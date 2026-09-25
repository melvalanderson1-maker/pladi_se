"""
seace_live_service/seace_scraper_router.py
Endpoints para "Actualizar en vivo". Vive en su propio servicio, separado
del backend principal, para que Playwright nunca comparta proceso con la API de chat.
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

JOB_TIMEOUT_HORAS = 2  # si un job lleva más de esto "corriendo", se considera muerto


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
        # cierra automáticamente cualquier job zombie (contenedor reiniciado a
        # mitad de un scraping) antes de decidir si hay uno legítimo corriendo
        cur.execute(
            """UPDATE seace_scraper_jobs
               SET estado = 'error',
                   mensaje = 'Cerrado automáticamente: superó el timeout sin actualizar',
                   finalizado_en = NOW()
               WHERE estado IN ('en_cola','corriendo')
                 AND iniciado_en < NOW() - INTERVAL %s HOUR""",
            (JOB_TIMEOUT_HORAS,),
        )
        con.commit()

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