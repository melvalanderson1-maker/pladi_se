"""
seace_cronograma_scraper.py
Scraper de cronograma de fases desde el módulo de proveedores de SEACE
(ICEfaces), usando credenciales RNP. Versión Playwright (async).

Instalar: pip install playwright && playwright install chromium
Corre con: python seace_cronograma_scraper.py <anio> "<nomenclatura>"
"""
import os
import re
import logging
import asyncio
from datetime import datetime

from playwright.async_api import async_playwright, Page
from mysql.connector import pooling
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("seace_cronograma")

LOGIN_URL = "https://prod1.seace.gob.pe/portal/"
BUSCADOR_URL = "https://prod1.seace.gob.pe/SeaceWeb-PRO/jspx/sel/procesoseleccionficha/buscarProcedimientosSeleccion.iface"
ICEFACES_UPDATE_URL_FRAGMENT = "block/send-receive-updates"

SEACE_USER = os.getenv("SEACE_RNP_USER")
SEACE_PASS = os.getenv("SEACE_RNP_PASS")

dbconfig = {
    "host": os.getenv("MYSQL_HOST", "localhost"), "port": int(os.getenv("MYSQL_PORT", "3306")),
    "user": os.getenv("MYSQL_USER"),
    "password": os.getenv("MYSQL_PASSWORD"),
    "database": os.getenv("MYSQL_DATABASE"),
}
pool = pooling.MySQLConnectionPool(pool_name="cronograma_pool", pool_size=2, **dbconfig)




async def cerrar_modal_si_aparece(page: Page, timeout: int = 4000):
    """
    Cierra cualquier modal genérico de SEACE que tenga un botón
    'Aceptar' o 'Acepto' visible. No falla si no hay modal — solo
    lo intenta con timeout corto y sigue de largo.
    """
    try:
        boton = page.locator("button, input[type='submit'], input[type='button']").filter(
            has_text=re.compile(r"^(Aceptar|Acepto)$")
        ).first
        await boton.wait_for(state="visible", timeout=timeout)
        await boton.click()
        logger.info("Modal genérico cerrado (botón Aceptar/Acepto)")
        await page.wait_for_timeout(800)
        return True
    except Exception:
        return False


async def login(page: Page):
    await page.goto(LOGIN_URL)
    await page.fill("#frmLogin\\:txtUsername", SEACE_USER)
    await page.fill("#frmLogin\\:txtPassword", SEACE_PASS)
    await page.click("#frmLogin input[type='submit'][value='Acceder']")

    # Le damos tiempo a que la respuesta del login (AJAX de ICEfaces) llegue
    await page.wait_for_timeout(3000)

    # Modal de Términos y Condiciones: apuntamos por TEXTO visible, no por el
    # id del form contenedor (ese permanece "hidden" aunque el popup se vea).
    try:
        texto_declaro = page.get_by_text("Declaro haber leído", exact=False).first
        await texto_declaro.wait_for(state="visible", timeout=10000)
        logger.info("Modal de Términos y Condiciones detectado (por texto)")

        # El checkbox vive en el mismo contenedor inmediato que ese texto
        contenedor = texto_declaro.locator("xpath=..")
        checkbox = contenedor.locator("input[type='checkbox']")
        await checkbox.wait_for(state="visible", timeout=5000)
        await checkbox.check(force=True)
        logger.info("Checkbox marcado")

        await page.wait_for_timeout(500)  # da tiempo a que el JS habilite el botón

        boton_acepto = page.get_by_role("button", name="Acepto", exact=True)
        if await boton_acepto.count() == 0:
            boton_acepto = page.locator("input[type='submit'][value='Acepto']")
        await boton_acepto.first.click(timeout=8000)
        logger.info("Botón 'Acepto' clickeado")
        await page.wait_for_timeout(2000)

        # Tras aceptar, puede que haya que re-enviar el login
        if await page.locator("#frmLogin\\:txtUsername").count() > 0:
            campo_visible = await page.locator("#frmLogin\\:txtUsername").is_visible()
            if campo_visible:
                logger.info("Formulario de login sigue visible tras aceptar; reintentando 'Acceder'")
                await page.click("#frmLogin input[type='submit'][value='Acceder']")
                await page.wait_for_timeout(2000)

    except Exception as e:
        logger.info(f"Error manejando modal de Términos y Condiciones: {e}")
        await page.screenshot(path="debug_modal_error.png", full_page=True)

    # --- DIAGNÓSTICO DECISIVO ---
    await page.screenshot(path="debug_post_login.png", full_page=True)

    # ¿El formulario de login SIGUE presente? Si sí, el login falló.
    campo_user_sigue_ahi = await page.locator("#frmLogin\\:txtUsername").count()
    logger.info(f"Campo de usuario aún visible (login falló si es 1): {campo_user_sigue_ahi}")

    # Busca CUALQUIER texto relacionado a sesión iniciada, sin importar mayúsculas/tildes
    texto_pagina = await page.locator("body").inner_text()
    with open("debug_body_text.txt", "w", encoding="utf-8") as f:
        f.write(texto_pagina)
    logger.info("Texto completo del body guardado en debug_body_text.txt")


        # Cierra el modal de "Mensaje" de aviso al proveedor (si aparece)
    await cerrar_modal_si_aparece(page)
    await cerrar_modal_si_aparece(page)  # por si aparece otro justo después

    await page.wait_for_selector("a:has-text('Cerrar Sesión')", timeout=20000)
    logger.info("Login OK")
    # -----------------------------

    await page.wait_for_selector("a:has-text('Cerrar Sesión')", timeout=20000)
    logger.info("Login OK")



def extraer_nro_seleccion(nomenclatura: str) -> str | None:
    """
    Extrae el número de selección de la nomenclatura, ej.
    'LP-ABR-11-2026-MP-CFF/CS-1-1' -> '11'
    Heurística: primer segmento numérico entre guiones que NO sea
    un año de 4 dígitos.
    """
    partes = nomenclatura.split("-")
    for p in partes:
        if p.isdigit() and len(p) != 4:
            return p
    return None

async def buscar_procedimiento(page: Page, anio: str, nomenclatura: str = None):
    link_buscar = page.get_by_text("Buscar Procedimientos", exact=True).first
    await link_buscar.wait_for(state="visible", timeout=10000)
    await link_buscar.click()
    await page.wait_for_timeout(1500)

    await cerrar_modal_si_aparece(page)

    await page.wait_for_selector("#frmVisualizarRepresentantesPostor\\:j_id271", timeout=15000)

    await page.select_option("#frmVisualizarRepresentantesPostor\\:j_id271", anio)

    nro_seleccion = extraer_nro_seleccion(nomenclatura) if nomenclatura else None
    if nro_seleccion:
        await page.fill("#frmVisualizarRepresentantesPostor\\:j_id265", nro_seleccion)
        logger.info(f"Filtrando por Nro. de selección: {nro_seleccion}")
    else:
        logger.warning("No se pudo extraer Nro. de selección de la nomenclatura; la búsqueda podría fallar la validación de SEACE")

    # Resetea el filtro de Estado (venía preseleccionado en "Registro de
    # participantes en curso" desde la sesión), para no excluir procesos
    # que ya avanzaron de fase.
    await page.select_option("#frmVisualizarRepresentantesPostor\\:j_id261", "-1")
    logger.info("Filtro de Estado reseteado a [Seleccione]")

    async with page.expect_response(lambda r: ICEFACES_UPDATE_URL_FRAGMENT in r.url, timeout=15000) as resp_info:
        await page.click("#frmVisualizarRepresentantesPostor\\:j_id331")
    await resp_info.value

    # Cierra el modal de validación si SEACE sigue pidiendo más criterios
    await cerrar_modal_si_aparece(page)

    if await page.locator("#frmLogin\\:txtUsername").count() > 0:
        if await page.locator("#frmLogin\\:txtUsername").is_visible():
            await page.screenshot(path="debug_sesion_perdida.png", full_page=True)
            raise RuntimeError("Se perdió la sesión después de buscar. Revisa debug_sesion_perdida.png")

    await page.wait_for_selector("#frmVisualizarRepresentantesPostor\\:dtProcedimiento", timeout=15000)

async def abrir_ficha_por_nomenclatura(page: Page, nomenclatura: str) -> bool:
    filas = await page.query_selector_all(
        "tr[id^='frmVisualizarRepresentantesPostor:dtProcedimiento:']"
    )
    for fila in filas:
        celda = await fila.query_selector("td.stylePersonalizado2 span")
        if not celda:
            continue
        texto = (await celda.inner_text()).strip()
        if texto == nomenclatura.strip():
            btn_ficha = await fila.query_selector("input[title='Ficha de Selección']")
            if not btn_ficha:
                return False
            async with page.expect_response(lambda r: ICEFACES_UPDATE_URL_FRAGMENT in r.url) as resp_info:
                await btn_ficha.click()
            await resp_info.value
            await page.wait_for_selector("#frmRegistrarDocumentacionCP\\:dtDocumentosGenerales", timeout=20000)
            return True
    return False


async def parsear_cronograma(page: Page) -> list[dict]:
    filas = await page.query_selector_all(
        "table#frmRegistrarDocumentacionCP\\:dtDocumentosGenerales tbody tr"
    )
    resultado = []
    for fila in filas:
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
            "etapa": etapa,
            "fecha_inicio": fecha_inicio,
            "fecha_fin": fecha_fin,
            "es_etapa_actual": es_actual,
        })
    return resultado


def parse_fecha(valor: str):
    valor = valor.strip()
    if not valor or valor == "---":
        return None
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y"):
        try:
            return datetime.strptime(valor, fmt)
        except ValueError:
            continue
    return None


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
        UNIQUE KEY uq_tender_etapa (tender_id, etapa)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """
    conn = pool.get_connection()
    cur = conn.cursor()
    cur.execute(sql)
    conn.commit()
    cur.close()
    conn.close()


def guardar_cronograma(tender_id: str, nomenclatura: str, fases: list[dict]):
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
    logger.info(f"Guardadas {len(fases)} fases para {nomenclatura}")


async def main(anio: str, nomenclatura: str):
    ensure_table()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)  # headless=False la primera vez, para ver qué pasa
        page = await browser.new_page()
        try:
            await login(page)
            await buscar_procedimiento(page, anio=anio, nomenclatura=nomenclatura)
            encontrado = await abrir_ficha_por_nomenclatura(page, nomenclatura)
            if not encontrado:
                logger.error(f"No se encontró la nomenclatura {nomenclatura} en los resultados")
                return
            fases = await parsear_cronograma(page)
            for f in fases:
                print(f)
            tender_id_el = await page.query_selector("#frmRegistrarDocumentacionCP\\:j_id248")
            tender_id = (await tender_id_el.inner_text()).strip() if tender_id_el else nomenclatura
            guardar_cronograma(tender_id, nomenclatura, fases)
        finally:
            await browser.close()


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("Uso: python seace_cronograma_scraper.py <anio> <nomenclatura>")
        print('Ejemplo: python seace_cronograma_scraper.py 2026 "LP-ABR-11-2026-MP-CFF/CS-1-1"')
        sys.exit(1)
    asyncio.run(main(sys.argv[1], sys.argv[2]))