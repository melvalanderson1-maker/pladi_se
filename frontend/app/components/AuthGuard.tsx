'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'

const RUTAS_PUBLICAS = ['/login']

export default function AuthGuard({
  children,
}: {
  children: React.ReactNode
}) {
  const { token, loading } = useAuth()
  const pathname = usePathname()
  const router = useRouter()

  const esPublica = RUTAS_PUBLICAS.includes(pathname)

  useEffect(() => {
    // Si estamos en /login, nunca redirigir.
    if (esPublica) {
      return
    }

    // Mientras se comprueba la sesión, esperamos.
    if (loading) {
      return
    }

    // No hay sesión y estamos en una ruta protegida.
    if (!token) {
      router.replace('/login')
    }
  }, [loading, token, esPublica, router])

  // =====================================================
  // IMPORTANTE:
  // /login SIEMPRE se debe renderizar.
  // No debe quedarse atrapado en "Cargando..."
  // =====================================================
  if (esPublica) {
    return <>{children}</>
  }

  // =====================================================
  // Rutas protegidas
  // =====================================================

  // Mientras comprobamos la sesión.
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">
          Cargando…
        </p>
      </div>
    )
  }

  // No hay sesión.
  // AuthGuard está redirigiendo a /login.
  if (!token) {
    return null
  }

  // Hay sesión.
  return <>{children}</>
}