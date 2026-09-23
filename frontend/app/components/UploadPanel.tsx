'use client'
import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, FileText, Loader2, CheckCircle, AlertCircle, X } from 'lucide-react'
import { uploadPDF, UploadResponse } from '@/lib/api'

interface UploadPanelProps {
  onUploadSuccess: () => void
}

interface UploadState {
  file: File
  status: 'uploading' | 'success' | 'error'
  message: string
  result?: UploadResponse
}

export default function UploadPanel({ onUploadSuccess }: UploadPanelProps) {
  const [uploads, setUploads] = useState<UploadState[]>([])

    const processFile = useCallback(
    async (file: File) => {
        const entry: UploadState = {
        file,
        status: 'uploading',
        message: 'Subiendo PDF...',
        }
        setUploads(prev => {
        const newUploads = [...prev, entry]
        const index = newUploads.length - 1

        uploadPDF(file)
            .then(result => {
            setUploads(p =>
                p.map((u, i) =>
                i === index ? {
                    ...u,
                    status: 'success',
                    message: result.message,
                    result
                } : u
                )
            )
            onUploadSuccess()

            // Polling cada 5 segundos para ver cuando termina el procesamiento
            const interval = setInterval(async () => {
                try {
                const res = await fetch(`/api/documents/${result.document_id}/status`)
                const data = await res.json()
                if (data.status === 'ready' && data.chunks > 0) {
                    setUploads(p =>
                    p.map((u, i) =>
                        i === index ? {
                        ...u,
                        message: `✅ Listo. ${data.chunks} fragmentos indexados.`,
                        result: { ...result, chunks_created: data.chunks }
                        } : u
                    )
                    )
                    onUploadSuccess()
                    clearInterval(interval)
                } else if (data.status === 'error') {
                    setUploads(p =>
                    p.map((u, i) =>
                        i === index ? {
                        ...u,
                        status: 'error',
                        message: `Error: ${data.error}`
                        } : u
                    )
                    )
                    clearInterval(interval)
                }
                } catch {
                clearInterval(interval)
                }
            }, 5000)
            })
            .catch(err => {
            const msg = err instanceof Error ? err.message : 'Error desconocido'
            setUploads(p =>
                p.map((u, i) =>
                i === index ? { ...u, status: 'error', message: msg } : u
                )
            )
            })

        return newUploads
        })
    },
    [onUploadSuccess]
    )
    const onDrop = useCallback(
    (acceptedFiles: File[]) => {
        // Evitar duplicados: filtrar archivos ya en proceso con mismo nombre y tamaño
        const newFiles = acceptedFiles.filter(file => 
        !uploads.some(u => u.file.name === file.name && u.file.size === file.size)
        )
        newFiles.forEach(processFile)
    },
    [processFile, uploads]
    )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
  })

  return (
    <div className="space-y-3">
      {/* Zona de drop */}
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors
          ${isDragActive
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
          }
        `}
      >
        <input {...getInputProps()} />
        <Upload size={28} className="mx-auto text-gray-400 mb-2" />
        <p className="text-sm font-medium text-gray-700">
          {isDragActive ? 'Suelta el PDF aquí...' : 'Arrastra PDFs o haz clic'}
        </p>
        <p className="text-xs text-gray-400 mt-1">Escaneados y digitales • Máx 50MB</p>
      </div>

      {/* Lista de uploads */}
      {uploads.map((upload, index) => (
        <div
          key={index}
          className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 bg-white"
        >
          <div className="flex-shrink-0 mt-0.5">
            {upload.status === 'uploading' && (
              <Loader2 size={16} className="animate-spin text-blue-500" />
            )}
            {upload.status === 'success' && (
              <CheckCircle size={16} className="text-green-500" />
            )}
            {upload.status === 'error' && (
              <AlertCircle size={16} className="text-red-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 flex items-center gap-1 truncate">
              <FileText size={12} />
              {upload.file.name}
            </p>
            <p
              className={`text-xs mt-0.5 ${
                upload.status === 'error' ? 'text-red-500' : 'text-gray-500'
              }`}
            >
              {upload.message}
            </p>
            {upload.result && (
              <p className="text-xs text-gray-400 mt-0.5">
                {upload.result.pages} páginas • {upload.result.chunks_created} fragmentos
                {upload.result.was_ocr && ' • OCR aplicado'}
              </p>
            )}
          </div>
          {upload.status !== 'uploading' && (
            <button
              onClick={() => setUploads(prev => prev.filter((_, i) => i !== index))}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}