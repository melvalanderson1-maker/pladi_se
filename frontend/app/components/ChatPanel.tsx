'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, FileText, ChevronDown, ChevronUp, Trash2, Bot, User, FileSearch } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useChat } from '@/hooks/useChat'
import { SourceChunk } from '@/lib/api'
import PDFViewer from './PDFViewer'
import Image from 'next/image'

interface ChatPanelProps {
  documentId: string | null
  documentName?: string
  chunksCount?: number
  onPdfViewerChange?: (open: boolean) => void
}

function SourcesList({ sources, onSourceClick }: { sources: SourceChunk[]; onSourceClick: (src: SourceChunk) => void }) {
  const [open, setOpen] = useState(false)
  if (!sources || sources.length === 0) return null

  return (
    <div className="mt-2 rounded-xl overflow-hidden" style={{ border: '1px solid #e2e8f0' }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors"
        style={{ background: '#f8fafc', color: '#64748b' }}
      >
        <FileSearch size={12} style={{ color: '#0a0adb' }} />
        <span className="font-semibold" style={{ color: '#0a0adb' }}>
          {sources.length} fuente{sources.length > 1 ? 's' : ''} consultada{sources.length > 1 ? 's' : ''}
        </span>
        {open ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
      </button>

      {open && (
        <div style={{ borderTop: '1px solid #e2e8f0' }}>
          {sources.map((src, i) => (
            <button
              key={i}
              onClick={() => onSourceClick(src)}
              className="w-full text-left px-3 py-2.5 text-xs transition-colors"
              style={{ borderBottom: i < sources.length - 1 ? '1px solid #f1f5f9' : 'none', background: 'white' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f0f6ff')}
              onMouseLeave={e => (e.currentTarget.style.background = 'white')}
            >
              <p className="font-semibold flex items-center gap-1" style={{ color: '#0d1f4e' }}>
                <FileText size={11} style={{ color: '#0a0adb' }} />
                {src.filename} — pág. {src.page}
              </p>
              <p className="mt-1 line-clamp-2" style={{ color: '#64748b' }}>{src.content}</p>
              <p className="mt-1 font-semibold" style={{ color: '#0a0adb' }}>Ver en documento →</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MessageBubble({
  message, onSourceClick,
}: {
  message: { role: string; content: string; sources?: SourceChunk[] }
  onSourceClick: (src: SourceChunk) => void
}) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-3 w-full ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-1"
        style={{ background: isUser ? '#0a0adb' : '#f0f4f8', border: isUser ? 'none' : '1px solid #e2e8f0' }}
      >
        {isUser
          ? <User size={14} color="white" />
          : <Bot size={14} color="#0a0adb" />}
      </div>

      <div className={`max-w-[82%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className="px-4 py-3 rounded-2xl text-sm leading-relaxed"
          style={isUser
            ? { background: '#0a0adb', color: 'white', borderTopRightRadius: '4px' }
            : { background: 'white', color: '#1e293b', borderTopLeftRadius: '4px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
          }
        >
          {isUser ? (
            <p>{message.content}</p>
          ) : (
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold" style={{ color: '#0d1f4e' }}>{children}</strong>,
                ul: ({ children }) => <ul className="list-disc ml-4 mb-2 space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal ml-4 mb-2 space-y-1">{children}</ol>,
                li: ({ children }) => <li>{children}</li>,
                code: ({ children }) => <code className="px-1 rounded text-xs font-mono" style={{ background: '#f1f5f9', color: '#0a0adb' }}>{children}</code>,
              }}
            >
              {message.content || 'Loading...'}
            </ReactMarkdown>
          )}
        </div>

        {!isUser && message.sources && (
          <div className="w-full mt-1">
            <SourcesList sources={message.sources} onSourceClick={onSourceClick} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function ChatPanel({ documentId, documentName, chunksCount, onPdfViewerChange }: ChatPanelProps) {
  const { messages, isLoading, error, sendMessage, clearMessages } = useChat(documentId)
  const [input, setInput] = useState('')
  const [viewerSource, setViewerSource] = useState<SourceChunk | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSourceClick = useCallback((src: SourceChunk) => {
    setViewerSource(src)
    onPdfViewerChange?.(true)
  }, [onPdfViewerChange])

  const handleViewerClose = useCallback(() => {
    setViewerSource(null)
    onPdfViewerChange?.(false)
  }, [onPdfViewerChange])

  const handleSend = async () => {
    const q = input.trim()
    if (!q || isLoading) return
    setInput('')
    await sendMessage(q)
    inputRef.current?.focus()
  }

  const exampleQuestions = [
    '¿Cuáles son los plazos importantes?',
    '¿Cuál es el valor total del contrato?',
    '¿Cuáles son los requisitos de participación?',
    '¿Qué documentos debo presentar?',
  ]

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-5 py-3"
        style={{ background: 'white', borderBottom: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(149, 29, 29, 0.04)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: '#f0f6ff' }}
          >
            <FileSearch size={16} style={{ color: '#0a0adb' }} />
          </div>
          <div>
            <p className="font-semibold text-sm" style={{ color: '#0d1f4e' }}>
              {documentName ? documentName : 'Todos los documentos'}
            </p>
            <p className="text-xs" style={{ color: '#94a3b8' }}>
              {documentId ? 'Buscando en este documento' : 'Buscando en todos los documentos'}
              {chunksCount ? ` · ${chunksCount} fragmentos indexados` : ''}
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearMessages}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: '#94a3b8', border: '1px solid #e2e8f0' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
            onMouseLeave={e => (e.currentTarget.style.color = '#94a3b8')}
          >
            <Trash2 size={12} /> Limpiar
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ background: '#f0f4f8' }}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: 'white', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(26,79,186,0.08)' }}
            >
              <Image src="/ecolimp-logo.jpg" alt="Ecolimp" width={40} height={40} className="rounded-xl object-contain" />
            </div>
            <p className="font-semibold mb-1" style={{ color: '#0d1f4e' }}>¿Qué deseas consultar?</p>
            <p className="text-xs mb-6" style={{ color: '#94a3b8' }}>Haz preguntas sobre los documentos cargados</p>
            <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
              {exampleQuestions.map(q => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="text-left text-xs px-4 py-2.5 rounded-xl transition-all"
                  style={{ background: 'white', border: '1px solid #e2e8f0', color: '#475569' }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = '#1a4fba'
                    e.currentTarget.style.color = '#1a4fba'
                    e.currentTarget.style.background = '#f0f6ff'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = '#e2e8f0'
                    e.currentTarget.style.color = '#475569'
                    e.currentTarget.style.background = 'white'
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} onSourceClick={handleSourceClick} />
          ))
        )}

        {isLoading && messages[messages.length - 1]?.content === '' && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: '#f0f4f8', border: '1px solid #e2e8f0' }}>
              <Bot size={14} color="#0a0adb" />
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-tl-sm" style={{ background: 'white', border: '1px solid #e2e8f0' }}>
              <div className="flex gap-1 items-center">
                {[0, 150, 300].map(delay => (
                  <div key={delay} className="w-2 h-2 rounded-full animate-bounce" style={{ background: '#0a0adb', animationDelay: `${delay}ms`, opacity: 0.5 }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 text-xs" style={{ background: '#fef2f2', borderTop: '1px solid #fecaca', color: '#dc2626' }}>
          ⚠️ {error}
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 px-4 py-3" style={{ background: 'white', borderTop: '1px solid #e2e8f0' }}>
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="Escribe tu pregunta..."
            rows={1}
            disabled={isLoading}
            className="flex-1 resize-none text-sm px-4 py-2.5 rounded-xl focus:outline-none disabled:opacity-50"
            style={{
              border: '1.5px solid #e2e8f0',
              minHeight: '42px',
              maxHeight: '120px',
              background: '#f8fafc',
              color: '#1e293b',
            }}
            onFocus={e => (e.target.style.borderColor = '#0a0adb')}
            onBlur={e => (e.target.style.borderColor = '#e2e8f0')}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all"
            style={{ background: input.trim() && !isLoading ? '#0a0adb' : '#e2e8f0' }}
          >
            {isLoading
              ? <Loader2 size={16} color="white" className="animate-spin" />
              : <Send size={16} color={input.trim() ? 'white' : '#94a3b8'} />}
          </button>
        </div>
        <p className="text-xs text-center mt-1.5" style={{ color: '#cbd5e1' }}>
          Shift+Enter nueva línea · Enter enviar
        </p>
      </div>

      {/* PDF Viewer */}
      {viewerSource && (
        <PDFViewer
          documentId={viewerSource.document_id}
          filename={viewerSource.filename}
          page={viewerSource.page}
          onClose={handleViewerClose}
        />
      )}
    </div>
  )
}