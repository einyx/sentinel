/**
 * Forgejo and Gitea.
 *
 * The forge's OAuth2 provider is the same in both: an authorisation code,
 * an access token, and a refresh token. The token is used as the password of
 * a clone, with the user name the forge expects.
 */

import type {
  AuthorizeParams,
  ConnectionProvider,
  ExchangeParams,
  Grant,
  GrantParams,
  Registration,
  RemoteRepository,
} from './types.js'

/** The user name a clone uses with an OAuth token. */
const CLONE_USER = 'oauth2'

/** Trim a trailing slash, so a base URL can be joined with a path. */
const trim = (url: string): string => url.replace(/\/+$/, '')

export const forgejo: ConnectionProvider = {
  id: 'forgejo',
  title: 'Forgejo',
  cloneUser: CLONE_USER,

  registration(redirectUri: string): Registration {
    return {
      where: 'Settings → Applications → OAuth2 Applications → Generate a new token',
      scopes: ['read:repository'],
      redirectUri,
      notes: [
        'The client secret is the one the forge shows when the application is created.',
        'The token is used to read the repositories it can see, and nothing else.',
      ],
    }
  },

  authorizeUrl(params: AuthorizeParams): string {
    const url = new URL(`${trim(params.baseUrl)}/login/oauth/authorize`)
    url.searchParams.set('client_id', params.clientId)
    url.searchParams.set('redirect_uri', params.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', params.scopes.join(' '))
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

    const response = await fetch(`${trim(params.baseUrl)}/login/oauth/access_token`, {
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
          : `the forge refused the authorisation code: ${response.status}`,
      )
    }

    return {
      accessToken: payload.access_token,
      refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined,
      tokenType: typeof payload.token_type === 'string' ? payload.token_type : undefined,
      scopes: typeof payload.scope === 'string' ? payload.scope : undefined,
      expiresAt: typeof payload.expires_in === 'number' ? new Date(Date.now() + payload.expires_in * 1000) : undefined,
    }
  },

  async listRepositories(params: GrantParams): Promise<RemoteRepository[]> {
    const repositories: RemoteRepository[] = []
    let page = 1

    // The forge pages the list. The page size is the maximum it allows, so
    // a big organisation is walked in as few requests as it can be.
    for (;;) {
      const url = new URL(`${trim(params.baseUrl)}/api/v1/user/repos`)
      url.searchParams.set('limit', '50')
      url.searchParams.set('page', String(page))

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `token ${params.accessToken}`,
        },
      })
      if (!response.ok) {
        throw new Error(`the forge refused to list the repositories: ${response.status}`)
      }

      const page1 = (await response.json()) as Array<Record<string, unknown>>
      if (!Array.isArray(page1) || page1.length === 0) break

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

      if (page1.length < 50) break
      page += 1
    }

    return repositories
  },

  async cloneToken(params: GrantParams): Promise<Grant> {
    // The access token lives for an hour by default. A clone that starts
    // with a token that is about to lapse fails halfway through the fetch,
    // so the grant is renewed first when it is close to the end.
    const expiringSoon =
      params.expiresAt !== null &&
      params.expiresAt !== undefined &&
      params.expiresAt.getTime() - Date.now() < 60_000

    if (!expiringSoon) {
      return {
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        expiresAt: params.expiresAt ?? undefined,
      }
    }

    if (!params.refreshToken) {
      throw new Error('the grant has expired and there is no refresh token')
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    })

    const response = await fetch(`${trim(params.baseUrl)}/login/oauth/access_token`, {
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
          : `the grant could not be renewed: ${response.status}`,
      )
    }

    return {
      accessToken: payload.access_token,
      refreshToken:
        typeof payload.refresh_token === 'string' ? payload.refresh_token : params.refreshToken,
      tokenType: typeof payload.token_type === 'string' ? payload.token_type : undefined,
      scopes: typeof payload.scope === 'string' ? payload.scope : undefined,
      expiresAt:
        typeof payload.expires_in === 'number' ? new Date(Date.now() + payload.expires_in * 1000) : undefined,
    }
  },

  async revoke(params: GrantParams): Promise<void> {
    // Forgejo has no endpoint for withdrawing a token: the application is
    // deleted instead, and the token dies with it. There is nothing to do
    // here but forget the grant.
    void params
  },
}

export { CLONE_USER }
