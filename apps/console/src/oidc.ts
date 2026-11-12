/**
 * Sign-in for the console.
 *
 * The console uses the authorization code flow with PKCE against the
 * Prysm auth platform, the same provider the Zero Trust console uses. The
 * browser holds no client secret: the code is exchanged with a verifier
 * that only exists in this tab.
 *
 * The token is kept in `sessionStorage`, not `localStorage`. A session
 * token that survives a browser restart is a token that can be replayed
 * from a shared machine, which is not worth the convenience of staying
 * signed in.
 */

/** The provider's settings. */
export interface OidcConfig {
  /** The issuer, including the `/oidc` path. */
  issuer: string
  /** The console's client identifier. */
  clientId: string
  /** The API resource the token is minted for. */
  audience: string
  /** Where the provider sends the browser back. */
  redirectUri: string
  /** The scopes the console asks for. */
  scopes: string[]
}

/** The token and its metadata. */
export interface Session {
  /**
   * The bearer credential the API accepts.
   *
   * This is the ID token: the provider issues an opaque access token for
   * this flow, and the API verifies JWTs, so the ID token is the one that
   * can be checked against the provider's signing keys.
   */
  credential: string
  refreshToken?: string
  /** When the credential expires, as a Unix timestamp in seconds. */
  expiresAt: number
  /** The operator's display name. */
  name?: string
  /** The operator's email address. */
  email?: string
  /** The roles the provider granted. */
  roles: string[]
}

/** Where the console keeps its session. */
const STORAGE_KEY = 'sentinel.session'

/** The console's own routes. */
export const SIGN_IN_PATH = '/auth/sign-in'
export const CALLBACK_PATH = '/auth/callback'

/** Encode bytes as base64url, without padding. */
function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The SHA-256 of the verifier, as base64url. */
async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

/** The verifier and the state, kept for the length of the redirect. */
interface PendingExchange {
  verifier: string
  state: string
  returnTo: string
}

const PENDING_KEY = 'sentinel.pending'

/**
 * Read the provider's settings from the build's environment.
 *
 * They are baked in at build time: they are not secrets, and the console is
 * a static bundle with no server to ask.
 */
export function oidcConfig(env: Record<string, string | undefined> = import.meta.env): OidcConfig {
  const issuer = (env.VITE_SENTINEL_OIDC_ISSUER ?? 'https://prysm.sh/oidc').replace(/\/+$/, '')
  const scheme = env.VITE_SENTINEL_PUBLIC_SCHEME?.trim() || window.location.protocol.replace(':', '')
  const origin =
    env.VITE_SENTINEL_PUBLIC_ORIGIN?.trim().replace(/\/+$/, '') || `${scheme}://${window.location.host}`
  return {
    issuer,
    clientId: env.VITE_SENTINEL_OIDC_CLIENT_ID ?? 'sentinel-console-001',
    audience: env.VITE_SENTINEL_OIDC_AUDIENCE ?? 'https://sentinel.prysm.sh/api',
    redirectUri: env.VITE_SENTINEL_OIDC_REDIRECT_URI?.trim() || `${origin}${CALLBACK_PATH}`,
    scopes: (env.VITE_SENTINEL_OIDC_SCOPES ?? 'openid profile email offline_access roles')
      .split(/\s+/)
      .filter(Boolean),
  }
}

/** The error raised when sign-in cannot complete. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * The resource indicator for an audience, when there is one.
 *
 * RFC 8707 defines the resource parameter as an absolute URI. When the
 * audience is a bare identifier, the provider derives the audience from
 * the client, and no resource parameter is sent.
 */
function resourceIndicator(audience: string): string | null {
  return /^https?:\/\//i.test(audience) ? audience : null
}

/** Begin the sign-in flow. */
export async function beginSignIn(config: OidcConfig, returnTo = '/'): Promise<void> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)))
  const challenge = await challengeOf(verifier)

  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, returnTo }))

  const url = new URL(`${config.issuer}/auth`)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', config.scopes.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')

  const resource = resourceIndicator(config.audience)
  if (resource) url.searchParams.set('resource', resource)

  window.location.assign(url.toString())
}

/** Read the claims out of a token. They are only shown, never acted on. */
export function readClaims(token: string): Record<string, unknown> {
  const parts = token.split('.')
  if (parts.length !== 3) return {}
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Build a session from a token response. */
function sessionFromTokens(tokens: {
  access_token: string
  id_token: string
  expires_in: number
  refresh_token?: string
}): Session {
  const claims = readClaims(tokens.id_token)
  const rolesClaim = claims.roles
  const roles = Array.isArray(rolesClaim) ? rolesClaim.filter((r): r is string => typeof r === 'string') : []
  const text = (key: string): string | undefined => {
    const value = claims[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }
  return {
    credential: tokens.id_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
    roles,
    name: text('name') ?? text('preferred_username'),
    email: text('email'),
  }
}

/** Finish the sign-in flow, exchanging the code for a token. */
export async function completeSignIn(config: OidcConfig): Promise<Session> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  if (!code) throw new AuthError('The provider did not return an authorization code.')

  const raw = sessionStorage.getItem(PENDING_KEY)
  if (!raw) throw new AuthError('This sign-in attempt has expired. Please try again.')
  const pending = JSON.parse(raw) as PendingExchange
  sessionStorage.removeItem(PENDING_KEY)
  if (!state || state !== pending.state) {
    throw new AuthError('The sign-in response did not match the request.')
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: pending.verifier,
  })
  const resource = resourceIndicator(config.audience)
  if (resource) body.set('resource', resource)

  const response = await fetch(`${config.issuer}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new AuthError(`The provider rejected the sign-in: ${detail || response.statusText}`)
  }

  const tokens = (await response.json()) as {
    access_token: string
    id_token: string
    expires_in: number
    refresh_token?: string
  }

  const session = sessionFromTokens(tokens)
  storeSession(session)
  return session
}

/** Exchange the refresh token for a new credential. */
export async function refreshSession(config: OidcConfig, session: Session): Promise<Session> {
  if (!session.refreshToken) throw new AuthError('This session cannot be renewed.')

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
    client_id: config.clientId,
    scope: config.scopes.join(' '),
  })
  const resource = resourceIndicator(config.audience)
  if (resource) body.set('resource', resource)

  const response = await fetch(`${config.issuer}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    throw new AuthError('The provider refused the renewal.')
  }

  const tokens = (await response.json()) as {
    access_token: string
    id_token: string
    expires_in: number
    refresh_token?: string
  }
  const renewed = sessionFromTokens(tokens)
  // A provider that does not rotate its refresh tokens sends none back.
  if (!renewed.refreshToken) renewed.refreshToken = session.refreshToken
  storeSession(renewed)
  return renewed
}

/** The stored session, if there is one. */
export function loadSession(): Session | null {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const session = JSON.parse(raw) as Session
    if (session.expiresAt <= Math.floor(Date.now() / 1000)) {
      clearSession()
      return null
    }
    return session
  } catch {
    clearSession()
    return null
  }
}

/** Keep the session. */
export function storeSession(session: Session): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

/** Forget the session. */
export function clearSession(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}

/** Whether the session is about to expire. */
export function needsRefresh(session: Session, withinSeconds = 60): boolean {
  return session.expiresAt - Math.floor(Date.now() / 1000) <= withinSeconds
}

/** Whether the session can be renewed at all. */
export function canRenew(session: Session): boolean {
  return Boolean(session.refreshToken)
}
