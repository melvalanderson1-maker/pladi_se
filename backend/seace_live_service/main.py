"""
seace_live_service/main.py
Servicio dedicado a "Actualizar en vivo" de SEACE. Corre aislado del
backend principal — si Playwright se cae o consume mucha RAM, no afecta
al chat/auth/RAG.
Corre con: uvicorn main:app --host 0.0.0.0 --port 4100
"""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from seace_scraper_router import router as seace_scraper_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")

app = FastAPI(title="SEACE Live Scraper Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(seace_scraper_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "seace-live-service"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=4100, reload=False)