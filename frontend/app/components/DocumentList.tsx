'use client'
import { useState, useEffect, useCallback } from 'react'
import { FileText, Trash2, Eye, Scan, Loader2 } from 'lucide-react'
import { getDocuments, deleteDocument, DocumentInfo } from '@/lib/api'

interface DocumentListProps {
  refreshKey: number
  selectedDocumentId: string | null
  onSelectDocument: (id: string | null, name?: string) => void
}

export default function DocumentList({ refreshKey, selectedDocumentId, onSelectDocument }: DocumentListProps) {
  const [documents, setDocuments] = useState<DocumentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const docs = await getDocuments()
      setDocuments(docs)
    } catch {
      setError('Error al cargar. ¿Está el backend activo?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDocuments() }, [fetchDocuments, refreshKey])

  const handleDelete = async (doc: DocumentInfo, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`¿Eliminar "${doc.filename}"?`)) return
    setDeletingId(doc.document_id)
    try {
      await deleteDocument(doc.document_id)
      if (selectedDocumentId === doc.document_id) onSelectDocument(null)
      await fetchDocuments()
    } catch {
      alert('Error al eliminar el documento')
    } finally {
      setDeletingId(null)
    }
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })

  if (loading) return (
    <div className="flex items-center gap-2 text-sm py-4" style={{ color: '#7a9cc8' }}>
      <Loader2 size={14} className="animate-spin" /> Cargando...
    </div>
  )

  if (error) return <p className="text-xs py-2" style={{ color: '#f87171' }}>{error}</p>

  if (documents.length === 0) return (
    <p className="text-xs text-center py-6" style={{ color: '#0a0adb' }}>
      Sin documentos. Sube tu primer PDF.
    </p>
  )

  return (
    <div className="space-y-1">
      {/* Todos */}
      <button
        onClick={() => onSelectDocument(null)}
        className="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-all"
        style={{
          background: selectedDocumentId === null ? '#0a0adb' : 'transparent',
          color: selectedDocumentId === null ? 'white' : '#0a0adb',
        }}
      >
        <Eye size={14} />
        Todos los documentos
      </button>

      {documents.map(doc => (
        <div
          key={doc.document_id}
          onClick={() => onSelectDocument(doc.document_id, doc.filename)}
          className="group flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-all"
          style={{
            background: selectedDocumentId === doc.document_id ? '#0a0adb' : 'transparent',
            color: selectedDocumentId === doc.document_id ? 'white' : '#0c09a7',
          }}
        >
          <div className="flex-shrink-0 mt-0.5">
            {doc.was_ocr ? <Scan size={14} /> : <FileText size={14} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate text-xs">{doc.filename}</p>
            <p className="text-xs mt-0.5 opacity-60">
              {doc.pages} págs · {doc.chunks} fragmentos{doc.was_ocr && ' · OCR'}
            </p>
            <p className="text-xs opacity-50">{formatDate(doc.uploaded_at)}</p>
          </div>
          <button
            onClick={(e) => handleDelete(doc, e)}
            disabled={deletingId === doc.document_id}
            className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
            style={{ color: '#ff0000' }}
          >
            {deletingId === doc.document_id
              ? <Loader2 size={18} className="animate-spin" />
              : <Trash2 size={19} />}
          </button>
        </div>
      ))}
    </div>
  )
}