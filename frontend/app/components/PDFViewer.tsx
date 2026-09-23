'use client'
import { useEffect, useState } from 'react'
import {
  X, FileText, ChevronLeft, ChevronRight,
  ExternalLink, Maximize2, Minimize2, Download, Printer,
} from 'lucide-react'
import Image from 'next/image'

interface PDFViewerProps {
  documentId: string
  filename: string
  page: number
  onClose: () => void
}

export default function PDFViewer({ documentId, filename, page, onClose }: PDFViewerProps) {
  const [currentPage, setCurrentPage] = useState(page)
  const [isVisible, setIsVisible] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  const pdfUrl = `${process.env.NEXT_PUBLIC_API_URL}/api/contratos/by-rag-id/${documentId}/file#page=${currentPage}&toolbar=0&navpanes=0&scrollbar=0&view=FitH`

  useEffect(() => { requestAnimationFrame(() => setIsVisible(true)) }, [])

  useEffect(() => { setCurrentPage(page) }, [page])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
      if (e.key === 'ArrowRight') setCurrentPage(p => p + 1)
      if (e.key === 'ArrowLeft') setCurrentPage(p => Math.max(1, p - 1))
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const handleClose = () => {
    setIsVisible(false)
    setTimeout(onClose, 280)
  }

  const panelWidth = isExpanded ? '1000px' : '720px'

  return (
    <div
      className="fixed top-0 right-0 h-full z-40 flex flex-col transition-all duration-300 ease-out"
      style={{
        width: panelWidth,
        background: 'white',
        boxShadow: '-4px 0 32px rgba(0,0,0,0.18)',
        transform: isVisible ? 'translateX(0)' : 'translateX(100%)',
        opacity: isVisible ? 1 : 0,
      }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 py-3"
        style={{ background: '#0a0adb', borderBottom: '1px solid #1a3570' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Image
            src="/ecolimp-logo.jpg"
            alt="Ecolimp"
            width={28}
            height={28}
            className="rounded object-contain"
            style={{ background: 'white', padding: '2px' }}
          />

        </div>

        <div className="w-px h-4 mx-1" style={{ background: '#1a3570' }} />

        {/* Filename */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <FileText size={13} style={{ color: '#ffffff', flexShrink: 0 }} />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate leading-tight text-white" title={filename}>
              {filename}
            </p>
            <p className="text-xs" style={{ color: '#ffffff' }}>Página {currentPage}</p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            title="Anterior (←)"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30"
            style={{ color: '#ffffff' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#ffffff')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <ChevronLeft size={15} />
          </button>

          <input
            type="number"
            min={1}
            value={currentPage}
            onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setCurrentPage(v) }}
            className="w-10 text-center text-xs rounded px-1 py-0.5 focus:outline-none"
            style={{ background: '#ffffff', color: 'blue', border: '1px solid #0a0adb' }}
          />

          <button
            onClick={() => setCurrentPage(p => p + 1)}
            title="Siguiente (→)"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: '#ffffff' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#0a0adb')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <ChevronRight size={15} />
          </button>

          <div className="w-px h-4 mx-1" style={{ background: '#0a0adb' }} />

          <button
            onClick={() => setIsExpanded(e => !e)}
            title={isExpanded ? 'Reducir' : 'Ampliar'}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: '#ffffff' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#0a0adb')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>

          <button
            onClick={() => window.open(`${process.env.NEXT_PUBLIC_API_URL}/api/contratos/by-rag-id/${documentId}/file#page=${currentPage}`, '_blank')}
            title="Abrir en pestaña nueva"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: '#ffffff' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#0a0adb')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <ExternalLink size={14} />
          </button>

          <button
            onClick={() => { const a = document.createElement('a'); a.href = `${process.env.NEXT_PUBLIC_API_URL}/api/contratos/by-rag-id/${documentId}/file`; a.download = filename; a.click() }}
            title="Descargar"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: '#ffffff' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#0a0adb')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Download size={14} />
          </button>

          <button
            onClick={() => { const iframe = document.querySelector(`iframe[title="${filename}"]`) as HTMLIFrameElement; iframe?.contentWindow?.print() }}
            title="Imprimir"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: '#ffffff' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#0a0adb')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Printer size={14} />
          </button>

          <div className="w-px h-4 mx-1" style={{ background: '#0a0adb' }} />

          <button
            onClick={handleClose}
            title="Cerrar (Esc)"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors ml-1"
            style={{ color: '#ffffff' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#ff0000'; e.currentTarget.style.color = '#ffffff' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#ffffff' }}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* PDF */}
      <div className="flex-1 overflow-hidden" style={{ background: '#ffffff' }}>
        <iframe
          key={`${documentId}-${currentPage}`}
          src={pdfUrl}
          className="w-full h-full"
          title={filename}
          style={{ border: 'none' }}
        />
      </div>
    </div>
  )
}