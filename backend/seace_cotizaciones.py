"""
seace_cotizaciones.py
======================
Endpoints del flujo de cotización de un contrato específico en SEACE:
  - Detalle de cotización (items, RTM, archivos, datos generales del contrato)
  - Guardar borrador (registrar precios + RTM por ítem) -> procesar-por-item
  - Subir archivo de sustento -> registrar-archivo-cotizacion
  - Descargar el formato solicitado por la entidad
  - Enviar cotización definitiva -> enviar-cotizacion

Vive en archivo separado y se monta como router dentro de
seace_scraper_completo.py (mismo servidor, mismo puerto 4000).
Los imports a seace_scraper_completo se hacen DENTRO de cada función
(import diferido) para evitar import circular, ya que el archivo
principal importa este router a nivel de módulo.
"""
import asyncio
import re
import mimetypes
from pathlib import Path
from typing import Optional, List

import aiohttp
from fastapi import APIRouter, UploadFile, File, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from auth import requiere_rol, requiere_modulo, get_current_user  # se importan igual, están en la raíz de backend/

router = APIRouter(prefix="/cotizaciones", tags=["cotizaciones"])

# Los datos de la empresa (RUC, razón social) y la sesión ya NO son fijos:
# se leen dinámicamente de la empresa seleccionada en seace_scraper_completo.
# Ver EMPRESAS / _empresa_seleccionada / obtener_token_empresa / _headers_base_empresa.


# ─────────────────────────────────────────────────────────────────────────────
# MODELOS
# ─────────────────────────────────────────────────────────────────────────────

class ItemCotizacion(BaseModel):
    idContratoItem: int
    precioUnitario: float
    precioTotal: float
    idCotizacionItem: Optional[int] = None


class RtmCotizacion(BaseModel):
    idContratoRtmValor: int
    tipoProceso: str
    valor: str
    idCotizacionRtm: Optional[int] = None


class GuardarBorradorRequest(BaseModel):
    idCotizacion: Optional[int] = None  
    idContrato: int
    idContratoInvita: Optional[int] = None
    fecVigencia: str          # "YYYY-MM-DD HH:MM:SS"
    nomCorreo: str
    numCelular: str
    precioTotal: float
    items: List[ItemCotizacion]
    rtm: List[RtmCotizacion]


class EnviarCotizacionRequest(BaseModel):
    idCotizacion: int
    idContrato: int


# ─────────────────────────────────────────────────────────────────────────────
# 1) DETALLE — items + RTM + archivos + datos generales del contrato
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/detalle/{id_contrato}")
async def obtener_detalle_cotizacion(id_contrato: int, id_cotizacion: Optional[int] = None, usuario: dict = Depends(get_current_user)):
    import seace_scraper_completo as _sc
    from seace_scraper_completo import (
        _async_get_json, BASE_URL, URL_DETALLE_COT, URL_OBTENER_COT, URL_BUSCADOR, log,
        obtener_token_empresa, EMPRESAS,
    )

    # Se lee SIEMPRE en el momento (no import estático) para reflejar la
    # empresa que el usuario tenga seleccionada justo ahora en el navbar.
    ruc_activo = _sc._empresa_seleccionada

    _token = obtener_token_empresa(ruc_activo)
    log(f"[cotizaciones] GET detalle id_contrato={id_contrato} empresa={ruc_activo} — token presente: {bool(_token)}")
    if not _token:
        log(f"[cotizaciones] Sin token en este proceso — rechazando antes de golpear SEACE", "ERROR")
        return JSONResponse(
            status_code=401,
            content={"error": "No hay una sesión RNP activa en este servidor. Vincula tu cuenta RNP e inténtalo de nuevo."},
        )

    ref_cot = f"{BASE_URL}/cotizacion/cotizaciones/{id_contrato}/registrar-cotizacion"
    params_cot = {"id_contrato": id_contrato}
    if id_cotizacion:
        params_cot["id_cotizacion"] = id_cotizacion

    connector = aiohttp.TCPConnector(ssl=False)
    try:
        async with aiohttp.ClientSession(connector=connector) as session:
            det_cot, comp = await asyncio.wait_for(
                asyncio.gather(
                    _async_get_json(session, URL_DETALLE_COT, params=params_cot, referer=ref_cot, ruc=ruc_activo),
                    _async_get_json(session, URL_OBTENER_COT, params={"id_contrato": id_contrato}, referer=ref_cot, ruc=ruc_activo),
                ),
                timeout=25,
            )

            # Si no nos pasaron id_cotizacion, puede que ya exista un borrador
            # para este contrato en SEACE. listar-completo NO lo revela sin
            # conocer de antemano el id_cotizacion, así que lo buscamos vía
            # el mismo endpoint que usa el buscador de contratos (buscador),
            # filtrando por el número de contratación (nroDescripcion), que
            # sí devuelve el idCotizacion del borrador si existe.
            if not id_cotizacion and comp:
                from db import pool
                id_cot_existente = None
                conn_check = pool.get_connection()
                try:
                    cur_check = conn_check.cursor()
                    cur_check.execute(
                        "SELECT mc.id_cotizacion_seace FROM mis_cotizaciones mc "
                        "JOIN empresas e ON e.id = mc.id_empresa "
                        "WHERE mc.id_contrato = %s AND e.ruc = %s "
                        "AND mc.id_cotizacion_seace IS NOT NULL",
                        (id_contrato, ruc_activo)
                    )
                    fila_check = cur_check.fetchone()
                    cur_check.close()
                    if fila_check:
                        id_cot_existente = fila_check[0]
                finally:
                    conn_check.close()

                if id_cot_existente:
                    log(f"[cotizaciones] contrato {id_contrato} ya tiene borrador {id_cot_existente} (BD propia) — re-consultando detalle con id_cotizacion")
                    params_cot["id_cotizacion"] = id_cot_existente
                    det_cot = await _async_get_json(session, URL_DETALLE_COT, params=params_cot, referer=ref_cot, ruc=ruc_activo)
                else:
                    nro_descripcion = comp.get("nroDescripcion")
                    anio_contrato = comp.get("anio")
                    log(f"[cotizaciones] contrato {id_contrato} sin registro en BD propia — buscando en SEACE por nroDescripcion={nro_descripcion!r} anio={anio_contrato!r}")
                    if nro_descripcion:
                        params_buscador = {
                            "anio": anio_contrato,
                            "ruc": ruc_activo,
                            "cotizaciones_enviadas": "false",
                            "invitaciones_por_cotizar": "false",
                            "palabra_clave": nro_descripcion,
                            "orden": 2,
                            "page": 1,
                            "page_size": 5,
                        }
                        resultado_buscador = await _async_get_json(session, URL_BUSCADOR, params=params_buscador, referer=ref_cot, ruc=ruc_activo)
                        log(f"[cotizaciones][DEBUG] resultado_buscador COMPLETO = {resultado_buscador}", "INFO")

                        if resultado_buscador and resultado_buscador.get("data"):
                            for fila in resultado_buscador["data"]:
                                log(f"[cotizaciones][DEBUG] fila candidata: idContrato={fila.get('idContrato')!r} (buscado={id_contrato!r}) idCotizacion={fila.get('idCotizacion')!r}", "INFO")
                                if fila.get("idContrato") == id_contrato and fila.get("idCotizacion"):
                                    id_cot_existente = fila["idCotizacion"]
                                    break

                        if id_cot_existente:
                            log(f"[cotizaciones] contrato {id_contrato} ya tiene borrador {id_cot_existente} (SEACE) — re-consultando detalle con id_cotizacion")
                            params_cot["id_cotizacion"] = id_cot_existente
                            det_cot = await _async_get_json(session, URL_DETALLE_COT, params=params_cot, referer=ref_cot, ruc=ruc_activo)
                        else:
                            log(f"[cotizaciones] contrato {id_contrato} sin borrador previo detectado en el buscador de SEACE tampoco", "WARN")
    except asyncio.TimeoutError:
        log(f"[cotizaciones] TIMEOUT obteniendo detalle de id_contrato={id_contrato}", "ERROR")
        return JSONResponse(
            status_code=504,
            content={"error": "SEACE no respondió a tiempo. Verifica que la sesión RNP siga activa e inténtalo de nuevo."},
        )

    log(f"[cotizaciones] detalle_cotizacion={'OK' if det_cot else 'None'} datos_contrato={'OK' if comp else 'None'}")

    if det_cot is None and comp is None:
        return JSONResponse(
            status_code=502,
            content={"error": "No se pudo obtener el detalle de cotización desde SEACE (revisa la sesión RNP)"},
        )

    return {"detalle_cotizacion": det_cot, "datos_contrato": comp}

# ─────────────────────────────────────────────────────────────────────────────
# 2) GUARDAR BORRADOR
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/guardar-borrador")
async def guardar_borrador(payload: GuardarBorradorRequest, usuario: dict = Depends(requiere_modulo("cotizar"))):
    from seace_scraper_completo import (
        _headers_base_empresa, BASE_URL, refresh_token_empresa,
        obtener_token_empresa, EMPRESAS, _empresa_seleccionada,
    )

    _token = obtener_token_empresa()
    if not _token:
        return JSONResponse(
            status_code=401,
            content={"error": "No hay una sesión RNP activa en este servidor. Vincula tu cuenta RNP e inténtalo de nuevo."},
        )

    url = f"{BASE_URL}/v1/s8uit-services/cotizacion/cotizaciones/procesar-por-item"
    body = {
        "fecVigencia": payload.fecVigencia,
        "nomCorreo": payload.nomCorreo,
        "numCelular": payload.numCelular,
        "idContrato": payload.idContrato,
        "idContratoInvita": payload.idContratoInvita,
        "precioTotal": payload.precioTotal,
        "uitContratoInvitaRequest": {
            "codRuc": _empresa_seleccionada,
            "nomRazonSocial": EMPRESAS[_empresa_seleccionada]["razon_social"],
            "nomCorreo": payload.nomCorreo,
            "numCelular": payload.numCelular,
        },
        "uitCotizacionItemRequestList": [i.dict() for i in payload.items],
        "uitCotizacionRtmRequestList": [r.dict() for r in payload.rtm],
    }
    if payload.idCotizacion:
        body["idCotizacion"] = payload.idCotizacion

    headers = _headers_base_empresa()
    headers["content-type"] = "application/json"
    headers["referer"] = f"{BASE_URL}/cotizacion/cotizaciones/{payload.idContrato}/registrar-cotizacion"

    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        for intento in range(2):
            async with session.post(url, json=body, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as r:
                if r.status == 401 and intento == 0:
                    refresh_token_empresa()
                    headers = _headers_base_empresa()
                    headers["content-type"] = "application/json"
                    headers["referer"] = f"{BASE_URL}/cotizacion/cotizaciones/{payload.idContrato}/registrar-cotizacion"
                    continue
                if r.status == 200:
                    data = await r.json(content_type=None)
                    id_cotizacion_seace = data.get("valorNumerico")

                    from db import pool
                    conn = pool.get_connection()
                    try:
                        cur = conn.cursor()
                        cur.execute("""
                            INSERT INTO mis_cotizaciones
                                (id_contrato, id_cotizacion_seace, id_usuario, id_empresa, estado_cotizacion, fecha_cotizado)
                            VALUES (%s, %s, %s,
                                (SELECT id FROM empresas WHERE ruc = %s),
                                'borrador', NOW())
                            ON DUPLICATE KEY UPDATE
                                id_cotizacion_seace = VALUES(id_cotizacion_seace),
                                id_usuario = VALUES(id_usuario),
                                estado_cotizacion = 'borrador',
                                fecha_cotizado = NOW()
                        """, (payload.idContrato, id_cotizacion_seace, int(usuario["sub"]), _empresa_seleccionada))
                        conn.commit()
                        cur.close()
                    finally:
                        conn.close()

                    from socket_manager import notificar_cotizacion
                    await notificar_cotizacion(
                        usuario["nombre"], payload.idContrato,
                        "guardó un borrador de cotización para",
                        empresa=EMPRESAS[_empresa_seleccionada]["razon_social"],
                    )

                    return {"idCotizacion": id_cotizacion_seace, "mensaje": data.get("valorCadena")}
                texto = await r.text()
                from seace_scraper_completo import log
                log(f"[cotizaciones] guardar_borrador FALLÓ status={r.status} body_enviado={body} respuesta_completa={texto}", "ERROR")
                return JSONResponse(status_code=r.status, content={"error": texto})

    return JSONResponse(status_code=502, content={"error": "No se pudo guardar el borrador"})






# ─────────────────────────────────────────────────────────────────────────────
# 2c) AUDITORÍA — todas las cotizaciones enviadas, con usuario y empresa
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/auditoria")
async def auditoria_cotizaciones(usuario: dict = Depends(requiere_modulo("auditoria"))):
    """Lista TODAS las cotizaciones (borrador + enviadas) de TODOS los
    usuarios y empresas, para trazabilidad. Solo admin.

    Incluye, además del estado_cotizacion (borrador/enviada, que es TU
    trámite), el estado REAL del proceso en SEACE (Vigente / En
    Evaluación / Culminado) y, cuando está Culminado, el resultado:
    ganado (tu empresa fue ADJUDICADO), adjudicado_otro (otro proveedor
    ganó) o desierto.
    """
    from db import pool

    conn = pool.get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("""
            SELECT
                mc.id                   AS id_registro,
                mc.id_contrato,
                mc.id_cotizacion_seace,
                mc.estado_cotizacion,
                mc.fecha_cotizado,
                u.id                    AS id_usuario,
                u.nombre                AS nombre_usuario,
                e.id                    AS id_empresa,
                e.razon_social          AS razon_social,
                e.ruc                   AS ruc_empresa,
                c.des_contratacion,
                c.des_objeto_contrato,
                c.nom_entidad,
                c.id_estado_contrato,
                c.nom_estado_contrato,
                (SELECT COUNT(*) FROM archivos_cotizacion_subidos acs
                 WHERE acs.id_contrato = mc.id_contrato
                   AND acs.id_cotizacion = mc.id_cotizacion_seace) AS total_archivos,
                ro.tiene_adjudicado,
                ro.tiene_desierto,
                CASE WHEN EXISTS (
                    SELECT 1 FROM cotizacion_ofertas co_g
                    WHERE co_g.id_contrato = mc.id_contrato
                      AND co_g.nom_estado_cotiza = 'ADJUDICADO'
                      AND co_g.cod_ruc = e.ruc
                ) THEN 1 ELSE 0 END AS empresa_gano
            FROM mis_cotizaciones mc
            LEFT JOIN usuarios u ON u.id = mc.id_usuario
            LEFT JOIN empresas e ON e.id = mc.id_empresa
            LEFT JOIN contratos c ON c.id_contrato = mc.id_contrato
            LEFT JOIN (
                SELECT id_contrato,
                       MAX(nom_estado_cotiza = 'ADJUDICADO') AS tiene_adjudicado,
                       MAX(nom_estado_cotiza = 'DESIERTO')   AS tiene_desierto
                FROM cotizacion_ofertas
                GROUP BY id_contrato
            ) ro ON ro.id_contrato = c.id_contrato
            ORDER BY mc.fecha_cotizado DESC
        """)
        filas = cur.fetchall()
        cur.close()
    finally:
        conn.close()

    for f in filas:
        if f.get("fecha_cotizado"):
            f["fecha_cotizado"] = f["fecha_cotizado"].isoformat()

        # ── Resultado del proceso, solo tiene sentido si está Culminado (4) ──
        resultado = None
        if f.get("id_estado_contrato") == 4:
            if f.get("empresa_gano"):
                resultado = "ganado"
            elif f.get("tiene_adjudicado"):
                resultado = "adjudicado_otro"
            elif f.get("tiene_desierto"):
                resultado = "desierto"
            else:
                resultado = "culminado"
        f["resultado_proceso"] = resultado

        # limpiar campos auxiliares que ya no aporta al frontend
        f.pop("tiene_adjudicado", None)
        f.pop("tiene_desierto", None)
        f.pop("empresa_gano", None)

    return {"registros": filas}


# ─────────────────────────────────────────────────────────────────────────────
# 2b) MIS POSTULACIONES — historial de cotizaciones del usuario logueado
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/mis-postulaciones")
async def mis_postulaciones(usuario: dict = Depends(get_current_user)):
    """
    Igual que /cotizaciones/auditoria (estado real del proceso en SEACE +
    resultado de adjudicación), pero filtrado SOLO a las postulaciones
    del usuario logueado — no de toda la organización.
    """
    from db import pool

    conn = pool.get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("""
            SELECT
                mc.id                   AS id_registro,
                mc.id_contrato,
                mc.id_cotizacion_seace,
                mc.estado_cotizacion,
                mc.fecha_cotizado,
                e.razon_social          AS empresa_usada,
                e.ruc                   AS ruc_empresa,
                c.des_contratacion,
                c.des_objeto_contrato,
                c.nom_entidad,
                c.id_estado_contrato,
                c.nom_estado_contrato,
                (SELECT COUNT(*) FROM archivos_cotizacion_subidos acs
                 WHERE acs.id_contrato = mc.id_contrato
                   AND acs.id_cotizacion = mc.id_cotizacion_seace) AS total_archivos,
                ro.tiene_adjudicado,
                ro.tiene_desierto,
                CASE WHEN EXISTS (
                    SELECT 1 FROM cotizacion_ofertas co_g
                    WHERE co_g.id_contrato = mc.id_contrato
                      AND co_g.nom_estado_cotiza = 'ADJUDICADO'
                      AND co_g.cod_ruc = e.ruc
                ) THEN 1 ELSE 0 END AS empresa_gano
            FROM mis_cotizaciones mc
            LEFT JOIN empresas e ON e.id = mc.id_empresa
            LEFT JOIN contratos c ON c.id_contrato = mc.id_contrato
            LEFT JOIN (
                SELECT id_contrato,
                       MAX(nom_estado_cotiza = 'ADJUDICADO') AS tiene_adjudicado,
                       MAX(nom_estado_cotiza = 'DESIERTO')   AS tiene_desierto
                FROM cotizacion_ofertas
                GROUP BY id_contrato
            ) ro ON ro.id_contrato = c.id_contrato
            WHERE mc.id_usuario = %s
            ORDER BY mc.fecha_cotizado DESC
        """, (int(usuario["sub"]),))
        filas = cur.fetchall()
        cur.close()
    finally:
        conn.close()

    postulaciones = []
    for f in filas:
        resultado = None
        if f.get("id_estado_contrato") == 4:
            if f.get("empresa_gano"):
                resultado = "ganado"
            elif f.get("tiene_adjudicado"):
                resultado = "adjudicado_otro"
            elif f.get("tiene_desierto"):
                resultado = "desierto"
            else:
                resultado = "culminado"

        postulaciones.append({
            "id_registro": f["id_registro"],
            "id_contrato": f["id_contrato"],
            "id_cotizacion_seace": f["id_cotizacion_seace"],
            "estado_cotizacion": f["estado_cotizacion"],
            "fecha_cotizado": f["fecha_cotizado"].isoformat() if f["fecha_cotizado"] else None,
            "empresa_usada": f["empresa_usada"] or "—",
            "des_contratacion": f["des_contratacion"],
            "des_objeto_contrato": f["des_objeto_contrato"],
            "nom_entidad": f["nom_entidad"],
            "id_estado_contrato": f["id_estado_contrato"],
            "total_archivos": f["total_archivos"] or 0,
            "resultado_proceso": resultado,
        })

    return {"postulaciones": postulaciones}


# ─────────────────────────────────────────────────────────────────────────────
# 3) SUBIR ARCHIVO DE SUSTENTO
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/subir-archivo")
async def subir_archivo(id_cotizacion: int, id_contrato_archivo: int, id_contrato: Optional[int] = None, file: UploadFile = File(...), usuario: dict = Depends(requiere_modulo("cotizar"))):
    from seace_scraper_completo import (
        _headers_base_empresa, BASE_URL, refresh_token_empresa, log,
        guardar_bytes_archivo, CARPETA_SALIDA, STORAGE_BACKEND, _empresa_seleccionada,
    )

    url = f"{BASE_URL}/v1/s8uit-services/archivo/archivos-cotizaciones/registrar-archivo-cotizacion"
    contenido = await file.read()
    log(f"[cotizaciones] subir_archivo bytes leídos={len(contenido)} nombre={file.filename} content_type={file.content_type}", "INFO")

    if len(contenido) == 0:
        return JSONResponse(status_code=400, content={"error": "El archivo llegó vacío al backend"})

    referer = (
        f"{BASE_URL}/cotizacion/cotizaciones/{id_contrato}/registrar-cotizacion"
        f"?cotizacion={id_cotizacion}"
        if id_contrato
        else f"{BASE_URL}/cotizacion/cotizaciones"
    )

    # Confirmado desde el código fuente de SEACE (modal-procesar-archivos-cotizacion.component.ts):
    # fd.append('cotizacionArchivo', requestItem.payload.file)
    params = {"idCotizacion": id_cotizacion, "idContratoArchivo": id_contrato_archivo}

    connector = aiohttp.TCPConnector(ssl=False)
    headers = _headers_base_empresa()
    headers["referer"] = referer
    headers.pop("content-type", None)  # aiohttp arma el boundary correcto solo

    async with aiohttp.ClientSession(connector=connector) as session:
        for intento in range(2):
            form = aiohttp.FormData()
            form.add_field("cotizacionArchivo", contenido, filename=file.filename,
                            content_type=file.content_type or "application/octet-stream")

            async with session.post(url, params=params, data=form, headers=headers,
                                     timeout=aiohttp.ClientTimeout(total=60)) as r:
                if r.status == 401 and intento == 0:
                    refresh_token_empresa()
                    headers = _headers_base_empresa()
                    headers["referer"] = referer
                    headers.pop("content-type", None)
                    continue
                if r.status == 200:
                    data = await r.json(content_type=None)
                    log(f"[cotizaciones] subir_archivo OK → {data}", "INFO")

                    # ── Guardar copia propia para auditoría (local/Azure/AWS) ────────
                    # Carpeta identificada por contrato + cotización, así cualquier
                    # archivo que audites después sabes EXACTAMENTE a qué proceso
                    # y a qué cotización pertenece, sin ambigüedad.
                    carpeta_cot = CARPETA_SALIDA / "cotizaciones" / str(id_contrato) / str(id_cotizacion)
                    id_archivo_ref = data.get("valorNumerico") or id_contrato_archivo

                    ruta_o_key, size = guardar_bytes_archivo(
                        contenido, carpeta_cot, id_archivo_ref, file.filename
                    )

                    if ruta_o_key:
                        ruta_guardar = ruta_o_key
                        if STORAGE_BACKEND == "local":
                            # Guardamos SOLO la ruta relativa (nunca la absoluta del
                            # PC que subió el archivo), para que sea portable entre
                            # cualquier máquina que corra el backend.
                            try:
                                ruta_guardar = str(Path(ruta_o_key).relative_to(CARPETA_SALIDA))
                            except ValueError:
                                pass

                        from db import pool
                        conn = pool.get_connection()
                        try:
                            cur = conn.cursor()
                            cur.execute("""
                                INSERT INTO archivos_cotizacion_subidos
                                    (id_contrato, id_cotizacion, id_contrato_archivo,
                                     id_usuario, id_empresa, nombre_archivo, extension,
                                     storage_backend, ruta_o_key, bytes)
                                VALUES (%s, %s, %s, %s,
                                    (SELECT id FROM empresas WHERE ruc = %s),
                                    %s, %s, %s, %s, %s)
                            """, (
                                id_contrato, id_cotizacion, id_contrato_archivo,
                                int(usuario["sub"]), _empresa_seleccionada,
                                file.filename,
                                Path(file.filename).suffix.lstrip(".") if file.filename else None,
                                STORAGE_BACKEND, ruta_guardar, size,
                            ))
                            conn.commit()
                            cur.close()
                        finally:
                            conn.close()
                    else:
                        log(f"[cotizaciones] ⚠️ No se pudo guardar copia propia del archivo (id_contrato={id_contrato}, id_cotizacion={id_cotizacion})", "WARN")

                    return data
                texto = await r.text()
                log(f"[cotizaciones] subir_archivo FALLÓ status={r.status} respuesta={texto[:400]}", "ERROR")
                return JSONResponse(status_code=r.status, content={"error": texto[:400]})

    return JSONResponse(status_code=502, content={"error": "No se pudo subir el archivo"})
# ─────────────────────────────────────────────────────────────────────────────
# 3b) ELIMINAR ARCHIVO DE SUSTENTO YA SUBIDO
# ─────────────────────────────────────────────────────────────────────────────
@router.delete("/eliminar-archivo/{id_cotizacion_archivo}")
async def eliminar_archivo(id_cotizacion_archivo: int, usuario: dict = Depends(requiere_modulo("cotizar"))):
    from seace_scraper_completo import _headers_base_empresa, BASE_URL, refresh_token_empresa, obtener_token_empresa, log

    _token = obtener_token_empresa()
    if not _token:
        return JSONResponse(
            status_code=401,
            content={"error": "No hay una sesión RNP activa en este servidor. Vincula tu cuenta RNP e inténtalo de nuevo."},
        )

    url = f"{BASE_URL}/v1/s8uit-services/archivo/archivos-cotizaciones/eliminar-archivo-cotizacion/{id_cotizacion_archivo}"
    headers = _headers_base_empresa()
    headers["referer"] = f"{BASE_URL}/cotizacion/cotizaciones"

    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        for intento in range(2):
            async with session.delete(url, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as r:
                if r.status == 401 and intento == 0:
                    refresh_token_empresa()
                    headers = _headers_base_empresa()
                    headers["referer"] = f"{BASE_URL}/cotizacion/cotizaciones"
                    continue
                if r.status == 200:
                    try:
                        data = await r.json(content_type=None)
                    except Exception:
                        data = {"ok": True}
                    log(f"[cotizaciones] eliminar_archivo id={id_cotizacion_archivo} OK", "INFO")
                    return data
                texto = await r.text()
                log(f"[cotizaciones] eliminar_archivo id={id_cotizacion_archivo} FALLÓ status={r.status} respuesta={texto[:400]}", "ERROR")
                return JSONResponse(status_code=r.status, content={"error": texto[:400]})

    return JSONResponse(status_code=502, content={"error": "No se pudo eliminar el archivo"})


# ─────────────────────────────────────────────────────────────────────────────
# 4) DESCARGAR FORMATO SOLICITADO (proxy binario)
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/descargar-formato/{id_archivo}")
async def descargar_formato(id_archivo: int):
    from seace_scraper_completo import _headers_base_empresa, BASE_URL, URL_DESCARGA, refresh_token_empresa, obtener_token_empresa, log

    _token = obtener_token_empresa()
    if not _token:
        log(f"[cotizaciones] Sin token — rechazando descarga de id_archivo={id_archivo}", "ERROR")
        return JSONResponse(
            status_code=401,
            content={"error": "No hay una sesión RNP activa en este servidor. Vincula tu cuenta RNP e inténtalo de nuevo."},
        )

    url = f"{URL_DESCARGA}/{id_archivo}"
    headers = _headers_base_empresa()
    headers["referer"] = f"{BASE_URL}/cotizacion/cotizaciones"

    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        for intento in range(2):
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as r:
                if r.status == 401 and intento == 0:
                    refresh_token_empresa()
                    headers = _headers_base_empresa()
                    headers["referer"] = f"{BASE_URL}/cotizacion/cotizaciones"
                    continue
                if r.status != 200:
                    log(f"[cotizaciones] descarga de id_archivo={id_archivo} devolvió status={r.status}", "ERROR")
                    return JSONResponse(status_code=502, content={"error": "No se pudo descargar el archivo desde SEACE"})

                contenido = await r.read()
                mime = r.headers.get("Content-Type", "application/octet-stream").split(";")[0].strip()

                nombre = None
                disposicion = r.headers.get("Content-Disposition", "")
                match = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)"?', disposicion)
                if match:
                    nombre = match.group(1)
                if not nombre:
                    ext = mimetypes.guess_extension(mime) or ""
                    nombre = f"formato_{id_archivo}{ext}"
                break
        else:
            return JSONResponse(status_code=502, content={"error": "No se pudo descargar el archivo (sesión expirada)"})

# ─────────────────────────────────────────────────────────────────────────────
# 4b) AUTORELLENAR CON IA — descarga el formato de SEACE, lo rellena con
#     datos de la empresa + contrato usando Gemini, y lo deja guardado para
#     abrirlo en OnlyOffice ya lleno.
# ─────────────────────────────────────────────────────────────────────────────

class AutorellenarRequest(BaseModel):
    idCotizacion: int
    idContrato: int


@router.post("/autorellenar/{id_archivo}")
async def autorellenar_archivo(id_archivo: int, payload: AutorellenarRequest, usuario: dict = Depends(requiere_modulo("cotizar"))):
    from seace_scraper_completo import (
        _headers_base_empresa, BASE_URL, URL_DESCARGA, refresh_token_empresa,
        obtener_token_empresa, log, guardar_bytes_archivo, CARPETA_SALIDA,
        EMPRESAS, _empresa_seleccionada,
    )
    from gemini_rellenar_documento import rellenar_documento
    import tempfile

    _token = obtener_token_empresa()
    if not _token:
        return JSONResponse(status_code=401, content={"error": "No hay una sesión RNP activa en este servidor."})

    # 1) Descarga el formato original directo de SEACE (mismo mecanismo que descargar_formato)
    url = f"{URL_DESCARGA}/{id_archivo}"
    headers = _headers_base_empresa()
    headers["referer"] = f"{BASE_URL}/cotizacion/cotizaciones"

    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        for intento in range(2):
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as r:
                if r.status == 401 and intento == 0:
                    refresh_token_empresa()
                    headers = _headers_base_empresa()
                    headers["referer"] = f"{BASE_URL}/cotizacion/cotizaciones"
                    continue
                if r.status != 200:
                    log(f"[cotizaciones] autorellenar: no se pudo descargar id_archivo={id_archivo} status={r.status}", "ERROR")
                    return JSONResponse(status_code=502, content={"error": "No se pudo descargar el formato original desde SEACE"})
                contenido_original = await r.read()
                break
        else:
            return JSONResponse(status_code=502, content={"error": "Sesión expirada al descargar el formato"})

    # 2) Guarda el original en un temporal y define dónde queda el relleno
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp_in:
        tmp_in.write(contenido_original)
        ruta_entrada = tmp_in.name

    carpeta_rellenos = CARPETA_SALIDA / "cotizaciones" / str(payload.idContrato) / str(payload.idCotizacion) / "rellenos"
    carpeta_rellenos.mkdir(parents=True, exist_ok=True)
    ruta_salida = str(carpeta_rellenos / f"relleno_{id_archivo}.docx")

    # 3) Datos disponibles para Gemini: empresa activa + contrato
    empresa = {
        "ruc": _empresa_seleccionada,
        "razon_social": EMPRESAS[_empresa_seleccionada]["razon_social"],
    }

    from db import pool
    conn = pool.get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            "SELECT des_contratacion, des_objeto_contrato, nom_entidad FROM contratos WHERE id_contrato = %s",
            (payload.idContrato,),
        )
        contrato = cur.fetchone() or {}
        cur.close()
    finally:
        conn.close()

    # 4) Rellena con Gemini
    resultado = await rellenar_documento(ruta_entrada, ruta_salida, empresa, contrato)
    log(f"[cotizaciones] autorellenar id_archivo={id_archivo} → {resultado}", "INFO")

    return {"idContratoArchivo": id_archivo, "rutaRelleno": ruta_salida, **resultado}

@router.post("/enviar")
async def enviar_cotizacion(payload: EnviarCotizacionRequest, usuario: dict = Depends(requiere_modulo("cotizar"))):
    from seace_scraper_completo import _headers_base_empresa, BASE_URL, refresh_token_empresa
    from db import pool

    # Anti-duplicado: si otro usuario ya envió esta cotización, no se vuelve a enviar.
    conn = pool.get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("""
            SELECT mc.fecha_cotizado, u.nombre AS nombre_usuario
            FROM mis_cotizaciones mc
            JOIN usuarios u ON u.id = mc.id_usuario
            WHERE mc.id_contrato = %s AND mc.estado_cotizacion = 'enviada'
        """, (payload.idContrato,))
        ya_enviada = cur.fetchone()
        cur.close()
    finally:
        conn.close()

    if ya_enviada:
        return JSONResponse(
            status_code=409,
            content={"error": f"Esta cotización ya fue enviada por {ya_enviada['nombre_usuario']} el {ya_enviada['fecha_cotizado']}."},
        )

    url = f"{BASE_URL}/v1/s8uit-services/cotizacion/cotizaciones/enviar-cotizacion"
    params = {"id_cotizacion": payload.idCotizacion, "id_contrato": payload.idContrato}

    headers = _headers_base_empresa()
    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        for intento in range(2):
            async with session.post(url, params=params, headers=headers,
                                     timeout=aiohttp.ClientTimeout(total=30)) as r:
                if r.status == 401 and intento == 0:
                    refresh_token_empresa()
                    headers = _headers_base_empresa()
                    continue
                if r.status == 200:
                    data = await r.json(content_type=None)

                    from db import pool
                    conn = pool.get_connection()
                    try:
                        cur = conn.cursor()
                        cur.execute("""
                            UPDATE mis_cotizaciones
                            SET estado_cotizacion = 'enviada', fecha_cotizado = NOW()
                            WHERE id_contrato = %s
                        """, (payload.idContrato,))
                        cur.execute("""
                            DELETE FROM carrito_cotizaciones
                            WHERE id_contrato = %s
                        """, (payload.idContrato,))
                        conn.commit()
                        cur.close()
                    finally:
                        conn.close()

                    from seace_scraper_completo import EMPRESAS, _empresa_seleccionada
                    from socket_manager import notificar_cotizacion, notificar_carrito
                    await notificar_cotizacion(
                        usuario["nombre"], payload.idContrato,
                        "envió la cotización de",
                        empresa=EMPRESAS[_empresa_seleccionada]["razon_social"],
                    )
                    await notificar_carrito(usuario["nombre"], payload.idContrato, "quitado")

                    return data
                texto = await r.text()
                return JSONResponse(status_code=r.status, content={"error": texto[:400]})

    return JSONResponse(status_code=502, content={"error": "No se pudo enviar la cotización"})


# ─────────────────────────────────────────────────────────────────────────────
# 6) CARRITO — preselección de contratos por cotizar, persistida por usuario
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/carrito")
async def obtener_carrito(usuario: dict = Depends(get_current_user)):
    from db import pool

    conn = pool.get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("""
            SELECT
                c.id_contrato,
                c.des_contratacion,
                c.des_objeto_contrato,
                c.nom_entidad,
                c.nom_sigla,
                c.nom_area_usuaria,
                c.valor_max_uit,
                c.id_estado_contrato,
                c.fec_ini_cotizacion,
                c.fec_fin_cotizacion,
                c.nom_objeto_contrato,
                c.cotizar,
                cc.fecha_agregado
            FROM carrito_cotizaciones cc
            JOIN contratos c ON c.id_contrato = cc.id_contrato
            WHERE cc.id_usuario = %s
            ORDER BY cc.fecha_agregado DESC
        """, (int(usuario["sub"]),))
        filas = cur.fetchall()
        cur.close()
    finally:
        conn.close()

    return {"carrito": filas}


@router.post("/carrito/{id_contrato}")
async def agregar_al_carrito(id_contrato: int, usuario: dict = Depends(get_current_user)):
    from db import pool
    from socket_manager import notificar_carrito

    conn = pool.get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT IGNORE INTO carrito_cotizaciones (id_usuario, id_contrato)
            VALUES (%s, %s)
        """, (int(usuario["sub"]), id_contrato))
        conn.commit()
        cur.close()
    finally:
        conn.close()

    await notificar_carrito(usuario["nombre"], id_contrato, "agregado")
    return {"ok": True}


@router.delete("/carrito/{id_contrato}")
async def quitar_del_carrito(id_contrato: int, usuario: dict = Depends(get_current_user)):
    from db import pool
    from socket_manager import notificar_carrito

    conn = pool.get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            DELETE FROM carrito_cotizaciones
            WHERE id_usuario = %s AND id_contrato = %s
        """, (int(usuario["sub"]), id_contrato))
        conn.commit()
        cur.close()
    finally:
        conn.close()

    await notificar_carrito(usuario["nombre"], id_contrato, "quitado")
    return {"ok": True}