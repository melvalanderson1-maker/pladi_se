"""
seace_sync.py
Job de sincronización — trae datos de la API OCDS del SEACE y los guarda en MySQL.
Corre con: python seace_sync.py
Programado: Windows Task Scheduler (local) / Coolify Scheduled Task (prod)
"""
import os
import json
import logging
from datetime import datetime, timezone, date, timedelta

import httpx
from mysql.connector import pooling
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("seace_sync")

BASE_URL = "https://contratacionesabiertas.oece.gob.pe/api/v1"
SOURCE = "seace_v3"


dbconfig = {
    "host": os.getenv("MYSQL_HOST", "localhost"), "port": int(os.getenv("MYSQL_PORT", "3306")),
    "user": os.getenv("MYSQL_USER"),
    "password": os.getenv("MYSQL_PASSWORD"),
    "database": os.getenv("MYSQL_DATABASE"),
}
pool = pooling.MySQLConnectionPool(pool_name="seace_sync_pool", pool_size=3, **dbconfig)


def get_conn():
    return pool.get_connection()


def ensure_table():
    sql = """
    CREATE TABLE IF NOT EXISTS seace_procesos (
        ocid VARCHAR(120) NOT NULL PRIMARY KEY,
        tender_id VARCHAR(50),
        titulo VARCHAR(255),
        descripcion TEXT,
        entidad VARCHAR(255),
        entidad_ruc VARCHAR(20),
        modalidad VARCHAR(150),
        categoria VARCHAR(50),
        fecha_convocatoria DATETIME NULL,
        fecha_fin_consultas DATETIME NULL,
        monto DECIMAL(15,2) NULL,
        estado ENUM('vigente','con_resultado','vencido_sin_resultado') NOT NULL,
        tiene_indicio_desierto TINYINT(1) DEFAULT 0,
        published_date DATETIME NULL,
        raw_json LONGTEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_estado_fecha (estado, fecha_convocatoria),
        INDEX idx_modalidad (modalidad)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS seace_sync_state (
        fuente VARCHAR(20) PRIMARY KEY,
        ultima_fecha DATE NOT NULL,
        cursor_url TEXT NULL
    ) ENGINE=InnoDB;
    """
    conn = get_conn()
    cur = conn.cursor()
    for stmt in sql.split(";"):
        if stmt.strip():
            cur.execute(stmt)
    conn.commit()
    # si la tabla ya existía de antes de este fix (sin cursor_url), se agrega aquí
    try:
        cur.execute("ALTER TABLE seace_sync_state ADD COLUMN cursor_url TEXT NULL")
        conn.commit()
    except Exception:
        conn.rollback()  # la columna ya existe, no pasa nada
    cur.close()
    conn.close()


def get_ultima_fecha() -> str:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT ultima_fecha FROM seace_sync_state WHERE fuente=%s", (SOURCE,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if row:
        return row[0].isoformat()
    return "2016-01-01"


def set_ultima_fecha(fecha: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO seace_sync_state (fuente, ultima_fecha) VALUES (%s,%s) "
        "ON DUPLICATE KEY UPDATE ultima_fecha=VALUES(ultima_fecha)",
        (SOURCE, fecha),
    )
    conn.commit()
    cur.close()
    conn.close()


def get_cursor_url():
    """Recupera el link 'next' donde se quedó la última corrida (si quedó a medias)."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT cursor_url FROM seace_sync_state WHERE fuente=%s", (SOURCE,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row[0] if row and row[0] else None


def set_cursor_url(url):
    """Guarda el link 'next' después de CADA página, para retomar ahí si el proceso se corta."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO seace_sync_state (fuente, ultima_fecha, cursor_url) "
        "VALUES (%s, '2016-01-01', %s) "
        "ON DUPLICATE KEY UPDATE cursor_url=VALUES(cursor_url)",
        (SOURCE, url),
    )
    conn.commit()
    cur.close()
    conn.close()


def clasificar_proceso(release: dict) -> str:
    if release.get("awards") or release.get("contracts"):
        return "con_resultado"
    tender = release.get("tender", {})
    fecha_limite = (
        tender.get("enquiryPeriod", {}).get("endDate")
        or tender.get("tenderPeriod", {}).get("endDate")
    )
    if fecha_limite:
        fecha_fin = datetime.fromisoformat(fecha_limite)
        if fecha_fin >= datetime.now(timezone.utc).astimezone(fecha_fin.tzinfo):
            return "vigente"
    return "vencido_sin_resultado"

def upsert_proceso(conn, release: dict):
    ocid = release["ocid"]
    tender = release.get("tender", {})
    buyer = release.get("buyer", {})
    estado = clasificar_proceso(release)

    documentos = tender.get("documents", [])
    tiene_desierto = any("desierto" in (d.get("title") or "").lower() for d in documentos)

    ruc = None
    parties = release.get("parties", [])
    if parties:
        for ident in parties[0].get("additionalIdentifiers", []):
            if ident.get("scheme") == "PE-RUC":
                ruc = ident.get("id")
                break


    region = None
    departamento = None
    distrito = None
    if parties:
        address = parties[0].get("address", {}) or {}
        region = address.get("region")
        departamento = address.get("department")
        distrito = address.get("locality")


    sql = """
        INSERT INTO seace_procesos
            (ocid, tender_id, titulo, descripcion, entidad, entidad_ruc, region, departamento, distrito, modalidad,
             categoria, fecha_convocatoria, fecha_fin_consultas, monto, estado,
             tiene_indicio_desierto, published_date, raw_json, nomenclatura, origen)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'api')
        ON DUPLICATE KEY UPDATE
            titulo = IF(published_date IS NULL OR VALUES(published_date) >= published_date, VALUES(titulo), titulo),
            descripcion = IF(published_date IS NULL OR VALUES(published_date) >= published_date, VALUES(descripcion), descripcion),
            estado = IF(published_date IS NULL OR VALUES(published_date) >= published_date, VALUES(estado), estado),
            tiene_indicio_desierto = IF(published_date IS NULL OR VALUES(published_date) >= published_date, VALUES(tiene_indicio_desierto), tiene_indicio_desierto),
            fecha_fin_consultas = IF(published_date IS NULL OR VALUES(published_date) >= published_date, VALUES(fecha_fin_consultas), fecha_fin_consultas),
            published_date = IF(published_date IS NULL OR VALUES(published_date) >= published_date, VALUES(published_date), published_date),
            raw_json = IF(published_date IS NULL OR VALUES(published_date) >= published_date, VALUES(raw_json), raw_json),
            nomenclatura = IF(published_date IS NULL OR VALUES(published_date) >= published_date, VALUES(nomenclatura), nomenclatura),
            region = IF(published_date IS NULL OR VALUES(published_date) >= published_date, VALUES(region), region),
            departamento = IF(published_date IS NULL OR VALUES(published_date) >= published_date, VALUES(departamento), departamento),
            distrito = IF(published_date IS NULL OR VALUES(published_date) >= published_date, VALUES(distrito), distrito)
    """
    # titulo ahora guarda la DESCRIPCIÓN real (igual que hace el scraper),
    # y nomenclatura guarda el código SEACE (tender.title) — antes estaban
    # invertidos, por eso "Objeto" en el frontend mostraba el código en
    # vez de la descripción para los procesos que vienen de la API.
    descripcion_texto = tender.get("description")
    titulo_texto = (descripcion_texto or tender.get("title") or "")[:250] or None

    params = (
        ocid, tender.get("id"), titulo_texto, descripcion_texto,
        buyer.get("name"), ruc, region, departamento, distrito, tender.get("procurementMethodDetails"),
        tender.get("mainProcurementCategory"), tender.get("datePublished"),
        tender.get("enquiryPeriod", {}).get("endDate"),
        tender.get("value", {}).get("amount_PEN"), estado, tiene_desierto,
        release.get("publishedDate"), json.dumps(release, ensure_ascii=False),
        tender.get("title"),
    )
    cur = conn.cursor()
    # Si el scraper ya había insertado un placeholder para esta misma
    # nomenclatura, lo borramos: el registro oficial de la API lo reemplaza.
    # OJO: se compara contra nomenclatura (código SEACE), no contra tender_id
    # (que es el ID interno de OCDS, numérico) — antes comparaba mal y nunca
    # borraba nada, por eso quedaban duplicados.
    cur.execute(sql, params)
    conn.commit()  # confirma el proceso YA para que seace_items (FK) lo vea antes de insertar
    if tender.get("title"):
        cur.execute(
            "SELECT ocid, tender_id FROM seace_procesos WHERE nomenclatura = %s AND origen = 'scraper' AND ocid != %s",
            (tender.get("title"), ocid),
        )
        for old_ocid, old_tid in cur.fetchall():
            # se MUEVE la ficha/documentos/cronograma al proceso oficial, en vez de perderlos
            cur.execute("UPDATE IGNORE seace_detalle_ficha SET ocid = %s WHERE ocid = %s", (ocid, old_ocid))
            cur.execute("UPDATE IGNORE seace_documentos SET ocid = %s WHERE ocid = %s", (ocid, old_ocid))
            if old_tid and tender.get("id"):
                cur.execute("UPDATE seace_cronograma_fases SET tender_id = %s WHERE tender_id = %s",
                            (tender.get("id"), old_tid))
            cur.execute("DELETE FROM seace_procesos WHERE ocid = %s", (old_ocid,))
    cur.close()
    try:
        upsert_adjudicaciones(conn, release)
    except Exception as e:
        conn.rollback()
        logger.warning("no se pudieron guardar adjudicaciones de %s: %s", ocid, e)
    try:
        upsert_items(conn, release)
    except Exception as e:
        conn.rollback()
        logger.warning("no se pudieron guardar items de %s: %s", ocid, e)


def upsert_adjudicaciones(conn, release: dict):
    ocid = release["ocid"]
    awards = release.get("awards", [])
    if not awards:
        return
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM seace_procesos WHERE ocid = %s LIMIT 1", (ocid,))
    if cur.fetchone() is None:
        cur.close()
        return
    for award in awards:
        suppliers = award.get("suppliers", []) or []
        proveedor = suppliers[0].get("name") if suppliers else None
        proveedor_ruc = None
        for ident in (suppliers[0].get("additionalIdentifiers", []) if suppliers else []):
            if ident.get("scheme") == "PE-RUC":
                proveedor_ruc = ident.get("id")
                break
        value = award.get("value", {}) or {}
        cur.execute(
            """
            INSERT INTO seace_adjudicaciones
                (ocid, award_id, proveedor, proveedor_ruc, monto, moneda, fecha_adjudicacion, estado_award)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE
                proveedor = VALUES(proveedor),
                proveedor_ruc = VALUES(proveedor_ruc),
                monto = VALUES(monto),
                moneda = VALUES(moneda),
                fecha_adjudicacion = VALUES(fecha_adjudicacion),
                estado_award = VALUES(estado_award)
            """,
            (ocid, award.get("id"), proveedor, proveedor_ruc,
             value.get("amount"), value.get("currency"), award.get("date"), award.get("status")),
        )
    cur.close()


def upsert_items(conn, release: dict):
    ocid = release["ocid"]
    cur = conn.cursor()

    # el ocid puede no existir como fila propia si otro release con el
    # mismo tender_id ya ocupó esa fila (uq_tender_id) — en ese caso no
    # hay dónde insertar items (la FK fallaría), así que se omite.
    cur.execute("SELECT 1 FROM seace_procesos WHERE ocid = %s LIMIT 1", (ocid,))
    if cur.fetchone() is None:
        cur.close()
        return

    # borra items previos de este ocid para no duplicar en cada re-sync
    cur.execute("DELETE FROM seace_items WHERE ocid = %s", (ocid,))

    def clasificaciones(item: dict):
        cubso = None
        unspsc = None
        principal = item.get("classification") or {}
        if principal.get("scheme") == "CUBSO":
            cubso = principal.get("id")
        elif principal.get("scheme") == "UNSPSC":
            unspsc = principal.get("id")
        for extra in item.get("additionalClassifications", []) or []:
            if extra.get("scheme") == "UNSPSC" and not unspsc:
                unspsc = extra.get("id")
            elif extra.get("scheme") == "CUBSO" and not cubso:
                cubso = extra.get("id")
        return cubso, unspsc

    def guardar_items(items: list, origen_item: str, proveedor=None, proveedor_ruc=None, fecha_adj=None):
        for item in items or []:
            cantidad = item.get("quantity")
            total = (item.get("totalValue") or {}).get("amount")
            precio_unitario = None
            if cantidad and total is not None:
                try:
                    precio_unitario = float(total) / float(cantidad)
                except (ZeroDivisionError, TypeError):
                    precio_unitario = None
            cubso, unspsc = clasificaciones(item)
            cur.execute(
                """
                INSERT INTO seace_items
                    (ocid, item_id, origen_item, descripcion, cantidad, monto_total,
                     precio_unitario, unidad, clasificacion_cubso, clasificacion_unspsc,
                     proveedor, proveedor_ruc, fecha_adjudicacion)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (ocid, item.get("id"), origen_item, item.get("description"),
                 cantidad, total, precio_unitario,
                 (item.get("unit") or {}).get("name"),
                 cubso, unspsc, proveedor, proveedor_ruc, fecha_adj),
            )

    # ítems referenciales (siempre existen si el proceso tiene tender.items)
    tender = release.get("tender", {})
    guardar_items(tender.get("items", []), "tender")

    # ítems adjudicados reales (solo si hay award) — con proveedor y fecha
    for award in release.get("awards", []) or []:
        suppliers = award.get("suppliers", []) or []
        proveedor = suppliers[0].get("name") if suppliers else None
        proveedor_ruc = None
        for ident in (suppliers[0].get("additionalIdentifiers", []) if suppliers else []):
            if ident.get("scheme") == "PE-RUC":
                proveedor_ruc = ident.get("id")
                break
        guardar_items(award.get("items", []), "award", proveedor, proveedor_ruc, award.get("date"))

    cur.close()


async def sync_vigentes():
    cursor = get_cursor_url()
    if cursor:
        # había una corrida cortada a medias (laptop apagada/suspendida, etc.)
        # retomamos exactamente donde se quedó, en vez de volver a 2016-01-01
        url, params = cursor, None
        logger.info("Retomando sincronización desde el cursor guardado (corrida anterior incompleta)")
    else:
        start = get_ultima_fecha()
        end = (date.today() + timedelta(days=1)).isoformat()
        logger.info(f"Sincronizando {start} a {end}")
        url = f"{BASE_URL}/releasesAfter"
        params = {"sourceId": SOURCE, "startDate": start, "endDate": end, "size": 100}

    total = 0
    conn = get_conn()
    async with httpx.AsyncClient(timeout=30) as client:
        while url:
            r = await client.get(url, params=params)
            r.raise_for_status()
            data = r.json()

            for rel in data.get("releases", []):
                upsert_proceso(conn, rel)
                total += 1
                if total % 100 == 0:
                    logger.info(f"Progreso: {total} releases procesados en esta corrida | último ocid: {rel.get('ocid')}")

            conn.commit()

            next_url = data.get("links", {}).get("next")
            # se guarda el cursor DESPUÉS de cada página: si el proceso se corta
            # acá, la próxima corrida arranca en next_url, no en 2016-01-01
            set_cursor_url(next_url)
            url, params = (next_url, None) if next_url else (None, None)

    conn.close()
    # terminó de recorrer todas las páginas -> se limpia el cursor y se marca
    # el colchón de 3 días para la próxima corrida incremental
    set_cursor_url(None)
    set_ultima_fecha((date.today() - timedelta(days=3)).isoformat())
    logger.info(f"Sincronizados {total} releases")


if __name__ == "__main__":
    import asyncio
    ensure_table()
    asyncio.run(sync_vigentes())