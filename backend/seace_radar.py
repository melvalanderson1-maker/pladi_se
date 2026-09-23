"""
seace_radar.py
===========================================================
RADAR DE PROCESOS RECIENTES - SEACE

Objetivo:
    Detectar procesos que aparecen primero en el buscador
    público del SEACE y que todavía NO aparecen en OCDS.

Arquitectura:

                SEACE PUBLICO
                      |
                      v
              seace_radar.py
                      |
                      v
                   MySQL
                      ^
                      |
              seace_sync.py
                      |
                      v
                    OCDS

IMPORTANTE:
    - NO intenta saltarse CAPTCHA/reCAPTCHA.
    - Usa Playwright para interactuar con el buscador público.
    - Guarda los identificadores SEACE encontrados.
    - Evita duplicados.
    - Está pensado para ejecutar periódicamente.
"""

import os
import re
import json
import logging
import asyncio
from datetime import datetime

import mysql.connector
from dotenv import load_dotenv
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError


# ============================================================
# CONFIGURACIÓN
# ============================================================

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)

logger = logging.getLogger("seace_radar")


# ------------------------------------------------------------
# SEACE
# ------------------------------------------------------------

SEACE_URL = (
    "https://prod2.seace.gob.pe/"
    "seacebus-uiwd-pub/buscadorPublico/"
    "buscadorPublico.xhtml"
)


# ------------------------------------------------------------
# BÚSQUEDA
# ------------------------------------------------------------

ANIO = int(os.getenv("SEACE_ANIO", "2026"))

# 1877 = Licitación Pública Abreviada
TIPO_PROCEDIMIENTO = os.getenv("SEACE_TIPO_PROCEDIMIENTO", "1877")

# Opcional:
# Si quieres buscar todos los procedimientos, puedes
# modificar este valor.
#
# Para tu caso actual:
# Registro de participantes en curso
ESTADO_PROCESO = os.getenv(
    "SEACE_ESTADO",
    "REGISTRO DE PARTICIPANTES EN CURSO"
)


# ------------------------------------------------------------
# NAVEGADOR
# ------------------------------------------------------------

HEADLESS = os.getenv("SEACE_HEADLESS", "true").lower() == "true"

BROWSER = os.getenv("SEACE_BROWSER", "chromium")

PAGE_TIMEOUT = int(
    os.getenv("SEACE_PAGE_TIMEOUT", "60000")
)

REQUEST_TIMEOUT = int(
    os.getenv("SEACE_REQUEST_TIMEOUT", "60000")
)


# ------------------------------------------------------------
# PAGINACIÓN
# ------------------------------------------------------------

MAX_PAGINAS = int(
    os.getenv("SEACE_MAX_PAGINAS", "1000")
)

PAUSA_ENTRE_PAGINAS = float(
    os.getenv("SEACE_PAUSA_PAGINAS", "0.5")
)


# ------------------------------------------------------------
# MYSQL
# ------------------------------------------------------------

DB_CONFIG = {
    "host": os.getenv("MYSQL_HOST", "localhost"), "port": int(os.getenv("MYSQL_PORT", "3306")),
    "user": os.getenv("MYSQL_USER"),
    "password": os.getenv("MYSQL_PASSWORD"),
    "database": os.getenv("MYSQL_DATABASE"),
    "port": int(os.getenv("MYSQL_PORT", "3306")),
}


# ============================================================
# MYSQL
# ============================================================

def get_conn():
    return mysql.connector.connect(**DB_CONFIG)


def ensure_table():
    """
    Crea las columnas necesarias para que el radar pueda
    coexistir con tu tabla seace_procesos.
    """

    conn = get_conn()
    cur = conn.cursor()

    # --------------------------------------------------------
    # Tabla principal
    # --------------------------------------------------------

    cur.execute("""
        CREATE TABLE IF NOT EXISTS seace_procesos (
            ocid VARCHAR(120) NULL,
            tender_id VARCHAR(100) NULL,

            nid_convocatoria VARCHAR(100) NULL,
            nid_proceso VARCHAR(100) NULL,
            nid_sistema VARCHAR(30) NULL,

            nomenclatura VARCHAR(180) NULL,

            titulo VARCHAR(255) NULL,
            descripcion TEXT NULL,

            entidad VARCHAR(255) NULL,
            entidad_ruc VARCHAR(30) NULL,

            modalidad VARCHAR(150) NULL,
            categoria VARCHAR(100) NULL,

            fecha_convocatoria DATETIME NULL,
            fecha_fin_consultas DATETIME NULL,

            monto DECIMAL(18,2) NULL,
            moneda VARCHAR(10) NULL,

            estado VARCHAR(100) NULL,

            tiene_indicio_desierto TINYINT(1) DEFAULT 0,

            published_date DATETIME NULL,

            origen VARCHAR(30) DEFAULT 'scraper',

            raw_json LONGTEXT NULL,

            updated_at TIMESTAMP
                DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,

            INDEX idx_nomenclatura (nomenclatura),
            INDEX idx_nid_convocatoria (nid_convocatoria),
            INDEX idx_nid_proceso (nid_proceso),
            INDEX idx_fecha_convocatoria (fecha_convocatoria),
            INDEX idx_entidad (entidad),
            INDEX idx_origen (origen)
        ) ENGINE=InnoDB
        DEFAULT CHARSET=utf8mb4
    """)

    conn.commit()

    # --------------------------------------------------------
    # Agregar columnas si la tabla YA EXISTÍA
    # --------------------------------------------------------

    columnas = [
        ("nid_convocatoria", "VARCHAR(100) NULL"),
        ("nid_proceso", "VARCHAR(100) NULL"),
        ("nid_sistema", "VARCHAR(30) NULL"),
        ("nomenclatura", "VARCHAR(180) NULL"),
        ("moneda", "VARCHAR(10) NULL"),
        ("origen", "VARCHAR(30) DEFAULT 'scraper'"),
    ]

    for nombre, tipo in columnas:

        cur.execute("""
            SELECT COUNT(*)
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'seace_procesos'
              AND COLUMN_NAME = %s
        """, (nombre,))

        existe = cur.fetchone()[0]

        if not existe:

            try:
                cur.execute(
                    f"""
                    ALTER TABLE seace_procesos
                    ADD COLUMN {nombre} {tipo}
                    """
                )

                logger.info(
                    f"Columna creada: {nombre}"
                )

            except Exception as e:

                logger.warning(
                    f"No se pudo crear columna {nombre}: {e}"
                )

    conn.commit()

    # --------------------------------------------------------
    # Índices
    # --------------------------------------------------------

    indices = [
        (
            "idx_seace_nomenclatura",
            "nomenclatura"
        ),
        (
            "idx_seace_nid_convocatoria",
            "nid_convocatoria"
        ),
        (
            "idx_seace_nid_proceso",
            "nid_proceso"
        ),
    ]

    for nombre_indice, columna in indices:

        try:

            cur.execute(f"""
                CREATE INDEX {nombre_indice}
                ON seace_procesos ({columna})
            """)

        except mysql.connector.Error:
            # Ya existe
            pass

    conn.commit()

    cur.close()
    conn.close()


# ============================================================
# UTILIDADES
# ============================================================

def limpiar_texto(texto):
    if texto is None:
        return None

    texto = str(texto)

    texto = re.sub(
        r"\s+",
        " ",
        texto
    )

    return texto.strip()


def convertir_fecha(fecha):
    """
    Convierte:

        03/09/2026 23:53:00

    a:

        datetime(2026, 9, 3, 23, 53, 0)
    """

    if not fecha:
        return None

    fecha = limpiar_texto(fecha)

    formatos = [
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y",
    ]

    for formato in formatos:

        try:
            return datetime.strptime(
                fecha,
                formato
            )

        except ValueError:
            pass

    logger.warning(
        f"No se pudo convertir fecha: {fecha}"
    )

    return None


def convertir_monto(texto):
    """
    Convierte ejemplos:

        S/ 4,812,094.15
        4,812,094.15
        4812094.15
    """

    if not texto:
        return None

    texto = str(texto)

    texto = (
        texto
        .replace("S/", "")
        .replace("S/.", "")
        .replace(",", "")
        .strip()
    )

    match = re.search(
        r"\d+(?:\.\d+)?",
        texto
    )

    if not match:
        return None

    try:
        return float(match.group(0))

    except ValueError:
        return None


# ============================================================
# PARSEO DE IDENTIFICADORES
# ============================================================

def extraer_atributo(html, nombre):
    """
    Busca atributos comunes dentro del HTML.

    Ejemplo:

        nidConvocatoria="123456"

    o

        nidConvocatoria='123456'
    """

    patrones = [
        rf'{re.escape(nombre)}="([^"]+)"',
        rf"{re.escape(nombre)}='([^']+)'",
        rf'{re.escape(nombre)}\s*=\s*([^ >]+)',
    ]

    for patron in patrones:

        match = re.search(
            patron,
            html,
            re.IGNORECASE
        )

        if match:
            return match.group(1)

    return None


def extraer_nid_desde_html(html):

    nid_convocatoria = (
        extraer_atributo(
            html,
            "nidConvocatoria"
        )
    )

    nid_proceso = (
        extraer_atributo(
            html,
            "nidProceso"
        )
    )

    nid_sistema = (
        extraer_atributo(
            html,
            "nidSistema"
        )
    )

    return (
        nid_convocatoria,
        nid_proceso,
        nid_sistema
    )


# ============================================================
# PARSEO DE FILAS
# ============================================================

async def extraer_filas(page):
    """
    Extrae las filas visibles del resultado.

    IMPORTANTE:
    SEACE usa una tabla JSF/PrimeFaces, por lo que no
    dependemos de una clase CSS concreta.
    """

    filas = []

    # --------------------------------------------------------
    # Buscar tablas
    # --------------------------------------------------------

    tablas = page.locator("table")

    cantidad_tablas = await tablas.count()

    logger.info(
        f"Tablas encontradas: {cantidad_tablas}"
    )

    for i in range(cantidad_tablas):

        tabla = tablas.nth(i)

        try:

            texto = await tabla.inner_text(
                timeout=3000
            )

        except Exception:
            continue

        if not texto:
            continue

        texto_lower = texto.lower()

        # ----------------------------------------------------
        # Identificar tabla REAL de resultados
        # ----------------------------------------------------

        tabla_id = await tabla.get_attribute("id")

        # SEACE tiene muchas tablas internas.
        # Estas pertenecen al FORMULARIO DE BÚSQUEDA,
        # NO a los resultados.
        if tabla_id and "idFormbuscarACF" in tabla_id:
            continue

        # También descartamos tablas claramente relacionadas
        # con controles del formulario.
        if (
            "Nombre o Sigla de Entidad" in texto
            or "Tipo de Selección" in texto
            or "Objeto de Contratación" in texto
            or "Fecha de la Publicación" in texto
        ):
            continue

        texto_lower = texto.lower()

        palabras_resultado = [
            "nomenclatura",
            "entidad",
            "objeto",
            "fecha",
        ]

        coincidencias = sum(
            1
            for palabra in palabras_resultado
            if palabra in texto_lower
        )

        if coincidencias < 2:
            continue

        # ----------------------------------------------------
        # DEBUG: mostrar tabla candidata
        # ----------------------------------------------------

        logger.info(
            f"Tabla candidata de RESULTADOS: #{i}"
        )

        logger.info(
            f"ID tabla: {tabla_id}"
        )

        logger.info(
            f"Texto tabla: {repr(texto[:1000])}"
        )

        tbody = tabla.locator(":scope > tbody")

        cantidad_filas = await tbody.locator(":scope > tr").count()

        logger.info(
            f"Filas encontradas: {cantidad_filas}"
        )




        # ============================================================
        # FIN DEBUG
        # ============================================================


        for j in range(cantidad_filas):

            tr = tbody.locator(":scope > tr").nth(j)

            try:

                celdas = tr.locator("td")

                cantidad_celdas = await celdas.count()

                if cantidad_celdas < 4:
                    continue

                textos = []

                for k in range(cantidad_celdas):

                    valor = await celdas.nth(k).inner_text()

                    textos.append(
                        limpiar_texto(valor)
                    )

                fila_html = await tr.inner_html()

                (
                    nid_convocatoria,
                    nid_proceso,
                    nid_sistema
                ) = extraer_nid_desde_html(
                    fila_html
                )

                # ------------------------------------------------
                # Intentar identificar nomenclatura
                # ------------------------------------------------

                nomenclatura = None

                for valor in textos:

                    if not valor:
                        continue

                    # Ejemplos:
                    #
                    # LP-ABR-3-2026-MDCH/C-1
                    # CP-ABR-4-2026-MDSP/CS-1

                    if re.search(
                        r"\b[A-Z]{2,10}-[A-Z0-9-]+-\d{4}-[A-Z0-9]+",
                        valor,
                        re.IGNORECASE
                    ):
                        nomenclatura = valor
                        break

                # ------------------------------------------------
                # Buscar fecha
                # ------------------------------------------------

                fecha_publicacion = None

                for valor in textos:

                    if not valor:
                        continue

                    if re.search(
                        r"\d{2}/\d{2}/\d{4}",
                        valor
                    ):

                        fecha_publicacion = (
                            convertir_fecha(valor)
                        )

                        if fecha_publicacion:
                            break

                # ------------------------------------------------
                # Buscar monto
                # ------------------------------------------------

                monto = None

                for valor in textos:

                    if not valor:
                        continue

                    if (
                        "S/" in valor
                        or re.search(
                            r"\d{1,3}(?:,\d{3})+\.\d{2}",
                            valor
                        )
                    ):

                        posible = convertir_monto(
                            valor
                        )

                        if posible is not None:

                            monto = posible
                            break

                # ------------------------------------------------
                # Entidad
                # ------------------------------------------------

                entidad = None

                for valor in textos:

                    if not valor:
                        continue

                    if (
                        "MUNICIPALIDAD" in valor.upper()
                        or
                        "GOBIERNO" in valor.upper()
                        or
                        "MINISTERIO" in valor.upper()
                        or
                        "UNIVERSIDAD" in valor.upper()
                    ):

                        entidad = valor
                        break

                # ------------------------------------------------
                # Objeto
                # ------------------------------------------------

                objeto = None

                for valor in textos:

                    if valor in (
                        "Obra",
                        "Bien",
                        "Servicio",
                        "Consultoría de Obra",
                        "Consultoria de Obra",
                    ):

                        objeto = valor
                        break

                # ------------------------------------------------
                # Si encontramos algo parecido a una fila
                # ------------------------------------------------

                if nomenclatura or nid_convocatoria or nid_proceso:

                    registro = {
                        "nid_convocatoria": nid_convocatoria,
                        "nid_proceso": nid_proceso,
                        "nid_sistema": nid_sistema,

                        "nomenclatura": nomenclatura,

                        "entidad": entidad,

                        "fecha_publicacion":
                            fecha_publicacion,

                        "objeto": objeto,

                        "monto": monto,

                        "celdas": textos,

                        "html": fila_html,
                    }

                    filas.append(
                        registro
                    )

            except Exception as e:

                logger.warning(
                    f"Error procesando fila {j}: {e}"
                )

        # Ya encontramos tabla
        break

    return filas


# ============================================================
# GUARDAR EN MYSQL
# ============================================================

def guardar_proceso(registro):

    conn = get_conn()
    cur = conn.cursor()

    nomenclatura = registro.get(
        "nomenclatura"
    )

    nid_convocatoria = registro.get(
        "nid_convocatoria"
    )

    nid_proceso = registro.get(
        "nid_proceso"
    )

    # --------------------------------------------------------
    # Verificar existencia
    # --------------------------------------------------------

    existente = None

    if nid_convocatoria:

        cur.execute(
            """
            SELECT ocid
            FROM seace_procesos
            WHERE nid_convocatoria = %s
            LIMIT 1
            """,
            (nid_convocatoria,)
        )

        existente = cur.fetchone()

    if not existente and nomenclatura:

        cur.execute(
            """
            SELECT ocid
            FROM seace_procesos
            WHERE nomenclatura = %s
            LIMIT 1
            """,
            (nomenclatura,)
        )

        existente = cur.fetchone()

    # --------------------------------------------------------
    # Si ya existe → actualizar
    # --------------------------------------------------------

    if existente:

        cur.execute(
            """
            UPDATE seace_procesos
            SET
                nid_proceso =
                    COALESCE(%s, nid_proceso),

                nid_sistema =
                    COALESCE(%s, nid_sistema),

                entidad =
                    COALESCE(%s, entidad),

                fecha_convocatoria =
                    COALESCE(%s, fecha_convocatoria),

                monto =
                    COALESCE(%s, monto),

                categoria =
                    COALESCE(%s, categoria),

                origen =
                    CASE
                        WHEN origen IS NULL
                             THEN 'scraper'
                        ELSE origen
                    END,

                raw_json = %s

            WHERE
                (
                    nid_convocatoria = %s
                    AND nid_convocatoria IS NOT NULL
                )
                OR
                (
                    nomenclatura = %s
                    AND nomenclatura IS NOT NULL
                )
            """,

            (
                nid_proceso,
                registro.get("nid_sistema"),
                registro.get("entidad"),
                registro.get("fecha_publicacion"),
                registro.get("monto"),
                registro.get("objeto"),

                json.dumps(
                    registro,
                    ensure_ascii=False
                ),

                nid_convocatoria,
                nomenclatura,
            )
        )

        logger.info(
            f"ACTUALIZADO: {nomenclatura}"
        )

    # --------------------------------------------------------
    # Nuevo
    # --------------------------------------------------------

    else:

        cur.execute(
            """
            INSERT INTO seace_procesos
            (
                ocid,

                tender_id,

                nid_convocatoria,
                nid_proceso,
                nid_sistema,

                nomenclatura,

                titulo,
                descripcion,

                entidad,
                entidad_ruc,

                modalidad,
                categoria,

                fecha_convocatoria,
                fecha_fin_consultas,

                monto,
                moneda,

                estado,

                tiene_indicio_desierto,

                published_date,

                origen,

                raw_json
            )
            VALUES
            (
                NULL,
                NULL,

                %s,
                %s,
                %s,

                %s,

                %s,
                %s,

                %s,
                NULL,

                NULL,
                %s,

                %s,
                NULL,

                %s,
                'PEN',

                %s,

                0,

                %s,

                'scraper',

                %s
            )
            """,

            (
                nid_convocatoria,
                nid_proceso,
                registro.get("nid_sistema"),

                nomenclatura,

                nomenclatura,
                None,

                registro.get("entidad"),

                registro.get("objeto"),

                registro.get("fecha_publicacion"),

                registro.get("monto"),

                ESTADO_PROCESO,

                registro.get("fecha_publicacion"),

                json.dumps(
                    registro,
                    ensure_ascii=False
                ),
            )
        )

        logger.info(
            f"NUEVO PROCESO DETECTADO: {nomenclatura}"
        )

    conn.commit()

    cur.close()
    conn.close()


# ============================================================
# GUARDAR LOTE
# ============================================================

def guardar_lote(registros):

    if not registros:
        return

    logger.info(
        f"Guardando {len(registros)} registros..."
    )

    for registro in registros:

        try:

            guardar_proceso(
                registro
            )

        except Exception as e:

            logger.error(
                f"Error guardando registro: {e}"
            )


# ============================================================
# DETECTAR CAPTCHA
# ============================================================

async def detectar_captcha(page):

    try:

        texto = (
            await page.locator("body").inner_text(
                timeout=3000
            )
        )

    except Exception:
        return False

    texto_lower = texto.lower()

    palabras = [
        "captcha",
        "recaptcha",
        "verifica que eres humano",
        "i'm not a robot",
        "no soy un robot",
    ]

    for palabra in palabras:

        if palabra in texto_lower:

            return True

    return False


# ============================================================
# ESPERAR RESULTADOS
# ============================================================

async def esperar_resultados(page):

    """
    Espera que SEACE termine el AJAX.
    """

    # Primero esperamos red
    try:

        await page.wait_for_load_state(
            "networkidle",
            timeout=15000
        )

    except Exception:
        pass

    # Luego buscamos señales de resultados
    for _ in range(20):

        try:

            texto = await page.locator(
                "body"
            ).inner_text()

            texto_lower = texto.lower()

            if (
                "nomenclatura" in texto_lower
                or
                "no se encontraron" in texto_lower
                or
                "no existen registros" in texto_lower
            ):

                return True

        except Exception:
            pass

        await asyncio.sleep(0.5)

    return False


# ============================================================
# LOCALIZAR SELECTORES
# ============================================================

async def listar_selects(page):

    selects = page.locator("select")

    cantidad = await selects.count()

    logger.info(
        f"SELECT encontrados: {cantidad}"
    )

    for i in range(cantidad):

        try:

            select = selects.nth(i)

            name = await select.get_attribute(
                "name"
            )

            select_id = await select.get_attribute(
                "id"
            )

            logger.info(
                f"SELECT #{i}: "
                f"id={select_id} "
                f"name={name}"
            )

        except Exception:
            pass


# ============================================================
# CONFIGURAR FORMULARIO
# ============================================================

async def configurar_busqueda(page):

    logger.info("=" * 70)
    logger.info("CONFIGURANDO FORMULARIO SEACE")
    logger.info("=" * 70)

    # ========================================================
    # IDs REALES OBTENIDOS DEL SEACE
    # ========================================================

    ID_TIPO = (
        "tbBuscador:idFormBuscarProceso:j_idt209_input"
    )

    ID_ANIO = (
        "tbBuscador:idFormBuscarProceso:anioConvocatoria_input"
    )

    ID_VERSION = (
        "tbBuscador:idFormBuscarProceso:j_idt257_input"
    )

    # ========================================================
    # FUNCIÓN AUXILIAR
    # ========================================================

    async def inspeccionar_select(select_id):

        locator = page.locator(
            f"select[id='{select_id}']"
        )

        if not await locator.count():

            logger.error(
                f"NO EXISTE SELECT: {select_id}"
            )

            return None

        try:

            visible = await locator.is_visible()

        except Exception:
            visible = False

        logger.info(
            f"SELECT encontrado: {select_id}"
        )

        logger.info(
            f"Visible: {visible}"
        )

        try:

            opciones = await locator.locator(
                "option"
            ).all()

            logger.info(
                f"Opciones encontradas: {len(opciones)}"
            )

            for opcion in opciones[:30]:

                value = await opcion.get_attribute(
                    "value"
                )

                texto = await opcion.inner_text()

                logger.info(
                    f"  value={value!r} "
                    f"text={texto!r}"
                )

        except Exception as e:

            logger.warning(
                f"No se pudieron leer opciones: {e}"
            )

        return locator

    # ========================================================
    # 1. INSPECCIONAR TIPO
    # ========================================================

    logger.info(
        "Inspeccionando TIPO DE PROCEDIMIENTO..."
    )

    select_tipo = await inspeccionar_select(
        ID_TIPO
    )

    # ========================================================
    # 2. INSPECCIONAR AÑO
    # ========================================================

    logger.info(
        "Inspeccionando AÑO..."
    )

    select_anio = await inspeccionar_select(
        ID_ANIO
    )

    # ========================================================
    # 3. INSPECCIONAR VERSION
    # ========================================================

    logger.info(
        "Inspeccionando VERSION SEACE..."
    )

    select_version = await inspeccionar_select(
        ID_VERSION
    )

    # ========================================================
    # 4. SELECCIONAR TIPO
    # ========================================================

    if select_tipo:

        logger.info(
            f"Seleccionando tipo: {TIPO_PROCEDIMIENTO}"
        )

        try:

            # IMPORTANTE:
            # El SELECT real de PrimeFaces está oculto.
            # Por eso usamos force=True.
            await select_tipo.select_option(
                value=TIPO_PROCEDIMIENTO,
                force=True
            )

            # Dar tiempo al AJAX de PrimeFaces
            await asyncio.sleep(1)

            # Verificar valor seleccionado
            valor_tipo = await select_tipo.input_value()

            logger.info(
                f"OK - TIPO seleccionado. Valor actual: {valor_tipo}"
            )

            # Verificar que realmente sea 1877
            if valor_tipo != TIPO_PROCEDIMIENTO:
                raise RuntimeError(
                    f"SEACE no aceptó el tipo. "
                    f"Esperado={TIPO_PROCEDIMIENTO}, "
                    f"Actual={valor_tipo}"
                )

        except Exception as e:

            logger.error(
                f"ERROR seleccionando TIPO: {e}"
            )

            raise
    # ========================================================
    # 5. SELECCIONAR AÑO
    # ========================================================

    if select_anio:

        logger.info(
            f"Seleccionando año: {ANIO}"
        )

        try:

            await select_anio.select_option(
                value=str(ANIO),
                force=True
            )

            await asyncio.sleep(1)

            valor_anio = await select_anio.input_value()

            logger.info(
                f"OK - AÑO seleccionado. Valor actual: {valor_anio}"
            )

            if valor_anio != str(ANIO):
                raise RuntimeError(
                    f"SEACE no aceptó el año. "
                    f"Esperado={ANIO}, "
                    f"Actual={valor_anio}"
                )

        except Exception as e:

            logger.error(
                f"ERROR seleccionando AÑO: {e}"
            )

            raise

    # ========================================================
    # 6. VERSION SEACE = 3
    # ========================================================

    if select_version:

        logger.info(
            "Seleccionando versión SEACE: 3"
        )

        try:

            await select_version.select_option(
                value="3",
                force=True
            )

            await asyncio.sleep(1)

            valor_version = await select_version.input_value()

            logger.info(
                f"OK - VERSION SEACE seleccionada. "
                f"Valor actual: {valor_version}"
            )

            if valor_version != "3":
                raise RuntimeError(
                    f"SEACE no aceptó la versión. "
                    f"Esperado=3, "
                    f"Actual={valor_version}"
                )

        except Exception as e:

            logger.error(
                f"ERROR seleccionando VERSION SEACE: {e}"
            )

            raise
    # ========================================================
    # 7. MOSTRAR VALORES ACTUALES
    # ========================================================

    logger.info("=" * 70)
    logger.info("VALORES ACTUALES DEL FORMULARIO")
    logger.info("=" * 70)

    try:

        if select_tipo:

            valor = await select_tipo.input_value()

            logger.info(
                f"TIPO       = {valor}"
            )

    except Exception:
        pass

    try:

        if select_anio:

            valor = await select_anio.input_value()

            logger.info(
                f"AÑO        = {valor}"
            )

    except Exception:
        pass

    try:

        if select_version:

            valor = await select_version.input_value()

            logger.info(
                f"VERSION    = {valor}"
            )

    except Exception:
        pass

    logger.info("=" * 70)
    logger.info(
        "CONFIGURACIÓN BASE TERMINADA"
    )
    logger.info("=" * 70)

# ============================================================
# BOTÓN BUSCAR
# ============================================================
async def ejecutar_busqueda(page):
    logger.info("Ejecutando búsqueda...")

    # ========================================================
    # 1. BOTÓN REAL DE PRIMEFACES
    # ========================================================
    boton_real = page.locator(
        "[id='tbBuscador:idFormBuscarProceso:btnBuscarSel']"
    ).first

    if not await boton_real.count():
        raise RuntimeError(
            "NO SE ENCONTRÓ EL BOTÓN REAL DE BÚSQUEDA"
        )

    logger.info("Botón real BUSCAR encontrado")

    try:
        tag = await boton_real.evaluate(
            "(el) => el.tagName"
        )

        visible = await boton_real.is_visible()

        logger.info(
            f"Tag botón real: {tag}"
        )

        logger.info(
            f"Visible botón real: {visible}"
        )

    except Exception as e:
        logger.warning(
            f"No se pudo inspeccionar botón real: {e}"
        )

    # ========================================================
    # 2. BUSCAR ELEMENTO VISUAL DE PRIMEFACES
    # ========================================================
    #
    # PrimeFaces normalmente genera:
    #
    # <button ...>
    #     <span class="ui-button-text">Buscar</span>
    # </button>
    #
    # El button puede estar oculto por CSS mientras que
    # el elemento visual está dentro de un contenedor.
    #
    # ========================================================

    candidatos = [
        "[id='tbBuscador:idFormBuscarProceso:btnBuscarSel']",
        "#tbBuscador\\:idFormBuscarProceso\\:btnBuscarSel",
        "button[name='tbBuscador:idFormBuscarProceso:btnBuscarSel']",
        ".btnBuscar_buscadorProcesos",
    ]

    elemento_click = None

    for selector in candidatos:

        try:

            loc = page.locator(selector).first

            if not await loc.count():
                continue

            logger.info(
                f"Encontrado candidato BUSCAR: {selector}"
            )

            try:
                visible = await loc.is_visible()
            except Exception:
                visible = False

            logger.info(
                f"Visible candidato: {visible}"
            )

            if visible:
                elemento_click = loc
                logger.info(
                    f"Usando candidato visible: {selector}"
                )
                break

        except Exception as e:

            logger.warning(
                f"Error inspeccionando {selector}: {e}"
            )

    # ========================================================
    # 3. SI HAY ELEMENTO VISIBLE → CLICK NORMAL
    # ========================================================

    if elemento_click:

        try:

            await elemento_click.click(
                timeout=15000
            )

            logger.info(
                "Click BUSCAR ejecutado correctamente."
            )

        except Exception as e:

            logger.warning(
                f"Click normal falló: {e}"
            )

            elemento_click = None

    # ========================================================
    # 4. FALLBACK: CLICK FORCE SOBRE EL BOTÓN REAL
    # ========================================================
    #
    # IMPORTANTE:
    #
    # No estamos saltando CAPTCHA.
    #
    # Solo estamos haciendo que Playwright dispare el evento
    # del botón oculto que pertenece al formulario PrimeFaces.
    #
    # ========================================================

    if elemento_click is None:

        logger.warning(
            "No se encontró elemento visual visible."
        )

        logger.info(
            "Intentando click force sobre botón PrimeFaces..."
        )

        try:

            await boton_real.click(
                force=True,
                timeout=15000
            )

            logger.info(
                "Click FORCE ejecutado correctamente."
            )

        except Exception as e:

            logger.error(
                f"Falló click FORCE: {e}"
            )

            # =================================================
            # ÚLTIMO DIAGNÓSTICO
            # =================================================

            try:

                await page.screenshot(
                    path="seace_radar_error_boton_buscar.png",
                    full_page=True
                )

                logger.info(
                    "Screenshot guardado: "
                    "seace_radar_error_boton_buscar.png"
                )

            except Exception:
                pass

            raise

    # ========================================================
    # 5. ESPERAR RESPUESTA AJAX DE PRIMEFACES
    # ========================================================

    logger.info(
        "Esperando respuesta de SEACE..."
    )

    await esperar_resultados(page)

    # ========================================================
    # 6. CAPTCHA
    # ========================================================

    if await detectar_captcha(page):

        logger.warning(
            "SE DETECTÓ CAPTCHA/reCAPTCHA."
        )

        logger.warning(
            "No se intenta saltar el CAPTCHA."
        )

        raise RuntimeError(
            "SEACE solicita CAPTCHA/reCAPTCHA"
        )

    logger.info(
        "Búsqueda terminada."
    )


# ============================================================
# PAGINACIÓN
# ============================================================

async def obtener_numero_pagina_actual(page):

    """
    Intenta encontrar la página actual.
    """

    selectores = [
        ".ui-paginator-page.ui-state-active",
        ".ui-paginator-current",
        "[aria-current='page']",
    ]

    for selector in selectores:

        loc = page.locator(selector).first

        if await loc.count():

            try:

                texto = await loc.inner_text()

                match = re.search(
                    r"\d+",
                    texto
                )

                if match:
                    return int(
                        match.group(0)
                    )

            except Exception:
                pass

    return None


async def siguiente_pagina(page):

    """
    Intenta pulsar el botón siguiente de PrimeFaces.
    """

    selectores = [
        ".ui-paginator-next",
        "a[aria-label*='Next']",
        "a[aria-label*='Siguiente']",
        ".ui-paginator-next:not(.ui-state-disabled)",
    ]

    for selector in selectores:

        boton = page.locator(
            selector
        ).first

        if not await boton.count():
            continue

        try:

            clase = await boton.get_attribute(
                "class"
            )

            if clase and "ui-state-disabled" in clase:
                continue

            logger.info(
                f"Pasando a siguiente página..."
            )

            await boton.click(
                timeout=10000
            )

            await asyncio.sleep(
                PAUSA_ENTRE_PAGINAS
            )

            await esperar_resultados(
                page
            )

            return True

        except Exception as e:

            logger.warning(
                f"Error paginando con {selector}: {e}"
            )

    return False


# ============================================================
# RADAR
# ============================================================

async def ejecutar_radar():

    logger.info("=" * 70)
    logger.info("SEACE RADAR INICIANDO")
    logger.info("=" * 70)

    logger.info(
        f"Año: {ANIO}"
    )

    logger.info(
        f"Tipo procedimiento: "
        f"{TIPO_PROCEDIMIENTO}"
    )

    logger.info(
        f"Estado: {ESTADO_PROCESO}"
    )

    # --------------------------------------------------------
    # BD
    # --------------------------------------------------------

    ensure_table()

    # --------------------------------------------------------
    # PLAYWRIGHT
    # --------------------------------------------------------

    async with async_playwright() as p:

        if BROWSER == "firefox":

            browser = await p.firefox.launch(
                headless=HEADLESS
            )

        elif BROWSER == "webkit":

            browser = await p.webkit.launch(
                headless=HEADLESS
            )

        else:

            browser = await p.chromium.launch(
                headless=HEADLESS
            )

        context = await browser.new_context(
            viewport={
                "width": 1600,
                "height": 1000,
            },

            locale="es-PE",

            timezone_id="America/Lima",

            user_agent=(
                "Mozilla/5.0 "
                "(Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 "
                "(KHTML, like Gecko) "
                "Chrome/139.0.0.0 "
                "Safari/537.36"
            ),
        )

        page = await context.new_page()

        page.set_default_timeout(
            PAGE_TIMEOUT
        )

        # ----------------------------------------------------
        # LOG DE REQUESTS
        # ----------------------------------------------------

        def on_request(request):

            url = request.url

            if (
                "buscadorPublico" in url
                or
                "seacebus" in url
            ):

                if request.method == "POST":

                    logger.debug(
                        f"POST SEACE: {url}"
                    )

        page.on(
            "request",
            on_request
        )

        # ----------------------------------------------------
        # ABRIR SEACE
        # ----------------------------------------------------

        logger.info(
            "Abriendo buscador público SEACE..."
        )

        try:

            await page.goto(
                SEACE_URL,
                wait_until="domcontentloaded",
                timeout=PAGE_TIMEOUT
            )

        except Exception as e:

            logger.error(
                f"Error abriendo SEACE: {e}"
            )

            await browser.close()

            return

        logger.info(
            f"URL actual: {page.url}"
        )

        # ----------------------------------------------------
        # CAPTCHA INICIAL
        # ----------------------------------------------------

        if await detectar_captcha(page):

            logger.warning(
                "SEACE mostró CAPTCHA inicialmente."
            )

            await browser.close()

            return

        # ----------------------------------------------------
        # CONFIGURAR
        # ----------------------------------------------------

        try:

            await configurar_busqueda(
                page
            )

        except Exception as e:

            logger.error(
                f"Error configurando búsqueda: {e}"
            )

            await page.screenshot(
                path="seace_radar_error_formulario.png",
                full_page=True
            )

            await browser.close()

            return

        # ----------------------------------------------------
        # BUSCAR
        # ----------------------------------------------------

        try:

            await ejecutar_busqueda(
                page
            )

        except Exception as e:

            logger.error(
                f"Error ejecutando búsqueda: {e}"
            )

            await page.screenshot(
                path="seace_radar_error_busqueda.png",
                full_page=True
            )

            await browser.close()

            return

        # ----------------------------------------------------
        # RECORRER PÁGINAS
        # ----------------------------------------------------

        pagina = 1

        total_detectados = 0

        nomenclaturas_vistas = set()

        while pagina <= MAX_PAGINAS:

            logger.info(
                "-" * 60
            )

            logger.info(
                f"PROCESANDO PÁGINA {pagina}"
            )

            # ----------------------------------------------
            # Extraer
            # ----------------------------------------------

            registros = await extraer_filas(
                page
            )

            logger.info(
                f"Registros extraídos: "
                f"{len(registros)}"
            )

            # ----------------------------------------------
            # Filtrar duplicados
            # ----------------------------------------------

            registros_nuevos = []

            for registro in registros:

                clave = (
                    registro.get(
                        "nid_convocatoria"
                    )
                    or
                    registro.get(
                        "nomenclatura"
                    )
                )

                if not clave:
                    continue

                if clave in nomenclaturas_vistas:
                    continue

                nomenclaturas_vistas.add(
                    clave
                )

                registros_nuevos.append(
                    registro
                )

            # ----------------------------------------------
            # Guardar
            # ----------------------------------------------

            guardar_lote(
                registros_nuevos
            )

            total_detectados += len(
                registros_nuevos
            )

            # ----------------------------------------------
            # Siguiente
            # ----------------------------------------------

            if not registros:

                logger.info(
                    "No hay registros."
                )

                break

            siguiente = await siguiente_pagina(
                page
            )

            if not siguiente:

                logger.info(
                    "No existe siguiente página."
                )

                break

            pagina += 1

        # ----------------------------------------------------
        # FIN
        # ----------------------------------------------------

        logger.info("=" * 70)

        logger.info(
            f"RADAR TERMINADO"
        )

        logger.info(
            f"Total detectados: "
            f"{total_detectados}"
        )

        logger.info(
            f"Páginas procesadas: "
            f"{pagina}"
        )

        logger.info("=" * 70)

        await browser.close()


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":

    try:

        asyncio.run(
            ejecutar_radar()
        )

    except KeyboardInterrupt:

        logger.info(
            "Radar detenido manualmente."
        )

    except Exception as e:

        logger.exception(
            f"Error fatal: {e}"
        )