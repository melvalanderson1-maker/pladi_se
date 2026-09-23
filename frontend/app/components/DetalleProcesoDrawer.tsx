'use client'

import { useEffect, useState } from 'react'
import {
  Building2, Calendar, FileText, Package, Phone, MapPin,
  Copy, Check, Download, X, TrendingUp, ChevronRight,
} from 'lucide-react'
import {
  getDetalleCompleto, getCronograma, urlDocumento, getAdjudicacion, getComparables,
  getPostores, refrescarPostores, urlDocumentoPostor,
  type DetalleCompleto, type CronogramaFase, type ProcesoSeace, type Adjudicacion,
  type Comparable, type PostoresResponse,
} from '@/lib/seace-api'

interface Props {
  ocid: string | null
  tenderId: string | null
  proceso?: ProcesoSeace | null
  onClose: () => void
}

// ── secciones del nav ─────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'cronograma', label: 'Cronograma' },
  { id: 'ofertas', label: 'Ofertas' },
  { id: 'comparables', label: 'Referencias' },
  { id: 'documentos', label: 'Documentos' },
]

// ── helpers de UI (estilo tomado del mockup) ─────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
      {children}
    </p>
  )
}

function SectionTitle({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-2">
      <Icon size={13} className="text-[#0B3D6E]" strokeWidth={2.5} />
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#0B3D6E]">{children}</h3>
    </div>
  )
}

function DrawerSkeleton() {
  return (
    <div className="space-y-4 p-5">
      {/* keyframes locales del shimmer — no depende del tailwind.config del proyecto */}
      <style>{`
        @keyframes seace-shimmer {
          0% { background-position: -420px 0; }
          100% { background-position: 420px 0; }
        }
        .seace-shimmer {
          background-image: linear-gradient(90deg, #f1f5f9 20%, #e5edf5 40%, #f1f5f9 60%);
          background-size: 840px 100%;
          animation: seace-shimmer 1.4s ease-in-out infinite;
        }
        @keyframes seace-orbit {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {/* indicador de carga */}
      <div className="flex items-center gap-3 pb-1">
        <div className="relative h-8 w-8 shrink-0">
          <span
            className="absolute inset-0 rounded-full border-2 border-slate-100 border-t-[#0B3D6E]"
            style={{ animation: 'seace-orbit 0.8s linear infinite' }}
          />
          <span className="absolute inset-[7px] rounded-full bg-[#0B3D6E]/10" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-700">Consultando SEACE…</p>
          <p className="text-[11px] text-slate-400">Trayendo entidad, cronograma y ofertas</p>
        </div>
      </div>

      <div className="h-5 w-4/5 seace-shimmer rounded" />
      <div className="h-3 w-1/2 seace-shimmer rounded" />

      <div className={`grid grid-cols-1 gap-3 lg:grid-cols-3`}>
        <div className="h-24 seace-shimmer rounded-lg lg:col-span-1" />
        <div className="h-24 seace-shimmer rounded-lg" />
        <div className="h-24 seace-shimmer rounded-lg" />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="h-14 seace-shimmer rounded-lg" />
        <div className="h-14 seace-shimmer rounded-lg" />
        <div className="h-14 seace-shimmer rounded-lg" />
      </div>

      <div className="h-24 w-full seace-shimmer rounded-lg" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="h-20 seace-shimmer rounded-lg" />
        <div className="h-20 seace-shimmer rounded-lg" />
      </div>
    </div>
  )
}

// ── fechas / lógica de negocio (idéntica a la original) ──────────────────────

// Acepta ISO ("2026-09-18T00:00:00") y formato SEACE ("19/09/2026 00:00")
function aDate(fecha: string | null | undefined): Date | null {
  if (!fecha) return null
  const m = fecha.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  const d = m
    ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
    : new Date(fecha)
  return Number.isNaN(d.getTime()) ? null : d
}

function tiempoRelativo(fecha: string | null | undefined) {
  const d = aDate(fecha)
  if (!d) return null
  const segundos = Math.round((d.getTime() - Date.now()) / 1000)
  const abs = Math.abs(segundos)
  const futuro = segundos > 0
  if (abs < 60) return futuro ? 'en instantes' : 'hace instantes'
  const minutos = Math.round(abs / 60)
  if (minutos < 60) return futuro ? `en ${minutos} min` : `hace ${minutos} min`
  const horas = Math.round(minutos / 60)
  if (horas < 24) return futuro ? `en ${horas} h` : `hace ${horas} h`
  const dias = Math.round(horas / 24)
  return futuro ? `en ${dias} día${dias === 1 ? '' : 's'}` : `hace ${dias} día${dias === 1 ? '' : 's'}`
}

function formatearFecha(fecha: string | null | undefined) {
  const d = aDate(fecha)
  if (!d) return '—'
  return d.toLocaleString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// "SIE-SIE-2-2026-MPA/OC-2" -> "2" | "CM-13058-2026-X" -> "13058"
function numeroDeNomenclatura(nom: string | null | undefined) {
  if (!nom) return null
  return nom.split('-').find(p => /^\d+$/.test(p)) ?? null
}

// una fase ya terminó si su fecha más tardía (inicio o fin) ya pasó
function faseTerminada(fase: CronogramaFase) {
  const ini = aDate(fase.fecha_inicio)?.getTime() ?? 0
  const fin = aDate(fase.fecha_fin)?.getTime() ?? 0
  const cierre = Math.max(ini, fin)
  return cierre > 0 && cierre < Date.now()
}

function StatusBadge({ estado }: { estado: string | null | undefined }) {
  const map: Record<string, { label: string; cls: string }> = {
    vigente: { label: 'Vigente', cls: 'bg-emerald-50 text-emerald-600 ring-emerald-200' },
    con_resultado: { label: 'Culminado', cls: 'bg-blue-50 text-blue-600 ring-blue-200' },
    vencido_sin_resultado: { label: 'Vencido', cls: 'bg-rose-50 text-rose-500 ring-rose-200' },
  }
  const { label, cls } = (estado && map[estado]) || { label: estado || '—', cls: 'bg-slate-50 text-slate-500 ring-slate-200' }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}

function etiquetaCategoria(categoria: string | null | undefined) {
  const key = (categoria || '').toLowerCase()
  const map: Record<string, string> = {
    goods: 'Bien', bien: 'Bien', bienes: 'Bien',
    services: 'Servicio', servicio: 'Servicio', servicios: 'Servicio',
    works: 'Obra', obra: 'Obra', obras: 'Obra',
    consultoriadeobra: 'Consultoría de obra',
  }
  return map[key] || null
}

// ── timeline horizontal (estilo mockup, alimentada con datos reales) ────────

interface FaseTimeline {
  etapa: string
  fecha: string
  pasada: boolean
  actual: boolean
  rel: string | null
}

function HorizontalTimeline({ fases }: { fases: FaseTimeline[] }) {
  return (
    <div className="w-full overflow-x-auto py-1">
      <div className="flex min-w-max items-start">
        {fases.map((fase, i) => {
          const isLast = i === fases.length - 1
          const dotColor = fase.actual ? '#F59E0B' : fase.pasada ? '#10B981' : '#CBD5E1'

          return (
            <div key={i} className="flex items-start">
              <div className="flex w-[112px] flex-col items-center">
                {/* conector + punto */}
                <div className="flex w-full items-center">
                  <div className={`h-px flex-1 ${i === 0 ? 'bg-transparent' : fase.pasada ? 'bg-emerald-300' : 'bg-slate-200'}`} />
                  <div
                    className="relative flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ring-4 ring-white"
                    style={{ background: dotColor }}
                  >
                    {fase.pasada && <Check size={9} strokeWidth={3} className="text-white" />}
                    {fase.actual && <span className="h-2 w-2 rounded-full bg-white" />}
                  </div>
                  <div className={`h-px flex-1 ${isLast ? 'bg-transparent' : 'bg-slate-200'}`} />
                </div>

                {/* texto */}
                <div className="mt-2 flex flex-col items-center text-center">
                  <p className={`text-[10px] font-semibold leading-tight ${
                    fase.actual ? 'text-slate-900' : fase.pasada ? 'text-slate-400' : 'text-slate-500'
                  }`}>
                    {fase.etapa}
                  </p>
                  <p className="mt-0.5 text-[9px] leading-tight text-slate-400">{fase.fecha}</p>
                  {fase.rel && (
                    <span className={`mt-1 rounded-full px-1.5 py-0.5 text-[8px] font-semibold ${
                      fase.actual ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {fase.rel}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── componente principal ─────────────────────────────────────────────────────

export default function DetalleProcesoDrawer({ ocid, tenderId, proceso, onClose }: Props) {
  const [data, setData] = useState<DetalleCompleto | null>(null)
  const [loading, setLoading] = useState(true)
  const [cronograma, setCronograma] = useState<CronogramaFase[]>([])
  const [copiado, setCopiado] = useState(false)
  const [adjudicacion, setAdjudicacion] = useState<Adjudicacion | null>(null)
  const [comparables, setComparables] = useState<Comparable[]>([])
  const [postoresData, setPostoresData] = useState<PostoresResponse | null>(null)
  const [activeSection, setActiveSection] = useState('resumen')

  // adelantados aquí (antes estaban más abajo) porque el useEffect de
  // postores los necesita en su array de dependencias
  const t = data?.tender
  const nomenclatura = proceso?.nomenclatura || proceso?.tender_id || tenderId || t?.title

  useEffect(() => {
    if (!ocid) return
    setData(null)
    setLoading(true)
    getDetalleCompleto(ocid)
      .then(setData)
      .finally(() => setLoading(false))
  }, [ocid])

  useEffect(() => {
    if (!tenderId) {
      setCronograma([])
      return
    }
    getCronograma(tenderId)
      .then(res => setCronograma(res.fases))
      .catch(() => setCronograma([]))
  }, [tenderId])

  useEffect(() => {
    if (!ocid) {
      setAdjudicacion(null)
      return
    }
    getAdjudicacion(ocid)
      .then(setAdjudicacion)
      .catch(() => setAdjudicacion(null))
  }, [ocid])

  useEffect(() => {
    if (!ocid) {
      setComparables([])
      return
    }
    getComparables(ocid)
      .then(res => setComparables(res.comparables))
      .catch(() => setComparables([]))
  }, [ocid])

  useEffect(() => {
    if (!ocid || !nomenclatura) {
      setPostoresData(null)
      return
    }
    let cancelado = false
    let intervalo: ReturnType<typeof setInterval> | null = null

    const cargar = () => {
      getPostores(ocid, nomenclatura)
        .then(res => {
          if (cancelado) return
          setPostoresData(res)
          if (res.estado === 'en_progreso' || res.estado === 'pendiente') {
            if (!intervalo) intervalo = setInterval(cargar, 3000)
          } else if (intervalo) {
            clearInterval(intervalo)
            intervalo = null
          }
        })
        .catch(() => { if (!cancelado) setPostoresData(null) })
    }
    cargar()

    return () => {
      cancelado = true
      if (intervalo) clearInterval(intervalo)
    }
  }, [ocid, nomenclatura])

  useEffect(() => {
    if (!ocid) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [ocid, onClose])

  const open = !!ocid
  const party = data?.parties?.[0]
  const numero = numeroDeNomenclatura(nomenclatura)

  const entidadNombre = data?.buyer?.name ?? data?.detalle_ficha?.entidad_convocante ?? proceso?.entidad
  const direccion = party?.address
    ? [party.address.streetAddress, party.address.locality, party.address.region].filter(Boolean).join(', ')
    : data?.detalle_ficha?.direccion_legal
  const telefono = party?.contactPoint?.telephone ?? data?.detalle_ficha?.telefono_entidad
  const descripcion = data?.detalle_ficha?.descripcion_objeto_completa ?? t?.description ?? proceso?.titulo
  const objeto = etiquetaCategoria(proceso?.categoria) ?? data?.detalle_ficha?.tipo_compra_seleccion

  // ---- cronograma → tarjetas de fechas ----
  const ahora = Date.now()

  // "Convocatoria" (licitaciones, SIE, CP) o "Invitación" (contratación directa)
  const etapaConvocatoria = cronograma.find(f => /^(convocatoria|invitaci)/i.test(f.etapa))

  // 1) la que SEACE marca activa; 2) si no hay, la que cubre la hora actual
  const etapaActual =
    cronograma.find(f => !!f.es_etapa_actual) ??
    cronograma.find(f => {
      const ini = aDate(f.fecha_inicio)?.getTime()
      const fin = aDate(f.fecha_fin)?.getTime()
      return !!ini && !!fin && ini <= ahora && ahora <= fin
    })

  // si no hay etapa activa, la siguiente que aún no empieza
  const etapaProxima = etapaActual
    ? undefined
    : cronograma.find(f => (aDate(f.fecha_inicio)?.getTime() ?? 0) > ahora)

  // "Buena Pro" (licitaciones/SIE/CP) o "Adjudicación" (contratación directa)
  const invertido = [...cronograma].reverse()
  const etapaFinal =
    invertido.find(f => /buena pro/i.test(f.etapa)) ??
    invertido.find(f => /adjudicaci/i.test(f.etapa))
  const etiquetaFinal = etapaFinal && !/buena pro/i.test(etapaFinal.etapa) ? 'Adjudicación' : 'Buena Pro'

  const esFaseActual = (f: CronogramaFase) => !!f.es_etapa_actual || f === etapaActual

  // primera fecha que SÍ sea válida (ya no gana un texto inválido)
  const fechaPublicacion = [
    etapaConvocatoria?.fecha_inicio,
    data?.detalle_ficha?.fecha_hora_publicacion_detalle,
    proceso?.published_date,
    t?.tenderPeriod?.startDate,
    cronograma[0]?.fecha_inicio,
  ].find(f => aDate(f))

  const abierto = !!etapaActual

  const docBasesScraper = data?.documentos_scraper?.find(d => d.ruta_local && /bases/i.test(d.documento))
  const documentoDescargable =
    t?.documents?.[0] ??
    (ocid && docBasesScraper ? { url: urlDocumento(ocid, docBasesScraper.nro) } : undefined)

  // datos ya calculados para la timeline horizontal
  const timelineFases: FaseTimeline[] = cronograma.map(fase => {
    const actual = esFaseActual(fase)
    const pasada = !actual && faseTerminada(fase)
    const ini = aDate(fase.fecha_inicio)
    const fin = aDate(fase.fecha_fin)
    const fecha =
      ini && fin && fin.getTime() > ini.getTime()
        ? `${formatearFecha(fase.fecha_inicio)} → ${formatearFecha(fase.fecha_fin)}`
        : formatearFecha(fase.fecha_inicio ?? fase.fecha_fin)
    const rel = actual ? 'En curso' : !pasada ? tiempoRelativo(fase.fecha_inicio) : null
    return { etapa: fase.etapa, fecha, pasada, actual, rel }
  })

  // lista unificada de documentos (OCDS si existe, si no el fallback del scraper)
  // para mostrarla compacta al costado del resumen
  type DocRow = { key: string; title: string; sub?: string; url?: string }
  const documentosList: DocRow[] = t?.documents?.length
    ? t.documents.map(d => ({ key: d.id, title: d.title, sub: d.format, url: d.url }))
    : (data?.documentos_scraper?.length
        ? data.documentos_scraper.map((d, idx) => ({
            key: String(idx),
            title: d.documento,
            sub: `${d.etapa}${d.fecha_publicacion ? ' · ' + d.fecha_publicacion : ''}`,
            url: d.ruta_local && ocid ? urlDocumento(ocid, d.nro) : undefined,
          }))
        : [])

  const copiarNomenclatura = async () => {
    if (!nomenclatura) return
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(nomenclatura)
      } else {
        // fallback para http:// / contextos no seguros donde
        // navigator.clipboard no existe o está bloqueado
        const textarea = document.createElement('textarea')
        textarea.value = nomenclatura
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch (e) {
      console.error('No se pudo copiar la nomenclatura', e)
    }
  }

  const scrollTo = (id: string) => {
    setActiveSection(id)
    document.getElementById(`drawer-sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className={`fixed inset-0 z-50 ${open ? 'pointer-events-auto' : 'pointer-events-none'}`} aria-hidden={!open}>
      {/* overlay */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-[#0B3D6E]/25 backdrop-blur-[2px] transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* panel */}
      <div
        role="dialog"
        aria-modal="true"
        className={`absolute right-0 top-0 flex h-full w-full max-w-[1100px] flex-col bg-white transition-transform duration-300 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ boxShadow: '-4px 0 40px rgba(0,0,0,0.08)' }}
      >
        {/* cabecera */}
        <div className="relative shrink-0 border-b border-slate-100 px-5 py-4">
          <button
            onClick={onClose}
            className="absolute right-5 top-4 shrink-0 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>

          <div className={`grid grid-cols-1 gap-3 pr-8 ${!loading && data && !data.error ? 'lg:grid-cols-3' : ''}`}>
            {/* col 1: título del proceso */}
            <div className="min-w-0">
              <Label>Detalle del proceso</Label>
              <h2 className="mt-1 break-words text-lg font-semibold leading-snug text-slate-900">
                {loading ? 'Cargando…' : (nomenclatura || 'Proceso')}
              </h2>
              {numero && <p className="mt-0.5 text-xs text-slate-400">N° {numero}</p>}
            </div>

            {/* col 2: etapa en curso + acciones */}
            {!loading && data && !data.error && (
              <div className="space-y-2">
                <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${abierto ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white shadow-sm'}`}>
                  <Label>¿Etapa en curso?</Label>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${abierto ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {abierto ? 'Sí, hay etapa activa' : 'Sin etapa activa'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={copiarNomenclatura}
                    className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    {copiado ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                    {copiado ? 'Copiado' : 'Copiar nomenclatura'}
                  </button>
                </div>
              </div>
            )}

            {/* col 3: buena pro otorgada */}
            {!loading && data && !data.error && adjudicacion && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-2">
                <Label>Buena Pro otorgada</Label>
                <p className="mt-1 text-sm font-semibold text-slate-900">{adjudicacion.proveedor || '—'}</p>
                {adjudicacion.proveedor_ruc && (
                  <p className="text-[11px] text-slate-400">RUC {adjudicacion.proveedor_ruc}</p>
                )}
                <p className="mt-1 text-sm font-bold text-emerald-700">
                  {adjudicacion.monto != null
                    ? `${adjudicacion.moneda === 'USD' ? 'US$' : 'S/'} ${adjudicacion.monto.toLocaleString('es-PE')}`
                    : 'Monto no especificado'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* nav de secciones */}
        {!loading && data && !data.error && (
          <div className="shrink-0 flex gap-0 overflow-x-auto border-b border-slate-100 px-5">
            {SECTIONS.map(sec => (
              <button
                key={sec.id}
                onClick={() => scrollTo(sec.id)}
                className={`shrink-0 border-b-2 px-3 py-2.5 text-[11px] font-medium transition-colors ${
                  activeSection === sec.id
                    ? 'border-[#0B3D6E] text-[#0B3D6E]'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                {sec.label}
              </button>
            ))}
          </div>
        )}

        {/* cuerpo */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <DrawerSkeleton />
          ) : !data || data.error ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No se pudo cargar el detalle de este proceso.
            </div>
          ) : (
            <div className="space-y-5 px-5 py-5">

              {/* resumen */}
              <section id="drawer-sec-resumen">
                <div className={`grid grid-cols-1 gap-3 ${documentosList.length ? 'lg:grid-cols-2 lg:items-stretch' : ''}`}>
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 shadow-sm px-4 py-3">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <Label>Entidad</Label>
                        <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                          <Building2 size={14} className="shrink-0 text-[#0B3D6E]" />
                          {entidadNombre || '—'}
                        </p>
                      </div>
                      {proceso?.estado && <StatusBadge estado={proceso.estado} />}
                    </div>

                    {(objeto || (proceso as any)?.region) && (
                      <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                        <div>
                          <Label>Objeto</Label>
                          <p className="mt-0.5 text-sm text-slate-700">{objeto || '—'}</p>
                        </div>
                        <div>
                          <Label>Ámbito</Label>
                          <p className="mt-0.5 text-sm text-slate-700">{(proceso as any)?.region || '—'}</p>
                        </div>
                      </div>
                    )}

                    <div className="border-t border-slate-100 pt-3">
                      <Label>Descripción</Label>
                      <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{descripcion || '—'}</p>
                    </div>

                    {((proceso as any)?.departamento || (proceso as any)?.distrito) && (
                      <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                        {(proceso as any)?.departamento && (proceso as any).departamento !== (proceso as any)?.region && (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                            {(proceso as any).departamento}
                          </span>
                        )}
                        {(proceso as any)?.distrito && (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                            {(proceso as any).distrito}
                          </span>
                        )}
                      </div>
                    )}

                    {(direccion || telefono) && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
                        {direccion && (
                          <span className="flex items-center gap-1"><MapPin size={11} /> {direccion}</span>
                        )}
                        {telefono && (
                          <span className="flex items-center gap-1"><Phone size={11} /> {telefono}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* documentos, al costado del resumen (matriz 1x2) */}
                {documentosList.length > 0 && (
                  <div id="drawer-sec-documentos" className="flex h-full flex-col rounded-lg border border-slate-200 bg-white shadow-sm px-3 py-3">
                    <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-1.5">
                        <FileText size={13} className="text-[#0B3D6E]" strokeWidth={2.5} />
                        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#0B3D6E]">Documentos</h3>
                        <span className="text-[10px] text-slate-400">({documentosList.length})</span>
                      </div>
                      {documentoDescargable?.url && (
                        <a
                          href={documentoDescargable.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex shrink-0 items-center gap-1 rounded-full bg-[#0B3D6E] px-2.5 py-1 text-[10px] font-semibold text-white transition-opacity hover:opacity-90"
                        >
                          <Download size={10} /> Descargar bases
                        </a>
                      )}
                    </div>
                    <div className={`space-y-1 ${documentosList.length > 4 ? 'max-h-56 overflow-y-auto pr-1' : ''}`}>
                      {documentosList.map(doc => (
                        doc.url ? (
                          <a
                            key={doc.key}
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[12px] text-[#0B3D6E] transition-colors hover:bg-slate-50"
                          >
                            <FileText size={12} className="shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                            {doc.sub && <span className="shrink-0 text-[9px] text-slate-400">{doc.sub}</span>}
                            <ChevronRight size={11} className="shrink-0 text-slate-300" />
                          </a>
                        ) : (
                          <div key={doc.key} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[12px] text-slate-500">
                            <FileText size={12} className="shrink-0 text-slate-300" />
                            <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                            <span className="shrink-0 text-[9px] font-medium uppercase text-slate-300">Sin archivo</span>
                          </div>
                        )
                      ))}
                    </div>
                  </div>
                )}
                </div>

                {/* tarjetas de fechas */}
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-white shadow-sm px-3 py-2.5 text-center">
                    <Label>Publicación</Label>
                    <p className="mt-1 text-[13px] font-semibold leading-snug text-slate-900">{formatearFecha(fechaPublicacion)}</p>
                    {tiempoRelativo(fechaPublicacion) && (
                      <p className="mt-0.5 text-[10px] text-slate-400">{tiempoRelativo(fechaPublicacion)}</p>
                    )}
                  </div>

                  <div className={`rounded-lg border px-3 py-2.5 text-center ${etapaActual ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-white shadow-sm'}`}>
                    <Label>{etapaActual || !etapaProxima ? 'Etapa actual' : 'Próxima etapa'}</Label>
                    <p className="mt-1 text-[13px] font-semibold leading-snug text-slate-900">
                      {(etapaActual ?? etapaProxima)?.etapa || '—'}
                    </p>
                    {etapaActual?.fecha_fin && (
                      <p className="mt-0.5 text-[10px] text-slate-400">hasta {formatearFecha(etapaActual.fecha_fin)}</p>
                    )}
                    {!etapaActual && etapaProxima && (
                      <p className="mt-0.5 text-[10px] text-slate-400">inicia {tiempoRelativo(etapaProxima.fecha_inicio)}</p>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white shadow-sm px-3 py-2.5 text-center">
                    <Label>{etiquetaFinal}</Label>
                    <p className="mt-1 text-[13px] font-semibold leading-snug text-slate-900">{formatearFecha(etapaFinal?.fecha_inicio)}</p>
                    {tiempoRelativo(etapaFinal?.fecha_inicio) && (
                      <p className="mt-0.5 text-[10px] text-slate-400">{tiempoRelativo(etapaFinal?.fecha_inicio)}</p>
                    )}
                  </div>
                </div>

              </section>

              {/* cronograma — timeline horizontal */}
              {!!cronograma.length && (
                <section id="drawer-sec-cronograma">
                  <SectionTitle icon={Calendar}>Cronograma del proceso</SectionTitle>
                  <div className="rounded-lg border border-slate-200 bg-white shadow-sm px-3 py-3">
                    <HorizontalTimeline fases={timelineFases} />
                  </div>
                </section>
              )}

              {/* items del tender (si existen) */}
              {!!t?.items?.length && (
                <section className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 shadow-sm">
                  <SectionTitle icon={Package}>Items</SectionTitle>
                  <ul className="space-y-2">
                    {t.items.map(item => (
                      <li key={item.id} className="rounded-lg border border-slate-200 bg-white shadow-sm px-4 py-3 text-sm text-slate-700">
                        {item.description}{' '}
                        <span className="font-medium text-slate-900">
                          — {item.quantity} {item.unit?.name ?? ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* cuadro comparativo de ofertas + precios de referencia, en 2 columnas */}
              <div className={`grid grid-cols-1 gap-3 ${comparables.length ? 'lg:grid-cols-2' : ''}`}>
              <section id="drawer-sec-ofertas" className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 shadow-sm">
                <SectionTitle icon={Package}>Ofertas presentadas en este proceso</SectionTitle>

                {(!postoresData || postoresData.estado === 'pendiente' || postoresData.estado === 'en_progreso') && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/60 shadow-sm px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="relative flex h-3.5 w-3.5 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0B3D6E]/40" />
                        <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-[#0B3D6E]" />
                      </span>
                      <p className="text-sm font-medium text-slate-700">
                        {postoresData?.paso || 'Iniciando búsqueda en SEACE…'}
                      </p>
                    </div>
                    {!!postoresData?.total_postores && (
                      <div className="mt-3">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-[#0B3D6E] transition-all duration-500"
                            style={{ width: `${Math.min(100, ((postoresData.postor_actual || 0) / postoresData.total_postores) * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-right text-[10px] text-slate-400">
                          {postoresData.postor_actual || 0} / {postoresData.total_postores}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {postoresData?.estado === 'sin_ofertas' && (
                  <p className="rounded-lg border border-slate-200 bg-white shadow-sm px-4 py-3 text-sm text-slate-500">
                    Este proceso aún no tiene ofertas presentadas registradas en SEACE.
                  </p>
                )}

                {postoresData?.estado === 'error' && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                    <span>No se pudo obtener el cuadro comparativo{postoresData.error ? `: ${postoresData.error}` : '.'}</span>
                    <button
                      onClick={() => ocid && nomenclatura && refrescarPostores(ocid, nomenclatura).then(setPostoresData)}
                      className="shrink-0 rounded-full bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-rose-700"
                    >
                      Reintentar
                    </button>
                  </div>
                )}

                {postoresData?.estado === 'listo' && postoresData.postores.length === 0 && (
                  <p className="rounded-lg border border-slate-200 bg-white shadow-sm px-4 py-3 text-sm text-slate-500">
                    Aún no hay ofertas registradas para este proceso.
                  </p>
                )}

                {postoresData?.estado === 'listo' && postoresData.postores.length > 0 && (
                  <div className={`space-y-2 ${postoresData.postores.length > 3 ? 'max-h-80 overflow-y-auto pr-1' : ''}`}>
                    {postoresData.postores.map((postor, i) => (
                      <div key={i} className="rounded-lg border border-slate-200 bg-white shadow-sm px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[13px] font-semibold text-slate-900">{postor.razon_social || '—'}</p>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              RUC {postor.ruc || '—'}{postor.consorcio === 'Si' ? ' · Consorcio' : ''}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-base font-bold text-emerald-600">
                              S/ {postor.monto_total.toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                            </p>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              {postor.estado_propuesta || '—'}
                            </p>
                          </div>
                        </div>

                        {!!postor.documentos.length && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-slate-50 pt-2.5">
                            {postor.documentos.map((doc, j) => (
                              <a
                                key={j}
                                href={ocid && postor.ruc ? urlDocumentoPostor(ocid, postor.ruc, doc.nombre) : '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10px] font-medium text-[#0B3D6E] transition-colors hover:bg-blue-50"
                              >
                                <FileText size={10} /> {doc.nombre}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* precios de referencia */}
              {!!comparables.length && (
                <section id="drawer-sec-comparables" className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 shadow-sm">
                  <SectionTitle icon={TrendingUp}>Ganadores de contrataciones similares</SectionTitle>
                  <p className="mb-3 text-[11px] text-slate-400">Precios y proveedores que ganaron procesos parecidos a este</p>
                  <div className={`space-y-2 ${comparables.length > 3 ? 'max-h-80 overflow-y-auto pr-1' : ''}`}>
                    {comparables.map((c, idx) => (
                      <div key={idx} className="rounded-lg border border-slate-200 bg-white shadow-sm px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold text-slate-900">{c.proveedor || '—'}</p>
                            <p className="mt-0.5 text-[11px] text-slate-500">{c.entidad}</p>
                            <p className="mt-0.5 text-[11px] text-slate-400">{c.descripcion}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[13px] font-bold text-emerald-600">
                              S/ {c.precio_unitario?.toLocaleString('es-PE', { maximumFractionDigits: 2 })}
                            </p>
                            <p className="text-[10px] text-slate-400">por {c.unidad || 'unidad'}</p>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between border-t border-slate-50 pt-2 text-[10px] text-slate-400">
                          <span>{c.nomenclatura}</span>
                          <span>{formatearFecha(c.fecha_adjudicacion)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              </div>

              <div className="h-6" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}