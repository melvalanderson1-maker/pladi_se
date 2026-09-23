'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { getSocket } from '@/lib/socket'
import {
  listarUsuariosAdmin, obtenerPermisosUsuario, guardarPermisosUsuario,
  listarRoles, crearUsuario, actualizarUsuario, eliminarUsuario,
  getEmpresas,
  type ModuloPermiso, type Rol, type Empresa,
} from '@/lib/api'
import {
  Users, X, ShieldCheck, Loader2, Plus, Pencil, Power,
  CheckCircle2, ShieldAlert, Info, Wifi, WifiOff,
} from 'lucide-react'
// ─── SISTEMA DE TOASTS ────────────────────────────────────────────────────

type ToastTone = 'success' | 'error' | 'info'
type ToastItem = { id: number; text: string; tone: ToastTone }

let toastIdSeq = 1

function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const push = useCallback((text: string, tone: ToastTone = 'info') => {
    const id = toastIdSeq++
    setToasts(prev => [...prev, { id, text, tone }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, push, dismiss }
}

function ToastStack({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  const styles: Record<ToastTone, string> = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    error: 'bg-rose-50 text-rose-700 border-rose-200',
    info: 'bg-blue-50 text-blue-700 border-blue-200',
  }
  const icons: Record<ToastTone, React.ReactNode> = {
    success: <CheckCircle2 size={15} className="shrink-0" />,
    error: <ShieldAlert size={15} className="shrink-0" />,
    info: <Info size={15} className="shrink-0" />,
  }
  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 w-full max-w-xs">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-xs font-semibold shadow-lg animate-in slide-in-from-right-4 ${styles[t.tone]}`}
        >
          {icons[t.tone]}
          <span className="flex-1">{t.text}</span>
          <button onClick={() => dismiss(t.id)}>
            <X size={12} className="opacity-60 hover:opacity-100" />
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── LOADER PROFESIONAL ───────────────────────────────────────────────────

function LoaderFullScreen({ texto }: { texto: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-600 animate-spin" />
        <div
          className="absolute inset-[4px] rounded-full border-4 border-transparent border-t-blue-400 animate-spin"
          style={{ animationDuration: '0.9s', animationDirection: 'reverse' }}
        />
        <Users size={16} className="text-blue-600" />
      </div>
      <p className="text-sm font-semibold text-slate-500">{texto}</p>
    </div>
  )
}

function LoaderInline() {
  return (
    <div className="relative w-4 h-4 flex items-center justify-center">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}

// ─── PÁGINA PRINCIPAL ─────────────────────────────────────────────────────

export default function UsuariosPage() {
  const { token } = useAuth()
  const { toasts, push, dismiss } = useToasts()

  const [usuarios, setUsuarios] = useState<any[]>([])
  const [roles, setRoles] = useState<Rol[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [loading, setLoading] = useState(true)

  const [modalPermisos, setModalPermisos] = useState<any>(null)
  const [modalForm, setModalForm] = useState<{ modo: 'crear' | 'editar'; usuario: any | null } | null>(null)
  const [usuariosOnline, setUsuariosOnline] = useState<Set<number>>(new Set())

  const cargarTodo = useCallback(async (silencioso = false) => {
    if (!token) return
    if (!silencioso) setLoading(true)
    try {
      const [us, rs, es] = await Promise.all([
        listarUsuariosAdmin(token),
        listarRoles(token),
        getEmpresas().catch(() => []), // no crítico si falla
      ])
      setUsuarios(us)
      setRoles(rs)
      setEmpresas(es)
    } catch (e: any) {
      push(e.message || 'No se pudo cargar la información', 'error')
    } finally {
      if (!silencioso) setLoading(false)
    }
  }, [token, push])

  useEffect(() => { cargarTodo() }, [cargarTodo])

  useEffect(() => {
    if (!token) return
    const socket = getSocket()
    if (!socket) return

    const handleUsuariosOnline = (data: { usuarios: number[] }) => {
      setUsuariosOnline(new Set(data.usuarios))
    }
    const handleConectado = (data: { id_usuario: number }) => {
      setUsuariosOnline(prev => new Set(prev).add(data.id_usuario))
    }
    const handleDesconectado = (data: { id_usuario: number }) => {
      setUsuariosOnline(prev => {
        const copy = new Set(prev)
        copy.delete(data.id_usuario)
        return copy
      })
    }

    socket.on('usuarios_online', handleUsuariosOnline)
    socket.on('usuario_conectado', handleConectado)
    socket.on('usuario_desconectado', handleDesconectado)

    // El socket puede haberse conectado ANTES de que esta página se
    // montara (es un singleton compartido), y el evento inicial
    // 'usuarios_online' solo se manda una vez, justo al conectar. Por
    // eso, apenas montamos, pedimos la lista actual explícitamente —
    // así nos incluimos a nosotros mismos aunque nos hayamos perdido
    // el evento inicial.
    if (socket.connected) {
      socket.emit('solicitar_usuarios_online')
    } else {
      socket.once('connect', () => socket.emit('solicitar_usuarios_online'))
    }

    return () => {
      socket.off('usuarios_online', handleUsuariosOnline)
      socket.off('usuario_conectado', handleConectado)
      socket.off('usuario_desconectado', handleDesconectado)
    }
  }, [token])

  const handleDesactivar = async (u: any) => {
    if (!token) return
    if (!confirm(`¿Desactivar a ${u.nombre}? Ya no podrá iniciar sesión, pero su historial se conserva.`)) return
    try {
      await eliminarUsuario(u.id, token)
      push(`${u.nombre} fue desactivado.`, 'success')
      cargarTodo(true)
    } catch (e: any) {
      push(e.message || 'No se pudo desactivar el usuario', 'error')
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <ToastStack toasts={toasts} dismiss={dismiss} />

      <div className="w-full px-6 lg:px-10 py-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/20">
              <Users size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-800 tracking-tight">Gestión de Usuarios</h1>
              <p className="text-xs text-slate-400 font-medium">
                {usuarios.length} usuario{usuarios.length === 1 ? '' : 's'} registrado{usuarios.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setModalForm({ modo: 'crear', usuario: null })}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold shadow-sm shadow-blue-900/20 transition-colors"
          >
            <Plus size={16} /> Nuevo usuario
          </button>
        </div>

        {loading ? (
          <LoaderFullScreen texto="Cargando usuarios..." />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-100">
                <tr>
                  <th className="text-left px-5 py-3.5">Nombre</th>
                  <th className="text-left px-5 py-3.5">Correo</th>
                  <th className="text-left px-5 py-3.5">Rol</th>
                  <th className="text-left px-5 py-3.5">Empresa</th>
                  <th className="text-left px-5 py-3.5">Conexión</th>
                  <th className="text-left px-5 py-3.5">Estado</th>
                  <th className="text-right px-5 py-3.5">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map(u => (
                  <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5 font-semibold text-slate-700">{u.nombre}</td>
                    <td className="px-5 py-3.5 text-slate-500">{u.correo}</td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold capitalize">
                        {u.rol}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">{u.empresa ?? '—'}</td>
                    <td className="px-5 py-3.5">
                      {usuariosOnline.has(u.id) ? (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"/>
                          <Wifi size={10}/> En línea
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase text-slate-400 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300"/>
                          <WifiOff size={10}/> Desconectado
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {u.activo ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                          Activo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-slate-400 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full">
                          Inactivo
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setModalForm({ modo: 'editar', usuario: u })}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title="Editar usuario"
                        >
                          <Pencil size={12} /> Editar
                        </button>
                        <button
                          onClick={() => setModalPermisos(u)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <ShieldCheck size={12} /> Permisos
                        </button>
                        {u.activo && (
                          <button
                            onClick={() => handleDesactivar(u)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                            title="Desactivar usuario"
                          >
                            <Power size={12} /> Desactivar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {usuarios.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-14 text-center text-sm text-slate-400">
                      No hay usuarios registrados todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalPermisos && (
        <PermisosModal
          usuario={modalPermisos}
          token={token!}
          onClose={() => setModalPermisos(null)}
          push={push}
        />
      )}

      {modalForm && (
        <UsuarioFormModal
          modo={modalForm.modo}
          usuario={modalForm.usuario}
          roles={roles}
          empresas={empresas}
          token={token!}
          onClose={() => setModalForm(null)}
          onGuardado={() => { setModalForm(null); cargarTodo(true) }}
          push={push}
        />
      )}
    </div>
  )
}

// ─── MODAL: CREAR / EDITAR USUARIO ────────────────────────────────────────

function UsuarioFormModal({
  modo, usuario, roles, empresas, token, onClose, onGuardado, push,
}: {
  modo: 'crear' | 'editar'
  usuario: any | null
  roles: Rol[]
  empresas: Empresa[]
  token: string
  onClose: () => void
  onGuardado: () => void
  push: (text: string, tone: ToastTone) => void
}) {
  const [nombre, setNombre] = useState(usuario?.nombre ?? '')
  const [correo, setCorreo] = useState(usuario?.correo ?? '')
  const [password, setPassword] = useState('')
  const [idRol, setIdRol] = useState<number | ''>(
    usuario ? (roles.find(r => r.nombre === usuario.rol)?.id ?? '') : ''
  )
  const [idEmpresa, setIdEmpresa] = useState<number | ''>(usuario?.id_empresa ?? '')
  const [activo, setActivo] = useState<boolean>(usuario?.activo ?? true)
  const [guardando, setGuardando] = useState(false)

  const puedeGuardar =
    nombre.trim() && correo.trim() && idRol !== '' &&
    (modo === 'editar' || password.trim().length >= 6)

  const handleGuardar = async () => {
    if (!puedeGuardar) return
    setGuardando(true)
    try {
      if (modo === 'crear') {
        await crearUsuario({
          nombre: nombre.trim(),
          correo: correo.trim(),
          password: password.trim(),
          id_rol: Number(idRol),
          id_empresa: idEmpresa === '' ? null : Number(idEmpresa),
        }, token)
        push(`Usuario ${nombre} creado correctamente.`, 'success')
      } else {
        await actualizarUsuario(usuario.id, {
          nombre: nombre.trim(),
          id_rol: Number(idRol),
          id_empresa: idEmpresa === '' ? null : Number(idEmpresa),
          activo,
        }, token)
        push(`Usuario ${nombre} actualizado correctamente.`, 'success')
      }
      onGuardado()
    } catch (e: any) {
      push(e.message || 'No se pudo guardar el usuario', 'error')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-100 overflow-hidden">
        <div className="relative bg-gradient-to-r from-slate-900 via-slate-800 to-blue-900 px-6 py-5 flex items-center gap-3">
          <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/60 to-transparent" />
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <Users size={16} className="text-white" />
          </div>
          <p className="text-sm font-bold text-white flex-1 truncate">
            {modo === 'crear' ? 'Nuevo usuario' : `Editar ${usuario.nombre}`}
          </p>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Nombre</label>
            <input
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Correo</label>
            <input
              type="email"
              value={correo}
              onChange={e => setCorreo(e.target.value)}
              disabled={modo === 'editar'}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
            />
            {modo === 'editar' && (
              <p className="text-[10px] text-slate-400 mt-1">El correo no se puede modificar.</p>
            )}
          </div>

          {modo === 'crear' && (
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          )}

          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Rol</label>
            <select
              value={idRol}
              onChange={e => setIdRol(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Selecciona un rol</option>
              {roles.map(r => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Empresa (opcional)</label>
            <select
              value={idEmpresa}
              onChange={e => setIdEmpresa(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Sin empresa asignada</option>
              {empresas.map(e => (
                <option key={e.id} value={e.id}>{e.razon_social}</option>
              ))}
            </select>
          </div>

          {modo === 'editar' && (
            <label className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-slate-100 cursor-pointer">
              <span className="text-sm font-medium text-slate-700">Usuario activo</span>
              <input
                type="checkbox"
                checked={activo}
                onChange={e => setActivo(e.target.checked)}
                className="w-4 h-4 rounded accent-blue-600"
              />
            </label>
          )}
        </div>

        <div className="p-5 border-t border-slate-100 flex gap-2 bg-slate-50/50">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-white transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleGuardar}
            disabled={!puedeGuardar || guardando}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold shadow-sm shadow-blue-900/20 disabled:opacity-60 transition-colors"
          >
            {guardando && <LoaderInline />}
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MODAL: PERMISOS (igual que antes, con toasts) ────────────────────────

function PermisosModal({
  usuario, token, onClose, push,
}: {
  usuario: any
  token: string
  onClose: () => void
  push: (text: string, tone: ToastTone) => void
}) {
  const [permisos, setPermisos] = useState<ModuloPermiso[]>([])
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    obtenerPermisosUsuario(usuario.id, token)
      .then(setPermisos)
      .catch((e: any) => push(e.message || 'No se pudieron cargar los permisos', 'error'))
      .finally(() => setLoading(false))
  }, [usuario.id, token, push])

  const toggle = (id_modulo: number) => {
    setPermisos(prev => prev.map(p => p.id_modulo === id_modulo ? { ...p, habilitado: !p.habilitado } : p))
  }

  const guardar = async () => {
    setGuardando(true)
    try {
      await guardarPermisosUsuario(usuario.id, permisos.map(p => ({ id_modulo: p.id_modulo, habilitado: p.habilitado })), token)
      push(`Permisos de ${usuario.nombre} actualizados.`, 'success')
      onClose()
    } catch (e: any) {
      push(e.message || 'No se pudieron guardar los permisos', 'error')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-slate-100 overflow-hidden">
        <div className="relative bg-gradient-to-r from-slate-900 via-slate-800 to-blue-900 px-6 py-5 flex items-center gap-3">
          <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/60 to-transparent" />
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <ShieldCheck size={16} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white truncate">{usuario.nombre}</p>
            <p className="text-[11px] text-blue-200/80 font-medium">Permisos por módulo</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="p-5 max-h-96 overflow-y-auto">
          {loading ? (
            <LoaderFullScreen texto="Cargando permisos..." />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {permisos.map(p => (
                <label
                  key={p.id_modulo}
                  className="flex flex-col items-center justify-center gap-2 px-2 py-3 rounded-xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/40 cursor-pointer transition-colors text-center"
                >
                  <span className="text-xs font-semibold text-slate-700 leading-tight">{p.nombre}</span>
                  <input
                    type="checkbox"
                    checked={p.habilitado}
                    onChange={() => toggle(p.id_modulo)}
                    className="w-4 h-4 rounded accent-blue-600"
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-100 flex gap-2 bg-slate-50/50">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-white transition-colors">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold shadow-sm shadow-blue-900/20 disabled:opacity-60 transition-colors"
          >
            {guardando && <LoaderInline />}
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}