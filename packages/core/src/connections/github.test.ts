import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { exportPKCS8, generateKeyPair } from 'jose'

import { github, listInstallations } from './github.js'

/**
 * A GitHub that answers like one.
 *
 * The endpoints the provider calls are here: the token exchange, the list of
 * the person's installations, and the minting of an installation token.
 */
let server: Server
let baseUrl: string
let privateKey: string

/** The authorisations the mock was asked with. */
const asked: { path: string; authorization: string | undefined }[] = []

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = await exportPKCS8(pair.privateKey)

  server = createServer((request, response) => {
    const url = request.url ?? ''
    asked.push({ path: url, authorization: request.headers.authorization })
    response.setHeader('Content-Type', 'application/json')

    if (url.startsWith('/login/oauth/access_token')) {
      response.end(
        JSON.stringify({
          access_token: 'a-user-token',
          token_type: 'bearer',
          scope: 'read:user',
        }),
      )
      return
    }

    if (url.startsWith('/user/installations')) {
      response.end(
        JSON.stringify({
          installations: [
            { id: 42, account: { login: 'prysmsh', type: 'Organization' } },
          ],
        }),
      )
      return
    }

    if (url.includes('/access_tokens')) {
      response.end(JSON.stringify({ token: 'an-installation-token', expires_at: '2026-01-01T00:00:00Z' }))
      return
    }

    if (url.startsWith('/installation/repositories')) {
      response.end(
        JSON.stringify({
          total_count: 1,
          repositories: [
            {
              full_name: 'prysmsh/prysm',
              clone_url: 'https://github.com/prysmsh/prysm.git',
              private: true,
              default_branch: 'master',
            },
          ],
        }),
      )
      return
    }

    response.statusCode = 404
    response.end('{}')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('the github provider', () => {
  it('builds the authorisation URL', () => {
    const url = new URL(
      github.authorizeUrl({
        baseUrl: 'https://github.com',
        clientId: 'an-app',
        redirectUri: 'https://sentinel.prysm.sh/auth/connect/github/an-id/callback',
        state: 'a-state',
        scopes: [],
      }),
    )

    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('an-app')
    expect(url.searchParams.get('state')).toBe('a-state')
  })

  it('exchanges the code for a grant', async () => {
    const grant = await github.exchange({
      baseUrl,
      clientId: 'an-app',
      clientSecret: privateKey,
      code: 'a-code',
      redirectUri: 'https://sentinel.prysm.sh/auth/connect/github/an-id/callback',
    })

    expect(grant.accessToken).toBe('a-user-token')
  })

  it('finds the installations the person can see', async () => {
    const installations = await listInstallations({ baseUrl, accessToken: 'a-user-token' })

    expect(installations).toHaveLength(1)
    expect(installations[0].id).toBe(42)
    expect(installations[0].account).toBe('prysmsh')
  })

  it('mints an installation token for the clone', async () => {
    const grant = await github.cloneToken({
      baseUrl,
      clientId: 'an-app',
      clientSecret: privateKey,
      accessToken: 'a-user-token',
      metadata: { installationId: 42 },
    })

    expect(grant.accessToken).toBe('an-installation-token')

    // The token is minted with a signed assertion, not with the person's
    // token: that is what makes the connection an app and not a person.
    const minting = asked.find((entry) => entry.path.includes('/access_tokens'))
    expect(minting?.authorization).toMatch(/^Bearer ey/)
  })

  it('refuses to mint a token without an installation', async () => {
    await expect(
      github.cloneToken({
        baseUrl,
        clientId: 'an-app',
        clientSecret: privateKey,
        accessToken: 'a-user-token',
        metadata: {},
      }),
    ).rejects.toThrow('no installation')
  })

  it('lists the repositories the installation can read', async () => {
    const repositories = await github.listRepositories({
      baseUrl,
      clientId: 'an-app',
      clientSecret: privateKey,
      accessToken: 'a-user-token',
      metadata: { installationId: 42 },
    })

    expect(repositories).toHaveLength(1)
    expect(repositories[0].fullName).toBe('prysmsh/prysm')
    expect(repositories[0].cloneUrl).toBe('https://github.com/prysmsh/prysm.git')
  })
})
