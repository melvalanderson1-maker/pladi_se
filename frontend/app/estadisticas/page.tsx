'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend, AreaChart, Area, LabelList,
} from 'recharts'
import {
  BarChart3, Building2, TrendingUp, Loader2, AlertCircle,
  CheckCircle2, Clock, XCircle, Layers, MapPin, Package,
  CalendarRange, Filter, ShoppingBag,
} from 'lucide-react'
import { SidebarTrigger } from '@/components/Sidebar'
import { getStatsContratos, getContratos, type StatsContratos, type ContratoResumen } from '@/lib/api'
import {
  getStatsEntidades, getStatsGeografia, getStatsProductos, getStatsTimeline, getStatsObjeto,
  getStatsProveedores,
  getOpcionesFiltro, getProvinciasPorDepartamento, getDistritosPorProvincia,
  buscarEntidades, buscarProveedores, buscarProductos,
  type EntidadStat, type GeografiaStat, type ProductoStat, type TimelineStat, type ObjetoStat,
  type ProveedorStat, type OpcionesFiltro,
} from '@/lib/api-stats'

const COLORS = { vigente: '#10b981', en_evaluacion: '#8b5cf6', culminado: '#f43f5e', otros: '#94a3b8' }
const PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#06b6d4', '#ec4899', '#84cc16']

// ─── Helpers ────────────────────────────────────────────────────────────

function truncate(str: string, max: number) {
  if (!str) return ''
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}

function formatPeriodo(periodo: string) {
  const [anio, mes] = periodo.split('-')
  const nombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const idx = parseInt(mes, 10) - 1
  return `${nombres[idx] ?? mes} ${anio.slice(2)}`
}

// Clase visual: resalta y hace parpadear un filtro cuando está activo (distinto del valor por defecto)
function claseFiltro(activo: boolean) {
  return activo
    ? 'border-blue-400 ring-2 ring-blue-300/70 bg-blue-50 animate-pulse'
    : 'border-slate-200 bg-white'
}

// Tick personalizado para el eje Y: trunca el nombre y evita el solapamiento
function TruncatedTick({ x, y, payload, width = 150 }: any) {
  const text = truncate(String(payload.value), 22)
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="#475569" fontSize={11} width={width}>
      {text}
    </text>
  )
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const tituloCompleto = payload[0]?.payload?.nombreCompleto ?? label
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs max-w-xs">
      <p className="font-bold text-slate-800 mb-1 break-words">{tituloCompleto}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="flex items-center gap-1.5" style={{ color: p.color || p.fill }}>
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          {p.name}: <span className="font-bold text-slate-700">{Number(p.value).toLocaleString()}</span>
        </p>
      ))}
    </div>
  )
}

// ─── Componentes de UI ─────────────────────────────────────────────────

function KpiCard({ label, value, icon, color, loading }: {
  label: string; value: number; icon: React.ReactNode; color: string; loading: boolean
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4 flex items-center gap-4 hover:shadow-md transition-shadow">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>{icon}</div>
      <div className="min-w-0">
        {loading
          ? <div className="h-7 w-12 bg-slate-100 rounded animate-pulse mb-1" />
          : <p className="text-2xl font-extrabold text-slate-800 truncate">{value.toLocaleString()}</p>}
        <p className="text-xs text-slate-500 font-medium">{label}</p>
      </div>
    </div>
  )
}

function ChartCard({ title, icon, children, loading, empty }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; loading: boolean; empty?: boolean
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col">
      <p className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
        {icon} {title}
      </p>
      {loading ? (
        <div className="h-72 flex items-center justify-center text-slate-400">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : empty ? (
        <div className="h-72 flex flex-col items-center justify-center text-slate-300 gap-2">
          <AlertCircle size={22} />
          <p className="text-xs text-slate-400">Sin datos para mostrar</p>
        </div>
      ) : children}
    </div>
  )
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}



function AutocompleteFiltro({ label, value, onChange, buscar, placeholder, activo = false }: {
  label: string
  value: string
  onChange: (v: string) => void
  buscar: (q: string) => Promise<string[]>
  placeholder: string
  activo?: boolean
}) {
  const [texto, setTexto] = useState(value)
  const [sugerencias, setSugerencias] = useState<string[]>([])
  const [abierto, setAbierto] = useState(false)

  useEffect(() => { setTexto(value) }, [value])

  useEffect(() => {
    const timeout = setTimeout(() => {
      onChange(texto)
      if (texto.trim().length >= 2) {
        buscar(texto).then((r) => { setSugerencias(r); setAbierto(true) })
      } else {
        setSugerencias([])
      }
    }, 400)
    return () => clearTimeout(timeout)
  }, [texto])

  return (
    <div className="flex flex-col gap-1 relative">
      <label className="text-[11px] font-semibold text-slate-500">{label}</label>
      <div className="relative">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onFocus={() => sugerencias.length && setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          placeholder={placeholder}
          className={`border rounded-lg px-2 py-1.5 pr-7 text-sm w-44 transition-colors ${claseFiltro(activo)}`}
        />
        {texto && (
          <button
            type="button"
            onClick={() => { setTexto(''); onChange(''); setSugerencias([]) }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
          >
            ✕
          </button>
        )}
      </div>
      {abierto && sugerencias.length > 0 && (
        <ul className="absolute top-full mt-1 left-0 w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-52 overflow-auto">
          {sugerencias.map((s) => (
            <li key={s}
              onMouseDown={() => { setTexto(s); onChange(s); setAbierto(false) }}
              className="px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Página ─────────────────────────────────────────────────────────────

export default function EstadisticasPage() {
  const [stats, setStats] = useState<StatsContratos | null>(null)
  const [entidades, setEntidades] = useState<EntidadStat[]>([])
  const [geografia, setGeografia] = useState<GeografiaStat[]>([])
  const [productos, setProductos] = useState<ProductoStat[]>([])
  const [timeline, setTimeline] = useState<TimelineStat[]>([])
  const [objeto, setObjeto] = useState<ObjetoStat[]>([])
  const [proveedores, setProveedores] = useState<ProveedorStat[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filtros
  const [filtros, setFiltros] = useState({
    anio: 'todos', estado: 'todos', resultado: '', objeto: '',
    entidad: '', proveedor: '', departamento: '', provincia: '', distrito: '', producto: '',
  })
  const [soloAdjudicados, setSoloAdjudicados] = useState(false)
  const [opciones, setOpciones] = useState<OpcionesFiltro | null>(null)
  const [provinciasDisp, setProvinciasDisp] = useState<string[]>([])
  const [distritosDisp, setDistritosDisp] = useState<string[]>([])

  useEffect(() => { getOpcionesFiltro().then(setOpciones).catch(() => {}) }, [])

  // Cascada: al cambiar departamento, recarga provincias y limpia provincia/distrito
  useEffect(() => {
    if (!filtros.departamento) { setProvinciasDisp([]); setDistritosDisp([]); return }
    getProvinciasPorDepartamento(filtros.departamento).then(setProvinciasDisp).catch(() => setProvinciasDisp([]))
    setFiltros(f => ({ ...f, provincia: '', distrito: '' }))
  }, [filtros.departamento])

  // Cascada: al cambiar provincia, recarga distritos y limpia distrito
  useEffect(() => {
    if (!filtros.departamento) return
    getDistritosPorProvincia(filtros.departamento, filtros.provincia || undefined)
      .then(setDistritosDisp).catch(() => setDistritosDisp([]))
    setFiltros(f => ({ ...f, distrito: '' }))
  }, [filtros.provincia])




  const anioOptions = useMemo(() => {
    const actual = new Date().getFullYear()
    const arr = [{ value: 'todos', label: 'Todos los años' }]
    for (let y = actual; y >= actual - 6; y--) arr.push({ value: String(y), label: String(y) })
    return arr
  }, [])

useEffect(() => {
  async function load() {
    setLoading(true)
    setError(null)
    try {
      const f = {
        anio: filtros.anio !== 'todos' ? parseInt(filtros.anio, 10) : undefined,
        estado: filtros.estado !== 'todos' ? filtros.estado : undefined,
        resultado: filtros.resultado || undefined,
        objeto: filtros.objeto ? parseInt(filtros.objeto, 10) : undefined,
        entidad: filtros.entidad || undefined,
        proveedor: filtros.proveedor || undefined,
        departamento: filtros.departamento || undefined,
        provincia: filtros.provincia || undefined,
        distrito: filtros.distrito || undefined,
        producto: filtros.producto || undefined,
      }
      const [s, ent, geo, prod, tl, obj, prov] = await Promise.all([
        getStatsContratos(f),
        getStatsEntidades({ limit: 10, ...f }),
        getStatsGeografia({ limit: 10, ...f }),
        getStatsProductos({ limit: 10, solo_adjudicados: soloAdjudicados, ...f }),
        getStatsTimeline(f),
        getStatsObjeto(f),
        getStatsProveedores({ limit: 10, ...f }),
      ])
      setStats(s); setEntidades(ent); setGeografia(geo)
      setProductos(prod); setTimeline(tl); setObjeto(obj); setProveedores(prov)
    } catch {
      setError('No se pudo conectar al backend. Verifica que la API esté disponible.')
    } finally {
      setLoading(false)
    }
  }
  load()
}, [filtros, soloAdjudicados])

  const estadoData = stats ? [
    { name: 'Vigentes',    value: stats.vigentes,      color: COLORS.vigente },
    { name: 'Evaluación',  value: stats.en_evaluacion, color: COLORS.en_evaluacion },
    { name: 'Culminados',  value: stats.culminados,    color: COLORS.culminado },
  ] : []

  const entidadesChartData = entidades.map((e) => ({
    ...e,
    nombreCorto: truncate(e.nom_entidad, 36),
    nombreCompleto: e.nom_entidad,
  }))

  const timelineChartData = timeline.map((t) => ({ ...t, periodoCorto: formatPeriodo(t.periodo) }))

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-gradient-to-r from-slate-900 via-slate-800 to-blue-900 shadow-xl sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center gap-3 flex-wrap">
          <SidebarTrigger className="lg:hidden" />
          <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/40">
            <BarChart3 size={20} className="text-white" />
          </div>
          <div className="mr-auto">
            <h1 className="text-white font-extrabold text-xl tracking-tight">Estadísticas</h1>
            <p className="text-white/70 text-[10px] font-medium uppercase tracking-wider">Panorama general de contratos</p>
          </div>


        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-4 space-y-4">
        {error && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <AlertCircle size={16} className="shrink-0" /> {error}
          </div>
        )}


      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">

          {/* Grupo: periodo / estado / tipo */}
          <div className="flex items-end gap-2 pr-5 border-r border-slate-100">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Año</label>
              <select value={filtros.anio} onChange={(e) => setFiltros(f => ({ ...f, anio: e.target.value }))}
                className={`border rounded-lg px-2 py-1 text-[13px] transition-colors ${claseFiltro(filtros.anio !== 'todos')}`}>
                {anioOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Estado</label>
              <select value={filtros.estado}
                onChange={(e) => setFiltros(f => ({ ...f, estado: e.target.value, resultado: '' }))}
                className={`border rounded-lg px-2 py-1 text-[13px] transition-colors ${claseFiltro(filtros.estado !== 'todos')}`}>
                <option value="todos">Todos</option>
                <option value="vigente">Vigentes</option>
                <option value="en_evaluacion">En evaluación</option>
                <option value="culminado">Culminados</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tipo</label>
              <select value={filtros.objeto}
                onChange={(e) => setFiltros(f => ({ ...f, objeto: e.target.value }))}
                className={`border rounded-lg px-2 py-1 text-[13px] transition-colors ${claseFiltro(!!filtros.objeto)}`}>
                <option value="">Todo tipo</option>
                <option value="1">Bienes</option>
                <option value="2">Servicios</option>
                <option value="3">Obra</option>
                <option value="4">Consultoría de Obra</option>
              </select>
            </div>

            {filtros.estado === 'culminado' && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Resultado</label>
                <select value={filtros.resultado}
                  onChange={(e) => setFiltros(f => ({ ...f, resultado: e.target.value }))}
                  className={`border rounded-lg px-2 py-1 text-[13px] transition-colors ${claseFiltro(!!filtros.resultado)}`}>
                  <option value="">Todos</option>
                  <option value="adjudicado">Adjudicados</option>
                  <option value="desierto">Desiertos</option>
                </select>
              </div>
            )}
          </div>

          {/* Grupo: búsqueda por texto */}
          <div className="flex items-end gap-2 pr-5 border-r border-slate-100">
            <AutocompleteFiltro label="Entidad" value={filtros.entidad}
              onChange={(v) => setFiltros(f => ({ ...f, entidad: v }))}
              buscar={buscarEntidades} placeholder="Buscar entidad..." activo={!!filtros.entidad} />

            <AutocompleteFiltro label="Proveedor" value={filtros.proveedor}
              onChange={(v) => setFiltros(f => ({ ...f, proveedor: v }))}
              buscar={buscarProveedores} placeholder="Buscar proveedor..." activo={!!filtros.proveedor} />

            <AutocompleteFiltro label="Producto" value={filtros.producto}
              onChange={(v) => setFiltros(f => ({ ...f, producto: v }))}
              buscar={buscarProductos} placeholder="Buscar producto..." activo={!!filtros.producto} />
          </div>

          {/* Grupo: ubicación geográfica */}
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Departamento</label>
              <select value={filtros.departamento} onChange={(e) => setFiltros(f => ({ ...f, departamento: e.target.value }))}
                className={`border rounded-lg px-2 py-1 text-[13px] transition-colors ${claseFiltro(!!filtros.departamento)}`}>
                <option value="">Todos</option>
                {opciones?.departamentos.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Provincia</label>
              <select value={filtros.provincia} disabled={!filtros.departamento}
                onChange={(e) => setFiltros(f => ({ ...f, provincia: e.target.value }))}
                className={`border rounded-lg px-2 py-1 text-[13px] disabled:bg-slate-50 disabled:text-slate-300 transition-colors ${claseFiltro(!!filtros.provincia)}`}>
                <option value="">{filtros.departamento ? 'Todas' : '—'}</option>
                {provinciasDisp.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Distrito</label>
              <select value={filtros.distrito} disabled={!filtros.departamento}
                onChange={(e) => setFiltros(f => ({ ...f, distrito: e.target.value }))}
                className={`border rounded-lg px-2 py-1 text-[13px] disabled:bg-slate-50 disabled:text-slate-300 transition-colors ${claseFiltro(!!filtros.distrito)}`}>
                <option value="">{filtros.departamento ? 'Todos' : '—'}</option>
                {distritosDisp.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          {/* Limpiar — pegado al borde derecho */}
          {(filtros.entidad || filtros.proveedor || filtros.producto || filtros.departamento ||
            filtros.provincia || filtros.distrito || filtros.estado !== 'todos' || filtros.resultado ||
            filtros.anio !== 'todos' || filtros.objeto) && (
            <button
              onClick={() => setFiltros({ anio: 'todos', estado: 'todos', resultado: '', objeto: '', entidad: '', proveedor: '', departamento: '', provincia: '', distrito: '', producto: '' })}
              className="ml-auto text-[13px] font-semibold text-blue-600 hover:text-blue-700 hover:underline"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <KpiCard label="Total"         value={stats?.total ?? 0}         icon={<Layers size={18}/>}       color="bg-slate-100 text-slate-600"     loading={loading}/>
          <KpiCard label="Vigentes"      value={stats?.vigentes ?? 0}      icon={<CheckCircle2 size={18}/>} color="bg-emerald-100 text-emerald-600" loading={loading}/>
          <KpiCard label="En evaluación" value={stats?.en_evaluacion ?? 0} icon={<Clock size={18}/>}        color="bg-violet-100 text-violet-600"   loading={loading}/>
          <KpiCard label="Culminados"    value={stats?.culminados ?? 0}    icon={<XCircle size={18}/>}      color="bg-rose-100 text-rose-600"       loading={loading}/>
          <KpiCard label="Otros estados" value={(stats as any)?.otros ?? 0} icon={<AlertCircle size={18}/>} color="bg-amber-100 text-amber-600"     loading={loading}/>
          <KpiCard label="Con cotización" value={(stats as any)?.con_cotizar ?? 0} icon={<ShoppingBag size={18}/>} color="bg-blue-100 text-blue-600" loading={loading}/>
        </div>

        {/* Preparar datos con % para el ranking de proveedores */}
        {(() => null)()}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          <ChartCard title="Top entidades que más contratan" icon={<TrendingUp size={15}/>} loading={loading} empty={!entidadesChartData.length}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={entidadesChartData} layout="vertical" margin={{ left: 10, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0"/>
                <XAxis type="number" tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false}/>
                <YAxis type="category" dataKey="nombreCorto" width={150} tick={<TruncatedTick />} stroke="#94a3b8" interval={0}/>
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="vigentes" stackId="a" name="Vigentes" fill={COLORS.vigente} />
                <Bar dataKey="en_evaluacion" stackId="a" name="En evaluación" fill={COLORS.en_evaluacion} />
                <Bar dataKey="culminados" stackId="a" name="Culminados" fill={COLORS.culminado} radius={[0, 6, 6, 0]}>
                  <LabelList dataKey="total" position="right" style={{ fontSize: 10, fontWeight: 700, fill: '#334155' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Distribución por estado" icon={<Building2 size={15}/>} loading={loading} empty={!estadoData.some(d => d.value > 0)}>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={estadoData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={3}
                                    label={({ percent }: { percent?: number }) => `${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}
                  style={{ fontSize: 11, fontWeight: 700 }}>
                  {estadoData.map((d, i) => <Cell key={i} fill={d.color}/>)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="bottom" height={24} iconType="circle" wrapperStyle={{ fontSize: 10 }}/>
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          {filtros.estado === 'culminado' && filtros.resultado === 'adjudicado' ? (
            <ChartCard title="Ranking de proveedores adjudicados" icon={<TrendingUp size={15}/>} loading={loading} empty={!proveedores.length}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={proveedores.map(p => ({ ...p, nombreCorto: truncate(p.proveedor, 20), nombreCompleto: p.proveedor }))}
                  layout="vertical" margin={{ left: 10, right: 30 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0"/>
                  <XAxis type="number" tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false}/>
                  <YAxis type="category" dataKey="nombreCorto" width={140} tick={<TruncatedTick />} stroke="#94a3b8" interval={0}/>
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                  <Bar dataKey="adjudicados" name="Adjudicados" fill={COLORS.vigente} radius={[0, 6, 6, 0]}>
                    <LabelList dataKey="adjudicados" position="right" style={{ fontSize: 10, fontWeight: 700, fill: '#334155' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          ) : (
            <ChartCard title="Evolución mensual de publicaciones" icon={<CalendarRange size={15}/>} loading={loading} empty={!timeline.length}>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={timelineChartData} margin={{ left: -10, right: 20 }}>
                  <defs>
                    <linearGradient id="colorTotalGrid" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/>
                  <XAxis dataKey="periodoCorto" tick={{ fontSize: 10 }} stroke="#94a3b8" interval="preserveStartEnd"/>
                  <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false}/>
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="total" name="Contratos publicados" stroke="#3b82f6" fill="url(#colorTotalGrid)" strokeWidth={2}/>
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          <ChartCard title="Distritos con más contratos" icon={<MapPin size={15}/>} loading={loading} empty={!geografia.length}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={geografia.map(g => ({ ...g, nombreCorto: truncate(g.nom_distrito, 18) }))} layout="vertical" margin={{ left: 10, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0"/>
                <XAxis type="number" tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false}/>
                <YAxis type="category" dataKey="nombreCorto" width={120} tick={<TruncatedTick />} stroke="#94a3b8" interval={0}/>
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="total" name="Contratos" radius={[0, 6, 6, 0]}>
                  <LabelList dataKey="total" position="right" style={{ fontSize: 10, fontWeight: 700, fill: '#334155' }} />
                  {geografia.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Productos / categorías más contratados" icon={<Package size={15}/>} loading={loading} empty={!productos.length}>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={productos.map(p => ({ ...p, nombreCorto: truncate(p.nom_cubso, 18), nombreCompleto: p.nom_cubso }))} layout="vertical" margin={{ left: 10, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0"/>
                <XAxis type="number" tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false}/>
                <YAxis type="category" dataKey="nombreCorto" width={120} tick={<TruncatedTick />} stroke="#94a3b8" interval={0}/>
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="total" name="Veces contratado" radius={[0, 6, 6, 0]}>
                  <LabelList dataKey="total" position="right" style={{ fontSize: 10, fontWeight: 700, fill: '#334155' }} />
                  {productos.map((_, i) => <Cell key={i} fill={PALETTE[(i + 2) % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Distribución por tipo de objeto" icon={<Layers size={15}/>} loading={loading} empty={!objeto.length}>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={objeto} dataKey="total" nameKey="nom_objeto_contrato" innerRadius={45} outerRadius={80} paddingAngle={3}
                  label={({ percent }: { percent?: number }) => `${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                  {objeto.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]}/>)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="bottom" height={24} iconType="circle" wrapperStyle={{ fontSize: 10 }}/>
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

            {filtros.estado === 'culminado' && filtros.resultado === 'adjudicado' && (
              <div className="md:col-span-3">
                <ChartCard title="Evolución mensual de publicaciones" icon={<CalendarRange size={15}/>} loading={loading} empty={!timeline.length}>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={timelineChartData} margin={{ left: -10, right: 20 }}>
                      <defs>
                        <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/>
                      <XAxis dataKey="periodoCorto" tick={{ fontSize: 10 }} stroke="#94a3b8" interval="preserveStartEnd"/>
                      <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false}/>
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="total" name="Contratos publicados" stroke="#3b82f6" fill="url(#colorTotal)" strokeWidth={2}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            )}

        </div>
      </main>
    </div>
  )
}