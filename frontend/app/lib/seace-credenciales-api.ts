const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface SeaceEstado {
  vinculada: boolean
  usuario: string | null
}

async function manejarRespuesta<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.detail || `Error ${res.status} al comunicarse con el servidor`)
  }
  return data as T
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export async function getEstadoSeace(token: string): Promise<SeaceEstado> {
  const res = await fetch(`${API_URL}/empresas/seace/estado`, { headers: authHeaders(token) })
  return manejarRespuesta<SeaceEstado>(res)
}

export async function vincularSeace(usuario: string, password: string, token: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_URL}/empresas/vincular-seace`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ usuario, password }),
  })
  return manejarRespuesta<{ ok: boolean }>(res)
}