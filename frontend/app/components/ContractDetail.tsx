'use client'

import React, { useEffect, useState } from 'react'
import {
  X, Building2, Calendar, FileText, Hash,
  MessageSquare, ArrowLeft, ShoppingCart,
  Loader2, Package, Wrench, ClipboardList,
  Download, AlertCircle, Users, DollarSign,
  CheckCircle, Clock, XCircle, ChevronDown, ChevronUp
} from 'lucide-react'

import ChatPanel from './ChatPanel'
import OnlyOfficeEditor from './OnlyOfficeEditor'
import { Contract } from './ContractCard'

import {
  getContrato, getArchivosSeace, getItemsContrato,
  getRtmContrato, getEtapasContrato, getCotizacion,
  getUrlArchivoLocal, getUrlArchivoPreview, indexarArchivo,
  getEmpresas, detectarCampos, generarDocumento,
  type ContratoDetalle, type ArchivoSeace,
  type ItemContrato, type RtmContrato,
  type EtapaContrato, type CotizacionCompleta,
  type Empresa, type CampoDetectado, type PreviewFill,
} from '@/lib/api'
import { PenLine, CheckCheck } from 'lucide-react'




interface ContractDetailProps {
  contract: Contract
  onClose : () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatFecha = (f: string | null | undefined) => {
  if (!f) return '—'

  try {
    // convertir "DD/MM/YYYY HH:mm:ss" → "YYYY-MM-DDTHH:mm:ss"
    const [datePart, timePart] = f.split(' ')
    if (!datePart) return '—'

    const [day, month, year] = datePart.split('/')

    const isoString = `${year}-${month}-${day}T${timePart ?? '00:00:00'}`

    const date = new Date(isoString)

    if (isNaN(date.getTime())) return f // fallback seguro

    return new Intl.DateTimeFormat('es-PE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date)

  } catch (e) {
    return f
  }
}

function formatMonto(v: number | null | undefined) {
  if (!v) return '—'
  return new Intl.NumberFormat('es-PE', {
    style: 'currency', currency: 'PEN', maximumFractionDigits: 2,
  }).format(v)
}

function statusCfg(status: string) {
  const m: Record<string, { label: string; badge: string; dot: string; icon: React.ReactNode }> = {
    vigente      : { label: 'Vigente',       badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', icon: <CheckCircle size={12}/> },
    en_evaluacion: { label: 'En Evaluación', badge: 'bg-violet-100 text-violet-700',   dot: 'bg-violet-500',  icon: <Clock      size={12}/> },
    culminado    : { label: 'Culminado',     badge: 'bg-rose-100 text-rose-700',       dot: 'bg-rose-500',    icon: <XCircle    size={12}/> },
  }
  return m[status] ?? { label: status, badge: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400', icon: null }
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value || value === '—') return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      <span className="text-sm text-slate-700 leading-snug">{value}</span>
    </div>
  )
}

function Section({ title, icon, children, defaultOpen = true }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <span className="text-blue-500">{icon}</span>
        <span className="text-sm font-semibold text-slate-700 flex-1">{title}</span>
        {open ? <ChevronUp size={14} className="text-slate-400"/> : <ChevronDown size={14} className="text-slate-400"/>}
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  )
}

function ArchivoRow({ arch, idContrato, onSelect, selected, indexing, onFill, filling, onEdit }: {
  arch: ArchivoSeace
  idContrato: number
  onSelect?: () => void
  selected?: boolean
  indexing?: boolean
  onFill?: () => void
  filling?: boolean
  onEdit?: () => void
}) {
  const ext     = arch.extension?.toLowerCase() ?? ''
  const isPdf   = ext === 'pdf'
  const isDocx  = ext === 'docx' || ext === 'doc'
  const color   = isPdf ? 'text-red-500' : isDocx ? 'text-blue-600' : 'text-slate-500'
  const label   = arch.nombre || `Archivo ${arch.id_archivo}`
  const kb      = arch.bytes ? `${(arch.bytes / 1024).toFixed(0)} KB` : arch.tamanio || ''
  const urlLocal = arch.id_archivo && arch.ruta_local
    ? getUrlArchivoLocal(idContrato, arch.id_archivo)
    : null

  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${onSelect ? 'cursor-pointer' : ''} ${selected ? 'border-blue-300 bg-blue-50' : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'}`}
    >
      <FileText size={16} className={`shrink-0 ${color}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-700 truncate">{label}</p>
        <p className="text-[10px] text-slate-400">
          {arch.tipo}{kb ? ` · ${kb}` : ''} · {ext.toUpperCase()}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
      {urlLocal && arch.id_archivo && onEdit && (
          <button
            onClick={e => { e.stopPropagation(); onEdit() }}
            className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"
            title="Abrir en nueva pestaña"
          >
            <FileText size={13} />
          </button>
        )}
        {urlLocal && (<a href={urlLocal} onClick={e => e.stopPropagation()} className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors" title="Descargar" download><Download size={13} /></a>)}
        {onEdit && (
          <button
            onClick={e => { e.stopPropagation(); onEdit() }}
            className="p-1 rounded hover:bg-blue-50 text-slate-300 hover:text-blue-500 transition-colors"
            title="Abrir en editor"
          >
            <PenLine size={13} />
          </button>
        )}
        {onFill && (
          filling
            ? <Loader2 size={12} className="shrink-0 ml-1 text-amber-500 animate-spin" />
            : <button
                onClick={e => { e.stopPropagation(); onFill() }}
                className="p-1 rounded hover:bg-amber-50 text-slate-300 hover:text-amber-500 transition-colors"
                title="Autocompletar campos"
              >
                <CheckCheck size={13} />
              </button>
        )}
        {onSelect && (
          indexing
            ? <Loader2 size={12} className="shrink-0 ml-1 text-blue-500 animate-spin" />
            : <MessageSquare size={12} className={`shrink-0 ml-1 ${selected ? 'text-blue-500' : 'text-slate-300'}`} />
        )}
      </div>
    </div>
  )
}
// ─── Panel principal ──────────────────────────────────────────────────────────

export function ContractDetail({ contract, onClose }: ContractDetailProps) {
  const [selectedDoc,    setSelectedDoc]    = useState<any>(null)
  const [detalle,        setDetalle]        = useState<ContratoDetalle | null>(null)
  const [archivos,       setArchivos]       = useState<ArchivoSeace[]>([])
  const [items,          setItems]          = useState<ItemContrato[]>([])
  const [rtm,            setRtm]            = useState<RtmContrato[]>([])
  const [etapas,         setEtapas]         = useState<EtapaContrato[]>([])
  const [cotizacion,     setCotizacion]     = useState<CotizacionCompleta | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState<string | null>(null)

  const [indexingId,   setIndexingId]   = useState<number | null>(null)
  const [empresas,     setEmpresas]     = useState<Empresa[]>([])
  const [empresaId,    setEmpresaId]    = useState<number | null>(null)
  const [fillPreview,  setFillPreview]  = useState<PreviewFill | null>(null)
  const [fillValores,  setFillValores]  = useState<Record<string, string>>({})
  const [fillingId,    setFillingId]    = useState<number | null>(null)
  const [generando,    setGenerando]    = useState(false)
  const [onlyOfficeDoc, setOnlyOfficeDoc] = useState<{idArchivo: number; nombre: string} | null>(null)
  // Cargar empresas al montar
  useEffect(() => {
    getEmpresas().then(e => {
      console.log('Empresas cargadas:', e)
      setEmpresas(e)
      if (e.length > 0) setEmpresaId(e[0].id)
    }).catch(err => {
      console.error('Error cargando empresas:', err)
    })
  }, [])

  // Cerrar con ESC: prioriza el modal que está "encima"
  // (Rellenar Documento > Editor OnlyOffice > panel de detalle completo)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (fillPreview) {
        setFillPreview(null)
      } else if (onlyOfficeDoc) {
        setOnlyOfficeDoc(null)
      } else {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [fillPreview, onlyOfficeDoc, onClose])


  const abrirOnlyOffice = (a: ArchivoSeace) => {
  if (!a.id_archivo) return
  setOnlyOfficeDoc({ idArchivo: a.id_archivo, nombre: a.nombre || `Archivo ${a.id_archivo}` })
  }


  const abrirFill = async (a: ArchivoSeace) => {
    if (!a.id_archivo) return
    if (!empresaId) {
      alert('No se encontró ninguna empresa en la BD. Verifica que hayas insertado tu empresa en la tabla "empresas".')
      return
    }
    setFillingId(a.id_archivo)
    try {
      const preview = await detectarCampos(contract.id, a.id_archivo, empresaId)
      const vals: Record<string, string> = {}
      preview.campos.forEach(c => { vals[c.campo] = c.valor_auto })
      setFillValores(vals)
      setFillPreview(preview)
    } catch (err: any) {
      alert(err.message || 'Error detectando campos')
    } finally {
      setFillingId(null)
    }
  }

  const handleGenerar = async () => {
    if (!fillPreview || !empresaId) return
    setGenerando(true)
    try {
      await generarDocumento(contract.id, fillPreview.id_archivo, empresaId, fillValores)
      setFillPreview(null)
    } catch (err: any) {
      alert(err.message || 'Error generando documento')
    } finally {
      setGenerando(false)
    }
  }

  const sc = statusCfg(contract.status)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const id = (contract as any).id_contrato ?? contract.id

    Promise.all([
      getContrato(id),
      getArchivosSeace(id, 'todos'),
      getItemsContrato(id),
      getRtmContrato(id),
      getEtapasContrato(id),
      getCotizacion(id),
    ])
      .then(([det, arch, its, r, et, cot]) => {
        setDetalle(det)
        setArchivos(arch)
        setItems(its)
        setRtm(r)
        setEtapas(et)
        setCotizacion(cot)
      })
      .catch(() => setError('Error cargando detalles del contrato'))
      .finally(() => setLoading(false))
  }, [contract.id, contract.cotizar, contract.status])

  const archContrato  = archivos.filter(a => a.contexto === 'contrato')
  const archCotizacion= archivos.filter(a => a.contexto === 'cotizacion')

  // Docs para el chatbot (archivos de cotización primero, luego contrato)
  const docsChat = archivos
      .filter(a => a.id_archivo)
      .map(a => ({
        id         : String(a.id_archivo),
        label      : a.nombre || `Archivo ${a.id_archivo}`,
        document_id: null, // sin RAG por ahora
      }))

    const selectArchivo = async (a: ArchivoSeace) => {
      if (selectedDoc?.id_archivo === a.id_archivo) {
        setSelectedDoc(null)
        return
      }

      // Abrimos el panel YA, así el usuario ve el loader inmediatamente
      setSelectedDoc(a)

      if (!a.rag_document_id && a.id_archivo) {
        setIndexingId(a.id_archivo)
        try {
          const result = await indexarArchivo(contract.id, a.id_archivo)
          const updated = { ...a, rag_document_id: result.document_id, chunks: result.chunks }

          setArchivos(prev =>
            prev.map(x => (x.id_archivo === a.id_archivo ? { ...x, rag_document_id: result.document_id } : x))
          )
          setSelectedDoc((prev: any) =>
            prev && prev.id_archivo === a.id_archivo ? updated : prev
          )
        } catch (err) {
          console.error('Error indexando archivo:', err)
          alert(`No se pudo indexar "${a.nombre}". Revisa que el archivo exista en el servidor.`)
          setSelectedDoc(null)
        } finally {
          setIndexingId(null)
        }
      }
    }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <button
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        aria-label="Cerrar"
      />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-5xl h-full bg-white shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-5 flex items-start justify-between gap-4 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-xs font-mono text-slate-400 bg-slate-700 px-2 py-0.5 rounded flex items-center gap-1">
                <Hash size={10} /> {contract.code}
              </span>
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 ${sc.badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                {sc.label}
              </span>
              {contract.cotizar && (
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-900 text-emerald-300 flex items-center gap-1">
                  <ShoppingCart size={10} /> Habilitado para cotizar
                </span>
              )}
            </div>
            <h2 className="text-base font-bold text-white leading-snug line-clamp-2">
              {contract.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* Columna izquierda — detalles */}
          <div className={`flex flex-col overflow-y-auto transition-all duration-300 ${selectedDoc ? 'w-2/5 border-r border-slate-100' : 'w-full'}`}>

            {loading ? (
              <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-sm">Cargando detalles...</span>
              </div>
            ) : error ? (
              <div className="flex items-center gap-2 m-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                <AlertCircle size={16} /> {error}
              </div>
            ) : (
              <div className="p-5 space-y-4">

                {/* Info general */}
                <Section title="Información general" icon={<ClipboardList size={15}/>}>
                  <div className="grid grid-cols-2 gap-4">
                    <InfoRow label="Entidad"         value={detalle?.nom_entidad} />
                    <InfoRow label="Sigla"           value={detalle?.nom_sigla} />
                    <InfoRow label="Área usuaria"    value={detalle?.nom_area_usuaria} />
                    <InfoRow label="Tipo contrato"   value={detalle?.nom_tipo_cotizacion} />
                    <InfoRow label="Tipo invitación" value={detalle?.nom_tipo_invitacion} />
                    <InfoRow label="Objeto"          value={detalle?.nom_objeto_contrato} />
                    <InfoRow label="Valor máx. UIT"  value={formatMonto(detalle?.valor_max_uit)} />
                    <InfoRow label="Publicado"       value={formatFecha(detalle?.fec_publica ?? null)} />
                    <InfoRow label="Inicio cotiz."   value={formatFecha(detalle?.fec_ini_cotizacion ?? null)} />
                    <InfoRow label="Fin cotiz."      value={formatFecha(detalle?.fec_fin_cotizacion ?? null)} />
                    <InfoRow label="Estado cotiz."   value={detalle?.nom_estado_cotiza} />
                    <InfoRow label="Consultas"       value={detalle?.num_consultas ? String(detalle.num_consultas) : null} />
                    <InfoRow label="Invitaciones"    value={detalle?.num_invitaciones ? String(detalle.num_invitaciones) : null} />
                    <InfoRow label="Subsanaciones"   value={detalle?.num_subsanaciones_total ? String(detalle.num_subsanaciones_total) : null} />
                  </div>
                  {detalle?.des_objeto_contrato && (
                    <div className="mt-4">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Descripción</p>
                      <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 rounded-lg p-3 border border-slate-100 whitespace-pre-line">
                        {detalle.des_objeto_contrato}
                      </p>
                    </div>
                  )}
                </Section>

                {/* Etapas */}
                {etapas.length > 0 && (
                  <Section title={`Etapas (${etapas.length})`} icon={<Clock size={15}/>}>
                    <div className="space-y-2">
                      {etapas.map((e, i) => (
                        <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                          <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
                          <div>
                            <p className="text-xs font-semibold text-slate-700">{e.nom_etapa_contrato}</p>
                            <p className="text-[10px] text-slate-400">{formatFecha(e.fec_ini)} → {formatFecha(e.fec_fin)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Items del contrato */}
                {items.length > 0 && (
                  <Section title={`Ítems del contrato (${items.length})`} icon={<Package size={15}/>}>
                    <div className="space-y-2">
                      {items.map((it, i) => (
                        <div key={i} className="p-3 rounded-lg border border-slate-100 bg-slate-50">
                          <p className="text-xs font-semibold text-slate-700">{it.nom_cubso || it.cod_cubso}</p>
                          {it.descripcion_item && (
                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{it.descripcion_item}</p>
                          )}
                          <div className="flex gap-4 mt-1.5 text-[10px] text-slate-400">
                            {it.cantidad    && <span>Cant: <b>{it.cantidad}</b> {it.nom_unidad_medida}</span>}
                            {it.precio_total && <span>Total: <b>{formatMonto(it.precio_total)}</b></span>}
                            {it.nom_distrito && <span>📍 {it.nom_distrito}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* RTM */}
                {rtm.length > 0 && (
                  <Section title={`RTM — Requisitos Técnicos (${rtm.length})`} icon={<Wrench size={15}/>} defaultOpen={false}>
                    <div className="space-y-2">
                      {rtm.map((r, i) => (
                        <div key={i} className="p-3 rounded-lg border border-slate-100">
                          <p className="text-xs font-semibold text-slate-700">{r.nombre_rtm}</p>
                          {r.valor && <p className="text-xs text-slate-500 mt-0.5">{r.valor}</p>}
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Archivos del contrato */}
                {/* Archivos del contrato */}
                {archContrato.length > 0 && (
                  <Section title={`Documentos del contrato (${archContrato.length})`} icon={<FileText size={15}/>}>
                    <div className="space-y-1.5">
                      {archContrato.map((a, i) => (
                        <ArchivoRow
                          key={i}
                          arch={a}
                          idContrato={contract.id}
                          selected={selectedDoc?.id_archivo === a.id_archivo}
                          indexing={indexingId === a.id_archivo}
                          filling={fillingId === a.id_archivo}
                          onSelect={() => selectArchivo(a)}
                          onFill={['docx','doc','pdf'].includes((a.extension ?? '').toLowerCase().replace('.',''))
                            ? () => abrirFill(a)
                            : undefined}
                          onEdit={() => abrirOnlyOffice(a)}
                        />
                      ))}
                    </div>
                  </Section>
                )}

                {/* COTIZACIÓN */}
                {cotizacion && (
                  <Section title="Cotización" icon={<ShoppingCart size={15}/>}>

                    {!cotizacion ? (
                      <p className="text-xs text-slate-400">Sin datos de cotización aún.</p>
                    ) : cotizacion.items.length === 0 && cotizacion.ofertas.length === 0 && cotizacion.rtm.length === 0 && cotizacion.archivos.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">Proceso desierto — ningún proveedor presentó oferta.</p>
                    ) : (
                      <div className="space-y-4">

                        {/* Items cotización */}
                        {cotizacion.items.length > 0 && (
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                              Ítems a cotizar ({cotizacion.items.length})
                            </p>
                            <div className="space-y-2">
                              {cotizacion.items.map((it, i) => (
                                <div key={i} className="p-3 rounded-lg border border-blue-100 bg-blue-50">
                                  <p className="text-xs font-semibold text-slate-700">{it.nom_cubso || it.cod_cubso}</p>
                                  {it.descripcion_item && (
                                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{it.descripcion_item}</p>
                                  )}
                                  <div className="flex gap-4 mt-1.5 text-[10px] text-slate-400">
                                    {it.cantidad       && <span>Cant: <b>{it.cantidad}</b> {it.nom_unidad_medida}</span>}
                                    {it.precio_unitario && <span>P.Unit: <b>{formatMonto(it.precio_unitario)}</b></span>}
                                    {it.precio_total   && <span>Total: <b>{formatMonto(it.precio_total)}</b></span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* RTM cotización */}
                        {cotizacion.rtm.length > 0 && (
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                              RTM de cotización
                            </p>
                            <div className="space-y-1.5">
                              {cotizacion.rtm.map((r, i) => (
                                <div key={i} className="p-2.5 rounded-lg border border-slate-100 text-xs">
                                  <p className="font-semibold text-slate-700">{r.nom_rtm}</p>
                                  <div className="flex gap-4 mt-0.5 text-slate-400">
                                    {r.valor_con_rtm && <span>Requerido: {r.valor_con_rtm}</span>}
                                    {r.valor_cot_rtm && <span>Ofertado: <b className="text-slate-600">{r.valor_cot_rtm}</b></span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Ofertas */}
                        {cotizacion.ofertas.length > 0 && (
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1">
                              <Users size={10}/> Resultado de la contratación ({cotizacion.ofertas.length})
                            </p>
                            <div className="space-y-2">
                              {cotizacion.ofertas.map((o, i) => {
                                const esDesierto = !o.nom_razon_social && (!o.precio_total || o.precio_total === 0)
                                return (
                                  <div key={i} className={`p-3 rounded-lg border ${
                                    esDesierto
                                      ? 'border-slate-200 bg-slate-50'
                                      : i === 0
                                        ? 'border-emerald-200 bg-emerald-50'
                                        : 'border-slate-100'
                                  }`}>
                                  {esDesierto ? (
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-bold text-slate-400">#{i + 1}</span>
                                        <span className="text-xs font-semibold text-slate-700">
                                          {(o as any).nom_cubso || o.cod_cubso || '—'}
                                        </span>
                                        <span className="ml-auto text-[10px] font-semibold text-rose-500 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                                          DESIERTO
                                        </span>
                                      </div>
                                      {(o as any).descripcion_item && (
                                        <p className="text-[10px] text-slate-400 pl-4">{(o as any).descripcion_item}</p>
                                      )}
                                      <div className="flex gap-4 pl-4 text-[10px] text-slate-400">
                                        {(o as any).cantidad && (
                                          <span>Cant: <b className="text-slate-600">{(o as any).cantidad}</b> {(o as any).nom_unidad_medida || ''}</span>
                                        )}
                                        {o.cod_cubso && (
                                          <span className="font-mono text-slate-300">{o.cod_cubso}</span>
                                        )}
                                      </div>
                                    </div>
                                  ) : (
                                      <>
                                        {i === 0 && <p className="text-[10px] font-bold text-emerald-600 mb-1">🏆 Mejor oferta</p>}
                                        {(o.cod_cubso || o.id_cubso) && (
                                          <p className="text-[10px] font-mono text-slate-400 mb-0.5">CUBSO: {o.cod_cubso ?? String(o.id_cubso ?? '')}</p>
                                        )}
                                        <p className="text-xs font-semibold text-slate-700">{o.nom_razon_social || '—'}</p>
                                        <p className="text-[10px] text-slate-400">{o.cod_ruc || 'Sin RUC'}</p>
                                        <div className="flex gap-4 mt-1 text-[10px] text-slate-500">
                                          {o.precio_total    && <span><DollarSign size={9} className="inline"/>Total: <b>{formatMonto(o.precio_total)}</b></span>}
                                          {o.plazo_ejecucion && <span>Plazo: {o.plazo_ejecucion}</span>}
                                          {o.fec_cotiza      && <span>Fecha: {formatFecha(o.fec_cotiza)}</span>}
                                          {o.nom_estado_cotiza && <span className="ml-auto text-[10px] font-semibold text-slate-500">{o.nom_estado_cotiza}</span>}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                        {/* Archivos cotización */}
                        {/* Archivos cotización */}
                        {archCotizacion.length > 0 && (
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                              Documentos de cotización ({archCotizacion.length})
                            </p>
                            <div className="space-y-1.5">
                            {archCotizacion.map((a, i) => (
                                <ArchivoRow
                                  key={i}
                                  arch={a}
                                  idContrato={contract.id}
                                  selected={selectedDoc?.id_archivo === a.id_archivo}
                                  indexing={indexingId === a.id_archivo}
                                  filling={fillingId === a.id_archivo}
                                  onSelect={() => selectArchivo(a)}
                                  onFill={['docx','doc','pdf'].includes((a.extension ?? '').toLowerCase().replace('.',''))
                                    ? () => abrirFill(a)
                                    : undefined}
                                  onEdit={() => abrirOnlyOffice(a)}
                                />
                              ))}
                            </div>
                          </div>
                        )}

                      </div>
                    )}
                  </Section>
                )}

              </div>
            )}
          </div>

          {/* Chat panel */}
          {/* Chat panel */}
          {selectedDoc && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setSelectedDoc(null)}
                  className="p-1 rounded-lg hover:bg-blue-500 text-white/80 hover:text-white transition-colors"
                >
                  <ArrowLeft size={14} />
                </button>
                <MessageSquare size={12} className="text-white" />
                <div>
                  <p className="text-xs font-bold text-white">PLADIBOT Chatbot</p>
                  <p className="text-[10px] text-blue-200 truncate max-w-48">{selectedDoc.nombre}</p>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-hidden">
                {indexingId === selectedDoc.id_archivo ? (
                  <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
                    <Loader2 size={28} className="animate-spin text-blue-600" />
                    <div className="text-center">
                      <p className="text-sm font-semibold text-slate-600">Procesando documento…</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Generando fragmentos y embeddings para búsqueda
                      </p>
                    </div>
                    <div className="w-56 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full w-1/3 bg-blue-500 rounded-full animate-[loading_1.2s_ease-in-out_infinite]" />
                    </div>
                  </div>
                ) : (
                  <ChatPanel
                    documentId={selectedDoc.rag_document_id ?? null}
                    documentName={selectedDoc.nombre}
                    chunksCount={selectedDoc.chunks}
                  />
                )}
              </div>
            </div>
          )}

      </div>
      </div>

      {/* ── Modal editor de campos ─────────────────────────────────────── */}
      {fillPreview && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-slate-900/60" onClick={() => setFillPreview(null)} />
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">

          {/* Header modal */}
          <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-4 flex items-center gap-3">
            <PenLine size={18} className="text-white" />
            <div className="flex-1">
              <p className="text-sm font-bold text-white">Rellenar Documento</p>
              <p className="text-xs text-amber-100 truncate">{fillPreview.nombre}</p>
            </div>
            <button onClick={() => setFillPreview(null)} className="text-white/70 hover:text-white">
              <X size={16} />
            </button>
          </div>

          {/* Selector empresa */}
          {empresas.length > 1 && (
            <div className="px-5 pt-4 pb-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Empresa</label>
              <select
                value={empresaId ?? ''}
                onChange={e => setEmpresaId(Number(e.target.value))}
                className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
              >
                {empresas.map(e => (
                  <option key={e.id} value={e.id}>{e.razon_social}</option>
                ))}
              </select>
            </div>
          )}

          {/* Campos editables */}
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
            {fillPreview.campos.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">
                No se detectaron campos rellenables en este documento.
              </p>
            ) : (
              fillPreview.campos.map(c => (
                <div key={c.campo}>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {c.label}
                  </label>
                  {c.contexto && (
                    <p className="text-[10px] text-slate-300 mb-0.5 truncate">↳ {c.contexto}</p>
                  )}
                  <input
                    type="text"
                    value={fillValores[c.campo] ?? ''}
                    onChange={e => setFillValores(prev => ({ ...prev, [c.campo]: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                  />
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-slate-100 flex gap-3">
            <button
              onClick={() => setFillPreview(null)}
              className="flex-1 text-sm py-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleGenerar}
              disabled={generando || fillPreview.campos.length === 0}
              className="flex-1 text-sm py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {generando
                ? <><Loader2 size={14} className="animate-spin" /> Generando...</>
                : <><CheckCheck size={14} /> Descargar rellenado</>}
            </button>
          </div>
        </div>
      </div>
    )}
    {onlyOfficeDoc && (
        <OnlyOfficeEditor
          idContrato={contract.id}
          idArchivo={onlyOfficeDoc.idArchivo}
          nombre={onlyOfficeDoc.nombre}
          onClose={() => setOnlyOfficeDoc(null)}
        />
      )}
    </div>
  )
}



