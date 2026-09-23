"""
seace_cronograma_batch.py
Job batch robusto: recorre todos los procesos 'vigentes' de seace_procesos,
extrae el cronograma completo de fases desde el módulo de proveedores de
SEACE (ICEfaces) y lo guarda en seace_cronograma_fases.

Diseñado para correr desatendido (Task Scheduler / Coolify) o de forma
interactiva, con:
- Soporte multi-cuenta real (SEACE solo permite 1 sesión activa por cuenta)
- Selección explícita de qué cuentas usar en cada corrida (nunca se loguea
  una cuenta que no elegiste, para no botar a alguien que ya la está usando)
- Un worker (browser context propio) por cuenta seleccionada, en paralelo
- Login con manejo robusto de Términos y Condiciones: nunca cuelga ni tumba
  todo el batch si el modal cambia o no aparece
- Recuperación automática si la sesión de un worker cae a mitad de camino
- Timeout duro por proceso (nunca se cuelga indefinidamente)
- Reintentos acotados por proceso
- Logging a archivo + consola
- Resumen final de éxitos/fallos

Uso:
  python seace_cronograma_batch.py --headless
      -> si hay más de 1 cuenta en el .env, te pregunta interactivamente
         con cuáles quieres trabajar (requiere terminal, no usar así en
         Task Scheduler/Coolify)

  python seace_cronograma_batch.py --headless --cuentas usuario1,usuario3
      -> usa exactamente esas cuentas, sin preguntar (esto es lo que debes
         usar en corridas desatendidas)

  python seace_cronograma_batch.py --headless --todas-las-cuentas
      -> usa todas las cuentas del .env, sin preguntar

  python seace_cronograma_batch.py --limit 20 --cuentas usuario1
      -> prueba rápida con 1 sola cuenta y 20 procesos
"""
import os
import re
import sys
import random
import asyncio
import logging
import argparse
from datetime import datetime

from playwright.async_api import async_playwright, Page, TimeoutError as PWTimeoutError
from mysql.connector import pooling
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------
LOGIN_URL = "https://prod1.seace.gob.pe/portal/"
ICEFACES_UPDATE_URL_FRAGMENT = "block/send-receive-updates"


def _cargar_cuentas() -> list[tuple[str, str]]:
    """
    Lee las cuentas SEACE del .env. Formato esperado:
        SEACE_ACCOUNTS=usuario1:clave1,usuario2:clave2,usuario3:clave3
    Si no existe SEACE_ACCOUNTS, cae a las variables antiguas
    SEACE_RNP_USER / SEACE_RNP_PASS (compatibilidad con el .env actual).
    """
    raw = os.getenv("SEACE_ACCOUNTS", "")
    cuentas = []
    for par in raw.split(","):
        par = par.strip()
        if not par or ":" not in par:
            continue
        usuario, clave = par.split(":", 1)
        usuario, clave = usuario.strip(), clave.strip()
        if usuario and clave:
            cuentas.append((usuario, clave))
    if not cuentas:
        u, p = os.getenv("SEACE_RNP_USER"), os.getenv("SEACE_RNP_PASS")
        if u and p:
            cuentas.append((u, p))
    return cuentas


TODAS_LAS_CUENTAS = _cargar_cuentas()

TIMEOUT_POR_PROCESO_SEG = 45      # timeout duro por proceso individual
MAX_REINTENTOS_POR_PROCESO = 2    # incluye el intento original
DELAY_MIN_ENTRE_PROCESOS = 1.5    # pausa entre procesos, por worker
DELAY_MAX_ENTRE_PROCESOS = 3.0
MAX_RELOGINS_POR_WORKER = 3       # tope de re-logins por worker antes de que ese worker se rinda
TIMEOUT_LOGIN_SEG = 25            # el login NUNCA puede colgarse más de esto (bajado de 45 -> falla rápido y reintenta)
MAX_INTENTOS_LOGIN_COMPLETO = 4   # reintentos COMPLETOS desde cero (goto + usuario/clave) si T&C o la verificación final fallan

LOG_FILE = "seace_cronograma_batch.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("seace_cronograma_batch")

dbconfig = {
    "host": os.getenv("MYSQL_HOST", "localhost"), "port": int(os.getenv("MYSQL_PORT", "3306")),
    "user": os.getenv("MYSQL_USER"),
    "password": os.getenv("MYSQL_PASSWORD"),
    "database": os.getenv("MYSQL_DATABASE"),
}
pool = pooling.MySQLConnectionPool(pool_name="cronograma_batch_pool", pool_size=5, **dbconfig)


# ---------------------------------------------------------------------------
# Base de datos (sin cambios respecto a la versión de 1 sola cuenta)
# ---------------------------------------------------------------------------
def ensure_table():
    sql = """
    CREATE TABLE IF NOT EXISTS seace_cronograma_fases (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tender_id VARCHAR(50) NOT NULL,
        nomenclatura VARCHAR(100),
        etapa VARCHAR(150) NOT NULL,
        fecha_inicio DATETIME NULL,
        fecha_fin DATETIME NULL,
        es_etapa_actual TINYINT(1) DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_tender_etapa (tender_id, etapa),
        INDEX idx_tender_id (tender_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS seace_cronograma_errores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tender_id VARCHAR(50) NOT NULL,
        nomenclatura VARCHAR(100),
        error TEXT,
        intentos INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """
    conn = pool.get_connection()
    cur = conn.cursor()
    for stmt in sql.split(";"):
        if stmt.strip():
            cur.execute(stmt)
    conn.commit()
    cur.close()
    conn.close()


def obtener_procesos_vigentes(limit: int = None) -> list[dict]:
    conn = pool.get_connection()
    cur = conn.cursor(dictionary=True)
    sql = """
        SELECT tender_id, titulo AS nomenclatura, entidad
        FROM seace_procesos
        WHERE estado = 'vigente'
          AND titulo IS NOT NULL
          AND titulo != ''
        ORDER BY updated_at DESC
    """
    if limit:
        sql += f" LIMIT {int(limit)}"
    cur.execute(sql)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows


def guardar_cronograma(tender_id: str, nomenclatura: str, fases: list[dict]):
    if not fases:
        return
    conn = pool.get_connection()
    cur = conn.cursor()
    for fase in fases:
        cur.execute(
            """
            INSERT INTO seace_cronograma_fases
                (tender_id, nomenclatura, etapa, fecha_inicio, fecha_fin, es_etapa_actual)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE
                fecha_inicio = VALUES(fecha_inicio),
                fecha_fin = VALUES(fecha_fin),
                es_etapa_actual = VALUES(es_etapa_actual)
            """,
            (
                tender_id, nomenclatura, fase["etapa"],
                parse_fecha(fase["fecha_inicio"]), parse_fecha(fase["fecha_fin"]),
                fase["es_etapa_actual"],
            ),
        )
    conn.commit()
    cur.close()
    conn.close()


def registrar_error(tender_id: str, nomenclatura: str, error: str, intentos: int):
    conn = pool.get_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO seace_cronograma_errores (tender_id, nomenclatura, error, intentos) VALUES (%s,%s,%s,%s)",
        (tender_id, nomenclatura, str(error)[:2000], intentos),
    )
    conn.commit()
    cur.close()
    conn.close()


def parse_fecha(valor: str):
    valor = (valor or "").strip()
    if not valor or valor == "---":
        return None
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y"):
        try:
            return datetime.strptime(valor, fmt)
        except ValueError:
            continue
    return None


def extraer_nro_seleccion(nomenclatura: str) -> str | None:
    partes = re.split(r"[-/]", nomenclatura)
    for p in partes:
        if p.isdigit() and len(p) != 4:
            return p
    return None


def extraer_anio(nomenclatura: str) -> str | None:
    m = re.search(r"\b(20\d{2})\b", nomenclatura)
    return m.group(1) if m else None


# Mapeo inferido del prefijo de la nomenclatura -> value de los combos
# "Tipo de Selección" / "Modalidad de Selección". Si el prefijo no está
# aquí, la función devuelve None y el llamador simplemente NO toca esos
# combos (se sigue buscando solo por Nro./Año, como hoy).
TIPO_SELECCION_MAP = {
    "LP": "82",         # Licitación Pública
    "CP": "75",          # Concurso Público
    "CP SER": "1881",    # Concurso Público de Servicios
    "CP CON": "1882",    # Concurso Público para Consultoría
}

MODALIDAD_SELECCION_MAP = {
    "SM": "381",    # Sin Modalidad
    "ABR": "1816",  # Abreviada
}


def extraer_tipo_modalidad(nomenclatura: str) -> tuple[str | None, str | None]:
    """
    Extrae (tipo_value, modalidad_value) del prefijo de la nomenclatura,
    ej. 'LP-SM-4-2026-...' -> ('82', '381'). Devuelve (None, None) si el
    prefijo no coincide con el mapeo conocido.
    """
    partes = nomenclatura.split("-")
    codigo_partes = []
    for p in partes:
        p = p.strip()
        if p.isdigit():
            break
        codigo_partes.append(p)

    if len(codigo_partes) < 2:
        return None, None

    modalidad_token = codigo_partes[-1].upper()
    tipo_token = "-".join(codigo_partes[:-1]).upper()

    return TIPO_SELECCION_MAP.get(tipo_token), MODALIDAD_SELECCION_MAP.get(modalidad_token)
# ---------------------------------------------------------------------------
# Selección de cuentas
# ---------------------------------------------------------------------------
def seleccionar_cuentas(cuentas: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """
    Muestra las cuentas disponibles del .env (solo el usuario, nunca la
    clave) y deja que el operador elija con cuáles trabajar en esta corrida.
    Las cuentas NO seleccionadas jamás se tocan: nunca se abre sesión con
    ellas, así no se desloguea a nadie que ya las esté usando.
    """
    if not cuentas:
        return []
    if len(cuentas) == 1:
        logger.info(f"Solo hay 1 cuenta configurada ({cuentas[0][0]}), se usará directamente.")
        return cuentas

    print("\nCuentas SEACE disponibles en tu .env:")
    for i, (usuario, _clave) in enumerate(cuentas, start=1):
        print(f"  {i}. {usuario}")
    print("  0. Cancelar")

    while True:
        resp = input(
            "\n¿Con cuáles quieres trabajar en esta corrida? "
            "(ej: 1,3  |  'todas'  |  0 para cancelar): "
        ).strip().lower()

        if resp in ("0", "cancelar"):
            logger.critical("Selección cancelada por el usuario. Abortando.")
            sys.exit(1)

        if resp in ("todas", "all", "*"):
            logger.info(f"Cuentas seleccionadas: TODAS ({', '.join(u for u, _ in cuentas)})")
            return cuentas

        try:
            indices = [int(x.strip()) for x in resp.split(",") if x.strip()]
        except ValueError:
            print("  ⚠ Formato no válido, usa números separados por coma (ej: 1,3).")
            continue

        if not indices or any(i < 1 or i > len(cuentas) for i in indices):
            print(f"  ⚠ Elige números entre 1 y {len(cuentas)}.")
            continue

        seleccion = [cuentas[i - 1] for i in sorted(set(indices))]
        nombres = ", ".join(u for u, _ in seleccion)
        logger.info(f"Cuentas seleccionadas para esta corrida: {nombres}")
        return seleccion


# ---------------------------------------------------------------------------
# Playwright: sesión y navegación
# ---------------------------------------------------------------------------
async def cerrar_modal_si_aparece(page: Page, timeout: int = 4000) -> bool:
    try:
        boton = page.locator("button, input[type='submit'], input[type='button']").filter(
            has_text=re.compile(r"^(Aceptar|Acepto)$")
        ).first
        await boton.wait_for(state="visible", timeout=timeout)
        await boton.click()
        logger.info("Modal genérico cerrado")
        await page.wait_for_timeout(600)
        return True
    except Exception:
        return False


async def sesion_esta_activa(page: Page) -> bool:
    """True si seguimos logueados (no volvimos a la pantalla de login)."""
    try:
        campo = page.locator("#frmLogin\\:txtUsername")
        if await campo.count() == 0:
            return True
        return not await campo.is_visible()
    except Exception:
        return True




async def aceptar_terminos_condiciones(page: Page, usuario: str, timeout_deteccion: int = 8000) -> str:
    """
    Detecta y acepta el modal de Términos y Condiciones de forma robusta,
    con varias estrategias de localización y verificación real de que el
    modal se cerró. Nunca lanza excepción; devuelve:
        "no_aparecio" -> el modal no salió (cuenta que ya lo aceptó antes)
        "aceptado"    -> se marcó el checkbox, se clickeó Acepto y el modal
                         se confirmó cerrado
        "fallo"       -> el modal apareció pero no se pudo aceptar
    """
    try:
        texto_declaro = page.get_by_text("Declaro haber leído", exact=False).first
        await texto_declaro.wait_for(state="visible", timeout=timeout_deteccion)
    except Exception:
        return "no_aparecio"

    logger.info(f"  [{usuario}] Modal de Términos y Condiciones detectado, procesando...")

    for intento in range(1, 3):  # hasta 2 intentos completos
        # --- Paso 1: marcar el checkbox (varias estrategias) ---
        checkbox_ok = False
        estrategias_checkbox = [
            lambda: texto_declaro.locator("xpath=ancestor::tr[1]").locator("input[type='checkbox']").first,
            lambda: texto_declaro.locator("xpath=..").locator("input[type='checkbox']").first,
            lambda: texto_declaro.locator("xpath=ancestor::*[self::div or self::td or self::li][1]").locator("input[type='checkbox']").first,
            lambda: page.locator("input[type='checkbox']").first,
        ]
        for i, estrategia in enumerate(estrategias_checkbox, start=1):
            try:
                candidato = estrategia()
                if await candidato.count() == 0:
                    continue
                await candidato.wait_for(state="visible", timeout=3000)
                await candidato.check(force=True, timeout=5000)
                await page.wait_for_timeout(300)
                if await candidato.is_checked():
                    checkbox_ok = True
                    logger.info(f"  [{usuario}] Checkbox de T&C marcado (estrategia {i}, intento {intento}).")
                    break
            except Exception:
                continue

        if not checkbox_ok:
            logger.warning(f"  [{usuario}] Intento {intento}: no se pudo marcar el checkbox de T&C.")
            await page.wait_for_timeout(800)
            continue

        # --- Paso 2: clic en "Acepto" (varias estrategias) ---
        boton_ok = False
        estrategias_boton = [
            lambda: page.get_by_role("button", name="Acepto", exact=True).first,
            lambda: page.locator("input[type='submit'][value='Acepto']").first,
            lambda: page.locator("button:has-text('Acepto')").first,
            lambda: page.get_by_text("Acepto", exact=True).first,
        ]
        for i, estrategia in enumerate(estrategias_boton, start=1):
            try:
                boton = estrategia()
                if await boton.count() == 0:
                    continue
                await boton.wait_for(state="visible", timeout=3000)
                await boton.click(timeout=5000, force=True)
                boton_ok = True
                logger.info(f"  [{usuario}] Botón 'Acepto' clickeado (estrategia {i}, intento {intento}).")
                break
            except Exception:
                continue

        if not boton_ok:
            logger.warning(f"  [{usuario}] Intento {intento}: no se pudo clickear el botón 'Acepto'.")
            await page.wait_for_timeout(800)
            continue

        await page.wait_for_timeout(2000)

        # --- Paso 3: verificar que el modal REALMENTE se cerró ---
        try:
            await texto_declaro.wait_for(state="hidden", timeout=5000)
            logger.info(f"  [{usuario}] Modal de T&C confirmado cerrado.")
        except Exception:
            try:
                sigue_visible = await page.get_by_text("Declaro haber leído", exact=False).first.is_visible()
            except Exception:
                sigue_visible = False
            if sigue_visible:
                logger.warning(f"  [{usuario}] Intento {intento}: el modal de T&C sigue visible después de aceptar.")
                await page.wait_for_timeout(800)
                continue

        # Tras aceptar T&C, a veces vuelve a mostrar el form de login
        campo_user = page.locator("#frmLogin\\:txtUsername")
        if await campo_user.count() > 0 and await campo_user.is_visible():
            await limpiar_overlays_fantasma(page)
            await page.click("#frmLogin input[type='submit'][value='Acceder']", timeout=5000, force=True)
            await page.wait_for_timeout(1500)

        return "aceptado"

    logger.error(f"  [{usuario}] No se pudo aceptar el modal de T&C tras 2 intentos.")
    try:
        await page.screenshot(path=f"debug_tyc_fallo_{usuario}.png", full_page=True)
    except Exception:
        pass
    return "fallo"



async def limpiar_overlays_fantasma(page: Page) -> None:
    """
    Elimina del DOM cualquier resto del modal de Términos y Condiciones
    (u otro overlay colapsado) que haya quedado de un intento anterior y
    esté interceptando clicks sobre el formulario de login. Simple
    hide/remove por JS; nunca falla.
    """
    try:
        await page.evaluate("""
            () => {
                document.querySelectorAll(
                    "#terminosCondiciones, .contenidoColapsadoDisposiciones, [id*='terminosCondiciones']"
                ).forEach(el => {
                    el.style.pointerEvents = 'none';
                    el.style.display = 'none';
                });
            }
        """)
    except Exception:
        pass




async def _un_intento_login(page: Page, usuario: str, clave: str) -> None:
    """
    Un solo intento COMPLETO de login, desde cero: goto -> llenar usuario
    y clave -> click Acceder -> Términos y Condiciones -> verificación
    final de que la sesión quedó activa. No atrapa errores (salvo lo que
    ya maneja aceptar_terminos_condiciones internamente); si algo falla,
    lanza excepción para que login() decida si reintenta desde cero.
    """
    await page.goto(LOGIN_URL, timeout=30000, wait_until="domcontentloaded")

    # Por si quedó algún overlay fantasma de un intento anterior cancelado
    # a mitad de camino, bloqueando clicks en el formulario de login.
    await limpiar_overlays_fantasma(page)

    await page.fill("#frmLogin\\:txtUsername", usuario, timeout=10000)
    await page.fill("#frmLogin\\:txtPassword", clave, timeout=10000)
    # force=True: evita que Playwright pierda hasta 10s reintentando el
    # click cuando detecta (falsamente) que un div colapsado del modal de
    # T&C "intercepta" el click. Ya limpiamos overlays fantasma arriba.
    await page.click("#frmLogin input[type='submit'][value='Acceder']", timeout=6000, force=True)
    await page.wait_for_timeout(1500)
    # --- Modal de Términos y Condiciones ---
    # Si el modal no aparece, seguimos igual (cuenta que ya lo aceptó
    # antes). Si aparece pero NO logramos aceptarlo de verdad, se lanza
    # excepción para que ESTE intento completo se dé por fallido y
    # login() arranque de cero (nuevo goto + usuario/clave) en el
    # siguiente intento.
    resultado_tyc = await aceptar_terminos_condiciones(page, usuario)
    if resultado_tyc == "fallo":
        raise RuntimeError("No se pudo aceptar el modal de Términos y Condiciones")

    # Modales genéricos de aviso (pueden salir 1 o 2 seguidos)
    await cerrar_modal_si_aparece(page)
    await cerrar_modal_si_aparece(page)

    # Verificación final robusta: bajo carga (varias cuentas trabajando en
    # paralelo) el servidor de SEACE puede tardar más en terminar de
    # procesar el login/T&C, así que el timeout aquí es más generoso
    # (25s) que antes (20s).
    await page.wait_for_selector("a:has-text('Cerrar Sesión')", timeout=25000)


async def login(page: Page, usuario: str, clave: str) -> bool:
    """
    Intenta loguearse con una cuenta específica. Devuelve True/False,
    NUNCA lanza excepción y NUNCA se cuelga.

    Hace hasta MAX_INTENTOS_LOGIN_COMPLETO intentos COMPLETOS DESDE CERO
    (nuevo goto + volver a llenar usuario/clave) si el modal de T&C no se
    puede aceptar correctamente, o si la verificación final ("Cerrar
    Sesión") no aparece a tiempo. Cada intento completo está acotado por
    TIMEOUT_LOGIN_SEG para que nunca se cuelgue indefinidamente.
    """
    for intento in range(1, MAX_INTENTOS_LOGIN_COMPLETO + 1):
        try:
            await asyncio.wait_for(_un_intento_login(page, usuario, clave), timeout=TIMEOUT_LOGIN_SEG)
            logger.info(f"[{usuario}] Login OK (intento {intento}/{MAX_INTENTOS_LOGIN_COMPLETO})")
            return True

        except asyncio.TimeoutError:
            logger.warning(f"[{usuario}] Intento {intento}/{MAX_INTENTOS_LOGIN_COMPLETO}: "
                            f"login se colgó más de {TIMEOUT_LOGIN_SEG}s.")
        except Exception as e:
            logger.warning(f"[{usuario}] Intento {intento}/{MAX_INTENTOS_LOGIN_COMPLETO}: login falló ({e}).")

        if intento < MAX_INTENTOS_LOGIN_COMPLETO:
            logger.info(f"[{usuario}] Reintentando login desde cero (usuario y contraseña de nuevo)...")
            await page.wait_for_timeout(2000)

    logger.error(f"[{usuario}] Login falló definitivamente tras {MAX_INTENTOS_LOGIN_COMPLETO} intentos.")
    try:
        await page.screenshot(path=f"debug_login_fallo_{usuario}.png", full_page=True)
    except Exception:
        pass
    return False


async def buscar_y_extraer_cronograma(page: Page, nomenclatura: str, entidad: str = None) -> list[dict]:
    """
    Busca el proceso por Nro. de selección + Año, abre su ficha y devuelve
    la lista de fases. Lanza excepción si algo falla (el llamador la captura).
    """
    anio = extraer_anio(nomenclatura)
    nro_seleccion = extraer_nro_seleccion(nomenclatura)
    if not anio or not nro_seleccion:
        raise ValueError(f"No se pudo extraer año/nro de selección de '{nomenclatura}'")
    tipo_value, modalidad_value = extraer_tipo_modalidad(nomenclatura)

    link_buscar = page.get_by_text("Buscar Procedimientos", exact=True).first
    await link_buscar.wait_for(state="visible", timeout=10000)

    # Limpieza preventiva: el overlay fantasma de T&C intercepta el click
    # y sin force=True Playwright gasta los 30s completos reintentando
    # contra un elemento que nunca va a soltar el pointer-events.
    await limpiar_overlays_fantasma(page)
    await cerrar_modal_si_aparece(page, timeout=1500)
    try:
        await link_buscar.click(timeout=8000, force=True)
    except PWTimeoutError:
        # Un solo reintento por si el overlay reapareció justo antes del click.
        await limpiar_overlays_fantasma(page)
        await cerrar_modal_si_aparece(page, timeout=1500)
        await link_buscar.click(timeout=8000, force=True)

    await page.wait_for_timeout(1200)
    await cerrar_modal_si_aparece(page, timeout=2000)

    # Bajo carga (varias cuentas trabajando en paralelo) el formulario de
    # búsqueda a veces tarda más de 15s en aparecer tras el clic. Se sube
    # el timeout a 30s y, si aun así no aparece, se reintenta el clic UNA
    # vez antes de darse por vencido (a veces el primer clic no termina de
    # procesarse en el servidor y hay que insistir).
    try:
        await page.wait_for_selector("#frmVisualizarRepresentantesPostor\\:j_id271", timeout=30000)
    except PWTimeoutError:
        logger.info("  El formulario de búsqueda tardó en aparecer, reintentando el clic...")
        await cerrar_modal_si_aparece(page, timeout=1500)
        await link_buscar.click()
        await page.wait_for_timeout(1200)
        await cerrar_modal_si_aparece(page, timeout=2000)
        await page.wait_for_selector("#frmVisualizarRepresentantesPostor\\:j_id271", timeout=30000)

    await page.select_option("#frmVisualizarRepresentantesPostor\\:j_id271", anio)
    await page.fill("#frmVisualizarRepresentantesPostor\\:j_id265", nro_seleccion)

    # Filtra por Tipo/Modalidad cuando se pudo deducir del prefijo. Esto
    # reduce ~240 resultados (1 entidad, 1 nro. de selección) a normalmente
    # 1, evitando depender de la paginación que hoy no se recorre.
    if tipo_value:
        try:
            # Cambiar el Tipo dispara un AJAX (iceSubmitPartial) que puede
            # repoblar/filtrar el combo de Modalidad. Esperamos esa
            # respuesta en vez de un sleep fijo, para no leer el combo de
            # Modalidad a mitad de la actualización.
            async with page.expect_response(
                lambda r: ICEFACES_UPDATE_URL_FRAGMENT in r.url, timeout=8000
            ):
                await page.select_option("#frmVisualizarRepresentantesPostor\\:j_id250", tipo_value)
        except Exception:
            logger.warning(f"  No se pudo setear Tipo de Selección para '{nomenclatura}'")

    if modalidad_value:
        try:
            # No forzar el value: primero verificamos si sigue existiendo
            # como <option> real tras el filtrado por Tipo. Si el Tipo
            # elegido no admite esa modalidad, la omitimos en vez de
            # lanzar una excepción y dejar el formulario a medio actualizar.
            valores_disponibles = await page.eval_on_selector_all(
                "#frmVisualizarRepresentantesPostor\\:j_id257 option",
                "opts => opts.map(o => o.value)"
            )
            if modalidad_value in valores_disponibles:
                await page.select_option("#frmVisualizarRepresentantesPostor\\:j_id257", modalidad_value)
                await page.wait_for_timeout(500)
            else:
                logger.info(
                    f"  Modalidad '{modalidad_value}' no aplica para el Tipo elegido de "
                    f"'{nomenclatura}' (se omite; el filtro por Tipo ya alcanza)"
                )
        except Exception:
            logger.warning(f"  No se pudo verificar/setear Modalidad de Selección para '{nomenclatura}'")

    if entidad:
        campo_entidad = page.locator("#frmVisualizarRepresentantesPostor\\:siglaEntidadNombre")
        await campo_entidad.fill(entidad.strip())
        await page.wait_for_timeout(400)

    try:
        await page.select_option("#frmVisualizarRepresentantesPostor\\:j_id261", "-1")
    except Exception:
        pass

    async with page.expect_response(lambda r: ICEFACES_UPDATE_URL_FRAGMENT in r.url, timeout=15000) as resp_info:
        await page.click("#frmVisualizarRepresentantesPostor\\:j_id331")
    await resp_info.value
    await cerrar_modal_si_aparece(page, timeout=2000)

    if not await sesion_esta_activa(page):
        raise ConnectionError("SESION_CAIDA")

    await page.wait_for_selector("#frmVisualizarRepresentantesPostor\\:dtProcedimiento", timeout=15000)

    filas = await page.query_selector_all(
        "tr[id^='frmVisualizarRepresentantesPostor:dtProcedimiento:']"
    )
    fila_encontrada = None
    for fila in filas:
        celda = await fila.query_selector("td.stylePersonalizado2 span")
        if celda and (await celda.inner_text()).strip() == nomenclatura.strip():
            fila_encontrada = fila
            break

    if fila_encontrada is None:
        pista = "" if (tipo_value and modalidad_value) else " (sin filtro Tipo/Modalidad — probablemente está en otra página)"
        raise LookupError(f"Nomenclatura '{nomenclatura}' no apareció en resultados (0 filas coincidentes){pista}")

    btn_ficha = await fila_encontrada.query_selector("input[title='Ficha de Selección']")
    if not btn_ficha:
        raise LookupError("Botón 'Ficha de Selección' no encontrado en la fila")

    async with page.expect_response(lambda r: ICEFACES_UPDATE_URL_FRAGMENT in r.url, timeout=15000) as resp_info:
        await btn_ficha.click()
    await resp_info.value
    await page.wait_for_selector("#frmRegistrarDocumentacionCP\\:dtDocumentosGenerales", timeout=20000)

    filas_cronograma = await page.query_selector_all(
        "table#frmRegistrarDocumentacionCP\\:dtDocumentosGenerales tbody tr"
    )
    resultado = []
    for fila in filas_cronograma:
        html = await fila.inner_html()
        es_actual = "etapaActual" in html
        celdas = await fila.query_selector_all("table tbody tr td")
        if len(celdas) < 3:
            continue
        etapa = (await celdas[0].inner_text()).strip()
        fecha_inicio = (await celdas[1].inner_text()).strip()
        fecha_fin = (await celdas[2].inner_text()).strip()
        if not etapa:
            continue
        resultado.append({
            "etapa": etapa, "fecha_inicio": fecha_inicio,
            "fecha_fin": fecha_fin, "es_etapa_actual": es_actual,
        })
    return resultado


# ---------------------------------------------------------------------------
# Orquestación del batch (multi-cuenta, en paralelo)
# ---------------------------------------------------------------------------
async def procesar_uno(page: Page, tender_id: str, nomenclatura: str, entidad: str = None) -> tuple[bool, str | None]:
    """
    Devuelve (exito, motivo_error). Nunca lanza excepción hacia afuera:
    todo error queda capturado y descrito en motivo_error.
    """
    try:
        fases = await asyncio.wait_for(
            buscar_y_extraer_cronograma(page, nomenclatura, entidad),
            timeout=TIMEOUT_POR_PROCESO_SEG,
        )
        if not fases:
            return False, "Cronograma vacío (0 fases parseadas)"
        guardar_cronograma(tender_id, nomenclatura, fases)
        return True, None

    except asyncio.TimeoutError:
        return False, f"TIMEOUT (> {TIMEOUT_POR_PROCESO_SEG}s)"
    except ConnectionError as e:
        return False, str(e)  # "SESION_CAIDA"
    except (LookupError, ValueError) as e:
        return False, str(e)
    except PWTimeoutError as e:
        return False, f"Timeout de Playwright: {e}"
    except Exception as e:
        return False, f"Error inesperado: {e}"


async def _worker(worker_id: int, usuario: str, clave: str, browser, cola: asyncio.Queue,
                   contador: dict, total: int):
    """
    Un worker = una cuenta SEACE real y propia (browser context propio).
    SEACE permite solo UNA sesión activa por cuenta, así que este worker
    SOLO usa 'usuario'/'clave' — nunca toca las demás cuentas del .env.
    """
    context = await browser.new_context()
    page = await context.new_page()

    if not await login(page, usuario, clave):
        logger.critical(f"[w{worker_id}/{usuario}] No pudo loguearse. Este worker no procesará nada.")
        await context.close()
        return

    relogins = 0

    while True:
        try:
            proceso = cola.get_nowait()
        except asyncio.QueueEmpty:
            break

        tender_id = proceso["tender_id"]
        nomenclatura = proceso["nomenclatura"]
        entidad = proceso.get("entidad")

        intento_final_ok = False
        ultimo_error = None

        for intento in range(1, MAX_REINTENTOS_POR_PROCESO + 1):
            ok, error = await procesar_uno(page, tender_id, nomenclatura, entidad)

            if ok:
                intento_final_ok = True
                break

            ultimo_error = error
            logger.warning(f"  [w{worker_id}/{usuario}] Intento {intento}/{MAX_REINTENTOS_POR_PROCESO} "
                            f"falló ({nomenclatura}): {error}")

            if error == "SESION_CAIDA":
                if relogins >= MAX_RELOGINS_POR_WORKER:
                    logger.critical(f"[w{worker_id}/{usuario}] Demasiados re-logins; este worker se rinde "
                                     f"(los procesos que le quedaban en cola los toman los demás workers).")
                    await context.close()
                    return
                logger.info(f"  [w{worker_id}/{usuario}] Sesión caída, re-logueando...")
                relogins += 1
                if not await login(page, usuario, clave):
                    logger.critical(f"[w{worker_id}/{usuario}] Re-login falló; este worker se rinde.")
                    await context.close()
                    return
                continue  # reintenta este mismo proceso tras re-loguear

            await page.wait_for_timeout(1500)

        if intento_final_ok:
            contador["exitosos"] += 1
            hechos = contador["exitosos"] + contador["fallidos"]
            logger.info(f"[w{worker_id}/{usuario}] ✅ OK ({hechos}/{total}) {nomenclatura}")
        else:
            contador["fallidos"] += 1
            hechos = contador["exitosos"] + contador["fallidos"]
            logger.error(f"[w{worker_id}/{usuario}] ❌ Falló definitivamente ({hechos}/{total}) "
                         f"{nomenclatura}: {ultimo_error}")
            registrar_error(tender_id, nomenclatura, ultimo_error, MAX_REINTENTOS_POR_PROCESO)
            try:
                await page.screenshot(path=f"debug_fallo_{tender_id}.png", full_page=True)
            except Exception:
                pass

        await page.wait_for_timeout(int(random.uniform(DELAY_MIN_ENTRE_PROCESOS, DELAY_MAX_ENTRE_PROCESOS) * 1000))

    await context.close()
    logger.info(f"[w{worker_id}/{usuario}] Sin más procesos en cola, worker termina.")


async def run_batch(limit: int = None, headless: bool = True, cuentas: list[tuple[str, str]] = None):
    ensure_table()
    procesos = obtener_procesos_vigentes(limit=limit)
    logger.info(f"Procesos vigentes a procesar: {len(procesos)}")

    if not procesos:
        logger.info("No hay procesos vigentes en seace_procesos. Nada que hacer.")
        return

    if not cuentas:
        logger.critical("No hay cuentas SEACE seleccionadas para esta corrida. Abortando.")
        return

    cola: asyncio.Queue = asyncio.Queue()
    for proceso in procesos:
        cola.put_nowait(proceso)

    contador = {"exitosos": 0, "fallidos": 0}
    total = len(procesos)

    logger.info(f"Arrancando con {len(cuentas)} cuenta(s) en paralelo: {', '.join(u for u, _ in cuentas)}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        tasks = [
            asyncio.create_task(_worker(i, usuario, clave, browser, cola, contador, total))
            for i, (usuario, clave) in enumerate(cuentas, start=1)
        ]
        await asyncio.gather(*tasks)
        await browser.close()

    _resumen_final(contador["exitosos"], contador["fallidos"])


def _resumen_final(exitosos: int, fallidos: int):
    total = exitosos + fallidos
    logger.info("=" * 60)
    logger.info(f"RESUMEN: {exitosos}/{total} exitosos, {fallidos}/{total} fallidos")
    if fallidos:
        logger.info("Detalle de fallos guardado en tabla seace_cronograma_errores")
    logger.info("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Batch de cronograma SEACE (multi-cuenta)")
    parser.add_argument("--limit", type=int, default=None, help="Máximo de procesos a scrapear (para pruebas)")
    parser.add_argument("--headless", action="store_true", help="Correr sin ventana visible (usar en producción)")
    parser.add_argument("--cuentas", type=str, default=None,
                         help="Usuarios a usar, separados por coma (ej: user1,user2). "
                              "OBLIGATORIO en corridas desatendidas (Task Scheduler/Coolify): "
                              "sin terminal interactiva no se puede preguntar.")
    parser.add_argument("--todas-las-cuentas", action="store_true",
                         help="Usa todas las cuentas del .env sin preguntar.")
    args = parser.parse_args()

    if not TODAS_LAS_CUENTAS:
        logger.critical("Falta SEACE_ACCOUNTS (o SEACE_RNP_USER/SEACE_RNP_PASS) en el .env")
        sys.exit(1)

    if args.todas_las_cuentas:
        cuentas_elegidas = TODAS_LAS_CUENTAS

    elif args.cuentas:
        usuarios_pedidos = {u.strip() for u in args.cuentas.split(",") if u.strip()}
        cuentas_elegidas = [c for c in TODAS_LAS_CUENTAS if c[0] in usuarios_pedidos]
        faltantes = usuarios_pedidos - {c[0] for c in cuentas_elegidas}
        if faltantes:
            logger.critical(f"Estos usuarios no están en SEACE_ACCOUNTS del .env: {', '.join(faltantes)}")
            sys.exit(1)

    elif sys.stdin.isatty():
        cuentas_elegidas = seleccionar_cuentas(TODAS_LAS_CUENTAS)

    else:
        logger.critical(
            "Corriendo sin terminal interactiva (Task Scheduler/Coolify) y sin --cuentas: "
            "no se puede preguntar qué cuentas usar. Pasa --cuentas usuario1,usuario2 "
            "o --todas-las-cuentas de forma explícita en la tarea programada."
        )
        sys.exit(1)

    logger.info(f"Cuentas SEACE en el .env: {len(TODAS_LAS_CUENTAS)} | usando en esta corrida: {len(cuentas_elegidas)}")
    asyncio.run(run_batch(limit=args.limit, headless=args.headless, cuentas=cuentas_elegidas))