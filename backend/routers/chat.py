"""
routers/chat.py
Endpoint de chat con streaming (Server-Sent Events).
El frontend recibe la respuesta token por token en tiempo real.
"""
import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from models.schemas import ChatRequest, ChatResponse
from services.rag_service import answer_question_stream, answer_question
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """
    Chat con streaming — la respuesta llega token por token.
    Usa Server-Sent Events (SSE).
    
    El frontend escucha con:
    const response = await fetch('/api/chat/stream', {...})
    const reader = response.body.getReader()
    """
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="La pregunta no puede estar vacía")
    
    async def generate():
        """Generator que produce los chunks del stream."""
        try:
            full_response = ""
            sources_data = None
            
            async for token in answer_question_stream(
                question=request.question,
                document_id=request.document_id,
                conversation_history=request.conversation_history
            ):
                # Detectar si llegaron las fuentes al final
                if "__SOURCES__" in token:
                    parts = token.split("__SOURCES__")
                    
                    # Enviar el texto antes de las fuentes
                    if parts[0]:
                        full_response += parts[0]
                        yield f"data: {json.dumps({'type': 'token', 'content': parts[0]})}\n\n"
                    
                    # Parsear y enviar las fuentes
                    sources_raw = parts[1].replace("__END_SOURCES__", "")
                    sources_data = json.loads(sources_raw)
                    
                else:
                    full_response += token
                    # Enviar cada token como evento SSE
                    yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
            
            # Al final, enviar el evento de completado con fuentes
            yield f"data: {json.dumps({'type': 'done', 'sources': sources_data or []})}\n\n"
            
        except Exception as e:
            logger.error(f"Error en chat stream: {e}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Importante para Nginx
        }
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Chat sin streaming — espera la respuesta completa.
    Más simple pero el usuario espera sin feedback.
    """
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="La pregunta no puede estar vacía")
    
    try:
        answer, sources = await answer_question(
            question=request.question,
            document_id=request.document_id,
            conversation_history=request.conversation_history
        )
        
        from models.schemas import SourceChunk
        source_chunks = [
            SourceChunk(
                document_id=s["document_id"],
                filename=s["filename"],
                page=s["page"],
                content=s["content"],
                score=s["score"]
            ) for s in sources
        ]
        
        return ChatResponse(answer=answer, sources=source_chunks)
        
    except Exception as e:
        logger.error(f"Error en chat: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error generando respuesta: {str(e)}")
