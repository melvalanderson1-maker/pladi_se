"""
main.py
Punto de entrada del backend FastAPI.
Corre con: uvicorn main:app --reload --port 8000
"""
import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Cargar variables de entorno PRIMERO (antes de cualquier import que toque DB)
load_dotenv()

import socketio
from socket_manager import sio
# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger(__name__)

# Importar routers
from routers.upload import router as upload_router
from routers.chat import router as chat_router
from routers.contratos import router as contratos_router
from routers.fill_document import router as fill_router


from routers.auth_router import router as auth_router
from routers.usuarios_router import router as usuarios_router

from routers.seace_router import router as seace_router
from routers.seace_credenciales import router as seace_credenciales_router
from routers.seace_scraper_router import router as seace_scraper_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 50)
    logger.info("Iniciando RAG Docs Backend...")
    logger.info("=" * 50)

    logger.info("Precargando modelo de embeddings...")
    from services.embedding_service import get_embeddings_model, get_vector_store
    get_embeddings_model()
    get_vector_store()
    logger.info("✓ Modelo de embeddings listo")

    if not os.getenv("OPENAI_API_KEY"):
        logger.warning("⚠️  OPENAI_API_KEY no configurada — el chat no funcionará")
    else:
        logger.info("✓ OpenAI API key encontrada")

    logger.info("✓ Servidor listo en http://localhost:8000")
    logger.info("✓ Documentación API en http://localhost:8000/docs")

    yield

    logger.info("Apagando servidor...")


app = FastAPI(
    title="RAG Docs API",
    description="Chat con tus PDFs usando IA",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registrar routers
app.include_router(upload_router)
app.include_router(chat_router)
app.include_router(contratos_router)
app.include_router(fill_router)


app.include_router(auth_router)
app.include_router(usuarios_router)

app.include_router(seace_router)
app.include_router(seace_credenciales_router)
app.include_router(seace_scraper_router)

@app.get("/")
async def root():
    return {
        "message": "RAG Docs API funcionando",
        "docs": "http://localhost:8000/docs",
        "endpoints": {
            "POST /api/upload"                        : "Subir un PDF",
            "GET /api/documents"                      : "Listar documentos",
            "DELETE /api/documents/{id}"              : "Eliminar documento",
            "POST /api/chat/stream"                   : "Chat con streaming",
            "POST /api/chat"                          : "Chat sin streaming",
            "GET /api/contratos"                      : "Lista de contratos SEACE",
            "GET /api/contratos/stats"                : "KPIs del dashboard",
            "GET /api/contratos/{id}"                 : "Detalle de un contrato",
            "GET /api/contratos/{id}/archivos"        : "Archivos del contrato",
            "GET /api/contratos/{id}/items"           : "Items del contrato",
            "GET /api/contratos/{id}/cotizacion"      : "Datos de cotización",
            "GET /api/contratos/{id}/etapas"          : "Etapas del proceso",
            "GET /api/contratos/{id}/archivos/{id_archivo}/preview": "Preview de archivo como PDF",
        }
    }


@app.get("/health")
async def health():
    return {"status": "ok", "service": "rag-docs-backend"}


# DESPUÉS:
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:socket_app", host="0.0.0.0", port=8000, reload=True)