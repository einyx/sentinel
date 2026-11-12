/**
 * GitHub, through a GitHub App.
 *
 * An OAuth app would hand the platform a token that acts as the person who
 * authorised it. A GitHub App does not: the person authorises the *app*,
 * the app is installed on the repositories, and the platform mints a
 * short-lived installation token for each clone from the app's own private
 * key. The token lives for an hour and the person who installed the app
 * never appears in the platform's store.
 *
 * The private key is the connection's secret. It is what signs the JSON web
 * token that is exchanged for an installation token.
 */

import { SignJWT, importPKCS8 } from 'jose'

import type {
  AuthorizeParams,
  ConnectionProvider,
  ExchangeParams,
  Grant,
  GrantParams,
  Registration,
  RemoteRepository,
} from './types.js'

/** The user name a clone uses with an installation token. */
const CLONE_USER = 'x-access-token'

/** How long the signed token that mints an installation token is good for. */
const JWT_LIFETIME_SECONDS = 540

/** The API, for a GitHub Enterprise installation. */
const api = (baseUrl: string, path: string): string => `${baseUrl.replace(/\/+$/, '')}${path}`

export const github: ConnectionProvider = {
  id: 'github',
  title: 'GitHub',
  cloneUser: CLONE_USER,

  registration(redirectUri: string): Registration {
    return {
      where: 'Settings → Developer settings → GitHub Apps → New GitHub App',
      scopes: ['Contents: read'],
      redirectUri,
      notes: [
        'Install the app on the organisations or repositories to watch.',
        'The private key is the connection’s secret. Generate one for the app; it is shown only once.',
        'The platform never stores a person’s token: it mints an installation token for each clone.',
      ],
    }
  },

  authorizeUrl(params: AuthorizeParams): string {
    const url = new URL(`${params.baseUrl.replace(/\/+$/, '')}/login/oauth/authorize`)
    url.searchParams.set('client_id', params.clientId)
    url.searchParams.set('redirect_uri', params.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', params.state)
    return url.toString()
  },

  async exchange(params: ExchangeParams): Promise<Grant> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    })

    const response = await fetch(`${params.baseUrl.replace(/\/+$/, '')}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok || typeof payload.access_token !== 'string') {
      throw new Error(
        typeof payload.error_description === 'string'
          ? payload.error_description
          : `GitHub refused the authorisation code: ${response.status}`,
      )
    }

    return {
      accessToken: payload.access_token,
      tokenType: typeof payload.token_type === 'string' ? payload.token_type : undefined,
      scopes: typeof payload.scope === 'string' ? payload.scope : undefined,
    }
  },

  async listRepositories(params: GrantParams): Promise<RemoteRepository[]> {
    const token = await installationToken(params)
    const repositories: RemoteRepository[] = []

    let page = 1
    for (;;) {
      const url = new URL(api(params.baseUrl, '/installation/repositories'))
      url.searchParams.set('per_page', '100')
      url.searchParams.set('page', String(page))

      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })
      if (!response.ok) {
        throw new Error(`GitHub refused to list the repositories: ${response.status}`)
      }

      const payload = (await response.json()) as { repositories?: Array<Record<string, unknown>> }
      const page1 = payload.repositories ?? []
      if (page1.length === 0) break

      for (const repository of page1) {
        const fullName = typeof repository.full_name === 'string' ? repository.full_name : ''
        const cloneUrl = typeof repository.clone_url === 'string' ? repository.clone_url : ''
        if (!fullName || !cloneUrl) continue
        repositories.push({
          fullName,
          cloneUrl,
          private: Boolean(repository.private),
          defaultBranch: typeof repository.default_branch === 'string' ? repository.default_branch : undefined,
        })
      }

      if (page1.length < 100) break
      page += 1
    }

    return repositories
  },

  async cloneToken(params: GrantParams): Promise<Grant> {
    const token = await installationToken(params)
    return { accessToken: token, expiresAt: undefined }
  },
}

/**
 * Mint an installation token.
 *
 * The token is signed by the app's private key and lives for an hour. The
 * installation is the one the connection holds.
 */
async function installationToken(params: GrantParams): Promise<string> {
  const installationId = String(params.metadata.installationId ?? '')
  if (!installationId) {
    throw new Error('the GitHub connection has no installation')
  }

  let key: Awaited<ReturnType<typeof importPKCS8>>
  try {
    key = await importPKCS8(params.clientSecret, 'RS256')
  } catch (cause) {
    throw new Error(
      `the GitHub app's private key could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(params.clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + JWT_LIFETIME_SECONDS)
    .sign(key)

  const response = await fetch(
    api(params.baseUrl, `/app/installations/${installationId}/access_tokens`),
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${assertion}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok || typeof payload.token !== 'string') {
    throw new Error(
      typeof payload.message === 'string'
        ? payload.message
        : `GitHub would not mint an installation token: ${response.status}`,
    )
  }

  return payload.token
}

/**
 * The installations the person who authorised the app can see.
 *
 * It is how the installation a connection uses is found: a person may have
 * the app installed on several organisations.
 */
export async function listInstallations(params: {
  baseUrl: string
  accessToken: string
}): Promise<Array<{ id: number; account: string; target: string }>> {
  const installations: Array<{ id: number; account: string; target: string }> = []

  let page = 1
  for (;;) {
    const url = new URL(api(params.baseUrl, '/user/installations'))
    url.searchParams.set('per_page', '100')
    url.searchParams.set('page', String(page))

    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${params.accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub refused to list the installations: ${response.status}`)
    }

    const payload = (await response.json()) as { installations?: Array<Record<string, unknown>> }
    const page1 = payload.installations ?? []
    if (page1.length === 0) break

    for (const installation of page1) {
      const account = installation.account as Record<string, unknown> | undefined
      installations.push({
        id: Number(installation.id),
        account: typeof account?.login === 'string' ? account.login : '',
        target: typeof account?.type === 'string' ? account.type : '',
      })
    }

    if (page1.length < 100) break
    page += 1
  }

  return installations
}

export { CLONE_USER }
