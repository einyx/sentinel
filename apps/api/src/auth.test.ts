import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose'

import { Authenticator } from './auth.js'
import type { Settings } from '@sentinel/core'
import type { FastifyRequest } from 'fastify'

/**
 * The settings the authenticator reads.
 *
 * Only the parts the token verification uses are filled in; the rest of the
 * settings are not read on this path.
 */
const settings = {
  oidcIssuer: 'https://provider.invalid/oidc',
  oidcAudience: 'https://sentinel.prysm.sh/api',
  oidcAudiences: ['sentinel-console-001'],
  oidcOperatorRole: 'sentinel:operator',
} as unknown as Settings

/**
 * A store that answers the two calls the sign-in path makes.
 *
 * It behaves like the real one: a member who is already known keeps the
 * role they have.
 */
const members = new Map<string, string>()

const store = {
  ensureOrganization: async () => ({ id: 'org-1', slug: 'default', name: 'Default', createdAt: '' }),
  upsertMember: async (_organizationId: string, subject: string, _email: string | null, _name: string | null, role: string) => {
    const known = members.get(subject)
    if (!known) members.set(subject, role)
    return {
      organizationId: 'org-1',
      subject,
      email: 'alessio@example.invalid',
      name: 'Alessio',
      role: members.get(subject) ?? role,
      createdAt: '',
    }
  },
} as never

/** The key the fake provider signs with. */
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
let server: Server
let issuer: string

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  const publicJwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }

  server = createServer((request, response) => {
    const url = request.url ?? ''
    response.setHeader('Content-Type', 'application/json')
    if (url.includes('.well-known/openid-configuration')) {
      response.end(
        JSON.stringify({
          issuer,
          jwks_uri: `${issuer}/jwks`,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
        }),
      )
      return
    }
    if (url.includes('jwks')) {
      response.end(JSON.stringify({ keys: [publicJwk] }))
      return
    }
    response.statusCode = 404
    response.end('{}')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  issuer = `http://127.0.0.1:${port}/oidc`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/** A request with a bearer token. */
function requestWith(token: string): FastifyRequest {
  return { headers: { authorization: `Bearer ${token}` } } as unknown as FastifyRequest
}

/** A signed identity token. */
async function identityToken(claims: Record<string, unknown>, audience: string): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject('alessio')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey)
}

describe('the authenticator', () => {
  it('accepts the console application as the audience of an identity token', async () => {
    const authenticator = new Authenticator({ ...settings, oidcIssuer: issuer }, store)
    const token = await identityToken({ roles: ['sentinel:operator'] }, 'sentinel-console-001')
    const actor = await authenticator.authenticate(requestWith(token))

    expect(actor.kind).toBe('user')
    expect(actor.subject).toBe('alessio')
    // The operator's role makes the person an owner.
    expect(actor.role).toBe('owner')
  })

  it('accepts the resource server as the audience', async () => {
    const authenticator = new Authenticator({ ...settings, oidcIssuer: issuer }, store)
    const token = await identityToken({ roles: [] }, 'https://sentinel.prysm.sh/api')
    const actor = await authenticator.authenticate(requestWith(token))

    // A token with no role is a member, not an owner.
    expect(actor.role).toBe('member')
  })

  it('keeps a demotion an owner made by hand', async () => {
    const authenticator = new Authenticator({ ...settings, oidcIssuer: issuer }, store)
    // The member was demoted by an owner; the provider still says they are
    // an operator.
    members.set('alessio', 'member')

    const token = await identityToken({ roles: ['sentinel:operator'] }, 'sentinel-console-001')
    const actor = await authenticator.authenticate(requestWith(token))

    expect(actor.role).toBe('member')
    members.delete('alessio')
  })

  it('takes effect when the provider takes the role away', async () => {
    const authenticator = new Authenticator({ ...settings, oidcIssuer: issuer }, store)
    // The member is an owner in the organisation's list, but the provider
    // no longer grants the operator's role.
    members.set('alessio', 'owner')

    const token = await identityToken({ roles: [] }, 'sentinel-console-001')
    const actor = await authenticator.authenticate(requestWith(token))

    expect(actor.role).toBe('member')
    members.delete('alessio')
  })

  it('refuses a token minted for something else', async () => {
    const authenticator = new Authenticator({ ...settings, oidcIssuer: issuer }, store)
    const token = await identityToken({ roles: ['sentinel:operator'] }, 'another-application')

    await expect(authenticator.authenticate(requestWith(token))).rejects.toThrow(
      'this token could not be verified',
    )
  })

  it('refuses a request with no credential', async () => {
    const authenticator = new Authenticator({ ...settings, oidcIssuer: issuer }, store)
    const request = { headers: {} } as unknown as FastifyRequest

    await expect(authenticator.authenticate(request)).rejects.toThrow('this request needs a bearer token')
  })
})
