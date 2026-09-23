'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  login as loginApi,
  obtenerPerfil,
  obtenerModulosPermitidos,
  type Usuario,
  type Modulo,
} from '@/lib/auth-api'

import {
  conectarSocket,
  desconectarSocket,
} from '@/lib/socket'

import { useToast } from '@/components/ToastProvider'

type AuthCtx = {
  usuario: Usuario | null
  modulos: Modulo[]
  token: string | null
  loading: boolean
  login: (correo: string, password: string) => Promise<void>
  logout: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

export function useAuth() {
  const ctx = useContext(Ctx)

  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  }

  return ctx
}

export function AuthProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const router = useRouter()
  const { showToast } = useToast()
  // =========================================================
  // 1. RECUPERAR SESIÓN AL CARGAR LA APLICACIÓN
  // =========================================================
  useEffect(() => {
    const inicializarSesion = async () => {
      try {
        const tokenGuardado = localStorage.getItem('pladibot-token')

        // No existe sesión guardada
        if (!tokenGuardado) {
          setToken(null)
          setUsuario(null)
          setModulos([])
          return
        }

        // Existe token: guardarlo en el estado
        setToken(tokenGuardado)

        // Comprobar que el token siga siendo válido
        const perfil = await obtenerPerfil(tokenGuardado)

        setUsuario(perfil)

        // Obtener módulos permitidos
        const modulosPermitidos =
          await obtenerModulosPermitidos(tokenGuardado)

        setModulos(modulosPermitidos)
      } catch (error) {
        console.error(
          'Error al restaurar la sesión:',
          error
        )

        // Token inválido, vencido o backend no disponible
        localStorage.removeItem('pladibot-token')

        setToken(null)
        setUsuario(null)
        setModulos([])
      } finally {
        // =====================================================
        // MUY IMPORTANTE:
        // SIEMPRE terminamos el estado de carga.
        // =====================================================
        setLoading(false)
      }
    }

    inicializarSesion()
  }, [])

// =========================================================
// 2. CONEXIÓN SOCKET
// =========================================================
// Ref para no depender de la identidad de showToast en el effect
// (si showToast cambia de referencia en cada render de ToastProvider,
// el effect de abajo se reiniciaría innecesariamente y desconectaría
// el socket justo cuando llega un evento del backend).
const showToastRef = useRef(showToast)
useEffect(() => {
  showToastRef.current = showToast
}, [showToast])

useEffect(() => {
  if (!token) return

  const socket = conectarSocket(token)

  const handlePermisosActualizados = () => {
    obtenerPerfil(token)
      .then(setUsuario)
      .catch(() => {})
    obtenerModulosPermitidos(token)
      .then(setModulos)
      .catch(() => {})
  }

  const handleCotizacionNotificacion = (data: { usuario: string; id_contrato: number; mensaje: string }) => {
    showToastRef.current(data.mensaje, 'info')
  }

  const handleContratoGanado = (data: {
    id_contrato: number
    razon_social: string
    des_contratacion: string | null
    nom_entidad: string | null
    mensaje: string
  }) => {
    showToastRef.current(data.mensaje, 'success')
  }

  const handleCuentaDesactivada = () => {
    sessionStorage.setItem('pladibot-login-transition', 'true')
    localStorage.removeItem('pladibot-token')

    setToken(null)
    setUsuario(null)
    setModulos([])

    router.push('/login')
  }

  socket.on('permisos_actualizados', handlePermisosActualizados)
  socket.on('cotizacion_notificacion', handleCotizacionNotificacion)
  socket.on('contrato_ganado', handleContratoGanado)
  socket.on('cuenta_desactivada', handleCuentaDesactivada)

  return () => {
    socket.off('permisos_actualizados', handlePermisosActualizados)
    socket.off('cotizacion_notificacion', handleCotizacionNotificacion)
    socket.off('contrato_ganado', handleContratoGanado)
    socket.off('cuenta_desactivada', handleCuentaDesactivada)
    desconectarSocket()
  }
}, [token])
  // =========================================================
  // 3. LOGIN
  // =========================================================
  const login = async (
    correo: string,
    password: string
  ) => {
    const respuesta = await loginApi(correo, password)

    const nuevoToken = respuesta.token
    const nuevoUsuario = respuesta.usuario

    localStorage.setItem(
      'pladibot-token',
      nuevoToken
    )

    setToken(nuevoToken)
    setUsuario(nuevoUsuario)

    const modulosPermitidos =
      await obtenerModulosPermitidos(nuevoToken)

    setModulos(modulosPermitidos)

    router.push('/')
  }

// =========================================================
// 4. LOGOUT
// =========================================================
const logout = () => {
  localStorage.removeItem('pladibot-token')

  setToken(null)
  setUsuario(null)
  setModulos([])

  router.push('/login')
}



  return (
        <Ctx.Provider
        value={{
            usuario,
            modulos,
            token,
            loading,
            login,
            logout,
        }}
        >
      {children}
    </Ctx.Provider>
  )
}