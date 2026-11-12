import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { forgejo } from './forgejo.js'

/**
 * A forge that answers like one.
 *
 * Only the two endpoints the provider calls are here: the token endpoint
 * and the list of the user's repositories.
 */
let server: Server
let baseUrl: string

/** What the mock was asked for. */
const asked: { path: string; authorization: string | undefined; body: string }[] = []

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = request.url ?? ''
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      asked.push({
        path: url,
        authorization: request.headers.authorization,
        body,
      })

      response.setHeader('Content-Type', 'application/json')

      if (url.startsWith('/login/oauth/access_token')) {
        const parameters = new URLSearchParams(body)
        if (parameters.get('grant_type') === 'refresh_token') {
          response.end(
            JSON.stringify({
              access_token: 'a-refreshed-token',
              refresh_token: 'a-refreshed-refresh-token',
              token_type: 'Bearer',
              expires_in: 3600,
              scope: 'read:repository',
            }),
          )
          return
        }
        response.end(
          JSON.stringify({
            access_token: 'an-access-token',
            refresh_token: 'a-refresh-token',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'read:repository',
          }),
        )
        return
      }

      if (url.startsWith('/api/v1/user/repos')) {
        response.end(
          JSON.stringify([
            {
              full_name: 'prysmsh/zt',
              clone_url: 'https://git.prysm.sh/prysmsh/zt.git',
              private: true,
              default_branch: 'main',
            },
            {
              full_name: 'prysmsh/prysm-compose',
              clone_url: 'https://git.prysm.sh/prysmsh/prysm-compose.git',
              private: false,
              default_branch: 'main',
            },
          ]),
        )
        return
      }

      response.statusCode = 404
      response.end('{}')
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('the forgejo provider', () => {
  it('builds the authorisation URL with the state and the scopes', () => {
    const url = new URL(
      forgejo.authorizeUrl({
        baseUrl: 'https://git.prysm.sh',
        clientId: 'an-app',
        redirectUri: 'https://sentinel.prysm.sh/auth/connect/forgejo/an-id/callback',
        state: 'a-state',
        scopes: ['read:repository'],
      }),
    )

    expect(url.origin + url.pathname).toBe('https://git.prysm.sh/login/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('an-app')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('read:repository')
    expect(url.searchParams.get('state')).toBe('a-state')
    expect(url.searchParams.get('redirect_uri')).toContain('/auth/connect/forgejo/')
  })

  it('exchanges the code for a grant', async () => {
    const grant = await forgejo.exchange({
      baseUrl,
      clientId: 'an-app',
      clientSecret: 'a-secret',
      code: 'a-code',
      redirectUri: 'https://sentinel.prysm.sh/auth/connect/forgejo/an-id/callback',
    })

    expect(grant.accessToken).toBe('an-access-token')
    expect(grant.refreshToken).toBe('a-refresh-token')
    expect(grant.scopes).toBe('read:repository')
    expect(grant.expiresAt).toBeInstanceOf(Date)

    const exchange = asked.find((entry) => entry.path.startsWith('/login/oauth/access_token'))
    expect(exchange?.body).toContain('grant_type=authorization_code')
    expect(exchange?.body).toContain('code=a-code')
  })

  it('lists the repositories the grant can read', async () => {
    const repositories = await forgejo.listRepositories({
      baseUrl,
      clientId: 'an-app',
      clientSecret: 'a-secret',
      accessToken: 'an-access-token',
      metadata: {},
    })

    expect(repositories).toHaveLength(2)
    expect(repositories[0].fullName).toBe('prysmsh/zt')
    expect(repositories[0].cloneUrl).toBe('https://git.prysm.sh/prysmsh/zt.git')
    expect(repositories[0].private).toBe(true)

    const list = asked.find((entry) => entry.path.startsWith('/api/v1/user/repos'))
    expect(list?.authorization).toBe('token an-access-token')
  })

  it('keeps the token when it is not about to lapse', async () => {
    const grant = await forgejo.cloneToken({
      baseUrl,
      clientId: 'an-app',
      clientSecret: 'a-secret',
      accessToken: 'an-access-token',
      refreshToken: 'a-refresh-token',
      expiresAt: new Date(Date.now() + 3600_000),
      metadata: {},
    })

    expect(grant.accessToken).toBe('an-access-token')
  })

  it('renews the grant when it is about to lapse', async () => {
    const grant = await forgejo.cloneToken({
      baseUrl,
      clientId: 'an-app',
      clientSecret: 'a-secret',
      accessToken: 'an-access-token',
      refreshToken: 'a-refresh-token',
      expiresAt: new Date(Date.now() + 10_000),
      metadata: {},
    })

    expect(grant.accessToken).toBe('a-refreshed-token')
    expect(grant.refreshToken).toBe('a-refreshed-refresh-token')

    const renewal = asked.filter((entry) => entry.path.startsWith('/login/oauth/access_token')).at(-1)
    expect(renewal?.body).toContain('grant_type=refresh_token')
  })
})
