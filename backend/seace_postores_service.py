import json
import threading
from datetime import datetime

from db import get_db
from test_scraping_seace import (
    sync_playwright, URL_BUSCADOR, TIMEOUT_MS, activar_pestana_buscador,
    derivar_tipo_anio_nro, seleccionar_tipo_seleccion_por_nomenclatura,
    seleccionar_por_id_estable, llenar_numero_seleccion,
    obtener_contenedor_tabla, buscar_en_todas_las_paginas,
    entrar_a_ficha_de_fila, entrar_a_ofertas_presentadas, contar_postores,
    entrar_a_detalle_postor, extraer_datos_postor, extraer_items_postor,
    descargar_documentos_postor, volver_a_lista_postores,
    fijar_filtros_completos, ejecutar_flujo_busqueda_con_reintentos, DEBUG_DIR,hay_opcion_ofertas_presentadas
)
from routers.seace_router import DOCS_DIR

_locks_en_progreso = set()
_lock_guard = threading.Lock()


def _conexion():
    """Reutiliza el MISMO generador que usa tu Depends(get_db) en el
    router, sin necesidad de tocar db.py."""
    gen = get_db()
    conn = next(gen)
    return conn, gen


def _cerrar(gen):
    try:
        next(gen)
    except StopIteration:
        pass


def _marcar_estado(ocid: str, estado: str, error_msg: str | None = None, paso: str | None = None,
                    total_postores: int | None = None, postor_actual: int | None = None):
    conn, gen = _conexion()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO seace_postores_cache (ocid, estado, error_msg, paso, total_postores, postor_actual, actualizado_en)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
          estado = VALUES(estado), error_msg = VALUES(error_msg), paso = VALUES(paso),
          total_postores = VALUES(total_postores), postor_actual = VALUES(postor_actual),
          actualizado_en = VALUES(actualizado_en)
        """,
        (ocid, estado, error_msg, paso, total_postores, postor_actual, datetime.now()),
    )
    conn.commit()
    cur.close()
    _cerrar(gen)


def _actualizar_paso(ocid: str, paso: str, total_postores: int | None = None, postor_actual: int | None = None):
    """Actualiza SOLO el texto/porcentaje de progreso sin tocar el estado
    (que sigue en 'en_progreso'). Se llama en cada etapa del scraping."""
    _marcar_estado(ocid, "en_progreso", paso=paso, total_postores=total_postores, postor_actual=postor_actual)


def obtener_cache(ocid: str) -> dict:
    conn, gen = _conexion()
    cur = conn.cursor(dictionary=True)

    cur.execute(
        "SELECT estado, error_msg, paso, total_postores, postor_actual, actualizado_en "
        "FROM seace_postores_cache WHERE ocid = %s", (ocid,)
    )
    cache = cur.fetchone()

    cur.execute("SELECT id, ruc, razon_social, consorcio, estado_propuesta, estado_registro, mype, monto_total, items_json FROM seace_postores WHERE ocid = %s", (ocid,))
    postores_rows = cur.fetchall()

    postores = []
    for p in postores_rows:
        cur.execute("SELECT nombre, ruta_local FROM seace_postores_documentos WHERE ocid = %s AND (ruc = %s OR ruc IS NULL)", (ocid, p["ruc"]))
        docs = cur.fetchall()
        postores.append({
            "ruc": p["ruc"],
            "razon_social": p["razon_social"],
            "consorcio": p["consorcio"],
            "estado_propuesta": p["estado_propuesta"],
            "estado_registro": p["estado_registro"],
            "mype": p["mype"],
            "monto_total": float(p["monto_total"]) if p["monto_total"] else 0.0,
            "items": json.loads(p["items_json"]) if p["items_json"] else [],
            "documentos": docs,
        })

    cur.close()
    _cerrar(gen)

    if not cache:
        return {"ocid": ocid, "estado": "pendiente", "postores": [], "error": None,
                "paso": None, "total_postores": None, "postor_actual": None, "actualizado_en": None}
    return {
        "ocid": ocid,
        "estado": cache["estado"],
        "postores": postores,
        "error": cache["error_msg"],
        "paso": cache["paso"],
        "total_postores": cache["total_postores"],
        "postor_actual": cache["postor_actual"],
        "actualizado_en": cache["actualizado_en"].isoformat() if cache["actualizado_en"] else None,
    }


def _scrapear_postores_sync(ocid: str, nomenclatura: str):
    try:
        keywords_tipo, anio, nro = derivar_tipo_anio_nro(nomenclatura)
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=False,
                args=["--disable-blink-features=AutomationControlled"],
            )
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                ),
                accept_downloads=True,
                viewport={"width": 1366, "height": 900},
            )
            page = context.new_page()
            page.goto(URL_BUSCADOR, timeout=30000, wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle", timeout=TIMEOUT_MS)
            fijar_filtros_fn = lambda: fijar_filtros_completos(
                page,
                lambda: seleccionar_tipo_seleccion_por_nomenclatura(page, keywords_tipo),
                keywords_tipo, anio, nro, es_texto_exacto=False,
            )

            _actualizar_paso(ocid, "Buscando el proceso en el buscador de SEACE…")
            fila, idx_pagina, num_pagina, todas_las_filas = ejecutar_flujo_busqueda_con_reintentos(
                page, nomenclatura, fijar_filtros_fn
            )
            if not fila:
                carpeta_debug = DEBUG_DIR / "postores_fallidos" / ocid
                carpeta_debug.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(carpeta_debug / "resultado_vacio.png"), full_page=True)
                (carpeta_debug / "resultado_vacio.html").write_text(page.content(), encoding="utf-8")

                hay_challenge = page.locator("iframe[title*='recaptcha']").count() > 0
                mensaje = (
                    f"No se encontró la nomenclatura en SEACE "
                    f"(total filas revisadas: {len(todas_las_filas)}"
                    f"{', posible reCAPTCHA presente' if hay_challenge else ''}). "
                    f"Evidencia guardada en {carpeta_debug}"
                )
                _marcar_estado(ocid, "error", mensaje)
                context.close()
                browser.close()
                return

            _actualizar_paso(ocid, "Proceso encontrado, abriendo la ficha de selección…")
            contenedor = obtener_contenedor_tabla(page)
            entrar_a_ficha_de_fila(page, contenedor, idx_pagina)

            if not hay_opcion_ofertas_presentadas(page):
                _marcar_estado(ocid, "sin_ofertas", paso="Sin ofertas presentadas registradas aún")
                context.close()
                browser.close()
                return

            _actualizar_paso(ocid, "Revisando ofertas presentadas…")
            entrar_a_ofertas_presentadas(page)
            total = contar_postores(page)
            _actualizar_paso(ocid, f"Se encontraron {total} postor(es), revisando cada uno…", total_postores=total, postor_actual=0)

            conn, gen = _conexion()
            cur = conn.cursor()
            cur.execute("DELETE FROM seace_postores WHERE ocid = %s", (ocid,))
            cur.execute("DELETE FROM seace_postores_documentos WHERE ocid = %s", (ocid,))
            conn.commit()

            for i in range(total):
                try:
                    _actualizar_paso(ocid, f"Revisando postor {i+1} de {total}…", total_postores=total, postor_actual=i+1)
                    entrar_a_detalle_postor(page, i)
                    datos = extraer_datos_postor(page)
                    items = extraer_items_postor(page)

                    if not datos.get("ruc") and not datos.get("razon_social"):
                        print(f"  [aviso] postor #{i+1} vino sin datos, reintento una vez...")
                        page.wait_for_timeout(1500)
                        datos = extraer_datos_postor(page)
                        items = extraer_items_postor(page)

                    if not datos.get("ruc") and not datos.get("razon_social"):
                        print(f"  [aviso] postor #{i+1} sigue sin datos, lo omito.")
                        volver_a_lista_postores(page)
                        continue

                    monto_total = sum(
                        float((it.get("monto_ofertado") or "0").replace(",", "")) for it in items
                    )
                    docs = descargar_documentos_postor(page, ocid, datos.get("ruc"))

                    cur.execute(
                        """
                        INSERT INTO seace_postores
                            (ocid, ruc, razon_social, consorcio, estado_propuesta, estado_registro, mype, monto_total, items_json)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            ocid, datos.get("ruc"), datos.get("razon_social"), datos.get("consorcio"),
                            datos.get("estado_propuesta"), datos.get("estado_registro"), datos.get("mype"),
                            monto_total, json.dumps(items, ensure_ascii=False),
                        ),
                    )
                    for d in docs:
                        cur.execute(
                            "INSERT INTO seace_postores_documentos (ocid, ruc, nombre, ruta_local) VALUES (%s, %s, %s, %s)",
                            (ocid, datos.get("ruc"), d["nombre"], d["ruta_local"]),
                        )
                    conn.commit()

                    volver_a_lista_postores(page)
                except Exception as e:
                    print(f"  [aviso] postor #{i+1} falló ({e}), sigo con el siguiente...")
                    try:
                        volver_a_lista_postores(page)
                    except Exception:
                        pass
                    continue
            cur.close()
            _cerrar(gen)
            context.close()
            browser.close()
            _marcar_estado(ocid, "listo")
    except Exception as e:
        _marcar_estado(ocid, "error", str(e))
    finally:
        with _lock_guard:
            _locks_en_progreso.discard(ocid)


def disparar_refresco(ocid: str, nomenclatura: str) -> dict:
    with _lock_guard:
        if ocid in _locks_en_progreso:
            return obtener_cache(ocid)
        _locks_en_progreso.add(ocid)
    _marcar_estado(ocid, "en_progreso")
    hilo = threading.Thread(target=_scrapear_postores_sync, args=(ocid, nomenclatura), daemon=True)
    hilo.start()
    return obtener_cache(ocid)