import type { Metadata } from 'next'
import localFont from 'next/font/local'

import './globals.css'

import { AuthProvider } from '@/components/AuthProvider'
import AuthGuard from '@/components/AuthGuard'
import AppLayout from '@/components/AppLayout'

import { ToastProvider } from '@/components/ToastProvider'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
})

const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
})


export const metadata: Metadata = {
  title: 'PLADIBOT',
  description: 'Plataforma SEACE',
}


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {

  return (
    <html lang="es">

      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
      <ToastProvider>
        <AuthProvider>

          <AuthGuard>

            <AppLayout>
              {children}
            </AppLayout>

          </AuthGuard>

        </AuthProvider>

        </ToastProvider>

      </body>

    </html>
  )
}