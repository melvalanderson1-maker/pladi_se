const SCRAPER_URL = process.env.NEXT_PUBLIC_SCRAPER_URL || 'http://localhost:4000'

export interface EmpresaEstado {
  ruc: string
  razon_social: string
  activa: boolean
  conectado_en: string | null
  error: string | null
  seleccionada: boolean
}

export interface EmpresasResponse {
  empresa_seleccionada: string
  empresas: EmpresaEstado[]
}

async function manejarRespuesta<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status} al comunicarse con el servidor`)
  }
  return data as T
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

export async function getEmpresas(token: string): Promise<EmpresasResponse> {
  const res = await fetch(`${SCRAPER_URL}/session/empresas`, {
    headers: authHeaders(token),
  })
  return manejarRespuesta<EmpresasResponse>(res)
}

export async function vincularEmpresa(ruc: string, token: string): Promise<{ mensaje: string }> {
  const res = await fetch(`${SCRAPER_URL}/session/empresas/${ruc}/vincular`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  return manejarRespuesta<{ mensaje: string }>(res)
}

export async function seleccionarEmpresa(ruc: string, token: string): Promise<{ mensaje: string; empresa_seleccionada: string }> {
  const res = await fetch(`${SCRAPER_URL}/session/empresas/${ruc}/seleccionar`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  return manejarRespuesta<{ mensaje: string; empresa_seleccionada: string }>(res)
}

export async function desvincularEmpresa(ruc: string, token: string): Promise<{ mensaje: string }> {
  const res = await fetch(`${SCRAPER_URL}/session/empresas/${ruc}/desvincular`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })
  return manejarRespuesta<{ mensaje: string }>(res)
}