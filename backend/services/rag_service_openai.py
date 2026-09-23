"""
rag_service_openai.py - Versión con OpenAI GPT-4o-mini
"""
import os
import json
from openai import AsyncOpenAI
from services.embedding_service import search_similar_chunks
import logging

logger = logging.getLogger(__name__)

LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
TOP_K_CHUNKS = int(os.getenv("TOP_K_CHUNKS", "5"))

_openai_client = None


def get_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY no está configurada en el .env")
        _openai_client = AsyncOpenAI(api_key=api_key)
    return _openai_client


def build_system_prompt() -> str:
    return """Eres un asistente experto en análisis de documentos.
Tu tarea es responder preguntas basándote EXCLUSIVAMENTE en el contenido de los documentos proporcionados como contexto.

Reglas:
1. Responde siempre en español.
2. Solo usa información del contexto proporcionado. No inventes datos.
3. Si la información no está en el contexto, di exactamente: "No encontré esa información en los documentos cargados."
4. Cita la página cuando sea relevante: "(Ver página X)".
5. Si encuentras fechas, plazos o montos, resáltalos claramente.
6. Sé directo y preciso. Para licitaciones/contratos, prioriza plazos, requisitos y montos."""


def build_context_from_chunks(chunks: list[dict]) -> str:
    if not chunks:
        return "No se encontraron fragmentos relevantes en los documentos."
    context_parts = []
    for i, chunk in enumerate(chunks, 1):
        meta = chunk["metadata"]
        context_parts.append(
            f"--- Fragmento {i} | Archivo: {meta.get('filename','?')} | Página: {meta.get('page','?')} ---\n{chunk['content']}"
        )
    return "\n\n".join(context_parts)


async def answer_question_stream(
    question: str,
    document_id: str = None,
    conversation_history: list[dict] = None
):
    chunks = search_similar_chunks(query=question, document_id=document_id, top_k=TOP_K_CHUNKS)
    context = build_context_from_chunks(chunks)

    messages = [{"role": "system", "content": build_system_prompt()}]

    if conversation_history:
        for msg in conversation_history[-20:]:
            if msg.get("role") in ("user", "assistant"):
                messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": f"Contexto:\n{context}\n\nPregunta: {question}"})

    client = get_client()
    try:
        stream = await client.chat.completions.create(
            model=LLM_MODEL,
            messages=messages,
            stream=True,
            temperature=0.1,
            max_tokens=2000
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content
    except Exception as e:
        logger.error(f"Error llamando a OpenAI: {e}")
        yield f"Error al conectar con el LLM: {str(e)}"

    sources_info = [{
        "document_id": c["metadata"].get("document_id", ""),
        "filename": c["metadata"].get("filename", ""),
        "page": c["metadata"].get("page", 0),
        "content": c["content"][:200] + "...",
        "score": c["score"]
    } for c in chunks]

    yield f"\n\n__SOURCES__{json.dumps(sources_info)}__END_SOURCES__"


async def answer_question(
    question: str,
    document_id: str = None,
    conversation_history: list[dict] = None
) -> tuple[str, list[dict]]:
    chunks = search_similar_chunks(query=question, document_id=document_id, top_k=TOP_K_CHUNKS)
    context = build_context_from_chunks(chunks)

    messages = [{"role": "system", "content": build_system_prompt()}]
    if conversation_history:
        for msg in conversation_history[-20:]:
            if msg.get("role") in ("user", "assistant"):
                messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": f"Contexto:\n{context}\n\nPregunta: {question}"})

    client = get_client()
    response = await client.chat.completions.create(
        model=LLM_MODEL, messages=messages, temperature=0.1, max_tokens=2000
    )
    answer = response.choices[0].message.content
    sources = [{
        "document_id": c["metadata"].get("document_id", ""),
        "filename": c["metadata"].get("filename", ""),
        "page": c["metadata"].get("page", 0),
        "content": c["content"][:200] + "...",
        "score": c["score"]
    } for c in chunks]
    return answer, sources