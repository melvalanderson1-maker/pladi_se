const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface Usuario {
  id: number
  nombre: string
  correo: string
  rol: 'admin' | 'cotizador' | 'visualizador'
  id_empresa: number | null
}

export interface Modulo {
  clave: string
  nombre: string
  ruta: string
  listo: boolean
}

export async function login(correo: string, password: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Correo o contraseña incorrectos')
  return data as { token: string; usuario: Usuario }
}

export async function obtenerPerfil(token: string) {
  const res = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('Sesión inválida')
  return res.json()
}

export async function obtenerModulosPermitidos(token: string) {
  const res = await fetch(`${API}/auth/modulos`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('No se pudo obtener los módulos')
  return res.json() as Promise<Modulo[]>
}