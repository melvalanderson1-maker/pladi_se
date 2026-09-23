"""
seace_cronograma_batch.py
Job batch robusto: recorre todos los procesos 'vigentes' de seace_procesos,
extrae el cronograma completo de fases desde el módulo de proveedores de
SEACE (ICEfaces) y lo guarda en seace_cronograma_fases.

Diseñado para correr desatendido (Task Scheduler / Coolify), con:
- Login único al inicio de todo el batch
- Recuperación automática si la sesión cae a mitad de camino
- Timeout duro por proceso (nunca se cuelga indefinidamente)
- Reintentos acotados por proceso
- Logging a archivo + consola
- Resumen final de éxitos/fallos

Corre con: python seace_cronograma_batch.py [--limit N] [--headless]
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

SEACE_USER = os.getenv("SEACE_RNP_USER")
SEACE_PASS = os.getenv("SEACE_RNP_PASS")

TIMEOUT_POR_PROCESO_SEG = 45      # timeout duro: si un proceso individual tarda más, se aborta y sigue con el siguiente
MAX_REINTENTOS_POR_PROCESO = 2    # incluye el intento original
DELAY_MIN_ENTRE_PROCESOS = 2.5    # segundos, para no verse como ataque automatizado
DELAY_MAX_ENTRE_PROCESOS = 5.5
MAX_RELOGINS_POR_BATCH = 5        # tope de re-logins totales antes de abortar el batch entero

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
pool = pooling.MySQLConnectionPool(pool_name="cronograma_batch_pool", pool_size=3, **dbconfig)


# ---------------------------------------------------------------------------
# Base de datos
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
    """
    Trae los procesos a scrapear. titulo = nomenclatura (confirmado en el
    JSON de la API OCDS: tender.title == 'LP-SM-17-2026-GRJ-1' etc).
    Filtramos estado='vigente' porque son los únicos donde el cronograma
    con fases futuras tiene sentido revisar/actualizar.
    """
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
    """'LP-ABR-11-2026-MP-CFF/CS-1-1' -> '11' (primer segmento numérico que no es año de 4 dígitos)"""
    partes = re.split(r"[-/]", nomenclatura)
    for p in partes:
        if p.isdigit() and len(p) != 4:
            return p
    return None


def extraer_anio(nomenclatura: str) -> str | None:
    m = re.search(r"\b(20\d{2})\b", nomenclatura)
    return m.group(1) if m else None


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


async def login(page: Page) -> bool:
    """Intenta loguearse. Devuelve True/False según éxito, nunca lanza excepción."""
    try:
        await page.goto(LOGIN_URL, timeout=30000)
        await page.fill("#frmLogin\\:txtUsername", SEACE_USER, timeout=10000)
        await page.fill("#frmLogin\\:txtPassword", SEACE_PASS, timeout=10000)
        await page.click("#frmLogin input[type='submit'][value='Acceder']", timeout=10000)
        await page.wait_for_timeout(3000)

        # Modal de Términos y Condiciones (por texto, no por id del contenedor)
        try:
            texto_declaro = page.get_by_text("Declaro haber leído", exact=False).first
            await texto_declaro.wait_for(state="visible", timeout=8000)
            checkbox = texto_declaro.locator("xpath=..").locator("input[type='checkbox']")
            await checkbox.check(force=True, timeout=5000)
            await page.wait_for_timeout(500)
            boton_acepto = page.get_by_role("button", name="Acepto", exact=True)
            if await boton_acepto.count() == 0:
                boton_acepto = page.locator("input[type='submit'][value='Acepto']")
            await boton_acepto.first.click(timeout=8000)
            await page.wait_for_timeout(2000)
            if await page.locator("#frmLogin\\:txtUsername").count() > 0:
                if await page.locator("#frmLogin\\:txtUsername").is_visible():
                    await page.click("#frmLogin input[type='submit'][value='Acceder']", timeout=8000)
                    await page.wait_for_timeout(2000)
        except Exception:
            pass  # no apareció modal de T&C, seguimos

        # Modales genéricos de aviso (pueden salir 1 o 2 seguidos)
        await cerrar_modal_si_aparece(page)
        await cerrar_modal_si_aparece(page)

        await page.wait_for_selector("a:has-text('Cerrar Sesión')", timeout=20000)
        logger.info("Login OK")
        return True

    except Exception as e:
        logger.error(f"Login falló: {e}")
        try:
            await page.screenshot(path="debug_login_fallo.png", full_page=True)
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

    link_buscar = page.get_by_text("Buscar Procedimientos", exact=True).first
    await link_buscar.wait_for(state="visible", timeout=10000)
    await link_buscar.click()
    await page.wait_for_timeout(1200)
    await cerrar_modal_si_aparece(page, timeout=2000)

    await page.wait_for_selector("#frmVisualizarRepresentantesPostor\\:j_id271", timeout=15000)
    await page.select_option("#frmVisualizarRepresentantesPostor\\:j_id271", anio)
    await page.fill("#frmVisualizarRepresentantesPostor\\:j_id265", nro_seleccion)

    if entidad:
        campo_entidad = page.locator("#frmVisualizarRepresentantesPostor\\:siglaEntidadNombre")
        await campo_entidad.fill(entidad.strip())
        await page.wait_for_timeout(400)

    # Resetea el filtro de Estado (puede venir preseleccionado de una sesión previa)
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
        raise LookupError(f"Nomenclatura '{nomenclatura}' no apareció en resultados (0 filas coincidentes)")

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
# Orquestación del batch
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
        return False, str(e)  # "SESION_CAIDA", lo maneja el loop principal
    except (LookupError, ValueError) as e:
        return False, str(e)
    except PWTimeoutError as e:
        return False, f"Timeout de Playwright: {e}"
    except Exception as e:
        return False, f"Error inesperado: {e}"


async def run_batch(limit: int = None, headless: bool = True):
    ensure_table()
    procesos = obtener_procesos_vigentes(limit=limit)
    logger.info(f"Procesos vigentes a procesar: {len(procesos)}")

    if not procesos:
        logger.info("No hay procesos vigentes en seace_procesos. Nada que hacer.")
        return

    exitosos, fallidos = 0, 0
    relogins_usados = 0

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        page = await browser.new_page()

        if not await login(page):
            logger.critical("No se pudo iniciar sesión. Abortando batch por completo.")
            await browser.close()
            return

        for i, proceso in enumerate(procesos, start=1):
            tender_id = proceso["tender_id"]
            nomenclatura = proceso["nomenclatura"]
            entidad = proceso.get("entidad")
            logger.info(f"[{i}/{len(procesos)}] Procesando {nomenclatura} (tender_id={tender_id}, entidad={entidad})")

            intento_final_ok = False
            ultimo_error = None

            for intento in range(1, MAX_REINTENTOS_POR_PROCESO + 1):
                ok, error = await procesar_uno(page, tender_id, nomenclatura, entidad)

                if ok:
                    intento_final_ok = True
                    break

                ultimo_error = error
                logger.warning(f"  Intento {intento}/{MAX_REINTENTOS_POR_PROCESO} falló: {error}")

                if error == "SESION_CAIDA":
                    if relogins_usados >= MAX_RELOGINS_POR_BATCH:
                        logger.critical("Demasiados re-logins. Abortando el batch.")
                        await browser.close()
                        _resumen_final(exitosos, fallidos + (len(procesos) - i + 1))
                        return
                    logger.info("  Sesión caída detectada, re-logueando...")
                    relogins_usados += 1
                    if not await login(page):
                        logger.critical("Re-login falló. Abortando el batch.")
                        await browser.close()
                        _resumen_final(exitosos, fallidos + (len(procesos) - i + 1))
                        return
                    continue  # reintenta este mismo proceso tras re-loguear

                # Error normal (no de sesión): pequeña pausa antes de reintentar
                await page.wait_for_timeout(1500)

            if intento_final_ok:
                exitosos += 1
                logger.info(f"  ✅ OK")
            else:
                fallidos += 1
                logger.error(f"  ❌ Falló definitivamente: {ultimo_error}")
                registrar_error(tender_id, nomenclatura, ultimo_error, MAX_REINTENTOS_POR_PROCESO)
                try:
                    await page.screenshot(path=f"debug_fallo_{tender_id}.png", full_page=True)
                except Exception:
                    pass

            # Pausa entre procesos, para no parecer un ataque automatizado
            await page.wait_for_timeout(int(random.uniform(DELAY_MIN_ENTRE_PROCESOS, DELAY_MAX_ENTRE_PROCESOS) * 1000))

        await browser.close()

    _resumen_final(exitosos, fallidos)


def _resumen_final(exitosos: int, fallidos: int):
    total = exitosos + fallidos
    logger.info("=" * 60)
    logger.info(f"RESUMEN: {exitosos}/{total} exitosos, {fallidos}/{total} fallidos")
    if fallidos:
        logger.info("Detalle de fallos guardado en tabla seace_cronograma_errores")
    logger.info("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Batch de cronograma SEACE")
    parser.add_argument("--limit", type=int, default=None, help="Máximo de procesos a scrapear (para pruebas)")
    parser.add_argument("--headless", action="store_true", help="Correr sin ventana visible (usar en producción)")
    args = parser.parse_args()

    if not SEACE_USER or not SEACE_PASS:
        logger.critical("Faltan SEACE_RNP_USER / SEACE_RNP_PASS en el .env")
        sys.exit(1)

    asyncio.run(run_batch(limit=args.limit, headless=args.headless))