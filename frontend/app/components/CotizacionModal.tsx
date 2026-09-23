'use client'

import { useEffect, useState } from 'react'
import {
  X, Download, Upload, Trash2, Send, Save, Loader2,
  FileText, CheckCircle2, ShieldAlert, Building2, Calendar,
  Mail, Phone, ClipboardCheck, Wand2,
} from 'lucide-react'
import {
  obtenerDetalleCotizacion, guardarBorrador, subirArchivoCotizacion,
  enviarCotizacion, urlDescargarFormato, eliminarArchivoCotizacion,
  autorellenarArchivoCotizacion,
  type DetalleCotizacionResponse, type ItemCotizacionDetalle, type RtmCotizacionDetalle,
} from '@/lib/cotizaciones-api'
import OnlyOfficeEditor from './OnlyOfficeEditor'
import { getEmpresas, type EmpresaEstado } from '@/lib/empresas-api'
import { useAuth } from '@/components/AuthProvider'

type ModalToast = { text: string; tone: 'info' | 'success' | 'warning' | 'error' } | null

interface Props {
  idContrato: number
  onClose: () => void
  onEnviada?: () => void
}

function ModalToastBar({ toast, onDismiss }: { toast: ModalToast; onDismiss: () => void }) {
  if (!toast) return null
  const styles: Record<string, string> = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    error  : 'bg-rose-50 text-rose-700 border-rose-200',
    info   : 'bg-blue-50 text-blue-700 border-blue-200',
  }
  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-semibold ${styles[toast.tone]}`}>
      {toast.tone === 'success' && <CheckCircle2 size={14} className="shrink-0"/>}
      {toast.tone === 'error'   && <ShieldAlert size={14} className="shrink-0"/>}
      {toast.tone === 'warning' && <ShieldAlert size={14} className="shrink-0"/>}
      {toast.tone === 'info'    && <Loader2 size={14} className="shrink-0 animate-spin"/>}
      <span className="flex-1">{toast.text}</span>
      <button onClick={onDismiss}><X size={12} className="opacity-60 hover:opacity-100"/></button>
    </div>
  )
}

export default function CotizacionModal({ idContrato, onClose, onEnviada }: Props) {
  const { usuario, token } = useAuth()
  const esSoloLectura = usuario?.rol === 'visualizador'
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [sending, setSending] = useState(false)
  const [toast,   setToast]   = useState<ModalToast>(null)

  const [data, setData] = useState<DetalleCotizacionResponse | null>(null)
  const [empresaActiva, setEmpresaActiva] = useState<EmpresaEstado | null>(null)
  const [idCotizacion, setIdCotizacion] = useState<number | null>(null)
  const [seleccionados, setSeleccionados] = useState<Record<number, boolean>>({})
  const [precios, setPrecios] = useState<Record<number, string>>({})
  const [rtmValores, setRtmValores] = useState<Record<number, string>>({})
  const [archivosSubidos, setArchivosSubidos] = useState<Record<number, { nombre: string; idCotizacionArchivo: number }>>({})
  const [archivosPendientes, setArchivosPendientes] = useState<Record<number, File>>({})
  const [subiendoArchivo, setSubiendoArchivo] = useState<number | null>(null)
  const [eliminandoArchivo, setEliminandoArchivo] = useState<number | null>(null)


  const [archivoAbierto, setArchivoAbierto] = useState<{ idContratoArchivo: number; nombre: string } | null>(null)
  const [rellenandoIA, setRellenandoIA] = useState<number | null>(null)
  const [editorKey, setEditorKey] = useState(0)

  const handleRellenarIA = async (idContratoArchivo: number, nombre: string) => {
    if (!idCotizacion) {
      setToast({ text: 'Guarda el borrador antes de rellenar con IA.', tone: 'warning' })
      return
    }
    setRellenandoIA(idContratoArchivo)
    try {
      await autorellenarArchivoCotizacion(idContratoArchivo, idCotizacion, idContrato, token!)
      setArchivoAbierto({ idContratoArchivo, nombre })
      setEditorKey(k => k + 1)
    } catch (e: any) {
      setToast({ text: e.message || 'No se pudo rellenar el documento', tone: 'error' })
    } finally {
      setRellenandoIA(null)
    }
  }

  const [fecVigencia, setFecVigencia] = useState('')
  const [correo, setCorreo] = useState('')
  const [celular, setCelular] = useState('')

  // Cerrar con ESC (deshabilitado mientras se guarda o envía, para no perder la operación en curso)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !sending) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [saving, sending, onClose])

  const cargar = async () => {
    setLoading(true)
    try {
      const res = await obtenerDetalleCotizacion(idContrato, token!, idCotizacion ?? undefined)
      setData(res)

      const cot = res.detalle_cotizacion.uitCotizacionCompletaProjection
      if (cot) {
        setIdCotizacion(cot.idCotizacion)
        if (cot.fecVigencia) {
          setFecVigencia(cot.fecVigencia.split(' ')[0].split('/').reverse().join('-'))
        } else {
          const unMesDespues = new Date()
          unMesDespues.setMonth(unMesDespues.getMonth() + 1)
          setFecVigencia(unMesDespues.toISOString().split('T')[0])
        }
        setCorreo(cot.nomCorreo || '')
        setCelular(cot.numCelular || '')
      } else {
        const unMesDespues = new Date()
        unMesDespues.setMonth(unMesDespues.getMonth() + 1)
        setFecVigencia(unMesDespues.toISOString().split('T')[0])
        setCorreo('ventas@grupoecolimp.com')
        setCelular('984319700')
      }

      const selInicial: Record<number, boolean> = {}
      const precioInicial: Record<number, string> = {}
      res.detalle_cotizacion.uitContratoItemCotizacionProjectionList.forEach((it: ItemCotizacionDetalle) => {
        selInicial[it.idContratoItem] = true
        precioInicial[it.idContratoItem] = it.precioUnitario != null ? String(it.precioUnitario) : ''
      })
      setSeleccionados(selInicial)
      setPrecios(precioInicial)

      const rtmInicial: Record<number, string> = {}
      res.detalle_cotizacion.uitContratoRtmCotizacionProjectionList.forEach((r: RtmCotizacionDetalle) => {
        if (r.nomRtm !== 'Precio') {
          rtmInicial[r.idContratoRtmValor] = r.valorCotRtm || r.valorConRtm || ''
        }
      })
      setRtmValores(rtmInicial)

      const archInicial: Record<number, { nombre: string; idCotizacionArchivo: number }> = {}
      res.detalle_cotizacion.contratoArchivoCotizacionProjectionList.forEach(a => {
        if (a.idCotizacionArchivo && a.nombreArchivoCot) {
          archInicial[a.idContratoArchivo] = { nombre: a.nombreArchivoCot, idCotizacionArchivo: a.idCotizacionArchivo }
        }
      })
      setArchivosSubidos(archInicial)
    } catch (e: any) {
      setToast({ text: e.message || 'No se pudo cargar la cotización', tone: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [idContrato])

  useEffect(() => {
    if (!token) return
    getEmpresas(token)
      .then(res => setEmpresaActiva(res.empresas.find(e => e.seleccionada) || null))
      .catch(() => setEmpresaActiva(null))
  }, [token])

  if (loading) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
        <div className="bg-white rounded-3xl shadow-2xl px-10 py-9 flex flex-col items-center gap-5 max-w-xs w-full mx-4 border border-slate-100">
          <div className="relative w-14 h-14 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-blue-100"/>
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-600 animate-spin"/>
            <div className="absolute inset-[5px] rounded-full border-4 border-transparent border-t-blue-400 animate-spin"
                 style={{ animationDuration: '0.9s', animationDirection: 'reverse' }}/>
            <ClipboardCheck size={18} className="text-blue-600"/>
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-slate-800">Cargando ficha de cotización</p>
            <p className="text-xs text-slate-400 mt-1">Sincronizando datos con SEACE...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
        <button className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose}/>
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center">
            <ShieldAlert size={22} className="text-rose-500"/>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">No se pudo cargar la cotización</p>
            <p className="text-xs text-slate-500 mt-1">{toast?.text || 'Verifica la conexión con el servidor de extracción (puerto 4000).'}</p>
          </div>
          <div className="flex gap-2 w-full">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50">
              Cerrar
            </button>
            <button onClick={cargar} className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold">
              Reintentar
            </button>
          </div>
        </div>
      </div>
    )
  }

  const items = data.detalle_cotizacion.uitContratoItemCotizacionProjectionList
  const rtmList = data.detalle_cotizacion.uitContratoRtmCotizacionProjectionList
  const archivos = data.detalle_cotizacion.contratoArchivoCotizacionProjectionList
  const contrato = data.datos_contrato
  const esPorPaquete = data.detalle_cotizacion.idTipoCotizacion === 1

  const precioTotal = items.reduce((sum, it) => {
    if (!seleccionados[it.idContratoItem]) return sum
    const pu = parseFloat(precios[it.idContratoItem] || '0') || 0
    return sum + pu * it.cantidad
  }, 0)

  const todosArchivosSubidos = archivos.length === 0 || archivos.every(a => !!archivosSubidos[a.idContratoArchivo])
  const hayItemSinPrecio = items.some(it => seleccionados[it.idContratoItem] && (parseFloat(precios[it.idContratoItem] || '0') || 0) <= 0)
  const puedeGuardar = !esSoloLectura && items.some(it => seleccionados[it.idContratoItem]) && fecVigencia && correo && !hayItemSinPrecio && !!empresaActiva
  const puedeEnviar = !esSoloLectura && !!idCotizacion && todosArchivosSubidos

  // Construye el payload y llama a guardarBorrador. Se usa tanto desde el
  // botón "Guardar borrador" como automáticamente cuando el usuario sube
  // un archivo sin haber guardado aún.
  const crearOActualizarBorrador = async (): Promise<number> => {
  const itemsPayload = (esPorPaquete ? items : items.filter(it => seleccionados[it.idContratoItem]))
    .map(it => {
      const estaSeleccionado = !!seleccionados[it.idContratoItem]
      const pu = esPorPaquete && !estaSeleccionado
        ? 0
        : (parseFloat(precios[it.idContratoItem] || '0') || 0)
      return {
        idContratoItem: it.idContratoItem,
        precioUnitario: pu,
        precioTotal: pu * it.cantidad,
        idCotizacionItem: it.idCotizacionItem,
      }
    })

    const rtmPayload = data.detalle_cotizacion.uitContratoRtmCotizacionProjectionList.map(r => ({
      idContratoRtmValor: r.idContratoRtmValor,
      tipoProceso: r.tipoProceso,
      valor: r.nomRtm === 'Precio' ? precioTotal.toFixed(2) : (rtmValores[r.idContratoRtmValor] || ''),
      idCotizacionRtm: r.idCotizacionRtm,
    }))

    const cot = data.detalle_cotizacion.uitCotizacionCompletaProjection
    const res = await guardarBorrador({
      idCotizacion,    
      idContrato,
      idContratoInvita: cot?.idContratoInvita ?? null,
      fecVigencia: `${fecVigencia} 00:00:00`,
      nomCorreo: correo,
      numCelular: celular,
      precioTotal,
      items: itemsPayload,
      rtm: rtmPayload,
    }, token!)

    setIdCotizacion(res.idCotizacion)
    return res.idCotizacion
  }

  const seleccionarArchivo = (idContratoArchivo: number, file: File) => {
    setArchivosPendientes(prev => ({ ...prev, [idContratoArchivo]: file }))
  }

  const quitarArchivoPendiente = (idContratoArchivo: number) => {
    setArchivosPendientes(prev => {
      const copy = { ...prev }
      delete copy[idContratoArchivo]
      return copy
    })
  }

  const handleEliminarArchivo = async (idContratoArchivo: number, idCotizacionArchivo: number) => {
    setEliminandoArchivo(idContratoArchivo)
    try {
      await eliminarArchivoCotizacion(idCotizacionArchivo, token!)
      setArchivosSubidos(prev => {
        const copy = { ...prev }
        delete copy[idContratoArchivo]
        return copy
      })
      setToast({ text: 'Documento eliminado correctamente.', tone: 'success' })
    } catch (e: any) {
      setToast({ text: e.message || 'No se pudo eliminar el archivo', tone: 'error' })
    } finally {
      setEliminandoArchivo(null)
      setTimeout(() => setToast(null), 3500)
    }
  }

  // Sube los archivos pendientes contra el borrador ya guardado. Se llama
  // recién después de crearOActualizarBorrador(), igual que en SEACE
  // (procesar-por-item primero, registrar-archivo-cotizacion después).
  const subirArchivosPendientes = async (idCotizacionActual: number) => {
    for (const [idStr, file] of Object.entries(archivosPendientes)) {
      const idContratoArchivo = Number(idStr)
      setSubiendoArchivo(idContratoArchivo)
      try {
        const res = await subirArchivoCotizacion(idCotizacionActual, idContratoArchivo, idContrato, file, token!)
        setArchivosSubidos(prev => ({ ...prev, [idContratoArchivo]: { nombre: file.name, idCotizacionArchivo: res.idCotizacionArchivo } }))
        quitarArchivoPendiente(idContratoArchivo)
      } catch (e: any) {
        setToast({ text: e.message || `No se pudo subir ${file.name}`, tone: 'error' })
      }
    }
    setSubiendoArchivo(null)
  }

  const handleGuardarBorrador = async () => {
    if (!puedeGuardar) return
    setSaving(true)
    setToast(null)
    try {
      const idCotizacionActual = await crearOActualizarBorrador()
      if (Object.keys(archivosPendientes).length > 0) {
        await subirArchivosPendientes(idCotizacionActual)
      }
      setToast({ text: 'Borrador guardado correctamente.', tone: 'success' })
      await cargar()
    } catch (e: any) {
      setToast({ text: e.message || 'No se pudo guardar el borrador', tone: 'error' })
    } finally {
      setSaving(false)
      setTimeout(() => setToast(null), 4000)
    }
  }

  const handleEnviar = async () => {
    if (!puedeEnviar || !idCotizacion) return
    setSending(true)
    setToast(null)
    try {
      await enviarCotizacion(idCotizacion, idContrato, token!)
      setToast({ text: 'Cotización enviada correctamente a la entidad.', tone: 'success' })
      setTimeout(() => {
        onEnviada?.()
        onClose()
      }, 1200)
    } catch (e: any) {
      setToast({ text: e.message || 'No se pudo enviar la cotización', tone: 'error' })
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose}/>

      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-100">

        {(saving || sending) && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/85 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4">
              <div className="relative w-14 h-14 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-4 border-blue-100"/>
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-600 animate-spin"/>
                <div className="absolute inset-[5px] rounded-full border-4 border-transparent border-t-blue-400 animate-spin"
                     style={{ animationDuration: '0.9s', animationDirection: 'reverse' }}/>
                {sending ? <Send size={16} className="text-blue-600"/> : <Save size={16} className="text-blue-600"/>}
              </div>
              <p className="text-sm font-bold text-slate-800">
                {sending ? 'Enviando cotización a la entidad...' : 'Guardando borrador...'}
              </p>
            </div>
          </div>
        )}

        {/* HEADER */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-blue-900 px-6 py-5 flex items-start justify-between shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
              <ClipboardCheck size={19} className="text-white"/>
            </div>
            <div>
              <p className="text-[10px] font-mono text-blue-200 uppercase tracking-wider">{contrato.nroDescripcion}</p>
              <p className="text-sm font-bold text-white mt-0.5 leading-snug max-w-lg">{contrato.desObjetoContrato}</p>
              <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-slate-300">
                <Building2 size={11}/>
                <span>{contrato.nomEntidad}</span>
              </div>
              {empresaActiva ? (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="inline-flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full">
                    <CheckCircle2 size={10}/>
                    Cotizando como {empresaActiva.razon_social}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="inline-flex items-center gap-1.5 bg-amber-500/15 border border-amber-400/30 text-amber-300 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full">
                    <ShieldAlert size={10}/>
                    Sin empresa vinculada
                  </span>
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors shrink-0">
            <X size={15}/>
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          <ModalToastBar toast={toast} onDismiss={() => setToast(null)}/>

          {/* Documentos solicitados */}
          {archivos.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2.5">Documentos solicitados por el proveedor</p>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {archivos.map(a => {
                  const subido = archivosSubidos[a.idContratoArchivo]
                  const pendiente = archivosPendientes[a.idContratoArchivo]
                  const subiendo = subiendoArchivo === a.idContratoArchivo
                  return (
                    <div key={a.idContratoArchivo} className="border border-slate-200 rounded-xl p-2.5 space-y-2">
                      <p className="text-[10px] font-bold text-slate-700 leading-snug line-clamp-2 min-h-[26px]">{a.nomTipoArchivo}</p>

                      <a  href={urlDescargarFormato(a.idContratoArchivo)}
                        target="_blank" rel="noreferrer"
                        className="flex items-center gap-1.5 text-[10px] font-semibold text-blue-600 hover:text-blue-700"
                      >
                        <Download size={11}/>
                        Formato ({(parseInt(a.tamanio) / 1024).toFixed(1)} KB)
                      </a>


                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setArchivoAbierto({ idContratoArchivo: a.idContratoArchivo, nombre: a.nomTipoArchivo })}
                          className="flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-600 border border-slate-200 rounded-lg py-1 hover:bg-slate-50"
                        >
                          <FileText size={11}/> Abrir
                        </button>
                        <button
                          onClick={() => handleRellenarIA(a.idContratoArchivo, a.nomTipoArchivo)}
                          disabled={rellenandoIA === a.idContratoArchivo || !idCotizacion}
                          title={!idCotizacion ? 'Guarda el borrador primero' : 'Rellenar automáticamente con IA'}
                          className="flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold text-purple-600 border border-purple-200 rounded-lg py-1 hover:bg-purple-50 disabled:opacity-40"
                        >
                          {rellenandoIA === a.idContratoArchivo ? <Loader2 size={11} className="animate-spin"/> : <Wand2 size={11}/>}
                          Rellenar IA
                        </button>
                      </div>

                      {subido ? (
                        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileText size={11} className="text-emerald-600 shrink-0"/>
                            <span className="text-[10px] font-semibold text-emerald-700 truncate">{subido.nombre}</span>
                          </div>
                          <button
                            onClick={() => handleEliminarArchivo(a.idContratoArchivo, subido.idCotizacionArchivo)}
                            disabled={eliminandoArchivo === a.idContratoArchivo}
                            className="w-5 h-5 rounded-md bg-rose-100 hover:bg-rose-200 text-rose-500 flex items-center justify-center shrink-0 disabled:opacity-50"
                          >
                            {eliminandoArchivo === a.idContratoArchivo
                              ? <Loader2 size={10} className="animate-spin"/>
                              : <Trash2 size={10}/>}
                          </button>
                        </div>
                      ) : pendiente && !subiendo ? (
                        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileText size={11} className="text-amber-600 shrink-0"/>
                            <span className="text-[10px] font-semibold text-amber-700 truncate">{pendiente.name}</span>
                          </div>
                          <button
                            onClick={() => quitarArchivoPendiente(a.idContratoArchivo)}
                            className="w-5 h-5 rounded-md bg-rose-100 hover:bg-rose-200 text-rose-500 flex items-center justify-center shrink-0"
                          >
                            <Trash2 size={10}/>
                          </button>
                        </div>
                      ) : esSoloLectura ? (
                        <div className="flex items-center justify-center gap-1.5 border-2 border-dashed border-slate-200 rounded-lg px-2 py-2 text-[10px] font-semibold text-slate-400">
                          Sin documento
                        </div>
                      ) : (
                        <label className={`flex items-center justify-center gap-1.5 border-2 border-dashed rounded-lg px-2 py-2 text-[10px] font-semibold cursor-pointer transition-colors text-center
                          ${subiendo ? 'border-blue-300 text-blue-400 bg-blue-50' : 'border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50/50'}`}>
                          {subiendo ? <Loader2 size={12} className="animate-spin"/> : <Upload size={12}/>}
                          {subiendo ? 'Subiendo...' : 'Seleccionar (máx. 50 MB)'}
                          <input
                            type="file"
                            className="hidden"
                            disabled={subiendo}
                            onChange={e => {
                              const file = e.target.files?.[0]
                              if (file) seleccionarArchivo(a.idContratoArchivo, file)
                              e.target.value = ''
                            }}
                          />
                        </label>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Registro de ítems */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">Registro de ítems</p>
              <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
                {esPorPaquete ? 'Debe cotizar por todo el grupo de ítems' : 'Seleccione los ítems a los que enviará su cotización'}
              </span>
            </div>
            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wide">
                    <th className="px-3 py-2.5 text-left w-8"></th>
                    <th className="px-3 py-2.5 text-left">Descripción</th>
                    <th className="px-3 py-2.5 text-left">Unidad</th>
                    <th className="px-3 py-2.5 text-center">Cant.</th>
                    <th className="px-3 py-2.5 text-left">Moneda</th>
                    <th className="px-3 py-2.5 text-right">P. Unitario</th>
                    <th className="px-3 py-2.5 text-right">P. Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => {
                    const pu = parseFloat(precios[it.idContratoItem] || '0') || 0
                    return (
                      <tr key={it.idContratoItem} className="border-t border-slate-100">
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={!!seleccionados[it.idContratoItem]}
                            onChange={e => setSeleccionados(prev => ({ ...prev, [it.idContratoItem]: e.target.checked }))}
                            disabled={esSoloLectura || esPorPaquete}
                            className="w-4 h-4 rounded accent-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="px-3 py-3 font-semibold text-slate-700 max-w-xs">{it.nomCubso}</td>
                        <td className="px-3 py-3 text-slate-500">{it.nomUnidadMedida}</td>
                        <td className="px-3 py-3 text-center text-slate-500">{it.cantidad}</td>
                        <td className="px-3 py-3 text-slate-500">{it.nomMoneda}</td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            step="0.01"
                            value={precios[it.idContratoItem] || ''}
                            onChange={e => setPrecios(prev => ({ ...prev, [it.idContratoItem]: e.target.value }))}
                            disabled={esSoloLectura}
                            className="w-24 text-right border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
                          />
                        </td>
                        <td className="px-3 py-3 text-right font-bold text-slate-800">
                          {(pu * it.cantidad).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* RTM */}
          {rtmList.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-3">Registro de requerimientos técnicos mínimos</p>
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wide">
                      <th className="px-3 py-2.5 text-left w-10">Nro</th>
                      <th className="px-3 py-2.5 text-left">Descripción</th>
                      <th className="px-3 py-2.5 text-right">RTM solicitado</th>
                      <th className="px-3 py-2.5 text-right">RTM ofertado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rtmList.map((r, idx) => (
                      <tr key={r.idContratoRtmValor} className="border-t border-slate-100">
                        <td className="px-3 py-3 text-slate-400">{idx + 1}</td>
                        <td className="px-3 py-3 font-semibold text-slate-700">{r.nomRtm}</td>
                        <td className="px-3 py-3 text-right text-slate-500">{r.valorConRtm || '—'}</td>
                          <td className="px-3 py-3">
                            {r.nomRtm === 'Precio' ? (
                              <div className="w-full text-right border border-slate-200 rounded-lg px-2 py-1.5 bg-slate-50 text-slate-600 font-semibold">
                                {precioTotal.toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                              </div>
                            ) : (
                              <input
                                type="text"
                                value={rtmValores[r.idContratoRtmValor] || ''}
                                onChange={e => setRtmValores(prev => ({ ...prev, [r.idContratoRtmValor]: e.target.value }))}
                                disabled={esSoloLectura}
                                className="w-full text-right border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
                              />
                            )}
                          </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Información adicional */}
          <div>
            <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-3">Información adicional</p>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase mb-1.5">
                  <Calendar size={11}/> Vigencia de cotización
                </label>
                <input
                  type="date"
                  value={fecVigencia}
                  onChange={e => setFecVigencia(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase mb-1.5">
                  <Mail size={11}/> Correo de contacto
                </label>
                <input
                  type="email"
                  value={correo}
                  onChange={e => setCorreo(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase mb-1.5">
                  <Phone size={11}/> Celular de contacto
                </label>
                <input
                  type="text"
                  value={celular}
                  onChange={e => setCelular(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="border-t border-slate-100 px-6 py-4 flex items-center justify-between shrink-0 bg-slate-50/50">
          <div className="text-xs text-slate-500">
            Total cotizado: <span className="font-bold text-slate-800">S/ {precioTotal.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleGuardarBorrador}
              disabled={!puedeGuardar || saving}
              title={esSoloLectura ? 'Tu rol solo tiene acceso de lectura' : !empresaActiva ? 'Vincula y selecciona una empresa en el navbar antes de cotizar' : ''}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
              Guardar borrador
            </button>
            <button
              onClick={handleEnviar}
              disabled={!puedeEnviar || sending}
              title={esSoloLectura ? 'Tu rol solo tiene acceso de lectura' : !idCotizacion ? 'Primero guarda el borrador' : !todosArchivosSubidos ? 'Sube todos los documentos solicitados' : ''}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
              Enviar cotización
            </button>
          </div>
        </div>
      </div>

      {archivoAbierto && (
        <OnlyOfficeEditor
          key={editorKey}
          idContrato={idContrato}
          idArchivo={archivoAbierto.idContratoArchivo}
          nombre={archivoAbierto.nombre}
          idCotizacion={idCotizacion}
          onClose={() => setArchivoAbierto(null)}
          onRellenarIA={async () => {
            if (!idCotizacion) {
              setToast({ text: 'Guarda el borrador antes de rellenar con IA.', tone: 'warning' })
              return
            }
            await autorellenarArchivoCotizacion(archivoAbierto.idContratoArchivo, idCotizacion, idContrato, token!)
            setEditorKey(k => k + 1)
          }}
        />
      )}
    </div>
  )
}