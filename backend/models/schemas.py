from pydantic import BaseModel
from typing import Optional, List


class UploadResponse(BaseModel):
    success: bool
    document_id: str
    filename: str
    pages: int
    chunks_created: int
    was_ocr: bool
    message: str


class DocumentInfo(BaseModel):
    document_id: str
    filename: str
    pages: int
    chunks: int
    was_ocr: bool
    uploaded_at: str


class DocumentListResponse(BaseModel):
    documents: List[DocumentInfo]
    total: int


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    question: str
    document_id: Optional[str] = None
    conversation_history: Optional[List[ChatMessage]] = []


class SourceChunk(BaseModel):
    document_id: str
    filename: str
    page: int
    content: str
    score: float


class ChatResponse(BaseModel):
    answer: str
    sources: List[SourceChunk] = []