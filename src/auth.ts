export type Campus = {
  tenant_code: string
  name: string
  slug: string
}

export type Role = 'platform_admin' | 'college_admin' | 'faculty' | 'student'

export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '')
export const DEMO_AUTH_ENABLED = import.meta.env.VITE_DEMO_AUTH_ENABLED === 'true'

const ACCESS_TOKEN_KEY = 'campuscloud.access_token'
const SELECTED_CAMPUS_KEY = 'campuscloud.selected_campus'
const ROLE_KEY = 'campuscloud.session_role'
const COGNITO_STATE_KEY = 'campuscloud.cognito_state'
const COGNITO_VERIFIER_KEY = 'campuscloud.cognito_verifier'

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
  sessionStorage.removeItem(COGNITO_STATE_KEY)
  sessionStorage.removeItem(COGNITO_VERIFIER_KEY)
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

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomUrlToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

function cognitoSettings() {
  const domain = import.meta.env.VITE_COGNITO_DOMAIN?.replace(/\/$/, '')
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID
  if (!domain || !clientId) {
    throw new Error('Cognito is not configured for this deployment. Set the hosted domain and app client ID.')
  }
  return { domain, clientId }
}

export async function beginCognitoLogin(campus: Campus): Promise<void> {
  const { domain, clientId } = cognitoSettings()
  const verifier = randomUrlToken(48)
  const state = randomUrlToken(24)
  const challengeBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = base64Url(new Uint8Array(challengeBytes))
  const redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI || `${window.location.origin}/auth/callback`

  sessionStorage.setItem(SELECTED_CAMPUS_KEY, JSON.stringify(campus))
  sessionStorage.setItem(COGNITO_STATE_KEY, state)
  sessionStorage.setItem(COGNITO_VERIFIER_KEY, verifier)

  const authorizeUrl = new URL(`${domain}/oauth2/authorize`)
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  }).toString()
  window.location.assign(authorizeUrl.toString())
}

export async function finishCognitoLogin(): Promise<{ accessToken: string; idToken: string }> {
  const query = new URLSearchParams(window.location.search)
  const code = query.get('code')
  const returnedState = query.get('state')
  const expectedState = sessionStorage.getItem(COGNITO_STATE_KEY)
  const verifier = sessionStorage.getItem(COGNITO_VERIFIER_KEY)
  const { domain, clientId } = cognitoSettings()
  const redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI || `${window.location.origin}/auth/callback`

  if (query.has('error')) throw new Error('Cognito sign-in was cancelled or could not be completed.')
  if (!code || !returnedState || !expectedState || returnedState !== expectedState || !verifier) {
    throw new Error('The sign-in response could not be verified. Please try again.')
  }

  sessionStorage.removeItem(COGNITO_STATE_KEY)
  sessionStorage.removeItem(COGNITO_VERIFIER_KEY)
  const response = await fetch(`${domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  })
  if (!response.ok) throw new Error('Cognito could not complete sign-in. Please try again.')
  const tokens = await response.json() as { access_token?: string; id_token?: string }
  if (!tokens.access_token || !tokens.id_token) throw new Error('Cognito did not return the required sign-in tokens.')
  return { accessToken: tokens.access_token, idToken: tokens.id_token }
}

export function beginCognitoLogout(): void {
  const { domain, clientId } = cognitoSettings()
  const logoutUrl = new URL(`${domain}/logout`)
  logoutUrl.search = new URLSearchParams({
    client_id: clientId,
    logout_uri: `${window.location.origin}/`,
  }).toString()
  window.location.assign(logoutUrl.toString())
}
