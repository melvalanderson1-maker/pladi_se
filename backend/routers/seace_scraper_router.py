"""
routers/seace_scraper_router.py
Proxy hacia el servicio dedicado seace-live-svc. El backend principal
YA NO ejecuta scraping en su propio proceso — solo reenvía la petición.
"""
import os
import httpx
from fastapi import APIRouter, HTTPException

SEACE_LIVE_SERVICE_URL = os.getenv("SEACE_LIVE_SERVICE_URL", "http://seace-live-svc:4100")

router = APIRouter(prefix="/api/seace/scraper", tags=["SEACE - Scraper en vivo"])


@router.post("/iniciar")
async def iniciar_scraper(anio: str = "2026", con_detalle: bool = True):
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{SEACE_LIVE_SERVICE_URL}/api/seace/scraper/iniciar",
            params={"anio": anio, "con_detalle": con_detalle},
        )
    r.raise_for_status()
    return r.json()


@router.get("/estado/{job_id}")
async def estado_scraper(job_id: str):
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{SEACE_LIVE_SERVICE_URL}/api/seace/scraper/estado/{job_id}")
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="job_id no encontrado")
    r.raise_for_status()
    return r.json()


@router.get("/progreso/{job_id}")
async def progreso_scraper(job_id: str):
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{SEACE_LIVE_SERVICE_URL}/api/seace/scraper/progreso/{job_id}")
    r.raise_for_status()
    return r.json()


@router.get("/ultimo")
async def ultimo_job():
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{SEACE_LIVE_SERVICE_URL}/api/seace/scraper/ultimo")
    r.raise_for_status()
    return r.json()