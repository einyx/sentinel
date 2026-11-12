/**
 * Who is asking.
 *
 * There are two kinds of caller:
 *
 *   - a person, who signed in at the provider and holds an OpenID Connect
 *     token. The token is verified against the provider's signing keys, and
 *     the claims say which organisation the person is in and what they may
 *     do there.
 *
 *   - a machine, which holds an API token. The token is looked up by its
 *     hash; the secret itself is never stored.
 *
 * Both end up as an actor: an organisation, a subject and a role.
 */

import type { FastifyReply, FastifyRequest } from 'fastify'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

import { hashToken } from '@sentinel/core'
import type { Settings } from '@sentinel/core'
import type { MemberRole, Store } from '@sentinel/core'

/** Who is asking. */
export interface Actor {
  /** The organisation the request is for. */
  organizationId: string
  /** Who the caller is: the provider's subject, or the API token's name. */
  subject: string
  /** The name of the person or the token. */
  name: string | null
  email: string | null
  role: MemberRole
  kind: 'user' | 'token'
}

/** The claims the platform reads out of a provider token. */
interface ProviderClaims extends JWTPayload {
  name?: string
  preferred_username?: string
  email?: string
  tenant_id?: string
  organization_id?: string
  organizations?: string[]
  organization_roles?: string[][]
  roles?: string[]
}

/**
 * The provider's signing keys.
 *
 * They are fetched from the provider's discovery document, so the platform
 * does not have to be told where they are.
 */
class ProviderKeys {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null
  private jwksUri: string | null = null

  constructor(private readonly issuer: string) {}

  /** The signing keys, fetched once and kept. */
  private async keys(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    if (this.jwks) return this.jwks

    const discoveryUrl = `${this.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
    const response = await fetch(discoveryUrl)
    if (!response.ok) {
      throw new Error(`the provider's discovery document could not be read: ${response.status}`)
    }
    const document = (await response.json()) as { jwks_uri?: string }
    if (!document.jwks_uri) {
      throw new Error("the provider's discovery document has no jwks_uri")
    }
    this.jwksUri = document.jwks_uri
    this.jwks = createRemoteJWKSet(new URL(document.jwks_uri))
    return this.jwks
  }

  /** Verify a token and return its claims. */
  async verify(token: string, audiences: string[]): Promise<ProviderClaims> {
    const keys = await this.keys()
    const { payload } = await jwtVerify(token, keys, {
      issuer: this.issuer,
      ...(audiences.length ? { audience: audiences } : {}),
    })
    return payload as ProviderClaims
  }

  /** Where the signing keys live. It is shown in the console's settings. */
  get uri(): string | null {
    return this.jwksUri
  }
}

/**
 * The organisation a token belongs to.
 *
 * The provider names it in one of several ways, depending on how the
 * application is set up. The first one that is there wins; when none of
 * them is, the request is for the default organisation.
 */
function organizationOf(claims: ProviderClaims): string {
  if (typeof claims.organization_id === 'string' && claims.organization_id) return claims.organization_id
  if (typeof claims.tenant_id === 'string' && claims.tenant_id) return claims.tenant_id
  if (Array.isArray(claims.organizations) && claims.organizations.length === 1) return claims.organizations[0]
  return 'default'
}

/**
 * The role a token grants.
 *
 * The provider's roles are read as they are: an administrative role makes
 * the caller an owner, anything else makes them a member. A token that
 * names no role at all is a member.
 */
function roleOf(claims: ProviderClaims, organization: string, operatorRole: string): MemberRole {
  const roles = new Set<string>()
  for (const role of claims.roles ?? []) {
    if (typeof role === 'string') roles.add(role.toLowerCase())
  }
  if (Array.isArray(claims.organization_roles)) {
    // Logto sends the roles of each organisation the caller is in, in the
    // same order as the `organizations` claim.
    const index = (claims.organizations ?? []).indexOf(organization)
    const scoped = index >= 0 ? claims.organization_roles[index] : undefined
    for (const role of scoped ?? []) {
      if (typeof role === 'string') roles.add(role.toLowerCase())
    }
  }
  for (const role of roles) {
    if (role === 'admin' || role === 'root' || role === 'owner') return 'owner'
  }
  // The organisation's own operator role. It is named by the deployment,
  // because the name is part of the contract with the provider.
  if (roles.has(operatorRole.toLowerCase())) return 'owner'
  return 'member'
}

/**
 * The authenticator.
 *
 * It turns a request into an actor, or refuses the request.
 */
export class Authenticator {
  private readonly keys: ProviderKeys | null

  constructor(
    private readonly settings: Settings,
    private readonly store: Store,
  ) {
    this.keys = settings.oidcIssuer ? new ProviderKeys(settings.oidcIssuer) : null
  }

  /** Whether a person can sign in at all. */
  get enabled(): boolean {
    return this.keys !== null
  }

  /** Where the provider's signing keys are. */
  get jwksUri(): string | null {
    return this.keys?.uri ?? null
  }

  /**
   * The actor for a request.
   *
   * Throws when the request carries no usable credential.
   */
  async authenticate(request: FastifyRequest): Promise<Actor> {
    const header = request.headers.authorization
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new AuthError('this request needs a bearer token', 401)
    }
    const token = header.slice(7).trim()
    if (!token) {
      throw new AuthError('this request needs a bearer token', 401)
    }

    if (token.startsWith('snt_')) {
      return this.authenticateApiToken(token)
    }
    return this.authenticateProviderToken(token)
  }

  /**
   * The audiences a token may carry.
   *
   * The console's identity token carries the application's identifier as
   * its audience, and the access token carries the resource server's
   * indicator. Both are accepted.
   */
  private audiences(): string[] {
    const audiences = [this.settings.oidcAudience, ...this.settings.oidcAudiences]
    return [...new Set(audiences.filter(Boolean))]
  }

  /** The actor for an API token. */
  private async authenticateApiToken(token: string): Promise<Actor> {
    const record = await this.store.findApiTokenByHash(hashToken(token))
    if (!record) {
      throw new AuthError('this API token is not known, or it has been revoked', 401)
    }
    await this.store.touchApiToken(record.id)
    return {
      organizationId: record.organizationId,
      subject: record.id,
      name: record.name,
      email: null,
      role: record.role,
      kind: 'token',
    }
  }

  /** The actor for a provider token. */
  private async authenticateProviderToken(token: string): Promise<Actor> {
    if (!this.keys) {
      throw new AuthError('this deployment has no identity provider configured', 401)
    }

    let claims: ProviderClaims
    try {
      claims = await this.keys.verify(token, this.audiences())
    } catch {
      throw new AuthError('this token could not be verified', 401)
    }

    const subject = claims.sub
    if (!subject) {
      throw new AuthError('this token has no subject', 401)
    }

    const organizationSlug = organizationOf(claims)
    const organization = await this.store.ensureOrganization(organizationSlug, organizationSlug)
    const role = roleOf(claims, organizationSlug, this.settings.oidcOperatorRole)
    const name =
      (typeof claims.name === 'string' && claims.name) ||
      (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
      null
    const email = typeof claims.email === 'string' ? claims.email : null

    const member = await this.store.upsertMember(organization.id, subject, email, name, role)

    return {
      organizationId: organization.id,
      subject,
      name: member.name ?? name,
      email: member.email ?? email,
      // The effective role is the weaker of the two: what the provider
      // grants, and what the organisation's own member list says. A
      // demotion by an owner sticks, and a role the provider takes away
      // takes effect at the next sign-in.
      role: weakerRole(member.role, role),
      kind: 'user',
    }
  }
}

/** The error an authenticator raises. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode = 401,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * The role a route needs.
 *
 * The roles are in order: `viewer` is the least and `owner` the most, so a
 * route that asks for `member` accepts a member and an owner.
 */
const ROLE_ORDER: Record<MemberRole, number> = { viewer: 0, member: 1, owner: 2 }

/**
 * The weaker of two roles.
 *
 * The role the provider grants and the role the organisation's member list
 * says are two different things, and the caller gets the lesser of them.
 */
export function weakerRole(a: MemberRole, b: MemberRole): MemberRole {
  return ROLE_ORDER[a] <= ROLE_ORDER[b] ? a : b
}

/** Whether the actor may use a route. */
export function hasRole(actor: Actor, required: MemberRole): boolean {
  return ROLE_ORDER[actor.role] >= ROLE_ORDER[required]
}

/**
 * The actor of a request, or a refusal.
 */
export function requireActor(request: FastifyRequest, reply: FastifyReply): Actor | null {
  const actor = (request as FastifyRequest & { actor?: Actor }).actor
  if (!actor) {
    void reply.code(401).send({ error: 'this request needs a bearer token' })
    return null
  }
  return actor
}
