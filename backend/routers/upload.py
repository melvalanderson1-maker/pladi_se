"""
routers/upload.py - Con procesamiento asíncrono en background
"""
import os
import uuid
import json
import asyncio
import aiofiles
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse
from services.ocr_service import extract_text_from_pdf, get_pdf_page_count
from services.embedding_service import process_and_store_document, delete_document
from models.schemas import UploadResponse, DocumentListResponse, DocumentInfo
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["upload"])

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
DOCS_REGISTRY = "./documents_registry.json"

os.makedirs(UPLOAD_DIR, exist_ok=True)


def load_registry() -> dict:
    if os.path.exists(DOCS_REGISTRY):
        with open(DOCS_REGISTRY, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_registry(registry: dict):
    with open(DOCS_REGISTRY, "w", encoding="utf-8") as f:
        json.dump(registry, f, ensure_ascii=False, indent=2)


def process_pdf_background(pdf_path: str, document_id: str, safe_filename: str, original_filename: str, total_pages: int):
    """Procesa el PDF en background — OCR + embeddings."""
    try:
        logger.info(f"[BG] Iniciando OCR para {safe_filename}...")
        pages_data, was_ocr = extract_text_from_pdf(pdf_path)

        if not pages_data:
            # Marcar como error en el registro
            registry = load_registry()
            if document_id in registry:
                registry[document_id]["status"] = "error"
                registry[document_id]["error"] = "No se pudo extraer texto"
                save_registry(registry)
            return

        logger.info(f"[BG] Generando embeddings para {safe_filename}...")
        chunks_created = process_and_store_document(
            pages_data=pages_data,
            document_id=document_id,
            filename=safe_filename,
            was_ocr=was_ocr
        )

        # Actualizar registro con resultado final
        registry = load_registry()
        if document_id in registry:
            registry[document_id]["status"] = "ready"
            registry[document_id]["chunks"] = chunks_created
            registry[document_id]["was_ocr"] = was_ocr
            save_registry(registry)

        logger.info(f"[BG] ✓ {safe_filename} listo: {chunks_created} chunks")

    except Exception as e:
        logger.error(f"[BG] Error procesando {safe_filename}: {e}", exc_info=True)
        registry = load_registry()
        if document_id in registry:
            registry[document_id]["status"] = "error"
            registry[document_id]["error"] = str(e)
            save_registry(registry)


@router.post("/upload", response_model=UploadResponse)
async def upload_pdf(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Solo se aceptan archivos PDF")

    if file.size and file.size > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="El archivo no puede superar 50MB")

    document_id = str(uuid.uuid4())
    safe_filename = file.filename.replace(" ", "_").replace("/", "_")
    pdf_path = os.path.join(UPLOAD_DIR, f"{document_id}_{safe_filename}")

    try:
        # 1. Guardar archivo inmediatamente
        logger.info(f"Guardando PDF: {safe_filename}")
        async with aiofiles.open(pdf_path, "wb") as f:
            content = await file.read()
            await f.write(content)

        # 2. Contar páginas rápido
        total_pages = get_pdf_page_count(pdf_path)

        # 3. Guardar en registro con status "processing"
        registry = load_registry()
        registry[document_id] = {
            "document_id": document_id,
            "filename": safe_filename,
            "original_filename": file.filename,
            "pages": total_pages,
            "chunks": 0,
            "was_ocr": False,
            "status": "processing",
            "pdf_path": pdf_path,
            "uploaded_at": datetime.now().isoformat()
        }
        save_registry(registry)

        # 4. Procesar en background (no bloquea la respuesta)
        background_tasks.add_task(
            process_pdf_background,
            pdf_path, document_id, safe_filename, file.filename, total_pages
        )

        # 5. Responder INMEDIATAMENTE al frontend
        return UploadResponse(
            success=True,
            document_id=document_id,
            filename=safe_filename,
            pages=total_pages,
            chunks_created=0,
            was_ocr=False,
            message=f"PDF recibido ({total_pages} páginas). Procesando en segundo plano..."
        )

    except HTTPException:
        raise
    except Exception as e:
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
        logger.error(f"Error guardando PDF {safe_filename}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error guardando el PDF: {str(e)}")


@router.get("/documents", response_model=DocumentListResponse)
async def list_documents():
    registry = load_registry()
    documents = [
        DocumentInfo(
            document_id=doc["document_id"],
            filename=doc.get("original_filename", doc["filename"]),
            pages=doc["pages"],
            chunks=doc["chunks"],
            was_ocr=doc["was_ocr"],
            uploaded_at=doc["uploaded_at"]
        )
        for doc in registry.values()
    ]
    documents.sort(key=lambda x: x.uploaded_at, reverse=True)
    return DocumentListResponse(documents=documents, total=len(documents))


@router.get("/documents/{document_id}/status")
async def document_status(document_id: str):
    """Retorna el estado de procesamiento de un documento."""
    registry = load_registry()
    if document_id not in registry:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    doc = registry[document_id]
    return {
        "document_id": document_id,
        "status": doc.get("status", "ready"),
        "chunks": doc.get("chunks", 0),
        "error": doc.get("error")
    }


@router.delete("/documents/{document_id}")
async def delete_document_endpoint(document_id: str):
    registry = load_registry()
    if document_id not in registry:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    doc_info = registry[document_id]
    delete_document(document_id)
    pdf_path = doc_info.get("pdf_path", "")
    if pdf_path and os.path.exists(pdf_path):
        os.remove(pdf_path)
    del registry[document_id]
    save_registry(registry)
    return {"success": True, "message": f"Documento '{doc_info['filename']}' eliminado"}



@router.get("/documents/{document_id}/file")
async def get_document_file(document_id: str):
    """Sirve el archivo PDF para visualización en el navegador."""
    registry = load_registry()
    if document_id not in registry:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    pdf_path = registry[document_id].get("pdf_path", "")
    if not pdf_path or not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline"}
    )