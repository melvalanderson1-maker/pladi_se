"""
seace_scraper_router.py

Endpoints para el botón "Actualizar en vivo" de Cotizar en SEACE:
  - POST /api/seace/scraper/iniciar   -> lanza seace_scrape_live.py en un
                                          thread aparte y devuelve un job_id.
  - GET  /api/seace/scraper/estado/{job_id} -> progreso de ese job.
  - GET  /api/seace/scraper/ultimo    -> último job (para reconectar el
                                          loader si el usuario recarga la página).

El scraping usa Playwright en modo sync, así que se corre en un
threading.Thread normal (NO en un asyncio task) para no bloquear el
event loop de FastAPI ni pelear con su loop.
"""

import threading

from fastapi import APIRouter, HTTPException
from mysql.connector import connect

from seace_scrape_live import (
    ejecutar_scraping_live,
    crear_job,
    dbconfig,
    MODALIDADES_MAYORES,
)

router = APIRouter(prefix="/api/seace/scraper", tags=["SEACE - Scraper en vivo"])


def _obtener_job(job_id: str):
    con = connect(**dbconfig)
    try:
        cur = con.cursor(dictionary=True)
        cur.execute("SELECT * FROM seace_scraper_jobs WHERE job_id = %s", (job_id,))
        row = cur.fetchone()
        cur.close()
        return row
    finally:
        con.close()


def _hay_job_corriendo():
    con = connect(**dbconfig)
    try:
        cur = con.cursor(dictionary=True)
        cur.execute(
            """SELECT * FROM seace_scraper_jobs
               WHERE estado IN ('en_cola','corriendo')
               ORDER BY iniciado_en DESC LIMIT 1"""
        )
        row = cur.fetchone()
        cur.close()
        return row
    finally:
        con.close()


@router.post("/iniciar")
async def iniciar_scraper(anio: str = "2026", con_detalle: bool = True):
    """Lanza el scraping en vivo. Si ya hay uno corriendo, devuelve
    ESE job_id en lugar de lanzar dos scrapers en simultáneo (el SEACE
    no tiene dos pestañas de resultados independientes por sesión)."""
    job_en_curso = _hay_job_corriendo()
    if job_en_curso:
        return {"job_id": job_en_curso["job_id"], "ya_estaba_corriendo": True}

    job_id = crear_job(anio, len(MODALIDADES_MAYORES))

    hilo = threading.Thread(
        target=ejecutar_scraping_live,
        kwargs={"anio": anio, "job_id": job_id, "headless": True, "con_detalle": con_detalle},
        daemon=True,
    )
    hilo.start()

    return {"job_id": job_id, "ya_estaba_corriendo": False}


@router.get("/estado/{job_id}")
async def estado_scraper(job_id: str):
    row = _obtener_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="job_id no encontrado")
    return row


@router.get("/progreso/{job_id}")
async def progreso_scraper(job_id: str):
    con = connect(**dbconfig)
    try:
        cur = con.cursor(dictionary=True)
        cur.execute(
            """SELECT modalidad, pagina_actual, paginas_totales, filas_procesadas,
                      filas_totales, estado, actualizado_en
               FROM seace_scraper_progreso WHERE job_id = %s ORDER BY modalidad""",
            (job_id,),
        )
        filas = cur.fetchall()
        cur.close()
        return {"modalidades": filas}
    finally:
        con.close()


@router.get("/ultimo")
async def ultimo_job():
    con = connect(**dbconfig)
    try:
        cur = con.cursor(dictionary=True)
        cur.execute("SELECT * FROM seace_scraper_jobs ORDER BY iniciado_en DESC LIMIT 1")
        row = cur.fetchone()
        cur.close()
        return row or {}
    finally:
        con.close()


