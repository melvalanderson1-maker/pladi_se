'use client'

import { useEffect, useState } from 'react'
import { Link2, Check, Loader2, AlertCircle, X } from 'lucide-react'
import { getEstadoSeace, vincularSeace } from '@/lib/seace-credenciales-api'
import { useAuth } from '@/components/AuthProvider'

export default function VincularSeace() {
  const { token } = useAuth()
  const [vinculada, setVinculada] = useState(false)
  const [usuarioGuardado, setUsuarioGuardado] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    getEstadoSeace(token)
      .then(data => { setVinculada(data.vinculada); setUsuarioGuardado(data.usuario) })
      .finally(() => setCargando(false))
  }, [token])

  const handleGuardar = async () => {
    if (!token || !usuario || !password) return
    setGuardando(true)
    setError(null)
    try {
      await vincularSeace(usuario, password, token)
      setVinculada(true)
      setUsuarioGuardado(usuario)
      setModalAbierto(false)
      setPassword('')
    } catch (e: any) {
      setError(e.message || 'No se pudo vincular la cuenta SEACE')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) {
    return (
      <div className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold whitespace-nowrap">
        <Loader2 size={13} className="animate-spin" /> Cargando SEACE...
      </div>
    )
  }

  return (
    <>
      <button
        onClick={() => setModalAbierto(true)}
        className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all border whitespace-nowrap
          ${vinculada
            ? 'bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-500'
            : 'bg-blue-600 border-blue-500 text-white hover:bg-blue-500'}`}
      >
        <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center
          ${vinculada ? 'bg-emerald-700' : 'bg-blue-700'}`}>
          {vinculada ? <Check size={13} /> : <Link2 size={12} />}
        </span>
        <span className="text-xs font-semibold">
          {vinculada ? `SEACE: ${usuarioGuardado}` : 'Vincular SEACE'}
        </span>
      </button>

      {modalAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Vincular cuenta SEACE</h3>
              <button onClick={() => setModalAbierto(false)} className="text-white/50 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-2">
              <input
                value={usuario}
                onChange={e => setUsuario(e.target.value)}
                placeholder="Usuario SEACE"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
              <input
                value={password}
                onChange={e => setPassword(e.target.value)}
                type="password"
                placeholder="Contraseña SEACE"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            {error && (
              <p className="flex items-center gap-1.5 text-xs text-rose-400">
                <AlertCircle size={12} /> {error}
              </p>
            )}

            <button
              onClick={handleGuardar}
              disabled={guardando || !usuario || !password}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
            >
              {guardando ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              {guardando ? 'Vinculando...' : 'Vincular'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}