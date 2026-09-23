"""
test_scraping_seace.py
PRUEBA DIRIGIDA por filtros (no por nomenclatura libre, porque el campo de
texto libre de SEACE no busca por nomenclatura completa de forma confiable).

Objetivo: encontrar el proceso "LP-ABR-1-2026-GRC-C-1" usando los 3 filtros
que sí identifican ese proceso de forma precisa en el formulario:

    Tipo de Selección      = "Licitación Pública Abreviada"   (LP-ABR)
    Año de la Convocatoria = "2026"
    Nro. Selección         = "1"

NOTA IMPORTANTE sobre los ids de SEACE:
  El <select> de "Tipo de Selección" tiene un id AUTOGENERADO por JSF
  (ej. "j_idt179") que puede cambiar si el servidor recompila la vista.
  Por eso NO lo referenciamos directo: lo ubicamos por el TEXTO de su
  <span> "Tipo de Selección" + filtrando que el <select> pertenezca al
  formulario correcto ("idFormBuscarProceso"), igual que ya hace
  seace_scrape_live.py. Esto es a prueba de refrescos de la página.

  En cambio, "Año de la Convocatoria" (:anioConvocatoria) y "Nro.
  Selección" (:numeroSeleccion) SÍ tienen ids estables, confirmados en
  el HTML que revisamos, así que esos se llenan directo.

  "Nombre o Sigla de Entidad" es un campo READONLY (se llena solo con
  el ícono de lupa, que abre un modal de búsqueda de entidades) — por
  eso NO lo usamos aquí. Si el filtro por Tipo+Año+Nro trae más de un
  resultado, el segundo paso sería automatizar ese modal.

Uso:
    pip install playwright
    playwright install chromium
    python test_scraping_seace.py "LP-ABR-1-2026-GRC-C-1"

    # o pasando los filtros a mano si algún día cambia la nomenclatura:
    python test_scraping_seace.py "LP-ABR-1-2026-GRC-C-1" --tipo "Licitación Pública Abreviada" --anio 2026 --nro 1

Salida:
    - screenshots y HTML crudo en ./debug_seace/ (para ver qué pasó en cada paso)
    - imprime en consola las filas encontradas y si alguna calza con la
      nomenclatura buscada
"""

import argparse
import re
import sys
import unicodedata
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

DEBUG_DIR = Path("debug_seace")
DEBUG_DIR.mkdir(exist_ok=True)

URL_BUSCADOR = "https://prod2.seace.gob.pe/seacebus-uiwd-pub/buscadorPublico/buscadorPublico.xhtml"
TIMEOUT_MS = 20_000


# ---------- utilidades (idénticas en espíritu a seace_scrape_live.py) ----------

def normalizar(texto: str) -> str:
    t = unicodedata.normalize("NFKD", texto or "")
    t = "".join(c for c in t if not unicodedata.combining(c))
    return " ".join(t.strip().lower().split())




import re as _re  # ya tienes "import re" arriba, no dupliques si ya está

# ---------- mapeo de códigos de nomenclatura -> keywords del combo real ----------

CODIGOS_TIPO_BASE = {
    "LP": "licitacion publica",
    "CP": "concurso publico",
    "AS": "adjudicacion simplificada",
    "SIE": "subasta inversa electronica",
    "CD": "contratacion directa",
    "CM": "comparacion de precios",
    "SD": "seleccion de consultores individuales",
}

CODIGOS_TIPO_MODIFICADOR = {
    "ABR": "abreviada",
}


def derivar_tipo_anio_nro(nomenclatura: str):
    """Parte cualquier nomenclatura SEACE (ej. 'LP-ABR-1-2026-GRC-C-1' o
    'LP-SM-16-2023-MINEM/DGER-1') en (keywords_tipo, anio, nro).

    Regla: se ubica el primer token de 4 dígitos (19xx/20xx) = año.
    El token inmediatamente ANTERIOR a ese = nro de selección.
    Todo lo que está antes = códigos de tipo; cada código se traduce con
    CODIGOS_TIPO_BASE/CODIGOS_TIPO_MODIFICADOR. Los códigos que no se
    reconocen (como 'SM') se ignoran en silencio -> exactamente el caso
    que describiste."""
    tokens = nomenclatura.strip().split("-")
    idx_anio = next(
        (i for i, t in enumerate(tokens) if re.fullmatch(r"(19|20)\d{2}", t)),
        None,
    )
    if idx_anio is None or idx_anio < 1:
        raise ValueError(
            f"No pude ubicar el año en '{nomenclatura}' "
            "(esperaba un token de 4 dígitos, ej. 2026)."
        )

    anio = tokens[idx_anio]
    nro = tokens[idx_anio - 1]
    tokens_tipo = tokens[: idx_anio - 1]

    keywords = []
    for tok in tokens_tipo:
        tok_up = tok.upper()
        if tok_up in CODIGOS_TIPO_BASE:
            keywords.append(CODIGOS_TIPO_BASE[tok_up])
        elif tok_up in CODIGOS_TIPO_MODIFICADOR:
            keywords.append(CODIGOS_TIPO_MODIFICADOR[tok_up])
        # códigos desconocidos (ej. 'SM') -> no aportan keyword, se ignoran

    if not keywords:
        raise ValueError(
            f"No reconocí ningún código de tipo en '{'-'.join(tokens_tipo)}' "
            f"(nomenclatura: '{nomenclatura}')."
        )
    return keywords, anio, nro


def guardar_evidencia(page, nombre: str):
    png = DEBUG_DIR / f"{nombre}.png"
    html = DEBUG_DIR / f"{nombre}.html"
    page.screenshot(path=str(png), full_page=True)
    html.write_text(page.content(), encoding="utf-8")
    print(f"  -> guardado {png} y {html}")


def activar_pestana_buscador(page):
    """Activa la pestaña 'Buscador de Procedimientos de Selección'."""
    tab = page.locator("a[href='#tbBuscador:tab1']")
    tab.first.wait_for(state="visible", timeout=TIMEOUT_MS)
    tab.first.click()
    page.wait_for_timeout(500)


def obtener_opciones(select_locator):
    return select_locator.evaluate(
        "(el) => Array.from(el.options).map(o => ({value: o.value, text: o.textContent}))"
    )


def elegir_opcion(select_locator, texto_deseado: str, nombre_campo: str):
    """Selecciona una opción de un combo PrimeFaces con clic real, y
    verifica que quedó bien puesta. Reintenta hasta 4 veces."""
    page = select_locator.page
    objetivo = normalizar(texto_deseado)
    opciones = obtener_opciones(select_locator)

    idx = next((i for i, o in enumerate(opciones) if normalizar(o["text"]) == objetivo), None)
    if idx is None:
        print(f"  [ERROR] No encontré la opción exacta '{texto_deseado}' en el combo '{nombre_campo}'.")
        print("  Opciones disponibles:")
        for o in opciones:
            print(f"    value={o['value']!r} texto={o['text']!r}")
        raise RuntimeError(f"Opción '{texto_deseado}' no encontrada en combo '{nombre_campo}'")

    opcion = opciones[idx]
    select_id = select_locator.get_attribute("id") or ""
    base = select_id[:-len("_input")] if select_id.endswith("_input") else select_id
    sel_item = f'li.ui-selectonemenu-item[data-label="{opcion["text"]}"]'

    def estado_actual():
        valor = select_locator.evaluate("(el) => el.value")
        try:
            etiqueta = page.locator(f'[id="{base}_label"]').first.inner_text(timeout=2000).strip()
        except Exception:
            etiqueta = None
        return valor, etiqueta

    def esta_ok():
        valor, etiqueta = estado_actual()
        return valor == opcion["value"] and (etiqueta is None or normalizar(etiqueta) == objetivo)

    for intento in range(1, 5):
        if esta_ok():
            return
        try:
            if intento <= 2:
                widget = page.locator(f'[id="{base}"]').first
                widget.scroll_into_view_if_needed(timeout=5000)
                widget.click(timeout=5000)
                panel = page.locator(f'[id="{base}_panel"]').first
                panel.wait_for(state="visible", timeout=5000)
                item = panel.locator(sel_item)
                if item.count() == 0:
                    item = panel.locator("li.ui-selectonemenu-item").nth(idx)
                item.first.click(timeout=5000)
            else:
                select_locator.select_option(value=opcion["value"], force=True)
                select_locator.dispatch_event("change")
        except Exception as e:
            print(f"  [combo '{nombre_campo}'] intento {intento}/4 con problemas: {e}")
            try:
                page.keyboard.press("Escape")
            except Exception:
                pass
        page.wait_for_timeout(800)
        try:
            page.wait_for_load_state("networkidle", timeout=TIMEOUT_MS)
        except Exception:
            pass

    if esta_ok():
        return
    valor, etiqueta = estado_actual()
    raise RuntimeError(
        f"No se pudo fijar '{texto_deseado}' en el combo '{nombre_campo}' tras 4 intentos "
        f"(quedó value={valor!r}, etiqueta={etiqueta!r})"
    )



def elegir_opcion_por_keywords(select_locator, keywords: list, nombre_campo: str):
    """Como elegir_opcion(), pero en vez de texto exacto recibe una lista
    de keywords normalizadas que TODAS deben estar en el texto de la
    opción. Entre las que califican, se queda con la de texto MÁS CORTO:
    así ['licitacion publica'] encuentra 'Licitación Pública' (no la
    Abreviada), y ['licitacion publica','abreviada'] sí encuentra la
    Abreviada."""
    opciones = obtener_opciones(select_locator)
    candidatas = [
        o for o in opciones
        if all(kw in normalizar(o["text"]) for kw in keywords)
    ]
    if not candidatas:
        print(f"  [ERROR] Ninguna opción de '{nombre_campo}' contiene los keywords {keywords}.")
        for o in opciones:
            print(f"    value={o['value']!r} texto={o['text']!r}")
        raise RuntimeError(f"No encontré opción para keywords {keywords} en '{nombre_campo}'")

    candidatas.sort(key=lambda o: len(o["text"]))
    elegida = candidatas[0]
    print(f"  [auto] '{nombre_campo}' <- keywords {keywords} -> elegido: {elegida['text']!r}")
    elegir_opcion(select_locator, elegida["text"], nombre_campo)


def seleccionar_tipo_seleccion_por_nomenclatura(page, keywords_tipo: list):
    """Igual que seleccionar_por_etiqueta pero eligiendo por keywords
    en vez de texto exacto (a prueba de ids autogenerados, igual que
    seleccionar_por_etiqueta)."""
    select = page.locator(
        "xpath=//span[contains(normalize-space(.), 'Tipo de Selección')]"
        "/ancestor::tr[1]//select[contains(@id, 'idFormBuscarProceso')]"
    ).first
    select.wait_for(state="attached", timeout=TIMEOUT_MS)
    elegir_opcion_por_keywords(select, keywords_tipo, "Tipo de Selección")
    page.wait_for_timeout(300)



def leer_texto_seleccionado(select_locator):
    """Lee el texto visible actualmente seleccionado de un combo
    PrimeFaces (el <span> '_label'), a partir de su <select>."""
    select_id = select_locator.get_attribute("id") or ""
    base = select_id[:-len("_input")] if select_id.endswith("_input") else select_id
    try:
        return select_locator.page.locator(f'[id="{base}_label"]').first.inner_text(timeout=2000).strip()
    except Exception:
        return None


def locator_tipo_seleccion(page):
    return page.locator(
        "xpath=//span[contains(normalize-space(.), 'Tipo de Selección')]"
        "/ancestor::tr[1]//select[contains(@id, 'idFormBuscarProceso')]"
    ).first


def locator_anio(page):
    return page.locator("select[id$=':anioConvocatoria_input']").first


def fijar_filtros_completos(page, seleccionar_tipo_fn, texto_o_keywords_tipo, anio: str,
                             nro: str, es_texto_exacto: bool, max_rondas: int = 6):
    """Selecciona Tipo de Selección + Año + Nro. Selección y REPITE hasta
    que los TRES queden correctos AL MISMO TIEMPO. En SEACE, tocar
    cualquiera de estos tres campos puede resetear a los otros por AJAX
    en cascada (Tipo<->Año, pero también Nro puede resetear a Tipo/Año),
    así que se verifica el estado real de los tres después de cada ronda,
    y solo se avanza a 'Buscar' cuando los tres coinciden en la misma
    ronda."""
    objetivo_anio = normalizar(anio)
    objetivo_nro = str(nro).strip()
    texto_tipo = texto_anio = valor_nro = None

    for ronda in range(1, max_rondas + 1):
        seleccionar_tipo_fn()
        page.wait_for_load_state("networkidle", timeout=TIMEOUT_MS)

        seleccionar_por_id_estable(page, ":anioConvocatoria", anio)
        page.wait_for_load_state("networkidle", timeout=TIMEOUT_MS)

        llenar_numero_seleccion(page, nro)
        try:
            page.locator("input[id$=':numeroSeleccion']").first.press("Tab")
        except Exception:
            pass
        page.wait_for_load_state("networkidle", timeout=TIMEOUT_MS)

        texto_tipo = leer_texto_seleccionado(locator_tipo_seleccion(page))
        texto_anio = leer_texto_seleccionado(locator_anio(page))
        try:
            valor_nro = page.locator("input[id$=':numeroSeleccion']").first.input_value()
        except Exception:
            valor_nro = None

        if es_texto_exacto:
            tipo_ok = texto_tipo is not None and normalizar(texto_tipo) == normalizar(texto_o_keywords_tipo)
        else:
            tipo_ok = texto_tipo is not None and all(kw in normalizar(texto_tipo) for kw in texto_o_keywords_tipo)
        anio_ok = texto_anio is not None and normalizar(texto_anio) == objetivo_anio
        nro_ok = valor_nro is not None and valor_nro.strip() == objetivo_nro

        print(f"  [ronda {ronda}] Tipo={texto_tipo!r} (ok={tipo_ok})  Año={texto_anio!r} (ok={anio_ok})  Nro={valor_nro!r} (ok={nro_ok})")

        if tipo_ok and anio_ok and nro_ok:
            return

    raise RuntimeError(
        f"No logré estabilizar Tipo/Año/Nro tras {max_rondas} rondas "
        f"(quedó Tipo={texto_tipo!r}, Año={texto_anio!r}, Nro={valor_nro!r})"
    )


def ejecutar_flujo_busqueda_con_reintentos(page, nomenclatura, fijar_filtros_fn, max_intentos=3):
    """Ejecuta: pestaña buscador -> filtros -> clic Buscar -> revisar
    resultados. Si SEACE devuelve la lista vacía (posible puntaje bajo
    de reCAPTCHA v3 en esa sesión, no un error real), recarga la página
    desde cero (nueva sesión = nuevo token de reCAPTCHA) y reintenta,
    hasta max_intentos veces."""
    for intento in range(1, max_intentos + 1):
        if intento > 1:
            print(f"\n  [reintento {intento}/{max_intentos}] resultado vacío, recargando sesión...")
            page.goto(URL_BUSCADOR, timeout=30000, wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle", timeout=TIMEOUT_MS)
            page.wait_for_timeout(1500)  # deja que grecaptcha.js termine de inicializar

        activar_pestana_buscador(page)
        fijar_filtros_fn()

        boton_buscar = page.locator("button[id$=':btnBuscarSelToken']")
        boton_buscar.wait_for(state="visible", timeout=TIMEOUT_MS)
        boton_buscar.click()

        page.wait_for_timeout(2500)  # da tiempo a que grecaptcha.execute() + el AJAX terminen
        try:
            page.wait_for_load_state("networkidle", timeout=TIMEOUT_MS)
            page.wait_for_selector("tbody[id$=':dtProcesos_data']", timeout=TIMEOUT_MS)
        except PWTimeout:
            print("  [aviso] la tabla de resultados tardó más de lo esperado, sigo igual...")

        fila, idx_pagina, num_pagina, todas_las_filas = buscar_en_todas_las_paginas(page, nomenclatura)
        if fila or todas_las_filas:
            return fila, idx_pagina, num_pagina, todas_las_filas

    return None, None, None, []




def seleccionar_por_etiqueta(page, texto_etiqueta: str, texto_opcion: str):
    """Ubica el <select> por el texto de su <span> asociado, filtrando
    SOLO el formulario 'idFormBuscarProceso' (hay un segundo formulario
    oculto con el mismo label, 'idFormbuscarACF', que NO queremos tocar).
    A prueba de que el id autogenerado (j_idtXXX) cambie."""
    select = page.locator(
        f"xpath=//span[contains(normalize-space(.), '{texto_etiqueta}')]"
        f"/ancestor::tr[1]//select[contains(@id, 'idFormBuscarProceso')]"
    ).first
    select.wait_for(state="attached", timeout=TIMEOUT_MS)
    elegir_opcion(select, texto_opcion, texto_etiqueta)
    page.wait_for_timeout(300)
    seleccionado = select.evaluate("(el) => el.options[el.selectedIndex]?.textContent")
    print(f"  [verificación] '{texto_etiqueta}' -> combo quedó en: {seleccionado!r}")


def seleccionar_por_id_estable(page, id_widget_termina_en: str, texto_opcion: str):
    """Para combos con id ESTABLE conocido (ej. ':anioConvocatoria')."""
    select = page.locator(f"select[id$='{id_widget_termina_en}_input']")
    select.wait_for(state="attached", timeout=TIMEOUT_MS)
    elegir_opcion(select, texto_opcion, id_widget_termina_en)
    page.wait_for_timeout(300)


def llenar_numero_seleccion(page, numero: str):
    """Campo estable: tbBuscador:idFormBuscarProceso:numeroSeleccion."""
    campo = page.locator("input[id$=':numeroSeleccion']").first
    campo.wait_for(state="visible", timeout=TIMEOUT_MS)
    campo.click()
    campo.fill(str(numero))
    print(f"  [verificación] Nro. Selección -> quedó en: {campo.input_value()!r}")


def esperar_challenge_visual(page):
    try:
        challenge = page.locator("iframe[title*='recaptcha challenge']")
        if challenge.count() > 0 and challenge.first.is_visible():
            print("Apareció un challenge visual de reCAPTCHA. Resuélvelo en la ventana del navegador.")
            input("Presiona Enter aquí para continuar...")
    except Exception:
        pass


def obtener_contenedor_tabla(page):
    contenedor = page.locator("div[id$=':dtProcesos']")
    contenedor.first.wait_for(state="attached", timeout=TIMEOUT_MS)
    return contenedor.first


def extraer_filas_resultado(contenedor):
    """Misma estructura de columnas que ya mapeaste en seace_scrape_live.py:
    0 N° | 1 Entidad | 2 Fecha Publicación | 3 Nomenclatura | 4 Reiniciado
    Desde | 5 Objeto | 6 Descripción | 7 SNIP | 8 CUI | 9 Monto | 10 Moneda
    | 11 Versión SEACE | 12 Acciones."""
    filas = contenedor.locator("tbody[id$=':dtProcesos_data'] > tr")
    n = filas.count()
    resultados = []
    for i in range(n):
        tds = filas.nth(i).locator("td")
        if tds.count() < 13:
            continue
        resultados.append({
            "entidad": tds.nth(1).inner_text().strip(),
            "fecha_publicacion": tds.nth(2).inner_text().strip(),
            "nomenclatura": tds.nth(3).inner_text().strip(),
            "objeto": tds.nth(5).inner_text().strip(),
            "descripcion": tds.nth(6).inner_text().strip(),
            "monto": tds.nth(9).inner_text().strip(),
            "moneda": tds.nth(10).inner_text().strip(),
        })
    return resultados


def leer_resumen_paginador(contenedor):
    try:
        return contenedor.locator("span.ui-paginator-current").first.inner_text(timeout=2000).strip()
    except Exception:
        return ""


def hay_pagina_siguiente(contenedor):
    boton_next = contenedor.locator("span.ui-paginator-next, a.ui-paginator-next")
    if boton_next.count() == 0:
        return False, None
    clase = boton_next.first.get_attribute("class") or ""
    if "ui-state-disabled" in clase:
        return False, None
    return True, boton_next.first


def buscar_en_todas_las_paginas(page, nomenclatura_objetivo: str, max_paginas: int = 200):
    """Recorre página por página (botón 'siguiente' de PrimeFaces) hasta
    encontrar la nomenclatura exacta o hasta que ya no haya más páginas.
    Devuelve (fila_encontrada, indice_en_su_pagina, numero_pagina, todas_las_filas)."""
    objetivo_norm = normalizar(nomenclatura_objetivo)
    todas_las_filas = []
    pagina = 1

    while True:
        contenedor = obtener_contenedor_tabla(page)
        filas = extraer_filas_resultado(contenedor)
        resumen = leer_resumen_paginador(contenedor)
        print(f"\n  Página {pagina}: {len(filas)} filas | {resumen}")

        for idx, f in enumerate(filas):
            todas_las_filas.append(f)
            if normalizar(f["nomenclatura"]) == objetivo_norm:
                print(f"  >>> ¡Encontrado en la página {pagina}, fila #{idx + 1} de esa página!")
                return f, idx, pagina, todas_las_filas

        if pagina >= max_paginas:
            print(f"  [aviso] llegué al límite de {max_paginas} páginas sin encontrarlo, me detengo.")
            break

        contenedor = obtener_contenedor_tabla(page)
        continuar, boton_next = hay_pagina_siguiente(contenedor)
        if not continuar:
            print(f"  [fin] no hay más páginas (última: {pagina}).")
            break

        boton_next.click()
        page.wait_for_timeout(900)
        try:
            page.wait_for_load_state("networkidle", timeout=TIMEOUT_MS)
        except PWTimeout:
            pass
        pagina += 1

    return None, None, None, todas_las_filas


CLAVES_PRECIOS = [
    "cuadro comparativo", "propuesta económica", "propuestas económicas",
    "orden de prelación", "monto ofertado", "precio ofertado", "postor",
]


def buscar_indicios_de_precios(html: str) -> list[str]:
    texto = html.lower()
    return [c for c in CLAVES_PRECIOS if c in texto]


def entrar_a_ficha_de_fila(page, contenedor, indice_fila: int):
    """Hace clic en el ícono de 'Ver Ficha de Selección' de la fila dada
    (mismo patrón que seace_scrape_live.py: img[id*='grafichaSel']) y
    espera a que cargue la ficha. Devuelve True si entró bien."""
    fila = contenedor.locator("tbody[id$=':dtProcesos_data'] > tr").nth(indice_fila)
    boton_ficha = fila.locator("img[id*='grafichaSel']").first
    if boton_ficha.count() == 0:
        print("  [ERROR] no encontré el ícono de 'Ver Ficha de Selección' en esta fila.")
        return False

    boton_ficha.scroll_into_view_if_needed()
    try:
        with page.expect_navigation(timeout=8000):
            boton_ficha.click()
    except PWTimeout:
        pass  # algunas veces es AJAX puro, sin navegación de página completa

    try:
        page.wait_for_load_state("networkidle", timeout=TIMEOUT_MS)
        page.locator("[id$=':pnlContenedorGral']").first.wait_for(state="visible", timeout=TIMEOUT_MS)
    except PWTimeout:
        print("  [aviso] la ficha tardó más de lo esperado en cargar, sigo igual...")
    return True



def hay_opcion_ofertas_presentadas(page) -> bool:
    """Revisa SIN LANZAR EXCEPCIÓN si la ficha tiene el enlace 'Ver
    Ofertas Presentadas'. Algunos procesos aún no llegan a esa etapa
    (sin ofertas registradas todavía, o la modalidad no la usa) y SEACE
    simplemente no lo muestra — eso NO es un error del scraper."""
    enlace = page.locator(
        "xpath=//form[contains(@id,'idFormFichaSeleccion')]"
        "//a[normalize-space(text())='Ver Ofertas Presentadas']"
    )
    if enlace.count() == 0:
        return False
    try:
        return enlace.first.is_visible()
    except Exception:
        return False


def entrar_a_ofertas_presentadas(page):
    """Hace clic en 'Ver Ofertas Presentadas' dentro de 'Opciones del
    procedimiento'. Se ubica por TEXTO (no por id, que es autogenerado
    tipo j_idtXXX y puede cambiar) y filtrando que esté dentro del
    formulario de la ficha ('idFormFichaSeleccion'). Es un submit de
    formulario completo, no XHR puro -> esperamos navegación real."""
    enlace = page.locator(
        "xpath=//form[contains(@id,'idFormFichaSeleccion')]"
        "//a[normalize-space(text())='Ver Ofertas Presentadas']"
    ).first
    enlace.wait_for(state="visible", timeout=TIMEOUT_MS)
    enlace.scroll_into_view_if_needed()

    try:
        with page.expect_navigation(timeout=8000):
            enlace.click()
    except PWTimeout:
        pass  # por si en algún caso responde por AJAX puro

    try:
        page.wait_for_load_state("networkidle", timeout=TIMEOUT_MS)
    except PWTimeout:
        print("  [aviso] la página de ofertas tardó más de lo esperado, sigo igual...")



def entrar_a_detalle_postor(page, indice_fila: int):
    """Hace clic en el ícono 'Ver detalles' (btnVer_detalle.png) de la fila
    indicada de la tabla 'Listado postores'. Es un submit de formulario
    completo, así que esperamos una navegación real de página Y ADEMÁS
    confirmamos que el contenido real de la ficha ya está presente
    (esto es lo que evita extraer sobre una página a medio cargar)."""
    tabla = page.locator("div[id$=':dtListaPostores']").first
    tabla.wait_for(state="visible", timeout=TIMEOUT_MS)
    fila = tabla.locator("tbody[id$=':dtListaPostores_data'] > tr").nth(indice_fila)
    enlace = fila.locator("a.ui-commandlink").first
    enlace.wait_for(state="visible", timeout=TIMEOUT_MS)
    enlace.scroll_into_view_if_needed()

    try:
        with page.expect_navigation(timeout=TIMEOUT_MS, wait_until="load"):
            enlace.click()
    except PWTimeout:
        pass  # por si responde por AJAX puro en vez de navegación completa

    try:
        page.wait_for_load_state("networkidle", timeout=TIMEOUT_MS)
    except PWTimeout:
        pass

    try:
        page.locator(
            "xpath=//td[normalize-space(text())='RUC/Código' or normalize-space(text())='Nombre o Razón Social']"
        ).first.wait_for(state="visible", timeout=TIMEOUT_MS)
    except PWTimeout:
        print("  [aviso] no encontré los datos del postor tras esperar; puede venir incompleto.")
    return True



def volver_a_lista_postores(page):
    """Regresa de la ficha de detalle del postor a 'Ver Ofertas
    Presentadas'. Usa go_back() con manejo de errores: la página anterior
    fue un postback de formulario, así que a veces el navegador aborta la
    navegación (net::ERR_ABORTED / frame detached). Reintenta una vez; si
    sigue fallando, reconstruye el flujo re-entrando desde la ficha."""
    try:
        page.go_back(wait_until="domcontentloaded", timeout=TIMEOUT_MS)
    except Exception as e:
        print(f"  [aviso] go_back falló ({e}); reintentando...")
        page.wait_for_timeout(1000)
        try:
            page.go_back(wait_until="domcontentloaded", timeout=TIMEOUT_MS)
        except Exception as e2:
            print(f"  [aviso] segundo go_back también falló ({e2}); "
                  "re-entro a 'Ver Ofertas Presentadas' desde la ficha.")
            entrar_a_ofertas_presentadas(page)
            return

    try:
        page.locator("div[id$=':dtListaPostores']").first.wait_for(state="visible", timeout=TIMEOUT_MS)
    except PWTimeout:
        print("  [aviso] la lista de postores tardó en reaparecer, sigo igual...")


def leer_campo_por_td(page, etiqueta: str):
    """Como leer_campo_ficha, pero para esta página el label está en un
    <td> normal (no en un <span>), así que se busca distinto."""
    td_etiqueta = page.locator(
        f"xpath=//td[normalize-space(text())='{etiqueta}']"
    ).first
    if td_etiqueta.count() == 0:
        return None
    td_valor = td_etiqueta.locator("xpath=following-sibling::td[1]").first
    try:
        texto = td_valor.inner_text().strip()
        return texto or None
    except Exception:
        return None


def extraer_items_postor(page):
    """Lee la tabla 'Listado de ítems' de la página de detalle del postor
    (div[id$=':dtListadoItems']). Aquí está el 'Monto ofertado' por ítem,
    que es justo el dato del cuadro comparativo que buscas."""
    tabla = page.locator("div[id$=':dtListadoItems']").first
    if tabla.count() == 0:
        return []
    filas = tabla.locator("tbody[id$=':dtListadoItems_data'] > tr")
    n = filas.count()
    items = []
    for i in range(n):
        tds = filas.nth(i).locator("td")
        if tds.count() < 6:
            continue
        try:
            items.append({
                "nro": tds.nth(0).inner_text().strip(),
                "descripcion": tds.nth(1).inner_text().strip(),
                "cantidad_solicitada": tds.nth(2).inner_text().strip(),
                "vr_ve_cuantia": tds.nth(3).inner_text().strip(),
                "cantidad_ofertada": tds.nth(4).inner_text().strip(),
                "monto_ofertado": tds.nth(5).inner_text().strip(),
            })
        except Exception:
            continue
    return items


def descargar_documentos_postor(page, ocid: str, ruc: str | None):
    from routers.seace_router import DOCS_DIR  # import local para evitar ciclo al tope del archivo

    ruc_carpeta = ruc or "sin_ruc"
    carpeta_destino = Path(DOCS_DIR) / "postores" / ocid / ruc_carpeta
    carpeta_destino.mkdir(parents=True, exist_ok=True)

    tabla = page.locator("div[id$=':dtListaArchivosOfertas']").first
    if tabla.count() == 0:
        return []
    filas = tabla.locator("tbody[id$=':dtListaArchivosOfertas_data'] > tr")
    n = filas.count()
    documentos = []
    for i in range(n):
        fila = filas.nth(i)
        nombre = fila.locator("td").nth(1).inner_text().strip()
        enlace = fila.locator("td").last.locator("a.ui-commandlink").last
        try:
            with page.expect_download(timeout=15000) as descarga_info:
                enlace.click()
            descarga = descarga_info.value
            ruta_absoluta = carpeta_destino / nombre
            descarga.save_as(str(ruta_absoluta))
            ruta_relativa = f"postores/{ocid}/{ruc_carpeta}/{nombre}"
            documentos.append({"nombre": nombre, "ruta_local": ruta_relativa})
        except PWTimeout:
            print(f"  [aviso] no se pudo descargar '{nombre}' (timeout)")
    return documentos


def extraer_datos_postor(page):
    """Todos los datos del postor disponibles en esta página de detalle:
    RUC, razón social, representante legal y estado de la propuesta."""
    return {
        "tipo_proveedor": leer_campo_por_td(page, "Tipo de Proveedor"),
        "ruc": leer_campo_por_td(page, "RUC/Código"),
        "consorcio": leer_campo_por_td(page, "Consorcio"),
        "razon_social": leer_campo_por_td(page, "Nombre o Razón Social"),
        "rep_legal_nombre": leer_campo_por_td(page, "Nombre"),
        "rep_legal_apellido_paterno": leer_campo_por_td(page, "Apellido paterno"),
        "rep_legal_apellido_materno": leer_campo_por_td(page, "Apellido materno"),
        "rep_legal_tipo_doc": leer_campo_por_td(page, "Tipo de documento"),
        "rep_legal_nro_doc": leer_campo_por_td(page, "Nro. documento"),
        "estado_registro": leer_campo_por_td(page, "Estado de registro"),
        "estado_propuesta": leer_campo_por_td(page, "Estado de la propuesta"),
        "mype": leer_campo_por_td(page, "MYPE"),
    }

def contar_postores(page):
    """Cuenta cuántas filas (postores) hay en la tabla de 'Ver Ofertas
    Presentadas' (dtListaPostores), para saber cuántas veces repetir el
    ciclo de entrar al detalle."""
    tabla = page.locator("div[id$=':dtListaPostores']").first
    tabla.wait_for(state="visible", timeout=TIMEOUT_MS)
    filas = tabla.locator("tbody[id$=':dtListaPostores_data'] > tr")
    return filas.count()

# ---------- lectura de detalle de la Ficha de Selección (sin descargar archivos) ----------

def leer_campo_ficha(page, etiqueta: str):
    """Lee un campo tipo 'etiqueta: valor' de la ficha, buscando el <span>
    con esa etiqueta y tomando el texto de la celda de al lado."""
    span = page.locator(f"xpath=//span[contains(normalize-space(text()), '{etiqueta}')]").first
    if span.count() == 0:
        return None
    td_valor = span.locator("xpath=ancestor::td[1]/following-sibling::td[1]").first
    if td_valor.count() == 0:
        return None
    try:
        texto = td_valor.inner_text().strip()
        return texto or None
    except Exception:
        return None


def leer_descripcion_completa(page):
    """La descripción completa del objeto vive en un diálogo aparte
    (id$=':dialogDescObj'), no en la tabla principal de la ficha."""
    dialogo = page.locator("[id$=':dialogDescObj'] .ui-dialog-content").first
    if dialogo.count() == 0:
        return None
    try:
        texto = dialogo.inner_text().strip()
        return texto or None
    except Exception:
        return None


def extraer_documentos_ficha_lista(page):
    """Solo LISTA los documentos publicados (nro, etapa, nombre, archivo,
    fecha) — NO descarga nada, para que el test sea rápido y no ensucie
    tu disco. Si alguno se llama 'BASES' o similar, es indicio de que
    ahí podría estar el cuadro comparativo si el proceso ya tiene buena pro."""
    docs = []
    filas = page.locator("tbody[id$=':dtDocumentos_data'] > tr")
    n = filas.count()
    for i in range(n):
        tds = filas.nth(i).locator("td")
        if tds.count() < 5:
            continue
        try:
            docs.append({
                "nro": tds.nth(0).inner_text().strip(),
                "etapa": tds.nth(1).inner_text().strip(),
                "documento": tds.nth(2).inner_text().strip(),
                "archivo": tds.nth(3).inner_text().strip(),
                "fecha_publicacion": tds.nth(4).inner_text().strip(),
            })
        except Exception:
            continue
    return docs


def extraer_cronograma_ficha(page):
    """Lee la tabla de Cronograma (div[id$=':dtCronograma']). Marca con
    'es_etapa_actual' la(s) fila(s) que SEACE resalta como vigente ahora."""
    filas = page.locator("tbody[id$=':dtCronograma_data'] > tr")
    n = filas.count()
    cronograma = []
    for i in range(n):
        tr = filas.nth(i)
        tds = tr.locator("td")
        if tds.count() < 3:
            continue
        try:
            clase = tr.get_attribute("class") or ""
            es_actual = "active" in clase.split()
            lineas_etapa = [l.strip() for l in tds.nth(0).inner_text().splitlines() if l.strip()]
            lineas_inicio = [l.strip() for l in tds.nth(1).inner_text().splitlines() if l.strip()]
            lineas_fin = [l.strip() for l in tds.nth(2).inner_text().splitlines() if l.strip()]
            cronograma.append({
                "etapa": lineas_etapa[0] if lineas_etapa else "",
                "fecha_inicio": lineas_inicio[0] if lineas_inicio else "",
                "fecha_fin": lineas_fin[0] if lineas_fin else "",
                "es_etapa_actual": es_actual,
            })
        except Exception:
            continue
    return cronograma


def extraer_detalle_ficha(page):
    """Junta todos los campos sueltos de la ficha en un solo dict, igual
    que hace extraer_detalle_ficha() en seace_scrape_live.py."""
    return {
        "tipo_compra_seleccion": leer_campo_ficha(page, "Tipo Compra o Selección"),
        "normativa_aplicable": leer_campo_ficha(page, "Normativa Aplicable"),
        "entidad_convocante": leer_campo_ficha(page, "Entidad Convocante"),
        "direccion_legal": leer_campo_ficha(page, "Direccion Legal"),
        "pagina_web": leer_campo_ficha(page, "Pagina Web"),
        "telefono_entidad": leer_campo_ficha(page, "Télefono de la Entidad"),
        "monto_derecho_participacion": leer_campo_ficha(page, "Monto del Derecho de Participacion"),
        "fecha_hora_publicacion_detalle": leer_campo_ficha(page, "Fecha y Hora Publicación"),
        "descripcion_objeto_completa": leer_descripcion_completa(page),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("nomenclatura", help='Ej. "LP-ABR-1-2026-GRC-C-1" (solo para comparar contra los resultados)')
    ap.add_argument("--tipo", default=None,
                    help="(opcional) Texto EXACTO del combo 'Tipo de Selección'; "
                         "si no se pasa, se deriva automáticamente de la nomenclatura")
    ap.add_argument("--anio", default=None, help="(opcional) se deriva de la nomenclatura si no se pasa")
    ap.add_argument("--nro", default=None, help="(opcional) se deriva de la nomenclatura si no se pasa")
    ap.add_argument("--headless", action="store_true", help="Correr sin ventana visible")
    args = ap.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless, slow_mo=150 if not args.headless else 0)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            )
        )
        page = context.new_page()

        print(f"\nAbriendo {URL_BUSCADOR} ...")
        page.goto(URL_BUSCADOR, timeout=30000, wait_until="domcontentloaded")
        page.wait_for_load_state("networkidle", timeout=TIMEOUT_MS)
        guardar_evidencia(page, "01_entrada")

        print("\nActivando pestaña 'Buscador de Procedimientos de Selección' ...")
        activar_pestana_buscador(page)
        guardar_evidencia(page, "02_pestana_activa")

        if args.tipo and args.anio and args.nro:
            usar_texto_exacto, keywords_tipo, anio, nro = True, None, args.anio, args.nro
        else:
            keywords_tipo, anio, nro = derivar_tipo_anio_nro(args.nomenclatura)
            usar_texto_exacto = False
            print(f"\n[auto] Derivado de '{args.nomenclatura}': tipo={keywords_tipo} anio={anio} nro={nro}")

        if usar_texto_exacto:
            fijar_filtros_fn = lambda: fijar_filtros_completos(
                page,
                lambda: seleccionar_por_etiqueta(page, "Tipo de Selección", args.tipo),
                args.tipo, anio, nro, es_texto_exacto=True,
            )
        else:
            fijar_filtros_fn = lambda: fijar_filtros_completos(
                page,
                lambda: seleccionar_tipo_seleccion_por_nomenclatura(page, keywords_tipo),
                keywords_tipo, anio, nro, es_texto_exacto=False,
            )

        print(f"\nBuscando '{args.nomenclatura}' (con reintentos si sale vacío)...")
        fila_encontrada, indice_en_pagina, num_pagina, todas_las_filas = ejecutar_flujo_busqueda_con_reintentos(
            page, args.nomenclatura, fijar_filtros_fn
        )
        guardar_evidencia(page, "04_resultados")

        print(f"\n{'=' * 70}")
        print(f"TOTAL DE FILAS REVISADAS EN TODAS LAS PÁGINAS: {len(todas_las_filas)}")
        print("=" * 70)

        if not fila_encontrada:
            print(f"\n❌ No encontré '{args.nomenclatura}' en ninguna página. Revisa la lista de abajo "
                  "por si el sufijo real es distinto (ej. otro '-C-N' de relanzamiento):\n")
            for i, f in enumerate(todas_las_filas, start=1):
                print(f"  [{i}] {f['nomenclatura']}  —  {f['entidad']}")
            browser.close()
            return

        print(f"\n✅ Encontrado en página {num_pagina}: {fila_encontrada['nomenclatura']}")
        print(f"   Entidad: {fila_encontrada['entidad']}")
        print(f"   Objeto: {fila_encontrada['objeto']} | {fila_encontrada['descripcion'][:100]}")
        print(f"   Monto: {fila_encontrada['monto']} {fila_encontrada['moneda']}")

        print("\nEntrando a su Ficha de Selección para revisar si trae el cuadro comparativo de precios...")
        contenedor = obtener_contenedor_tabla(page)
        entro_ok = entrar_a_ficha_de_fila(page, contenedor, indice_en_pagina)

        if not entro_ok:
            print("❌ No se pudo entrar a la ficha. Revisa ./debug_seace/04_resultados.png a mano.")
            browser.close()
            return

        guardar_evidencia(page, "05_ficha_seleccion")

        print("\nExtrayendo campos de la ficha (igual que extraer_detalle_ficha en seace_scrape_live.py)...")
        detalle = extraer_detalle_ficha(page)
        documentos = extraer_documentos_ficha_lista(page)
        cronograma = extraer_cronograma_ficha(page)

        html_ficha = page.content()
        indicios = buscar_indicios_de_precios(html_ficha)

        print(f"\n{'=' * 70}")
        print("DETALLE DE LA FICHA DE SELECCIÓN")
        print("=" * 70)
        for campo, valor in detalle.items():
            print(f"  {campo}: {valor!r}")

        print(f"\n--- DOCUMENTOS PUBLICADOS ({len(documentos)}) ---")
        if documentos:
            for d in documentos:
                print(f"  [{d['nro']}] ({d['etapa']}) {d['documento']} — {d['archivo']} — {d['fecha_publicacion']}")
        else:
            print("  (ninguno listado todavía, o la tabla de documentos usa otro id — revisa el .html)")

        print(f"\n--- CRONOGRAMA ({len(cronograma)} etapas) ---")
        if cronograma:
            for c in cronograma:
                marca = "  <<< ETAPA ACTUAL" if c["es_etapa_actual"] else ""
                print(f"  {c['etapa']}: {c['fecha_inicio']} -> {c['fecha_fin']}{marca}")
        else:
            print("  (sin cronograma leído, revisa el .html)")

        print(f"\n--- PALABRAS CLAVE DE PRECIOS EN TODA LA PÁGINA DE LA FICHA ---")
        print(f"  {indicios or 'ninguna'}")
        print("=" * 70)

        print("\nEntrando a 'Ver Ofertas Presentadas' para ubicar el cuadro comparativo...")
        entrar_a_ofertas_presentadas(page)
        guardar_evidencia(page, "06_ofertas_presentadas")

        total_postores = contar_postores(page)
        print(f"\nSe encontraron {total_postores} postor(es). Entrando al detalle de cada uno...")

        cuadro_comparativo = []

        for i in range(total_postores):
            print(f"\n--- Entrando al detalle del postor #{i + 1} ---")
            entrar_a_detalle_postor(page, i)
            guardar_evidencia(page, f"07_detalle_postor{i + 1}")

            datos_postor = extraer_datos_postor(page)
            items_postor = extraer_items_postor(page)
            documentos_postor = descargar_documentos_postor(
                page, DEBUG_DIR / f"docs_postor_{datos_postor['ruc'] or i+1}"
            )
            cuadro_comparativo.append({
                "ruc": datos_postor["ruc"],
                "razon_social": datos_postor["razon_social"],
                "items": items_postor,
                "documentos": documentos_postor,
            })

            # Volvemos a la página de 'Ver Ofertas Presentadas' para poder
            # entrar al siguiente postor de la lista.
            page.go_back()
            try:
                page.wait_for_load_state("networkidle", timeout=TIMEOUT_MS)
                page.locator("div[id$=':dtListaPostores']").first.wait_for(
                    state="visible", timeout=TIMEOUT_MS
                )
            except PWTimeout:
                print("  [aviso] tardó en volver a la lista de postores, sigo igual...")

        print(f"\n{'=' * 70}")
        print("CUADRO COMPARATIVO COMPLETO")
        print("=" * 70)
        for postor in cuadro_comparativo:
            print(f"\n  RUC: {postor['ruc']}  |  Razón Social: {postor['razon_social']}")
            for it in postor["items"]:
                print(f"    Ítem {it['nro']}: Monto ofertado = {it['monto_ofertado']} "
                      f"(cantidad ofertada: {it['cantidad_ofertada']})")
        print("=" * 70)

        browser.close()


if __name__ == "__main__":
    sys.exit(main() or 0)