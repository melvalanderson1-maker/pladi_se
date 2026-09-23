"""
reclasificar_estados.py
Recorre seace_procesos, re-evalúa el campo `estado` de cada fila usando la
lógica corregida de clasificar_proceso() (con fallback a tenderPeriod),
y actualiza solo las filas cuyo estado cambió. No golpea la API del SEACE:
usa el raw_json ya guardado.
Corre con: python reclasificar_estados.py
"""
import os
import json
import logging
from datetime import datetime, timezone

from mysql.connector import pooling
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("reclasificar_estados")

dbconfig = {
    "host": os.getenv("MYSQL_HOST", "localhost"), "port": int(os.getenv("MYSQL_PORT", "3306")),
    "user": os.getenv("MYSQL_USER"),
    "password": os.getenv("MYSQL_PASSWORD"),
    "database": os.getenv("MYSQL_DATABASE"),
}
pool = pooling.MySQLConnectionPool(pool_name="reclasificar_pool", pool_size=2, **dbconfig)


def get_conn():
    return pool.get_connection()


def clasificar_proceso(release: dict) -> str:
    """Misma lógica corregida que en seace_sync.py — con fallback a tenderPeriod."""
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


def reclasificar():
    conn = get_conn()
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT ocid, estado, raw_json FROM seace_procesos")
    filas = cur.fetchall()
    cur.close()

    logger.info(f"Revisando {len(filas)} registros...")

    cambios = 0
    update_cur = conn.cursor()
    for fila in filas:
        try:
            release = json.loads(fila["raw_json"])
        except (TypeError, json.JSONDecodeError):
            logger.warning(f"raw_json inválido para ocid={fila['ocid']}, se omite")
            continue

        nuevo_estado = clasificar_proceso(release)
        if nuevo_estado != fila["estado"]:
            update_cur.execute(
                "UPDATE seace_procesos SET estado = %s WHERE ocid = %s",
                (nuevo_estado, fila["ocid"]),
            )
            cambios += 1
            logger.info(f"{fila['ocid']}: {fila['estado']} → {nuevo_estado}")

    conn.commit()
    update_cur.close()
    conn.close()
    logger.info(f"Listo. {cambios} registros reclasificados de {len(filas)} revisados.")


if __name__ == "__main__":
    reclasificar()