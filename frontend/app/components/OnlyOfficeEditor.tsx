'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, X, Wand2 } from 'lucide-react'

interface OnlyOfficeEditorProps {
  idContrato : number
  idArchivo  : number
  nombre     : string
  idCotizacion?: number | null
  onClose    : () => void
  onRellenarIA?: () => Promise<void>
}

declare global {
  interface Window { DocsAPI: any }
}

export default function OnlyOfficeEditor({
  idContrato, idArchivo, nombre, idCotizacion, onClose, onRellenarIA
}: OnlyOfficeEditorProps) {
  const editorRef   = useRef<any>(null)
  const initialized = useRef(false)
  const [loading, setLoading] = useState(true)
  const [loadingMsg, setLoadingMsg] = useState('Cargando editor...')
  const [error, setError]   = useState<string | null>(null)
  const [rellenando, setRellenando] = useState(false)

  const ONLYOFFICE_URL = process.env.NEXT_PUBLIC_ONLYOFFICE_URL || 'http://localhost:8080'
  const API_URL        = process.env.NEXT_PUBLIC_API_URL        || 'http://localhost:8000'

  const esPDF = nombre.toLowerCase().endsWith('.pdf')

  const convertirPDFaDocx = async (pdfUrl: string, key: string): Promise<string | null> => {
    try {
      setLoadingMsg('Convirtiendo PDF a Word...')
      const payload = {
        async      : false,
        filetype   : 'pdf',
        outputtype : 'docx',
        key        : `conv_${key}_${Date.now()}`,
        url        : pdfUrl,
        title      : nombre.replace('.pdf', ''),
      }
      const resp = await fetch(`${ONLYOFFICE_URL}/ConvertService.ashx`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify(payload),
      })
      const text = await resp.text()
      // Parsear XML de respuesta
      const match = text.match(/<FileUrl>(.*?)<\/FileUrl>/i)
      if (match) return match[1]
      console.error('[CONVERT] Respuesta:', text)
      return null
    } catch (e) {
      console.error('[CONVERT] Error:', e)
      return null
    }
  }

 useEffect(() => {
  if (initialized.current) return
  initialized.current = true

  const scriptId = 'onlyoffice-api-script'

  const initEditor = async () => {
    try {
      setLoadingMsg('Obteniendo configuración...')
      const qs = idCotizacion ? `?id_cotizacion=${idCotizacion}` : ''
      const res = await fetch(
        `${API_URL}/api/contratos/${idContrato}/archivos/${idArchivo}/onlyoffice-config${qs}`
      )
      if (!res.ok) throw new Error('No se pudo obtener config de OnlyOffice')
      const config = await res.json()

      if (!window.DocsAPI) throw new Error('OnlyOffice no cargó correctamente')
      if (editorRef.current) {
        try { editorRef.current.destroyEditor() } catch {}
      }

      config.width  = '100%'
      config.height = '100%'
      config.events = {
        onAppReady: () => { setLoading(false) },
        onError   : (e: any) => setError(`Error: ${e.data?.errorDescription || 'desconocido'}`),
      }
      config.type = 'desktop'

      setLoadingMsg('Abriendo documento...')
      editorRef.current = new window.DocsAPI.DocEditor('onlyoffice-container', config)
    } catch (err: any) {
      setError(err.message || 'Error iniciando OnlyOffice')
      setLoading(false)
    }
  }

  const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null

  if (!existingScript) {
    setLoadingMsg('Conectando con OnlyOffice...')
    const script = document.createElement('script')
    script.id  = scriptId
    // ← CLAVE: primero carga el script, DENTRO del onload llama a initEditor
    script.src = `${ONLYOFFICE_URL}/web-apps/apps/api/documents/api.js`
    script.onload  = () => initEditor()   // ← solo aquí, cuando DocsAPI ya existe
    script.onerror = () => {
      setError(`No se pudo conectar con OnlyOffice en ${ONLYOFFICE_URL}. ¿Está corriendo el contenedor?`)
      setLoading(false)
    }
    document.head.appendChild(script)
  } else {
    // Script ya estaba en el DOM (segunda apertura del editor)
    if (window.DocsAPI) {
      initEditor()
    } else {
      // Estaba cargando todavía, esperar
      existingScript.addEventListener('load', initEditor)
    }
  }

  return () => {
    if (editorRef.current) {
      try { editorRef.current.destroyEditor() } catch {}
    }
  }
}, [idContrato, idArchivo])

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-white">
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-blue-700 to-blue-800 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">{nombre}</p>
          <p className="text-[10px] text-blue-200">
            {esPDF ? 'PDF → Word — editable automáticamente' : 'Editor — los cambios se guardan automáticamente'}
          </p>
        </div>
          <div className="flex items-center gap-2 shrink-0">
            {onRellenarIA && (
              <button
             onClick={async () => {
                  if (rellenando) return
                  setRellenando(true)
                  try { await onRellenarIA() } finally { setRellenando(false) }
                }}
                disabled={rellenando}
                title="Rellenar automáticamente con IA"
                className="w-8 h-8 rounded-lg bg-purple-500/80 hover:bg-purple-400 text-white flex items-center justify-center transition-colors disabled:opacity-50"
              >
                {rellenando ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center transition-colors"
            >
              <X size={16} />
            </button>
          </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white">
            <Loader2 size={28} className="animate-spin text-blue-600" />
            <p className="text-sm text-slate-500">{loadingMsg}</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white px-8">
            <p className="text-sm text-red-500 text-center">{error}</p>
            <button onClick={onClose} className="text-xs text-slate-400 underline">Cerrar</button>
          </div>
        )}
        <div className="w-full h-full" suppressHydrationWarning>
          <div id="onlyoffice-container" style={{width:'100%', height:'100%'}} />
        </div>
      </div>
    </div>
  )
}