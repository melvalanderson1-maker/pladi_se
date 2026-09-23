"""
seace_scraper.py
Scraper del buscador en vivo del portal SEACE (prod1.seace.gob.pe), vía Playwright.
Complementa a seace_sync.py (API OCDS, que solo se actualiza 1 vez al día a las 8:15am):
este scraper corre cada 15-30 min y trae publicaciones frescas directo del portal,
como registros provisionales (origen='scraper'). Cuando la API OCDS trae luego el
registro oficial para la misma nomenclatura, seace_sync.py reemplaza el placeholder.
Corre con: python seace_scraper.py
"""
import os
import re
import json
import logging
from datetime import datetime, timedelta

import time
import random
import requests

from bs4 import BeautifulSoup

from playwright.async_api import async_playwright, Page
from mysql.connector import pooling
from dotenv import load_dotenv

from playwright.async_api import async_playwright, Page, TimeoutError as PlaywrightTimeoutError

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("seace_scraper")

LOGIN_URL = "https://prod1.seace.gob.pe/portal/"
BUSCADOR_URL = "https://prod1.seace.gob.pe/SeaceWeb-PRO/jspx/sel/procesoseleccionficha/buscarProcedimientosSeleccion.iface?locale=es_PE"

URL_UPDATES = (
    "https://prod1.seace.gob.pe/"
    "SeaceWeb-PRO/block/send-receive-updates"
)

# value real de cada <option> del select de Modalidad
MODALIDADES = {
    "Abreviada": "1816",
    "Subasta Inversa Electrónica": "26",
}
# value real de cada <option> del select de Estado
ESTADOS = {
    "PUBLICADO": "0",
    "REGISTRO DE PARTICIPANTES EN CURSO": "1",
}

dbconfig = {
    "host": os.getenv("MYSQL_HOST", "localhost"), "port": int(os.getenv("MYSQL_PORT", "3306")),
    "user": os.getenv("MYSQL_USER"),
    "password": os.getenv("MYSQL_PASSWORD"),
    "database": os.getenv("MYSQL_DATABASE"),
}
pool = pooling.MySQLConnectionPool(pool_name="seace_scraper_pool", pool_size=3, **dbconfig)


def get_conn():
    return pool.get_connection()


def obtener_tender_ids_existentes(conn) -> set[str]:
    """Nomenclaturas (tender_id) que ya están en la tabla, sin importar el origen."""
    cur = conn.cursor()
    cur.execute("SELECT tender_id FROM seace_procesos WHERE tender_id IS NOT NULL")
    ids = {row[0] for row in cur.fetchall() if row[0]}
    cur.close()
    return ids



async def _aceptar_modal_terminos_robusto(page: Page, usuario: str, password: str, max_intentos: int = 4):
    """
    Acepta el modal de términos y condiciones de forma robusta.

    A veces ICEfaces no procesa el click en 'Acepto' (overlay que
    intercepta el evento, JS que no terminó de cargar, sesión que
    quedó en un estado raro) y el scraper se queda paralizado ahí
    para siempre. Esta función reintenta el checkbox+click varias
    veces y, si el modal sigue sin cerrarse, recarga la página desde
    cero (vuelve a hacer login) y lo intenta de nuevo.
    """
    checkbox_sel = 'input[id="terminosCondiciones:idcheckBox"]'
    boton_sel = 'input[id="terminosCondiciones:idButtonAceptar"]'

    for intento_externo in range(1, max_intentos + 1):
        checkbox = page.locator(checkbox_sel)

        # Si el modal ni siquiera aparece, no hay nada que aceptar.
        try:
            await checkbox.wait_for(state="visible", timeout=15000)
        except PlaywrightTimeoutError:
            logger.info("Modal de términos no apareció, sigo.")
            return

        modal_cerrado = False

        # Reintentos internos: marcar checkbox + click en Acepto,
        # sin recargar la página todavía.
        for intento_interno in range(1, 4):
            try:
                await page.evaluate("""
                    const chk = document.getElementById('terminosCondiciones:idcheckBox');
                    if (chk) {
                        chk.checked = true;
                        if (typeof habilitarBoton === 'function') {
                            habilitarBoton();
                        }
                    }
                """)
                await page.wait_for_timeout(400)

                boton_aceptar = page.locator(boton_sel)
                await boton_aceptar.wait_for(state="visible", timeout=8000)

                deshabilitado = await boton_aceptar.is_disabled()
                if deshabilitado:
                    logger.warning(
                        f"Intento {intento_interno}: botón 'Acepto' sigue "
                        f"deshabilitado, reintentando checkbox..."
                    )
                    await page.wait_for_timeout(500)
                    continue

                await boton_aceptar.click(force=True, timeout=8000)
                await page.wait_for_load_state("networkidle", timeout=15000)

                # Verificación real: el checkbox del modal ya no debe existir
                await checkbox.wait_for(state="detached", timeout=8000)
                modal_cerrado = True
                logger.info("Modal de términos aceptado.")
                break

            except PlaywrightTimeoutError:
                logger.warning(
                    f"Intento {intento_interno}/3 (externo {intento_externo}): "
                    f"el modal de términos no se cerró, reintentando..."
                )
                await page.wait_for_timeout(800)
                continue

        if modal_cerrado:
            return

        # Si tras 3 intentos internos el modal sigue ahí, la página quedó
        # en un estado atascado: recargamos desde el login y reintentamos
        # todo el flujo (esto es lo que evita que el scraper se quede
        # paralizado para siempre).
        logger.warning(
            f"Intento externo {intento_externo}/{max_intentos}: "
            f"el modal de términos no cedió, recargando página y "
            f"volviendo a intentar login..."
        )

        await page.screenshot(
            path=f"debug_terminos_atascado_intento_{intento_externo}.png",
            full_page=True,
        )

        await page.goto(LOGIN_URL, wait_until="networkidle")

        campo_usuario = page.locator('input[id="frmLogin:txtUsername"]')
        if await campo_usuario.count() > 0:
            await campo_usuario.fill(usuario)
            await page.locator('input[id="frmLogin:txtPassword"]').fill(password)
            await page.locator('input[id="frmLogin:j_id113"]').click()
            await page.wait_for_load_state("networkidle")

    # Si llegamos aquí, se agotaron todos los intentos.
    await page.screenshot(path="debug_terminos_fallo_definitivo.png", full_page=True)
    with open("debug_terminos_fallo_definitivo.html", "w", encoding="utf-8") as f:
        f.write(await page.content())
    raise Exception(
        "No se pudo aceptar el modal de términos y condiciones tras "
        f"{max_intentos} intentos. Revisa debug_terminos_fallo_definitivo.png/.html"
    )



async def login(page: Page, usuario: str, password: str):
    await page.goto(LOGIN_URL, wait_until="networkidle")
    await page.locator('input[id="frmLogin:txtUsername"]').fill(usuario)
    await page.locator('input[id="frmLogin:txtPassword"]').fill(password)
    await page.locator('input[id="frmLogin:j_id113"]').click()
    await page.wait_for_load_state("networkidle")

    # Modal 1: términos y condiciones (checkbox + Acepto), con reintentos
    # robustos para que el scraper nunca se quede paralizado aquí.
    await _aceptar_modal_terminos_robusto(page, usuario, password)

    # Modal 2: aviso al proveedor (Aceptar)
    aceptar = page.locator('input[id="frmPortalAccesosDirectosRol:j_id237"]')
    try:
        await aceptar.wait_for(state="visible", timeout=10000)
        await aceptar.click()
        await page.wait_for_load_state("networkidle")
        logger.info("Modal de proveedor aceptado.")
    except PlaywrightTimeoutError:
        logger.info("Modal de proveedor no apareció, sigo.")


    # Verificación real de que el login funcionó: si el campo de usuario del
    # formulario de acceso sigue presente y vacío, seguimos en la pantalla
    # anónima del portal (credenciales rechazadas o sesión reiniciada) — el
    # modal de términos NO es prueba de login exitoso, aparece en cualquier
    # carga fresca del portal.
    campo_usuario = page.locator('input[id="frmLogin:txtUsername"]')
    if await campo_usuario.count() > 0:
        valor_actual = await campo_usuario.input_value()
        if valor_actual == "":
            await page.screenshot(path="debug_login_fallido.png", full_page=True)
            with open("debug_login_fallido.html", "w", encoding="utf-8") as f:
                f.write(await page.content())
            raise Exception(
                "Login sin efecto: seguimos en la pantalla de acceso del portal "
                "(usuario/contraseña probablemente incorrectos para esta empresa, "
                "o el portal reinició la sesión). Revisa debug_login_fallido.png/.html "
                "y verifica las credenciales de esta empresa en seace_credenciales_empresa."
            )




    logger.info("Sesión iniciada en SEACE")


async def click_buscar_procedimientos(page: Page):
    """
    Entra al buscador mediante el click REAL del portal SEACE.

    NO usamos page.goto(BUSCADOR_URL), porque SEACE utiliza
    ICEfaces y el rol activo del proveedor queda establecido
    mediante la navegación AJAX.
    """

    posibles_selectores = [
        'text="Buscar Procedimientos"',
        'a:has-text("Buscar Procedimientos")',
        '[title="Buscar Procedimientos"]',
        'a[href*="buscarProcedimientosSeleccion"]',
    ]

    elem = None

    for sel in posibles_selectores:

        try:

            loc = page.locator(sel).first

            await loc.wait_for(
                state="visible",
                timeout=8000
            )

            elem = loc

            logger.info(
                f"'Buscar Procedimientos' encontrado con selector: {sel}"
            )

            break

        except PlaywrightTimeoutError:
            continue

    if elem is None:

        await page.screenshot(
            path="debug_buscar_procedimientos_no_encontrado.png",
            full_page=True
        )

        with open(
            "debug_buscar_procedimientos_no_encontrado.html",
            "w",
            encoding="utf-8"
        ) as f:
            f.write(await page.content())

        raise Exception(
            "No se encontró el link 'Buscar Procedimientos'."
        )

    # ------------------------------------------------------------
    # CLICK REAL
    # ------------------------------------------------------------

    await elem.scroll_into_view_if_needed()

    await elem.click(
        force=True
    )

    logger.info(
        "Click real en 'Buscar Procedimientos' ejecutado."
    )

    # ICEfaces trabaja por AJAX. No dependemos únicamente de
    # networkidle porque puede mantener conexiones abiertas.

    try:

        await page.locator(
            'select[id="frmVisualizarRepresentantesPostor:j_id257"]'
        ).wait_for(
            state="visible",
            timeout=30000
        )

    except PlaywrightTimeoutError:

        logger.error(
            f"Después del click no apareció el buscador. "
            f"URL actual: {page.url}"
        )

        await page.screenshot(
            path="debug_despues_click_buscar.png",
            full_page=True
        )

        with open(
            "debug_despues_click_buscar.html",
            "w",
            encoding="utf-8"
        ) as f:
            f.write(await page.content())

        raise Exception(
            "El click en 'Buscar Procedimientos' no dejó "
            "disponible el formulario del buscador."
        )

    logger.info(
        f"BUSCADOR CONFIRMADO. URL actual: {page.url}"
    )



def extraer_ice_view_de_xml(xml_text):
    match = re.search(
        r'address="[^:"]+:(\d+):dynamic-code"',
        xml_text
    )
    return match.group(1) if match else None


def extraer_fecha_servidor_bd(xml_text):
    soup = BeautifulSoup(xml_text, "html.parser")

    inp = soup.find(
        "input",
        {"id": "frmRegistrarDocumentacionCP:fechaServidorBD"}
    )

    if inp and inp.get("value"):
        return inp.get("value")

    match = re.search(
        r'fechaServidorBD[^v]*value="(\d+)"',
        xml_text
    )

    if match:
        return match.group(1)

    return str(int(time.time() * 1000))


async def crear_sesion_ice(page: Page):
    """
    Copia las cookies de Playwright a requests y obtiene
    ice.session / ice.view para poder utilizar los POST
    ICEfaces directamente.
    """

    cookies_pw = await page.context.cookies()

    req_session = requests.Session()

    for cookie in cookies_pw:
        req_session.cookies.set(
            cookie["name"],
            cookie["value"]
        )

    req_session.headers.update({
        "Accept": "*/*",
        "Accept-Language": "es-ES,es;q=0.9",
        "Content-Type":
            "application/x-www-form-urlencoded; charset=UTF-8",
        "Origin":
            "https://prod1.seace.gob.pe",
        "Referer":
            BUSCADOR_URL,
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/140.0 Safari/537.36",
    })

    cookies_dict = {
        c["name"]: c["value"]
        for c in cookies_pw
    }

    ice_sessions_raw = cookies_dict.get(
        "ice.sessions",
        ""
    )

    ice_session = (
        ice_sessions_raw.split("#")[0]
        if ice_sessions_raw
        else ""
    )

    bconn = cookies_dict.get(
        "bconn",
        ""
    )

    ice_view = (
        bconn.split(":")[1]
        if ":" in bconn
        else "2"
    )

    if not ice_session:
        raise RuntimeError(
            "No se encontró cookie ice.sessions."
        )

    logger.info(
        f"ICE session preparada. "
        f"ice.session={ice_session[:20]}..., "
        f"ice.view={ice_view}"
    )

    return req_session, ice_session, ice_view


def fetch_detalle_fila(
    req_session,
    ice_session,
    ice_view,
    fila_idx,
    form_data
):
    """
    Abre la Ficha de Selección mediante los POST ICEfaces
    que utiliza el Selenium funcional.

    NO utiliza page.locator().click().
    """

    btn_id = (
        "frmVisualizarRepresentantesPostor:"
        f"dtProcedimiento:{fila_idx}:j_id386"
    )

    # ============================================================
    # POST 1: ABRIR FICHA
    # ============================================================

    payload1 = dict(form_data)

    payload1.update({
        "ice.submit.partial": "false",

        "ice.event.target": btn_id,
        "ice.event.captured": btn_id,
        "ice.event.type": "onclick",

        "ice.event.alt": "false",
        "ice.event.ctrl": "false",
        "ice.event.shift": "false",
        "ice.event.meta": "false",

        "ice.event.x": "1305",
        "ice.event.y": "700",

        "ice.event.left": "false",
        "ice.event.right": "false",

        btn_id: "",

        "frmVisualizarRepresentantesPostor:_idcl":
            btn_id,

        "ice.session":
            ice_session,

        "ice.view":
            ice_view,

        "ice.focus":
            btn_id,

        "rand":
            str(random.random()),
    })

    logger.info(
        f"Fila {fila_idx}: POST ICEfaces para abrir ficha..."
    )

    resp1 = req_session.post(
        URL_UPDATES,
        data=payload1,
        timeout=30
    )

    resp1.raise_for_status()

    xml1 = resp1.text

    # ============================================================
    # ACTUALIZAR ICE.VIEW
    # ============================================================

    nuevo_view = extraer_ice_view_de_xml(
        xml1
    )

    if nuevo_view:
        ice_view = nuevo_view

    # ============================================================
    # SI NO APARECIÓ LA FICHA -> REPETIR
    # ============================================================

    if (
        "frmRegistrarDocumentacionCP" not in xml1
        or "j_id248" not in xml1
    ):

        logger.info(
            f"Fila {fila_idx}: "
            "primer POST no devolvió la ficha; "
            "reintentando..."
        )

        payload1["ice.view"] = ice_view
        payload1["rand"] = str(
            random.random()
        )

        resp1 = req_session.post(
            URL_UPDATES,
            data=payload1,
            timeout=30
        )

        resp1.raise_for_status()

        xml1 = resp1.text

        nuevo_view = extraer_ice_view_de_xml(
            xml1
        )

        if nuevo_view:
            ice_view = nuevo_view

    # ============================================================
    # POST 2: REFRESCAR DETALLE
    # ============================================================

    fecha_bd = extraer_fecha_servidor_bd(
        xml1
    )

    payload2 = {
        "ice.submit.partial":
            "false",

        "ice.event.target":
            "frmRegistrarDocumentacionCP:hiddenRefrescar",

        "ice.event.captured":
            "frmRegistrarDocumentacionCP:hiddenRefrescar",

        "ice.event.type":
            "onclick",

        "ice.event.alt":
            "false",

        "ice.event.ctrl":
            "false",

        "ice.event.shift":
            "false",

        "ice.event.meta":
            "false",

        "ice.event.x":
            "0",

        "ice.event.y":
            "25.833332061767578",

        "ice.event.left":
            "false",

        "ice.event.right":
            "false",

        "frmRegistrarDocumentacionCP:hiddenRefrescar":
            "",

        "frmRegistrarDocumentacionCP:_idcl":
            "",

        "idOrganismo":
            "",

        "idConvocatoria":
            "",

        "frmRegistrarDocumentacionCP:listaFechasEventos":
            "",

        "frmRegistrarDocumentacionCP:fechaServidorBD":
            fecha_bd,

        "icefacesCssUpdates":
            "",

        "frmRegistrarDocumentacionCP":
            "frmRegistrarDocumentacionCP",

        "ice.session":
            ice_session,

        "ice.view":
            ice_view,

        "ice.focus":
            btn_id,

        "rand":
            str(random.random()),
    }

    logger.info(
        f"Fila {fila_idx}: POST ICEfaces para refrescar detalle..."
    )

    resp2 = req_session.post(
        URL_UPDATES,
        data=payload2,
        timeout=30
    )

    resp2.raise_for_status()

    xml2 = resp2.text

    nuevo_view2 = extraer_ice_view_de_xml(
        xml2
    )

    if nuevo_view2:
        ice_view = nuevo_view2

    return xml1, xml2, ice_view




def cerrar_detalle_ice(
    req_session,
    ice_session,
    ice_view
):
    """
    Cierra/regresa desde la Ficha de Selección
    usando POST ICEfaces.
    """

    payload3 = {
        "ice.submit.partial":
            "false",

        "ice.event.target":
            "frmRegistrarDocumentacionCP:j_id751",

        "ice.event.captured":
            "frmRegistrarDocumentacionCP:j_id751",

        "ice.event.type":
            "onclick",

        "ice.event.alt":
            "false",

        "ice.event.ctrl":
            "false",

        "ice.event.shift":
            "false",

        "ice.event.meta":
            "false",

        "ice.event.x":
            "694",

        "ice.event.y":
            "1186",

        "ice.event.left":
            "false",

        "ice.event.right":
            "false",

        "frmRegistrarDocumentacionCP:j_id751":
            "Regresar",

        "frmRegistrarDocumentacionCP:_idcl":
            "",

        "idOrganismo":
            "",

        "idConvocatoria":
            "",

        "frmRegistrarDocumentacionCP:listaFechasEventos":
            "",

        "frmRegistrarDocumentacionCP:fechaServidorBD":
            str(int(time.time() * 1000)),

        "icefacesCssUpdates":
            "",

        "frmRegistrarDocumentacionCP":
            "frmRegistrarDocumentacionCP",

        "ice.session":
            ice_session,

        "ice.view":
            ice_view,

        "ice.focus":
            "frmRegistrarDocumentacionCP:j_id751",

        "rand":
            str(random.random()),
    }

    resp3 = req_session.post(
        URL_UPDATES,
        data=payload3,
        timeout=30
    )

    resp3.raise_for_status()

    nuevo_view = extraer_ice_view_de_xml(
        resp3.text
    )

    return (
        nuevo_view
        if nuevo_view
        else ice_view
    )


def parsear_detalle_ficha(xml1, xml2):
    """
    Extrae del CDATA de la respuesta ICEfaces (POST 1 y POST 2 de
    fetch_detalle_fila) los mismos campos que bot_seace.py obtiene:
    datos generales, cronograma y URLs de documentos PDF.
    """
    detalle = {}

    for xml in [xml1, xml2]:
        if not xml:
            continue

        contenidos = re.findall(r'<!\[CDATA\[(.*?)\]\]>', xml, re.DOTALL)
        htmls = contenidos if contenidos else [xml]

        for html_chunk in htmls:
            soup = BeautifulSoup(html_chunk, "html.parser")

            for tag in soup.find_all(True):
                tid = tag.get("id", "")
                if tid.endswith(":j_id248"):
                    detalle["Nro_Expediente"] = tag.get_text(strip=True)
                elif tid.endswith(":j_id251"):
                    detalle["Nomenclatura_Ficha"] = tag.get_text(strip=True)
                elif tid.endswith(":j_id270"):
                    detalle["Entidad_Convocante"] = tag.get_text(strip=True)
                elif tid.endswith(":j_id378"):
                    detalle["Etapa_Actual"] = tag.get_text(strip=True)

            for td in soup.find_all("td"):
                prev = td.find_previous_sibling("td")
                if not prev:
                    continue
                label_span = prev.find("span", class_="iceOutTxt")
                if not label_span:
                    continue
                label = label_span.get_text(strip=True)
                for tag in td.find_all(["input", "button"]):
                    tag.decompose()
                valor = td.get_text(strip=True)
                if label and valor:
                    clave = re.sub(r'[^a-zA-Z0-9_]', '_', label)[:40]
                    detalle[f"campo_{clave}"] = valor

            vr = soup.find("span", class_="otValorReferencialMostrar")
            if vr and vr.get_text(strip=True):
                detalle["Valor_Referencial"] = vr.get_text(strip=True)
            moneda = soup.find("span", class_="otValorReferencialDescMoneda")
            if moneda and moneda.get_text(strip=True):
                detalle["Moneda_VR"] = moneda.get_text(strip=True)

            for b_tag in soup.find_all("b"):
                for s in b_tag.find_all("span", class_="iceOutTxt"):
                    t = s.get_text(strip=True)
                    if t:
                        detalle["Etapa_Actual"] = t

            etapas_crono = []
            for tr in soup.find_all("tr"):
                tr_id = tr.get("id", "")
                if "dtDocumentosGenerales:" not in tr_id:
                    continue
                parte = tr_id.split("dtDocumentosGenerales:")[-1]
                if not parte.isdigit():
                    continue

                nombre = ""
                for td in tr.find_all("td"):
                    t = td.get_text(" ", strip=True)
                    if t and len(t) > 4 and not re.match(r'^\d{2}/\d{2}/\d{4}', t):
                        nombre = t[:80]
                        break

                fechas = []
                for lbl in tr.find_all("label"):
                    t = lbl.get_text(strip=True)
                    if re.match(r'\d{2}/\d{2}/\d{4}', t):
                        fechas.append(t)

                lugar = ""
                for sp in tr.find_all("span"):
                    style = sp.get("style", "")
                    if "font-weight: bold" in style or "font-weight:bold" in style:
                        t = sp.get_text(strip=True)
                        if t:
                            lugar = t
                            break

                if nombre:
                    entrada = nombre
                    if fechas:
                        entrada += " | " + " → ".join(fechas)
                    if lugar:
                        entrada += " | Lugar: " + lugar
                    etapas_crono.append(entrada)

            if etapas_crono:
                detalle["Cronograma"] = " || ".join(etapas_crono)
                for e in etapas_crono:
                    partes = e.split(" | ")
                    nombre_e = partes[0].strip()
                    fechas_e = [p for p in partes[1:] if re.search(r'\d{2}/\d{2}/\d{4}', p)]
                    if "Convocatoria" in nombre_e and "Nro" not in nombre_e:
                        detalle["Fecha_Convocatoria"] = fechas_e[0] if fechas_e else ""
                    elif "Registro de participantes" in nombre_e:
                        fs = re.findall(r'\d{2}/\d{2}/\d{4}[^\|]*', e)
                        detalle["Inicio_Registro_Part"] = fs[0].strip() if len(fs) > 0 else ""
                        detalle["Fin_Registro_Part"] = fs[1].strip() if len(fs) > 1 else ""
                    elif "propuestas" in nombre_e and "Presentaci" in nombre_e:
                        detalle["Fecha_Presentacion_Prop"] = fechas_e[0] if fechas_e else ""
                    elif "Buena Pro" in nombre_e:
                        detalle["Fecha_Buena_Pro"] = fechas_e[0] if fechas_e else ""

            urls_acumuladas = []
            for tr in soup.find_all("tr"):
                tr_id = tr.get("id", "")
                if "tablaAccionesProcedimientos:" not in tr_id:
                    continue
                parte = tr_id.split("tablaAccionesProcedimientos:")[-1]
                if not parte.isdigit():
                    continue
                celdas = tr.find_all("td")
                if len(celdas) < 4:
                    continue

                nro = celdas[0].get_text(strip=True)
                etapa = celdas[1].get_text(strip=True)
                nombre_doc = celdas[2].get_text(strip=True)
                fecha_doc = celdas[4].get_text(strip=True) if len(celdas) > 4 else ""

                link = celdas[3].find("a")
                uuid = ""
                if link:
                    m = re.search(r"descargarArchivoCMS\('([^']+)'\)", link.get("onclick", ""))
                    if m:
                        uuid = m.group(1)

                url = f"https://prod1.seace.gob.pe/SeaceWeb-PRO/download?fileName={uuid}" if uuid else ""

                detalle[f"PDF_{nro}_etapa"] = etapa
                detalle[f"PDF_{nro}_nombre"] = nombre_doc
                detalle[f"PDF_{nro}_fecha"] = fecha_doc
                detalle[f"PDF_{nro}_url"] = url

                if url:
                    urls_acumuladas.append(url)
                    idx = len(urls_acumuladas)
                    detalle[f"URL_PDF_{idx}"] = url

            if urls_acumuladas:
                detalle["URLs_PDFs"] = " | ".join(urls_acumuladas)

    return detalle




async def leer_paginacion(page: Page) -> tuple[int, int, int]:
    """
    Lee el pie de tabla ('X registros encontrados, ... Página P / T.')
    y devuelve (pagina_actual, total_paginas, total_registros).
    Si no lo encuentra, asume que hay una sola página (no rompe el flujo).
    """
    try:
        texto = await page.locator(
            'span.iceOutFrmt.standard'
        ).first.inner_text(timeout=10000)
    except PlaywrightTimeoutError:
        logger.warning("No se pudo leer el pie de tabla de paginación, asumo 1 página.")
        return (1, 1, 0)

    match = re.search(
        r'(\d+)\s+registros encontrados.*?P[aá]gina\s+(\d+)\s*/\s*(\d+)',
        texto
    )

    if not match:
        logger.warning(f"No pude parsear el pie de tabla: '{texto}'. Asumo 1 página.")
        return (1, 1, 0)

    total_registros = int(match.group(1))
    pagina_actual = int(match.group(2))
    total_paginas = int(match.group(3))

    return (pagina_actual, total_paginas, total_registros)


async def ir_a_pagina_siguiente(page: Page) -> bool:
    """
    Clic en 'Página Siguiente'. Devuelve True SOLO si se verifica que el
    número de página realmente cambió (leyendo de nuevo el pie de tabla).
    Reintenta el clic varias veces porque, tras extraer detalle de fichas
    con peticiones HTTP crudas, el ice.view del navegador puede quedar
    desincronizado y el primer clic AJAX no surtir efecto aunque el botón
    siga visualmente habilitado.
    """
    pagina_antes, _, _ = await leer_paginacion(page)

    for intento in range(1, 4):
        boton_siguiente = page.locator(
            'span[id="frmVisualizarRepresentantesPostor:dsPostores2next"]'
        )

        # Antes de rendirse, esperamos ACTIVAMENTE (hasta 8s) a que el
        # paginador se adjunte al DOM. Cuando todas las filas de la
        # página ya estaban en BD no se hace ningún POST crudo de
        # detalle, así que pasa muy poco tiempo entre que la tabla
        # queda "visible" y este chequeo — el paginador puede no
        # haber terminado de renderizarse todavía. .count() no espera
        # nada, por eso fallaba siempre en ese escenario.
        try:
            await boton_siguiente.wait_for(state="attached", timeout=8000)
        except PlaywrightTimeoutError:
            logger.warning(
                f"Intento {intento}/3: botón 'siguiente' no encontrado, reintentando..."
            )
            await page.wait_for_timeout(1500)
            continue

        clase = await boton_siguiente.get_attribute("class") or ""
        if "iceCmdLnk-dis" in clase:
            logger.info("Botón 'siguiente' deshabilitado: ya es la última página.")
            return False

        await boton_siguiente.click(force=True)

        try:
            await page.wait_for_load_state("networkidle", timeout=20000)
        except PlaywrightTimeoutError:
            pass

        await page.wait_for_timeout(800)

        pagina_despues, _, _ = await leer_paginacion(page)

        if pagina_despues != pagina_antes:
            return True

        logger.warning(
            f"Intento {intento}/3: el clic en 'siguiente' no cambió la página "
            f"({pagina_antes} -> {pagina_despues}), reintentando..."
        )
        await page.wait_for_timeout(1500)

    logger.error(
        f"No se pudo avanzar de la página {pagina_antes} tras 3 intentos "
        f"(probable desincronización de ice.view por las peticiones HTTP crudas)."
    )
    return False


async def procesar_filas_pagina_actual(
    page: Page,
    modalidad: str,
    estado: str,
    anio: str,
    tender_ids_existentes: set,
    conn,
) -> tuple[list[dict], bool]:
    """
    Extrae y procesa (con detalle) TODAS las filas reales de la página
    de resultados actualmente cargada. No pagina — asume que la tabla
    ya corresponde a la página que se quiere leer.
    Devuelve (lista_de_items, hubo_al_menos_una_fila_nueva).
    """
    filas_todas = page.locator(
        'table[id="frmVisualizarRepresentantesPostor:dtProcedimiento"] tbody tr'
    )
    total_todas = await filas_todas.count()

    filas_validas = []
    for pos in range(total_todas):
        fila_actual = filas_todas.nth(pos)
        boton_ficha = fila_actual.locator('input[id*=":j_id386"]')

        if await boton_ficha.count() > 0:
            btn_id_attr = await boton_ficha.first.get_attribute("id")
            match_idx = re.search(r'dtProcedimiento:(\d+):j_id386', btn_id_attr or "")

            if not match_idx:
                logger.warning(
                    f"Fila DOM {pos}: no se pudo extraer el índice real "
                    f"del id '{btn_id_attr}', se omite esta fila."
                )
                continue

            filas_validas.append({"dom_pos": pos, "id_idx": int(match_idx.group(1))})

    logger.info(
        f"{modalidad} / {estado}: {len(filas_validas)} filas reales en esta página"
    )

    req_session = ice_session = ice_view = None
    form_data = None

    resultados = []
    hubo_fila_nueva = False

    for numero, fila_info in enumerate(filas_validas):
        dom_pos_inicial = fila_info["dom_pos"]
        fila = filas_todas.nth(dom_pos_inicial)
        celdas = fila.locator("td")

        try:
            cantidad_celdas = await celdas.count()
            if cantidad_celdas < 8:
                logger.warning(
                    f"Fila real {numero} (HTML {dom_pos_inicial}): "
                    f"columnas insuficientes ({cantidad_celdas})."
                )
                continue

            item = {
                "entidad": (await celdas.nth(1).inner_text()).strip(),
                "fecha_publicacion": (await celdas.nth(2).inner_text()).strip(),
                "nomenclatura": (await celdas.nth(3).inner_text()).strip(),
                "objeto": (await celdas.nth(6).inner_text()).strip(),
                "descripcion": (await celdas.nth(7).inner_text()).strip(),
            }
        except Exception as e:
            logger.warning(
                f"Fila real {numero} (HTML {dom_pos_inicial}) no se pudo parsear: {e}"
            )
            continue

        if item["nomenclatura"] in tender_ids_existentes:
            logger.info(
                f"{modalidad} / {estado}: nomenclatura "
                f"'{item['nomenclatura']}' ya existe en BD — omitiendo fila real {numero}"
            )
            continue

        hubo_fila_nueva = True


        if req_session is None:
            req_session, ice_session, ice_view = await crear_sesion_ice(page)
            form_data = {
                "frmVisualizarRepresentantesPostor:dsPostores2": "",
                "frmVisualizarRepresentantesPostor:j_id274": "",
                "frmVisualizarRepresentantesPostor:j_id271": anio,
                "frmVisualizarRepresentantesPostor:j_id267": "",
                "frmVisualizarRepresentantesPostor:j_id265": "",
                "frmVisualizarRepresentantesPostor:j_id261": ESTADOS[estado],
                "frmVisualizarRepresentantesPostor:j_id257": MODALIDADES[modalidad],
                "frmVisualizarRepresentantesPostor:j_id254": "",
                "frmVisualizarRepresentantesPostor:j_id250": "-1",
                "frmVisualizarRepresentantesPostor:j_id244": "",
                "frmVisualizarRepresentantesPostor:valorSinglaEntidad": "",
                "frmVisualizarRepresentantesPostor:siglaEntidadNombre": "",
                "icefacesCssUpdates": "",
                "frmVisualizarRepresentantesPostor": "frmVisualizarRepresentantesPostor",
            }

        filas_actuales = page.locator(
            'table[id="frmVisualizarRepresentantesPostor:dtProcedimiento"] tbody tr'
        )
        total_actuales = await filas_actuales.count()
        fila_actual_id_idx = None

        for idx_actual in range(total_actuales):
            fila_busqueda = filas_actuales.nth(idx_actual)
            boton_actual = fila_busqueda.locator('input[id*=":j_id386"]')

            if await boton_actual.count() > 0:
                texto_actual = (await fila_busqueda.inner_text()).strip()
                if item["nomenclatura"] and item["nomenclatura"] in texto_actual:
                    btn_id_attr_actual = await boton_actual.first.get_attribute("id")
                    match_idx_actual = re.search(
                        r'dtProcedimiento:(\d+):j_id386', btn_id_attr_actual or ""
                    )
                    if match_idx_actual:
                        fila_actual_id_idx = int(match_idx_actual.group(1))
                    break

        if fila_actual_id_idx is None:
            logger.warning(
                f"Fila real {numero}: no se pudo volver a localizar "
                f"'{item['nomenclatura']}' en esta página."
            )
            continue

        try:
            xml1, xml2, ice_view = fetch_detalle_fila(
                req_session, ice_session, ice_view, fila_actual_id_idx, form_data,
            )
            detalle = parsear_detalle_ficha(xml1, xml2)

            if detalle:
                item.update(detalle)
                logger.info(f"Fila real {numero}: detalle extraído ({len(detalle)} campos).")
                logger.info(f"Fila real {numero}: campos = {sorted(detalle.keys())}")
            else:
                logger.warning(f"Fila real {numero}: el detalle vino vacío (0 campos).")

            ice_view = cerrar_detalle_ice(req_session, ice_session, ice_view)

        except Exception as e_detalle:
            logger.warning(
                f"Fila real {numero}: no se pudo extraer el detalle completo: {e_detalle}"
            )

        # Se guarda YA, no al final de toda la búsqueda. Así, si más
        # adelante el paginador se desincroniza y hay que reintentar la
        # búsqueda completa, esta fila ya va a estar en
        # tender_ids_existentes y el reintento la va a saltar en vez de
        # volver a pedir su detalle por HTTP crudo (que es justo lo que
        # rompe el paginador).
        try:
            upsert_placeholder(conn, item, modalidad)
            conn.commit()
            tender_ids_existentes.add(item["nomenclatura"])
        except Exception as e_guardado:
            logger.warning(
                f"Fila real {numero}: no se pudo guardar en BD de inmediato: {e_guardado}"
            )

        resultados.append(item)

    # ------------------------------------------------------------
    # SINCRONIZAR EL NAVEGADOR CON EL ice.view REAL DEL SERVIDOR
    # ------------------------------------------------------------
    # fetch_detalle_fila / cerrar_detalle_ice hicieron POSTs crudos
    # (fuera del navegador) que avanzaron el ice.view en el servidor.
    # El navegador (Playwright) NO se enteró de esos avances porque
    # ICEfaces no usa la cookie 'bconn' para armar el POST del clic:
    # usa un objeto JS interno (container.bridge) creado en el
    # <script id="...configuration-script">. Si no actualizamos ESE
    # objeto, el próximo clic real en "Página Siguiente" sigue
    # mandando el ice.view viejo y el servidor lo ignora.
    if hubo_fila_nueva:
        try:
            resultado_bridge = await page.evaluate(
                """
                (viewNuevo) => {
                    const scripts = document.querySelectorAll(
                        'script[id$=":configuration-script"]'
                    );
                    if (!scripts.length) {
                        return {ok: false, motivo: 'no-script'};
                    }
                    const contenedor = scripts[0].parentNode;
                    if (!contenedor || !contenedor.bridge) {
                        return {ok: false, motivo: 'no-bridge'};
                    }
                    const bridge = contenedor.bridge;
                    const anterior = bridge.configuration
                        ? bridge.configuration.view
                        : bridge.view;
                    if (bridge.configuration) {
                        bridge.configuration.view = viewNuevo;
                    } else {
                        bridge.view = viewNuevo;
                    }
                    return {
                        ok: true,
                        anterior: anterior,
                        nuevo: viewNuevo,
                        bridgeKeys: Object.keys(bridge)
                    };
                }
                """,
                ice_view,
            )
            logger.info(
                f"Bridge ICEfaces del navegador resincronizado: {resultado_bridge}"
            )
        except Exception as e_bridge:
            logger.warning(
                f"No se pudo resincronizar el bridge JS de ICEfaces: {e_bridge}"
            )

        try:
            cookies_actuales = await page.context.cookies()
            bconn_cookie = next(
                (c for c in cookies_actuales if c["name"] == "bconn"), None
            )

            if bconn_cookie and ":" in bconn_cookie["value"]:
                partes_bconn = bconn_cookie["value"].split(":")
                partes_bconn[1] = str(ice_view)
                nueva_bconn = dict(bconn_cookie)
                nueva_bconn["value"] = ":".join(partes_bconn)

                await page.context.add_cookies([nueva_bconn])

                logger.info(
                    f"Cookie 'bconn' resincronizada: navegador ahora "
                    f"alineado con ice.view={ice_view}"
                )
            else:
                logger.warning(
                    "No se encontró cookie 'bconn' válida para resincronizar "
                    "el ice.view del navegador."
                )
        except Exception as e_sync:
            logger.warning(
                f"No se pudo resincronizar ice.view del navegador: {e_sync}"
            )

    return resultados, hubo_fila_nueva


async def buscar_convocatorias(
    page: Page,
    modalidad: str,
    estado: str,
    tender_ids_existentes: set,
    conn,
    anio: str = "2026"
) -> tuple[list[dict], bool]:

    logger.info(
        f"Preparando búsqueda: modalidad={modalidad}, estado={estado}, año={anio}"
    )

    # ============================================================
    # IMPORTANTE:
    # NO HACER page.goto(BUSCADOR_URL)
    #
    # SEACE utiliza ICEfaces y el rol activo del proveedor queda
    # asociado a la navegación AJAX realizada desde el portal.
    #
    # Si hacemos goto() directo al buscador, SEACE puede devolver
    # nuevamente la pantalla de login.
    # ============================================================

    # ------------------------------------------------------------
    # 1. Verificar que seguimos realmente dentro del buscador
    # ------------------------------------------------------------
    select_modalidad = page.locator(
        'select[id="frmVisualizarRepresentantesPostor:j_id257"]'
    )

    try:
        await select_modalidad.wait_for(
            state="visible",
            timeout=15000
        )
    except PlaywrightTimeoutError:
        logger.error(
            f"El formulario del buscador no está disponible. "
            f"URL actual: {page.url}"
        )

        await page.screenshot(
            path=f"debug_buscador_perdido_{modalidad}_{estado}.png",
            full_page=True
        )

        with open(
            f"debug_buscador_perdido_{modalidad}_{estado}.html",
            "w",
            encoding="utf-8"
        ) as f:
            f.write(await page.content())

        raise Exception(
            "SEACE ya no está en el buscador. "
            "Probablemente la sesión/rol fue reiniciado."
        )

    logger.info(
        f"Formulario del buscador confirmado. URL={page.url}"
    )

    # ------------------------------------------------------------
    # 2. Esperar que ICEfaces haya cargado las opciones
    # ------------------------------------------------------------
    try:
        await page.wait_for_function(
            """
            () => {
                const el = document.getElementById(
                    'frmVisualizarRepresentantesPostor:j_id257'
                );
                return el && el.options && el.options.length > 1;
            }
            """,
            timeout=15000
        )
    except PlaywrightTimeoutError:
        logger.error("El select de modalidad no cargó sus opciones.")

        await page.screenshot(
            path=f"debug_modalidad_sin_opciones_{modalidad}_{estado}.png",
            full_page=True
        )

        raise Exception(
            "El select de modalidad apareció pero no cargó sus opciones."
        )

    # ------------------------------------------------------------
    # 3. Seleccionar MODALIDAD
    # ------------------------------------------------------------
    await select_modalidad.select_option(
        MODALIDADES[modalidad]
    )

    logger.info(
        f"Modalidad seleccionada: {modalidad} "
        f"(value={MODALIDADES[modalidad]})"
    )

    # ICEfaces necesita tiempo para procesar el evento AJAX.
    await page.wait_for_timeout(1500)

    # Esperar nuevamente a que el formulario siga presente.
    await page.locator(
        'select[id="frmVisualizarRepresentantesPostor:j_id257"]'
    ).wait_for(
        state="visible",
        timeout=15000
    )

    # ------------------------------------------------------------
    # 4. Seleccionar ESTADO
    # ------------------------------------------------------------
    select_estado = page.locator(
        'select[id="frmVisualizarRepresentantesPostor:j_id261"]'
    )

    await select_estado.wait_for(
        state="visible",
        timeout=15000
    )

    await page.wait_for_function(
        """
        () => {
            const el = document.getElementById(
                'frmVisualizarRepresentantesPostor:j_id261'
            );
            return el && el.options && el.options.length > 1;
        }
        """,
        timeout=15000
    )

    await select_estado.select_option(
        ESTADOS[estado]
    )

    logger.info(
        f"Estado seleccionado: {estado} "
        f"(value={ESTADOS[estado]})"
    )

    await page.wait_for_timeout(1500)

    # ------------------------------------------------------------
    # 4.1 VERIFICACIÓN: el AJAX de "Estado" puede re-renderizar todo
    # el formulario y resetear el select de Modalidad a su valor por
    # defecto. Si eso pasa, el resto del flujo (fechas, búsqueda)
    # queda operando sobre la modalidad equivocada. Verificamos el
    # valor real en el DOM y, si no coincide, lo volvemos a aplicar.
    # ------------------------------------------------------------
    valor_modalidad_actual = await select_modalidad.input_value()

    if valor_modalidad_actual != MODALIDADES[modalidad]:
        logger.warning(
            f"Modalidad se reseteó tras seleccionar Estado. "
            f"Esperado={MODALIDADES[modalidad]} "
            f"(value real='{valor_modalidad_actual}'). "
            f"Reaplicando Modalidad={modalidad}..."
        )

        await select_modalidad.select_option(MODALIDADES[modalidad])
        await page.wait_for_timeout(1500)

        # Reaplicar Estado también, porque volver a tocar Modalidad
        # puede a su vez resetear el Estado.
        await select_estado.select_option(ESTADOS[estado])
        await page.wait_for_timeout(1500)

        valor_modalidad_final = await select_modalidad.input_value()
        valor_estado_final = await select_estado.input_value()

        if (
            valor_modalidad_final != MODALIDADES[modalidad]
            or valor_estado_final != ESTADOS[estado]
        ):
            await page.screenshot(
                path=f"debug_modalidad_no_estabiliza_{modalidad}_{estado}.png",
                full_page=True,
            )
            raise Exception(
                f"Los selects de Modalidad/Estado no se estabilizaron: "
                f"esperado modalidad={MODALIDADES[modalidad]} "
                f"estado={ESTADOS[estado]}, obtenido "
                f"modalidad={valor_modalidad_final} "
                f"estado={valor_estado_final}. Revisa "
                f"debug_modalidad_no_estabiliza_{modalidad}_{estado}.png"
            )

        logger.info("Modalidad y Estado verificados y estables tras reaplicar.")
    else:
        logger.info(
            f"Modalidad verificada correctamente tras seleccionar Estado: "
            f"{valor_modalidad_actual}"
        )

    # ============================================================
    # 5. FECHAS
    #
    # IMPORTANTE:
    # Los campos fechaInicio y fechaFin son componentes
    # ICEfaces (iceSelInpDateInput).
    #
    # Su onkeypress ejecuta iceSubmit(), por lo que NO debemos
    # escribir carácter por carácter con Playwright.
    #
    # Colocamos el valor directamente en el DOM y NO disparamos
    # eventos de teclado.
    # ============================================================

    # ============================================================
    # CONFIGURACIÓN DE FECHAS
    # ============================================================
    # Las fechas SOLO se utilizan para:
    #
    #     Modalidad = Abreviada
    #     Estado    = PUBLICADO
    #
    # Para cualquier otra combinación NO se toca fechaInicio
    # ni fechaFin, porque SEACE no necesariamente muestra
    # esos campos.
    # ============================================================

    requiere_fechas = (
        estado == "PUBLICADO"
    )
    # Confirmado por el propio SEACE (alerta "Ingrese las Fechas
    # correspondientes"): TODAS las modalidades exigen fechaInicio/
    # fechaFin cuando estado=PUBLICADO. Lo que varía es cuánto tarda
    # el AJAX de ICEfaces en renderizar esos campos según modalidad.
    if requiere_fechas:

        logger.info(
            f"{modalidad} + {estado}: "
            "configurando Fecha Inicio y Fecha Fin..."
        )

        fecha_fin = datetime.now().date()
        fecha_inicio = fecha_fin - timedelta(days=4)

        fecha_inicio_str = fecha_inicio.strftime("%d/%m/%Y")
        fecha_fin_str = fecha_fin.strftime("%d/%m/%Y")

        logger.info(
            f"Rango de fechas: "
            f"{fecha_inicio_str} -> {fecha_fin_str}"
        )

        # Esperar a que SEACE realmente muestre ambos campos.
        fecha_inicio_input = page.locator(
            '#frmVisualizarRepresentantesPostor\\:fechaInicio'
        )

        fecha_fin_input = page.locator(
            '#frmVisualizarRepresentantesPostor\\:fechaFin'
        )

        # El AJAX de ICEfaces que renderiza estos campos tarda distinto
        # según la modalidad (Subasta Inversa Electrónica tarda más que
        # Abreviada). En vez de un solo wait_for con timeout fijo,
        # reintentamos re-disparando el onchange del Estado si el campo
        # todavía no aparece.
        campos_listos = False

        for intento_fecha in range(1, 4):

            try:
                await fecha_inicio_input.wait_for(
                    state="visible",
                    timeout=10000
                )
                await fecha_fin_input.wait_for(
                    state="visible",
                    timeout=10000
                )
                campos_listos = True
                break

            except PlaywrightTimeoutError:
                logger.warning(
                    f"{modalidad} + {estado}: "
                    f"intento {intento_fecha}/3, campos de fecha "
                    f"aún no aparecen, re-disparando selección de Estado..."
                )

                await select_estado.select_option(ESTADOS[estado])
                await page.wait_for_timeout(2000)

        if not campos_listos:

            await page.screenshot(
                path=f"debug_fechas_no_aparecen_{modalidad}_{estado}.png",
                full_page=True
            )
            with open(
                f"debug_fechas_no_aparecen_{modalidad}_{estado}.html",
                "w",
                encoding="utf-8"
            ) as f:
                f.write(await page.content())
            raise Exception(
                f"Los campos de fecha no aparecieron para "
                f"{modalidad} + {estado} tras 3 intentos. Revisa "
                f"debug_fechas_no_aparecen_{modalidad}_{estado}.png/.html"
            )

        # Fecha Inicio
        await fecha_inicio_input.fill(fecha_inicio_str)

        # Fecha Fin
        await fecha_fin_input.fill(fecha_fin_str)

        # Verificación real del DOM
        valor_inicio = await fecha_inicio_input.input_value()
        valor_fin = await fecha_fin_input.input_value()

        logger.info(
            f"VERIFICACION DOM Fecha Inicio = '{valor_inicio}'"
        )

        logger.info(
            f"VERIFICACION DOM Fecha Fin = '{valor_fin}'"
        )

        if valor_inicio != fecha_inicio_str:
            raise RuntimeError(
                "Fecha Inicio no quedó correctamente. "
                f"Esperado={fecha_inicio_str}, "
                f"obtenido={valor_inicio}"
            )

        if valor_fin != fecha_fin_str:
            raise RuntimeError(
                "Fecha Fin no quedó correctamente. "
                f"Esperado={fecha_fin_str}, "
                f"obtenido={valor_fin}"
            )

        logger.info(
            "Las dos fechas quedaron establecidas en el formulario."
        )

    else:

        logger.info(
            f"{modalidad} + {estado}: "
            "no se colocan Fecha Inicio ni Fecha Fin."
        )
    # ------------------------------------------------------------
    # 6. Seleccionar AÑO
    # ------------------------------------------------------------
    select_anio = page.locator(
        'select[id="frmVisualizarRepresentantesPostor:j_id271"]'
    )

    await select_anio.wait_for(
        state="visible",
        timeout=15000
    )

    await select_anio.select_option(anio)

    logger.info(
        f"Año seleccionado: {anio}"
    )

    await page.wait_for_timeout(1000)
    # ------------------------------------------------------------
    # 6. BOTÓN BUSCAR
    # ------------------------------------------------------------
    boton_buscar = page.locator(
        'input[id="frmVisualizarRepresentantesPostor:j_id331"]'
    )

    await boton_buscar.wait_for(
        state="visible",
        timeout=15000
    )

    await boton_buscar.click(
        force=True
    )

    logger.info(
        f"Buscando {modalidad} / {estado} / {anio}..."
    )

    # ------------------------------------------------------------
    # 7. Esperar tabla de resultados
    # ------------------------------------------------------------
    tabla = page.locator(
        'table[id="frmVisualizarRepresentantesPostor:dtProcedimiento"]'
    )

    try:
        await tabla.wait_for(
            state="visible",
            timeout=30000
        )
    except PlaywrightTimeoutError:

        logger.error(
            f"La tabla de resultados no apareció. "
            f"URL actual: {page.url}"
        )

        await page.screenshot(
            path=f"debug_sin_tabla_{modalidad}_{estado}.png",
            full_page=True
        )

        with open(
            f"debug_sin_tabla_{modalidad}_{estado}.html",
            "w",
            encoding="utf-8"
        ) as f:
            f.write(await page.content())

        raise Exception(
            "SEACE no mostró la tabla de resultados."
        )

    logger.info(
        f"Tabla de resultados cargada: {page.url}"
    )

    # ------------------------------------------------------------
    # 7.1 ESPERAR A QUE LA BÚSQUEDA REALMENTE TERMINE
    # ------------------------------------------------------------
    # tabla.wait_for(state="visible") solo confirma que el <table>
    # sigue en el DOM. Si ya estaba visible por la búsqueda anterior,
    # esto se resuelve al instante, ANTES de que el AJAX de esta
    # nueva búsqueda haya reemplazado las filas. Esperamos a que la
    # red esté quieta y damos un margen fijo extra.
    try:
        await page.wait_for_load_state("networkidle", timeout=20000)
    except PlaywrightTimeoutError:
        pass

    await page.wait_for_timeout(1500)

    # ------------------------------------------------------------
    # 7.2 FORZAR QUE LA BÚSQUEDA EMPIECE EN LA PÁGINA 1
    # ------------------------------------------------------------
    # El paginador de ICEfaces es "pegajoso": si la búsqueda anterior
    # había quedado en la página 2, una nueva búsqueda con otros
    # filtros puede reaparecer todavía posicionada ahí. Si detectamos
    # eso, clickeamos "Primera Página" a la fuerza.
    pag_num_inicial, _, _ = await leer_paginacion(page)

    if pag_num_inicial != 1:
        logger.warning(
            f"{modalidad} / {estado}: la tabla apareció en la página "
            f"{pag_num_inicial} en vez de la 1 (paginador pegajoso de "
            f"la búsqueda anterior). Forzando 'Primera Página'..."
        )

        boton_primera = page.locator(
            'span[id="frmVisualizarRepresentantesPostor:dsPostores2first"]'
        )

        try:
            await boton_primera.wait_for(state="attached", timeout=10000)
            await boton_primera.click(force=True)

            try:
                await page.wait_for_load_state("networkidle", timeout=20000)
            except PlaywrightTimeoutError:
                pass

            await page.wait_for_timeout(1500)

            pag_num_verificado, _, _ = await leer_paginacion(page)

            if pag_num_verificado != 1:
                logger.error(
                    f"{modalidad} / {estado}: no se pudo forzar la "
                    f"página 1 (quedó en {pag_num_verificado}). "
                    f"Continúo de todos modos."
                )
            else:
                logger.info(
                    f"{modalidad} / {estado}: paginador reseteado a "
                    f"la página 1 correctamente."
                )

        except PlaywrightTimeoutError:
            logger.error(
                f"{modalidad} / {estado}: no se encontró el botón "
                f"'Primera Página' para forzar el reset. Continúo "
                f"de todos modos."
            )

    await page.screenshot(path=f"debug_pie_tabla_{modalidad}_{estado}.png", full_page=True)

    # ------------------------------------------------------------
    # 8. Recorrer TODAS las páginas de resultados
    # ------------------------------------------------------------
    # Cada fila NUEVA ya se guardó en BD apenas se extrajo (ver
    # procesar_filas_pagina_actual), así que si el paginador se
    # desincroniza acá abajo no se pierde nada. Esta función solo avisa
    # con completado=False, y quien la llama reintenta la búsqueda
    # completa: el reintento salta lo ya guardado y llega más lejos.
    # ------------------------------------------------------------

    resultados = []
    pag_num = 1
    pag_total = 1
    MAX_PAGINAS_SEGURIDAD = 60
    paginas_consecutivas_sin_nuevas = 0
    UMBRAL_CORTE = 5
    completado = False

    while True:

        pag_num, pag_total, pag_registros = await leer_paginacion(page)

        logger.info(
            f"{modalidad} / {estado}: procesando página "
            f"{pag_num}/{pag_total} ({pag_registros} registros en total)"
        )

        filas_pagina, hubo_fila_nueva = await procesar_filas_pagina_actual(
            page, modalidad, estado, anio, tender_ids_existentes, conn
        )

        resultados.extend(filas_pagina)

        if pag_num > 1:
            if hubo_fila_nueva:
                paginas_consecutivas_sin_nuevas = 0
            else:
                paginas_consecutivas_sin_nuevas += 1
                logger.info(
                    f"{modalidad} / {estado}: página {pag_num} sin filas "
                    f"nuevas ({paginas_consecutivas_sin_nuevas}/{UMBRAL_CORTE} "
                    f"consecutivas)."
                )

            if paginas_consecutivas_sin_nuevas >= UMBRAL_CORTE:
                logger.info(
                    f"{modalidad} / {estado}: {UMBRAL_CORTE} páginas seguidas "
                    f"sin filas nuevas — corto acá."
                )
                completado = True
                break

        if pag_num >= pag_total:
            logger.info(
                f"{modalidad} / {estado}: última página alcanzada "
                f"({pag_num}/{pag_total})."
            )
            completado = True
            break

        if pag_num >= MAX_PAGINAS_SEGURIDAD:
            logger.warning(
                f"{modalidad} / {estado}: tope de seguridad de "
                f"{MAX_PAGINAS_SEGURIDAD} páginas alcanzado, corto acá."
            )
            completado = True
            break

        avanzo = await ir_a_pagina_siguiente(page)

        if not avanzo:
            logger.warning(
                f"{modalidad} / {estado}: paginador desincronizado en "
                f"página {pag_num}/{pag_total}. Se reintentará la "
                f"búsqueda completa desde el principio."
            )
            break

        try:
            await tabla.wait_for(state="visible", timeout=20000)
        except PlaywrightTimeoutError:
            logger.error(
                f"{modalidad} / {estado}: la tabla no reapareció tras "
                f"pasar de página. Se reintentará la búsqueda completa "
                f"desde el principio."
            )
            await page.screenshot(
                path=f"debug_paginacion_rota_{modalidad}_{estado}_pag{pag_num}.png",
                full_page=True,
            )
            break

    logger.info(
        f"{modalidad} / {estado}: {len(resultados)} filas procesadas "
        f"(hasta página {pag_num}/{pag_total}, completado={completado})"
    )

    return resultados, completado

def upsert_placeholder(conn, item: dict, modalidad: str):
    ocid_placeholder = f"scraper-{item['nomenclatura']}"
    try:
        fecha_pub = datetime.strptime(item["fecha_publicacion"], "%d/%m/%Y %H:%M:%S")
    except ValueError:
        fecha_pub = None

    monto = None
    if item.get("Valor_Referencial"):
        m = re.search(r"[\d,]+\.?\d*", item["Valor_Referencial"].replace(",", ""))
        if m:
            try:
                monto = float(m.group(0))
            except ValueError:
                monto = None

    sql = """
        INSERT INTO seace_procesos
            (ocid, tender_id, titulo, entidad, modalidad, categoria,
             estado, origen, published_date, monto, raw_json)
        VALUES (%s,%s,%s,%s,%s,%s,'vigente','scraper',%s,%s,%s)
        ON DUPLICATE KEY UPDATE
            titulo = VALUES(titulo), entidad = VALUES(entidad),
            published_date = VALUES(published_date),
            monto = VALUES(monto), raw_json = VALUES(raw_json)
    """
    params = (
        ocid_placeholder, item["nomenclatura"], item["descripcion"],
        item["entidad"], modalidad, item["objeto"], fecha_pub,
        monto, json.dumps(item, ensure_ascii=False),
    )
    cur = conn.cursor()
    cur.execute(sql, params)
    cur.close()


async def scrapear_para_empresa(browser, empresa_id: int, usuario: str, password: str, conn) -> int:
    # new_context() aísla la sesión de cada empresa — no se pisan cookies entre una y otra
    context = await browser.new_context()
    page = await context.new_page()

    # --- DIAGNÓSTICO: capturar por qué se cierra/crashea la página ---
    def _on_page_close():
        logger.warning(f"Empresa {empresa_id}: la PÁGINA se cerró inesperadamente.")

    def _on_page_crash():
        logger.warning(f"Empresa {empresa_id}: la página CRASHEÓ (renderer).")

    def _on_context_close():
        logger.warning(f"Empresa {empresa_id}: el CONTEXT se cerró.")

    def _on_dialog(dialog):
        logger.warning(f"Empresa {empresa_id}: diálogo nativo '{dialog.type}' detectado: {dialog.message}")
        dialog.accept()

    page.on("close", _on_page_close)
    page.on("crash", _on_page_crash)
    context.on("close", _on_context_close)
    page.on("dialog", _on_dialog)

    total = 0
    try:
        await login(page, usuario, password)

        # Evidencia del estado justo después del login, ANTES de navegar al buscador
        try:
            await page.screenshot(path=f"debug_post_login_empresa_{empresa_id}.png", full_page=True)
            with open(f"debug_post_login_empresa_{empresa_id}.html", "w", encoding="utf-8") as f:
                f.write(await page.content())
            logger.info(f"Empresa {empresa_id}: URL tras login = {page.url}")
        except Exception as e_diag:
            logger.warning(f"Empresa {empresa_id}: no se pudo capturar diagnóstico post-login: {e_diag}")

        await click_buscar_procedimientos(page)

        tender_ids_existentes = obtener_tender_ids_existentes(conn)
        MAX_REINTENTOS_BUSQUEDA = 8
        for modalidad in MODALIDADES:
            for estado in ESTADOS:
                cantidad_antes = len(tender_ids_existentes)
                completado = False
                intento_busqueda = 0
                while not completado and intento_busqueda < MAX_REINTENTOS_BUSQUEDA:
                    intento_busqueda += 1
                    _resultados, completado = await buscar_convocatorias(
                        page, modalidad, estado,
                        tender_ids_existentes=tender_ids_existentes,
                        conn=conn,
                    )
                    if not completado:
                        logger.warning(
                            f"{modalidad} / {estado}: reintentando búsqueda "
                            f"completa (intento {intento_busqueda}/"
                            f"{MAX_REINTENTOS_BUSQUEDA})..."
                        )
                if not completado:
                    logger.error(
                        f"{modalidad} / {estado}: no se completó tras "
                        f"{MAX_REINTENTOS_BUSQUEDA} reintentos. Sigo con la "
                        f"siguiente combinación."
                    )
                total += len(tender_ids_existentes) - cantidad_antes
        logger.info(f"Empresa {empresa_id}: {total} filas procesadas")
    except Exception as e:
        # si una empresa falla (cuenta bloqueada, credencial vencida, etc.) las demás igual corren
        logger.error(f"Empresa {empresa_id} falló, sigo con la siguiente: {e}")
        try:
            await page.screenshot(path=f"error_empresa_{empresa_id}.png", full_page=True)
            html = await page.content()
            with open(f"error_empresa_{empresa_id}.html", "w", encoding="utf-8") as f:
                f.write(html)
            logger.info(
                f"Guardados error_empresa_{empresa_id}.png y error_empresa_{empresa_id}.html "
                f"(revísalos para ver en qué pantalla se quedó)"
            )
        except Exception:
            pass
    finally:
        # Los warnings "se cerró inesperadamente" salían de estos mismos
        # listeners de diagnóstico al cerrar el contexto normalmente.
        # Los quitamos antes de cerrar para que el log no confunda un
        # cierre normal con un error real.
        page.remove_listener("close", _on_page_close)
        context.remove_listener("close", _on_context_close)
        await context.close()
    return total


async def main():
    from seace_credenciales import listar_credenciales_activas

    credenciales = listar_credenciales_activas()
    if not credenciales:
        raise RuntimeError("No hay ninguna empresa con credenciales SEACE activas en seace_credenciales_empresa")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, slow_mo=300)
        conn = get_conn()
        total = 0
        for cred in credenciales:
            total += await scrapear_para_empresa(
                browser, cred["empresa_id"], cred["usuario"], cred["password"], conn
            )
        conn.close()
        await browser.close()
        logger.info(f"Scraper terminado (todas las empresas): {total} filas procesadas")


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())