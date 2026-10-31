export type Campus = {
  tenant_code: string
  name: string
  slug: string
}

export type Role = 'platform_admin' | 'college_admin' | 'faculty' | 'student'

export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '')
export const LOCAL_AUTH_ENABLED = import.meta.env.VITE_LOCAL_AUTH_ENABLED !== 'false'

const ACCESS_TOKEN_KEY = 'campuscloud.access_token'
const SELECTED_CAMPUS_KEY = 'campuscloud.selected_campus'
const ROLE_KEY = 'campuscloud.session_role'

export function getAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getSelectedCampus(): Campus | null {
  const stored = sessionStorage.getItem(SELECTED_CAMPUS_KEY)
  if (!stored) return null
  try {
    return JSON.parse(stored) as Campus
  } catch {
    sessionStorage.removeItem(SELECTED_CAMPUS_KEY)
    return null
  }
}

export function getDemoRole(): Role | null {
  const stored = sessionStorage.getItem(ROLE_KEY)
  return stored === 'platform_admin' || stored === 'college_admin' || stored === 'faculty' || stored === 'student'
    ? stored
    : null
}

export function storeSession(accessToken: string, campus: Campus, role: Role): void {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  sessionStorage.setItem(SELECTED_CAMPUS_KEY, JSON.stringify(campus))
  sessionStorage.setItem(ROLE_KEY, role)
}

export function clearSession(): void {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY)
  sessionStorage.removeItem(SELECTED_CAMPUS_KEY)
  sessionStorage.removeItem(ROLE_KEY)
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { accessToken?: string | null; tenantCode?: string } = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (options.accessToken) headers.set('Authorization', `Bearer ${options.accessToken}`)
  if (options.tenantCode) headers.set('X-Tenant-Code', options.tenantCode)

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers })
  const body = await response.json().catch(() => null) as { detail?: string } | null
  if (!response.ok) {
    throw new Error(body?.detail || `Request failed (${response.status})`)
  }
  return body as T
}

