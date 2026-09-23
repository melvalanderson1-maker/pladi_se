'use client'

import { usePathname } from 'next/navigation'

import Sidebar, {
  SidebarProvider,
  SidebarInset,
} from '@/components/Sidebar'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {

  const pathname = usePathname()

  // =========================================================
  // LOGIN = PÁGINA PÚBLICA
  // NO MOSTRAR SIDEBAR
  // =========================================================

  if (pathname === '/login') {
    return <>{children}</>
  }

  // =========================================================
  // RESTO DE LA APLICACIÓN
  // MOSTRAR SIDEBAR
  // =========================================================

  return (
    <SidebarProvider>

      <Sidebar />

      <SidebarInset>
        {children}
      </SidebarInset>

    </SidebarProvider>
  )
}