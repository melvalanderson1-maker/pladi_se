"""
rag_service_groq.py - Versión con Groq (GRATIS)
Modelos disponibles: llama-3.1-8b-instant, mixtral-8x7b-32768, gemma2-9b-it
"""
import os
import json
from groq import AsyncGroq
from services.embedding_service import search_similar_chunks
import logging

logger = logging.getLogger(__name__)

LLM_MODEL = os.getenv("LLM_MODEL", "llama-3.3-70b-versatile")
TOP_K_CHUNKS = int(os.getenv("TOP_K_CHUNKS", "8"))


_groq_client = None


def get_client() -> AsyncGroq:
    global _groq_client
    if _groq_client is None:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY no está configurada en el .env")
        _groq_client = AsyncGroq(api_key=api_key)
    return _groq_client


def build_system_prompt() -> str:
    return """Eres un asistente experto en análisis de documentos de contratación pública peruana (SEACE, Perú Compras).
Tu tarea es responder preguntas basándote en el contenido de los documentos proporcionados como contexto.

Reglas estrictas:
1. Responde siempre en español.
2. Usa TODA la información relevante del contexto, aunque la pregunta use palabras distintas al documento.
   Ejemplo: "requisitos del proveedor" = "requisitos mínimos" = "perfil del proveedor" = "habilitación del postor".
3. Si la pregunta es sobre requisitos, busca en el contexto: habilitación, perfil, condiciones, capacidad, experiencia, documentos a presentar.
4. Si la pregunta es sobre plazos, busca: fechas, cronograma, días calendario, días hábiles, vigencia.
5. Si la pregunta es sobre precio o monto, busca: valor referencial, precio unitario, valor total, UIT, presupuesto.
6. Si encuentras información parcialmente relacionada, ÚSALA y aclara que es lo más cercano encontrado.
7. Solo di "No encontré esa información en los documentos cargados." si realmente no hay NADA relacionado en ningún fragmento.
8. Cita la página cuando sea relevante: "(Ver página X)".
9. Si encuentras fechas, plazos o montos, resáltalos claramente con negritas.
10. Sé completo — incluye todos los puntos relevantes encontrados en los fragmentos, no solo el primero."""


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
            role = msg.role if hasattr(msg, 'role') else msg.get("role")
            content = msg.content if hasattr(msg, 'content') else msg.get("content")
            if role in ("user", "assistant"):
                messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": f"Contexto de los documentos:\n{context}\n\nPregunta del usuario: {question}\n\nInstrucción: Analiza TODOS los fragmentos del contexto y responde de forma completa. Si la pregunta usa términos distintos al documento, busca el concepto equivalente."})

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
        logger.error(f"Error llamando a Groq: {e}")
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
            role = msg.role if hasattr(msg, 'role') else msg.get("role")
            content = msg.content if hasattr(msg, 'content') else msg.get("content")
            if role in ("user", "assistant"):
                messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": f"Contexto:\n{context}\n\nPregunta: {question}"})

    client = get_client()
    response = await client.chat.completions.create(
        model=LLM_MODEL,
        messages=messages,
        temperature=0.1,
        max_tokens=2000
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