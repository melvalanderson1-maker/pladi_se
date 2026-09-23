"""
embedding_service.py
Convierte texto en embeddings (vectores numéricos) y los guarda en ChromaDB.
Usa sentence-transformers que corre GRATIS en tu CPU.
"""
import os
import uuid
from datetime import datetime
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
import logging

logger = logging.getLogger(__name__)

CHROMA_DIR = os.getenv("CHROMA_DIR", "./chroma_db")
EMBEDDING_MODEL = os.getenv(
    "EMBEDDING_MODEL",
    "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
)
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "1500"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "200"))

_embeddings_model = None
_vector_store = None


def get_embeddings_model() -> HuggingFaceEmbeddings:
    global _embeddings_model
    if _embeddings_model is None:
        logger.info(f"Cargando modelo de embeddings: {EMBEDDING_MODEL}")
        logger.info("Primera vez puede tardar 1-2 minutos (descarga ~420MB)...")
        _embeddings_model = HuggingFaceEmbeddings(
            model_name=EMBEDDING_MODEL,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True}
        )
        logger.info("Modelo de embeddings listo.")
    return _embeddings_model


def get_vector_store() -> Chroma:
    global _vector_store
    if _vector_store is None:
        os.makedirs(CHROMA_DIR, exist_ok=True)
        _vector_store = Chroma(
            collection_name="documents",
            embedding_function=get_embeddings_model(),
            persist_directory=CHROMA_DIR
        )
        logger.info(f"ChromaDB conectado en: {CHROMA_DIR}")
    return _vector_store


def process_and_store_document(
    pages_data: list[dict],
    document_id: str,
    filename: str,
    was_ocr: bool
) -> int:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", ", ", " ", ""]
    )

    all_chunks = []
    all_metadatas = []
    all_ids = []

    for page_data in pages_data:
        page_num = page_data["page_num"]
        text = page_data["text"]

        if not text.strip():
            continue

        chunks = splitter.split_text(text)

        for i, chunk in enumerate(chunks):
            if len(chunk.strip()) < 20:
                continue

            all_chunks.append(chunk)
            all_ids.append(str(uuid.uuid4()))
            all_metadatas.append({
                "document_id": document_id,
                "filename": filename,
                "page": page_num,
                "chunk_index": i,
                "was_ocr": str(was_ocr),
                "uploaded_at": datetime.now().isoformat()
            })

    if not all_chunks:
        logger.warning(f"No se generaron chunks para documento {document_id}")
        return 0

    logger.info(f"Generando embeddings para {len(all_chunks)} chunks...")
    vector_store = get_vector_store()

    batch_size = 100
    for i in range(0, len(all_chunks), batch_size):
        vector_store.add_texts(
            texts=all_chunks[i:i + batch_size],
            ids=all_ids[i:i + batch_size],
            metadatas=all_metadatas[i:i + batch_size]
        )
        logger.info(f"  Guardados chunks {i+1} a {min(i+batch_size, len(all_chunks))}")

    logger.info(f"Documento {filename} procesado: {len(all_chunks)} chunks en ChromaDB")
    return len(all_chunks)


def delete_document(document_id: str) -> bool:
    try:
        vector_store = get_vector_store()
        results = vector_store.get(where={"document_id": document_id})
        if results["ids"]:
            vector_store.delete(ids=results["ids"])
            logger.info(f"Eliminados {len(results['ids'])} chunks del documento {document_id}")
            return True
        else:
            logger.warning(f"No se encontraron chunks para documento {document_id}")
            return False
    except Exception as e:
        logger.error(f"Error eliminando documento {document_id}: {e}")
        return False


def search_similar_chunks(
    query: str,
    document_id: str = None,
    top_k: int = 5
) -> list[dict]:
    vector_store = get_vector_store()

    filter_dict = None
    if document_id:
        filter_dict = {"document_id": document_id}

    results = vector_store.similarity_search_with_score(
        query=query,
        k=top_k * 2,
        filter=filter_dict
    )
    # Filtrar solo resultados con score relevante
    results = [(doc, score) for doc, score in results if score < 0.5][:top_k]
    if not results:
        # Si nada pasa el filtro, devolver los mejores de todos modos
        results = vector_store.similarity_search_with_score(
            query=query,
            k=top_k,
            filter=filter_dict
        )

    chunks = []
    for doc, score in results:
        chunks.append({
            "content": doc.page_content,
            "metadata": doc.metadata,
            "score": float(score)
        })

    return chunks