/**
 * The API.
 *
 * Everything the console does goes through here. The routes are the shape
 * of the product: repositories to watch, findings to deal with, the
 * insights that say where the risk is, and the settings that make it work.
 */

import { randomBytes, randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  decrypt,
  encrypt,
  generateApiToken,
  generateHoneytoken,
  hashToken,
  honeytokenFingerprint,
  checkValidity,
  connectionProvider,
  connectionProviderIds,
  connectionProviders,
  listInstallations,
  listRules,
  type FindingStatus,
  type MemberRole,
  type Provider,
  type Settings,
  type Store,
  type Validity,
} from '@sentinel/core'

import { AuthError, hasRole, type Actor } from './auth.js'
import { listRemoteRepositories, resolveConnection } from './connections.js'

/** The status values a finding may take. */
const STATUSES: FindingStatus[] = ['open', 'acknowledged', 'resolved', 'ignored']

/** The role values a member may take. */
const ROLES: MemberRole[] = ['owner', 'member', 'viewer']

/** The provider values a repository may take. */
const PROVIDERS: Provider[] = ['github', 'forgejo', 'gitlab', 'generic']

/**
 * Register the routes.
 */
export async function registerRoutes(
  app: FastifyInstance,
  options: { settings: Settings; store: Store },
): Promise<void> {
  const { settings, store } = options

  /** The actor of the request. The hook has already refused a request that has none. */
  const actorOf = (request: FastifyRequest): Actor =>
    (request as FastifyRequest & { actor: Actor }).actor

  /** Refuse a request the caller's role does not cover. */
  const requireRole = (request: FastifyRequest, reply: FastifyReply, role: MemberRole): boolean => {
    if (!hasRole(actorOf(request), role)) {
      void reply.code(403).send({ error: 'this action needs a higher role' })
      return false
    }
    return true
  }

  /**
   * The origin the browser reaches the API at.
   *
   * The console's own server forwards the requests, so the origin is taken
   * from the forwarded headers rather than from the connection.
   */
  const originOf = (request: FastifyRequest): string =>
    `${request.protocol}://${request.headers.host ?? 'localhost'}`

  /** The body of a request, as a record. */
  const bodyOf = (request: FastifyRequest): Record<string, unknown> =>
    (request.body ?? {}) as Record<string, unknown>

  /**
   * Whether an error is a unique constraint.
   *
   * Postgres says so with its own code, and a name that is already taken
   * is a thing the operator did, not a fault of the service.
   */
  const isDuplicate = (error: unknown): boolean =>
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'

  app.get('/health', async () => ({ ok: true, service: 'sentinel' }))

  // -- who am I -------------------------------------------------------------

  app.get('/me', async (request) => {
    const actor = actorOf(request)
    const organization = await store.getOrganization(actor.organizationId)
    return {
      actor: {
        subject: actor.subject,
        name: actor.name,
        email: actor.email,
        role: actor.role,
        kind: actor.kind,
      },
      organization,
      identityProvider: settings.oidcIssuer || null,
    }
  })

  // -- the dashboard --------------------------------------------------------

  app.get('/summary', async (request) => {
    const actor = actorOf(request)
    return store.summary(actor.organizationId)
  })

  app.get('/insights', async (request) => {
    const actor = actorOf(request)
    return store.insights(actor.organizationId)
  })

  // -- connections ----------------------------------------------------------

  /**
   * The providers, and what the operator has to register to use them.
   */
  app.get('/connections/providers', async (request) => {
    const redirectUri = (provider: string): string =>
      `${originOf(request)}/auth/connect/${provider}/callback`

    // The forges the deployment has registered with come first: connecting
    // to one of them is a single click, because the application is already
    // registered and nobody has to copy an id or a secret anywhere.
    const preRegistered = settings.preRegisteredProviders.map((entry) => {
      const provider = connectionProviders[entry.provider]
      return {
        id: entry.provider,
        key: entry.baseUrl,
        title: entry.name,
        preRegistered: true,
        registration: provider.registration(redirectUri(entry.provider)),
      }
    })

    const manual = connectionProviderIds
      .filter((id) => !settings.preRegisteredProviders.some((entry) => entry.provider === id))
      .map((id) => {
        const provider = connectionProviders[id]
        return {
          id,
          title: provider.title,
          preRegistered: false,
          registration: provider.registration(redirectUri(id)),
        }
      })

    return { providers: [...preRegistered, ...manual] }
  })

  app.get('/connections', async (request) => {
    const actor = actorOf(request)
    return { connections: await store.listConnections(actor.organizationId) }
  })

  /**
   * Start a connection.
   *
   * The row is created first, and the state it carries is what ties the
   * authorisation that comes back to this connection and to nobody else.
   */
  app.post('/connections', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'member')) return

    const body = bodyOf(request)
    const provider = connectionProvider(String(body.provider ?? ''))
    if (!provider) {
      return reply.code(400).send({ error: 'unknown provider' })
    }

    // A forge the deployment has registered with needs nothing from the
    // operator: the application is already there, and the operator only
    // has to authorise it.
    const deployment = settings.preRegisteredProviders.find(
      (entry) => entry.provider === provider.id,
    )

    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : provider.title
    const baseUrl = deployment?.baseUrl ?? (typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '')
    const clientId = deployment?.clientId ?? (typeof body.clientId === 'string' ? body.clientId.trim() : '')
    const clientSecret =
      deployment?.clientSecret ?? (typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '')

    if (!baseUrl || !clientId || !clientSecret) {
      return reply.code(400).send({
        error: 'a connection needs the address of the forge, the application id and the application secret',
      })
    }

    // The redirect URI is the same for every connection of a provider: the
    // application is registered once, and the URI it was registered with
    // cannot name a connection that does not exist yet.
    const redirectUri = `${originOf(request)}/auth/connect/${provider.id}/callback`

    // The state carries the connection it belongs to, and the API looks the
    // connection up by it: the callback says which connection it is
    // finishing, without the state being handed out with the connection.
    const id = randomUUID()
    const state = `${id}.${randomBytes(24).toString('base64url')}`

    const connection = await store.createConnection({
      id,
      organizationId: actor.organizationId,
      provider: provider.id,
      name,
      baseUrl,
      clientId,
      // The secret of a deployment's own application is kept out of the
      // row: it comes from the deployment, so rotating it there does not
      // break the connections that were made with it.
      clientSecretCiphertext: deployment ? '' : encrypt(clientSecret, settings.encryptionKey),
      state,
    })

    await store.audit(actor.organizationId, actor.subject, 'connection.create', connection.id, {
      provider: provider.id,
      name,
    })

    return reply.code(201).send({
      connection,
      redirectUri,
      authorizeUrl: provider.authorizeUrl({
        baseUrl,
        clientId,
        redirectUri,
        state,
        scopes: provider.registration(redirectUri).scopes,
      }),
    })
  })

  /**
   * The authorisation came back: the grant is exchanged and kept.
   */
  app.post('/connections/:id/complete', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'member')) return

    const { id } = request.params as { id: string }
    const body = bodyOf(request)
    const code = typeof body.code === 'string' ? body.code : ''
    const state = typeof body.state === 'string' ? body.state : ''
    if (!code) {
      return reply.code(400).send({ error: 'the authorisation carried no code' })
    }

    const connection = await store.getConnection(id)
    if (!connection || connection.organizationId !== actor.organizationId) {
      return reply.code(404).send({ error: 'no such connection' })
    }
    // The state is what ties the authorisation that came back to this
    // connection. It is looked up rather than compared, so it is never
    // handed out with the connection.
    const pending = await store.findConnectionByState(state)
    if (!pending || pending.id !== id || pending.organizationId !== actor.organizationId) {
      return reply.code(400).send({ error: 'the authorisation does not match this connection' })
    }

    const provider = connectionProvider(connection.provider)
    const secrets = await store.getConnectionSecrets(id)
    if (!provider || !secrets) {
      return reply.code(409).send({ error: 'the connection cannot be completed' })
    }

    const redirectUri = `${originOf(request)}/auth/connect/${provider.id}/callback`
    let grant
    try {
      const deployment = settings.preRegisteredProviders.find(
        (entry) => entry.provider === connection.provider && entry.baseUrl === connection.baseUrl,
      )
      grant = await provider.exchange({
        baseUrl: connection.baseUrl,
        clientId: deployment?.clientId ?? connection.clientId,
        clientSecret: deployment
          ? deployment.clientSecret
          : decrypt(secrets.clientSecret, settings.encryptionKey),
        code,
        redirectUri,
      })
    } catch (error) {
      await store.setConnectionStatus(id, 'needs_attention')
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'the authorisation could not be exchanged',
      })
    }

    // GitHub's grant belongs to an app, not to a repository: the
    // installation is what says which repositories the token can read.
    const metadata: Record<string, unknown> = { ...connection.metadata }
    if (connection.provider === 'github') {
      try {
        const installations = await listInstallations({
          baseUrl: connection.baseUrl,
          accessToken: grant.accessToken,
        })
        if (!installations.length) {
          await store.setConnectionStatus(id, 'needs_attention')
          return reply.code(409).send({
            error: 'the GitHub app is not installed on any account: install it and try again',
          })
        }
        metadata.installationId = installations[0].id
        metadata.installationAccount = installations[0].account
        metadata.installations = installations
      } catch (error) {
        await store.setConnectionStatus(id, 'needs_attention')
        return reply.code(400).send({
          error: error instanceof Error ? error.message : 'the installations could not be listed',
        })
      }
    }

    const completed = await store.completeConnection(
      id,
      {
        accessTokenCiphertext: encrypt(grant.accessToken, settings.encryptionKey),
        refreshTokenCiphertext: grant.refreshToken ? encrypt(grant.refreshToken, settings.encryptionKey) : null,
        tokenType: grant.tokenType ?? null,
        scopes: grant.scopes ?? null,
        expiresAt: grant.expiresAt ? grant.expiresAt.toISOString() : null,
        account:
          grant.account ??
          (typeof metadata.installationAccount === 'string' ? metadata.installationAccount : null),
      },
      metadata,
    )

    await store.audit(actor.organizationId, actor.subject, 'connection.complete', id, {
      provider: connection.provider,
    })

    return { connection: completed }
  })

  /** The repositories the grant can read. */
  app.get('/connections/:id/repositories', async (request, reply) => {
    const actor = actorOf(request)
    const { id } = request.params as { id: string }
    const connection = await store.getConnection(id)
    if (!connection || connection.organizationId !== actor.organizationId) {
      return reply.code(404).send({ error: 'no such connection' })
    }
    try {
      const resolved = await resolveConnection(
        store,
        id,
        settings.encryptionKey,
        settings.preRegisteredProviders,
      )
      return { repositories: await listRemoteRepositories(resolved) }
    } catch (error) {
      await store.setConnectionStatus(id, 'needs_attention')
      return reply.code(409).send({
        error: error instanceof Error ? error.message : 'the connection cannot be used',
      })
    }
  })

  /** Withdraw a connection. */
  app.delete('/connections/:id', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'member')) return
    const { id } = request.params as { id: string }
    const connection = await store.getConnection(id)
    if (!connection || connection.organizationId !== actor.organizationId) {
      return reply.code(404).send({ error: 'no such connection' })
    }
    await store.revokeConnection(id, actor.organizationId)
    await store.audit(actor.organizationId, actor.subject, 'connection.revoke', id, {
      provider: connection.provider,
      name: connection.name,
    })
    return reply.code(204).send()
  })

  // -- repositories ---------------------------------------------------------

  app.get('/repositories', async (request) => {
    const actor = actorOf(request)
    return { repositories: await store.listRepositories(actor.organizationId) }
  })

  app.post('/repositories', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'member')) return

    const body = bodyOf(request)
    let name = typeof body.name === 'string' ? body.name.trim() : ''
    let cloneUrl = typeof body.cloneUrl === 'string' ? body.cloneUrl.trim() : ''

    let provider = (typeof body.provider === 'string' ? body.provider : 'generic') as Provider

    let credentialId: string | null = null
    let connectionId: string | null = null
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    if (token) {
      const credential = await store.createCredential(
        actor.organizationId,
        typeof body.username === 'string' && body.username.trim() ? body.username.trim() : null,
        encrypt(token, settings.encryptionKey),
      )
      credentialId = credential.id
    }

    // A repository can also be picked from a connection, in which case the
    // grant is what clones it.
    if (typeof body.connectionId === 'string' && body.connectionId) {
      const connection = await store.getConnection(body.connectionId)
      if (!connection || connection.organizationId !== actor.organizationId) {
        return reply.code(400).send({ error: 'no such connection' })
      }
      if (connection.status !== 'active') {
        return reply.code(400).send({ error: 'the connection is not usable' })
      }
      const remoteName = typeof body.remoteName === 'string' ? body.remoteName.trim() : ''
      const resolved = await resolveConnection(
        store,
        connection.id,
        settings.encryptionKey,
        settings.preRegisteredProviders,
      )
      const repositories = await listRemoteRepositories(resolved)
      const remote = repositories.find((repository) => repository.fullName === remoteName)
      if (!remote) {
        return reply.code(400).send({
          error: 'the connection cannot read that repository',
        })
      }
      connectionId = connection.id
      cloneUrl = remote.cloneUrl
      provider = connection.provider === 'github' ? 'github' : 'forgejo'
      if (!name) name = remote.fullName
    }

    // A repository is watched with a token that was pasted in, or with a
    // grant the forge gave the platform. One of the two has to be there.
    if (!cloneUrl) {
      return reply.code(400).send({
        error: 'a repository needs a clone URL, or a connection to take it from',
      })
    }

    if (!PROVIDERS.includes(provider)) {
      return reply.code(400).send({ error: `unknown provider: ${provider}` })
    }

    const interval = Number(body.scanIntervalMinutes)
    let repository
    try {
      repository = await store.createRepository({
        organizationId: actor.organizationId,
        name: name || cloneUrl,
        provider,
        cloneUrl,
        credentialId,
        connectionId,
        scanIntervalMinutes: Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : 360,
      })
    } catch (error) {
      if (isDuplicate(error)) {
        return reply.code(409).send({ error: 'a repository with that name is already watched' })
      }
      throw error
    }

    await store.audit(actor.organizationId, actor.subject, 'repository.create', repository.id, { name })
    return reply.code(201).send({ repository })
  })

  app.get('/repositories/:id', async (request, reply) => {
    const actor = actorOf(request)
    const { id } = request.params as { id: string }
    const repository = await store.getRepository(id)
    if (!repository || repository.organizationId !== actor.organizationId) {
      return reply.code(404).send({ error: 'no such repository' })
    }
    return { repository, ignores: await store.listIgnores(id) }
  })

  app.patch('/repositories/:id', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'member')) return
    const { id } = request.params as { id: string }
    const body = bodyOf(request)

    const existing = await store.getRepository(id)
    if (!existing || existing.organizationId !== actor.organizationId) {
      return reply.code(404).send({ error: 'no such repository' })
    }

    const changes: Parameters<typeof store.updateRepository>[1] = {}
    if (typeof body.name === 'string' && body.name.trim()) changes.name = body.name.trim()
    if (typeof body.enabled === 'boolean') changes.enabled = body.enabled
    if (typeof body.scanIntervalMinutes === 'number' && body.scanIntervalMinutes > 0) {
      changes.scanIntervalMinutes = Math.floor(body.scanIntervalMinutes)
    }
    if (body.token !== undefined) {
      const token = typeof body.token === 'string' ? body.token.trim() : ''
      if (!token) {
        return reply.code(400).send({ error: 'the token cannot be empty' })
      }
      const credential = await store.createCredential(
        actor.organizationId,
        typeof body.username === 'string' && body.username.trim() ? body.username.trim() : null,
        encrypt(token, settings.encryptionKey),
      )
      changes.credentialId = credential.id
    }

    const repository = await store.updateRepository(id, changes)
    await store.audit(actor.organizationId, actor.subject, 'repository.update', id, changes as Record<string, unknown>)
    return { repository }
  })

  app.delete('/repositories/:id', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'owner')) return
    const { id } = request.params as { id: string }
    const repository = await store.getRepository(id)
    if (!repository || repository.organizationId !== actor.organizationId) {
      return reply.code(404).send({ error: 'no such repository' })
    }
    await store.deleteRepository(id)
    await store.audit(actor.organizationId, actor.subject, 'repository.delete', id, {
      name: repository.name,
    })
    return reply.code(204).send()
  })

  app.post('/repositories/:id/scan', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'member')) return
    const { id } = request.params as { id: string }
    const repository = await store.getRepository(id)
    if (!repository || repository.organizationId !== actor.organizationId) {
      return reply.code(404).send({ error: 'no such repository' })
    }
    await store.requestScan(id)
    await store.audit(actor.organizationId, actor.subject, 'repository.scan', id, { name: repository.name })
    return reply.code(202).send({ queued: true })
  })

  // -- ignores --------------------------------------------------------------

  app.get('/repositories/:id/ignores', async (request, reply) => {
    const actor = actorOf(request)
    const { id } = request.params as { id: string }
    const repository = await store.getRepository(id)
    if (!repository || repository.organizationId !== actor.organizationId) {
      return reply.code(404).send({ error: 'no such repository' })
    }
    return { ignores: await store.listIgnores(id) }
  })

  app.post('/repositories/:id/ignores', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'member')) return
    const { id } = request.params as { id: string }
    const body = bodyOf(request)
    const repository = await store.getRepository(id)
    if (!repository || repository.organizationId !== actor.organizationId) {
      return reply.code(404).send({ error: 'no such repository' })
    }
    const kind = body.kind === 'rule' ? 'rule' : 'path'
    const value = typeof body.value === 'string' ? body.value.trim() : ''
    if (!value) {
      return reply.code(400).send({ error: 'an ignore needs a value' })
    }
    const ignore = await store.createIgnore(id, kind, value)
    await store.audit(actor.organizationId, actor.subject, 'repository.ignore', id, { kind, value })
    return reply.code(201).send({ ignore })
  })

  app.delete('/ignores/:id', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'member')) return
    const { id } = request.params as { id: string }
    const removed = await store.deleteIgnore(id, actor.organizationId)
    if (!removed) {
      return reply.code(404).send({ error: 'no such ignore' })
    }
    await store.audit(actor.organizationId, actor.subject, 'repository.unignore', id)
    return reply.code(204).send()
  })

  // -- findings -------------------------------------------------------------

  app.get('/findings', async (request) => {
    const actor = actorOf(request)
    const query = request.query as Record<string, string | undefined>
    const limit = Math.min(Number(query.limit ?? 50) || 50, 200)
    const offset = Math.max(Number(query.offset ?? 0) || 0, 0)

    const status = query.status as FindingStatus | undefined
    const validity = query.validity as Validity | undefined

    const result = await store.listFindings(actor.organizationId, {
      repositoryId: query.repositoryId,
      status: status && STATUSES.includes(status) ? status : undefined,
      validity: validity && ['unknown', 'valid', 'revoked', 'invalid'].includes(validity) ? validity : undefined,
      ruleId: query.ruleId,
      author: query.author,
      assignee: query.assignee,
      search: query.search,
      limit,
      offset,
    })
    return { ...result, limit, offset }
  })

  app.get('/findings/:id', async (request, reply) => {
    const actor = actorOf(request)
    const { id } = request.params as { id: string }
    const finding = await store.getFinding(id)
    if (!finding) {
      return reply.code(404).send({ error: 'no such finding' })
    }
    const repository = await store.getRepository(finding.repositoryId)
    if (!repository || repository.organizationId !== actor.organizationId) {
      return reply.code(404).send({ error: 'no such finding' })
    }
    return { finding, notes: await store.listNotes(id) }
  })

  app.patch('/findings/:id', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'member')) return
    const { id } = request.params as { id: string }
    const body = bodyOf(request)

    const finding = await store.getFinding(id)
    if (!finding) {
      return reply.code(404).send({ error: 'no such finding' })
    }
    const repository = await store.getRepository(finding.repositoryId)
    if (!repository || repository.organizationId !== actor.organizationId) {
      return reply.code(404).send({ error: 'no such finding' })
    }

    let updated = finding
    if (typeof body.status === 'string') {
      if (!STATUSES.includes(body.status as FindingStatus)) {
        return reply.code(400).send({ error: `unknown status: ${body.status}` })
      }
      updated = (await store.setFindingStatus(id, body.status as FindingStatus, actor.subject)) ?? updated
      await store.audit(actor.organizationId, actor.subject, `finding.${body.status}`, id, {
        rule: finding.ruleId,
        repository: repository.name,
      })
    }
    if (body.assignee !== undefined) {
      const assignee = typeof body.assignee === 'string' && body.assignee.trim() ? body.assignee.trim() : null
      updated = (await store.assignFinding(id, assignee)) ?? updated
      await store.audit(actor.organizationId, actor.subject, 'finding.assign', id, { assignee })
    }
    return { finding: updated }
  })

  app.get('/findings/:id/notes', async (request, reply) => {
    const actor = actorOf(request)
    const { id } = request.params as { id: string }
    const finding = await store.getFinding(id)
    if (!finding) {
      return reply.code(404).send({ error: 'no such finding' })
    }
    const repository = await store.getRepository(finding.repositoryId)
    if (!repository || repository.organizationId !== actor.organizationId) {
      return reply.code(404).send({ error: 'no such finding' })
    }
    return { notes: await store.listNotes(id) }
  })

  app.post('/findings/:id/notes', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'member')) return
    const { id } = request.params as { id: string }
    const body = bodyOf(request)
    const text = typeof body.body === 'string' ? body.body.trim() : ''
    if (!text) {
      return reply.code(400).send({ error: 'a note cannot be empty' })
    }
    const finding = await store.getFinding(id)
    if (!finding) {
      return reply.code(404).send({ error: 'no such finding' })
    }
    const repository = await store.getRepository(finding.repositoryId)
    if (!repository || repository.organizationId !== actor.organizationId) {
      return reply.code(404).send({ error: 'no such finding' })
    }
    const note = await store.createNote(id, actor.subject, text)
    await store.audit(actor.organizationId, actor.subject, 'finding.note', id)
    return reply.code(201).send({ note })
  })

  /**
   * Check whether the secret of a finding still works.
   *
   * The check asks the provider, so it is deliberately a separate call: the
   * console asks for it when somebody wants to know, and not on every page
   * load.
   */
  app.post('/findings/:id/verify', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'member')) return
    const { id } = request.params as { id: string }
    const finding = await store.getFinding(id)
    if (!finding) {
      return reply.code(404).send({ error: 'no such finding' })
    }
    const repository = await store.getRepository(finding.repositoryId)
    if (!repository || repository.organizationId !== actor.organizationId) {
      return reply.code(404).send({ error: 'no such finding' })
    }

    const ciphertext = await store.getFindingSecret(id)
    if (!ciphertext) {
      return reply.code(409).send({ error: 'the secret of this finding is not stored' })
    }

    let secret: string
    try {
      secret = decrypt(ciphertext, settings.encryptionKey)
    } catch {
      return reply.code(409).send({ error: 'the secret of this finding cannot be read' })
    }

    const validity = await checkValidity(secret)
    const updated = await store.setFindingValidity(id, validity)
    await store.audit(actor.organizationId, actor.subject, 'finding.verify', id, { validity })
    return { finding: updated, validity }
  })

  // -- scans ----------------------------------------------------------------

  app.get('/scans', async (request) => {
    const actor = actorOf(request)
    const limit = Math.min(Number((request.query as { limit?: string }).limit ?? 50) || 50, 200)
    return { scans: await store.listRecentScans(actor.organizationId, limit) }
  })

  // -- members --------------------------------------------------------------

  app.get('/members', async (request) => {
    const actor = actorOf(request)
    return { members: await store.listMembers(actor.organizationId) }
  })

  app.patch('/members/:subject', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'owner')) return
    const { subject } = request.params as { subject: string }
    const body = bodyOf(request)
    const role = body.role as MemberRole
    if (!ROLES.includes(role)) {
      return reply.code(400).send({ error: `unknown role: ${String(body.role)}` })
    }
    const member = await store.setMemberRole(actor.organizationId, subject, role)
    if (!member) {
      return reply.code(404).send({ error: 'no such member' })
    }
    await store.audit(actor.organizationId, actor.subject, 'member.role', subject, { role })
    return { member }
  })

  // -- api tokens -----------------------------------------------------------

  app.get('/tokens', async (request) => {
    const actor = actorOf(request)
    if (!hasRole(actor, 'member')) {
      return { tokens: [] }
    }
    return { tokens: await store.listApiTokens(actor.organizationId) }
  })

  app.post('/tokens', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'member')) return
    const body = bodyOf(request)
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'API token'
    const role = ROLES.includes(body.role as MemberRole) ? (body.role as MemberRole) : 'member'
    const token = generateApiToken()
    const record = await store.createApiToken(actor.organizationId, name, hashToken(token), role)
    await store.audit(actor.organizationId, actor.subject, 'token.create', record.id, { name })
    // The token is shown once. It is not stored anywhere in the clear.
    return reply.code(201).send({ token: record, secret: token })
  })

  app.delete('/tokens/:id', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'member')) return
    const { id } = request.params as { id: string }
    const revoked = await store.revokeApiToken(id, actor.organizationId)
    if (!revoked) {
      return reply.code(404).send({ error: 'no such token' })
    }
    await store.audit(actor.organizationId, actor.subject, 'token.revoke', id)
    return reply.code(204).send()
  })

  // -- webhooks -------------------------------------------------------------

  app.get('/webhooks', async (request) => {
    const actor = actorOf(request)
    if (!hasRole(actor, 'member')) {
      return { webhooks: [] }
    }
    return { webhooks: await store.listWebhooks(actor.organizationId) }
  })

  app.post('/webhooks', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'owner')) return
    const body = bodyOf(request)
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Webhook'
    if (!url || !/^https?:\/\//i.test(url)) {
      return reply.code(400).send({ error: 'a webhook needs an http or https URL' })
    }
    const kind = body.kind === 'slack' ? 'slack' : 'generic'
    const webhook = await store.createWebhook({
      organizationId: actor.organizationId,
      name,
      url,
      kind,
    })
    await store.audit(actor.organizationId, actor.subject, 'webhook.create', webhook.id, { name, kind })
    return reply.code(201).send({ webhook })
  })

  app.delete('/webhooks/:id', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'owner')) return
    const { id } = request.params as { id: string }
    const removed = await store.deleteWebhook(id, actor.organizationId)
    if (!removed) {
      return reply.code(404).send({ error: 'no such webhook' })
    }
    await store.audit(actor.organizationId, actor.subject, 'webhook.delete', id)
    return reply.code(204).send()
  })

  // -- honeytokens ----------------------------------------------------------

  app.get('/honeytokens', async (request) => {
    const actor = actorOf(request)
    if (!hasRole(actor, 'member')) {
      return { honeytokens: [] }
    }
    return { honeytokens: await store.listHoneytokens(actor.organizationId) }
  })

  app.post('/honeytokens', async (request, reply) => {
    const actor = actorOf(request)
    if (!requireRole(request, reply, 'member')) return
    const body = bodyOf(request)
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : 'Honeytoken'
    const secret = generateHoneytoken()
    const record = await store.createHoneytoken({
      organizationId: actor.organizationId,
      label,
      provider: typeof body.provider === 'string' ? body.provider : 'generic',
      fingerprint: honeytokenFingerprint(secret),
    })
    await store.audit(actor.organizationId, actor.subject, 'honeytoken.create', record.id, { label })
    // The value is shown once: it has to be planted somewhere, and only its
    // hash is kept.
    return reply.code(201).send({ honeytoken: record, secret })
  })

  // -- the rules ------------------------------------------------------------

  /**
   * The rules the scanner runs.
   *
   * They are read out of gitleaks itself, because the effective set is the
   * upstream defaults plus the organisation's own rules, and only gitleaks
   * knows the first part.
   */
  app.get('/rules', async (_request, reply) => {
    try {
      const rules = await listRules(settings.gitleaksPath, settings.gitleaksConfig)
      return {
        rules: rules.map((rule) => rule.id),
        descriptions: Object.fromEntries(rules.map((rule) => [rule.id, rule.description])),
        source: settings.gitleaksConfig,
      }
    } catch (error) {
      return reply.code(503).send({
        error: `the rules could not be read: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  })

  // -- the audit log --------------------------------------------------------

  app.get('/audit', async (request) => {
    const actor = actorOf(request)
    if (!hasRole(actor, 'owner')) {
      return { entries: [] }
    }
    const limit = Math.min(Number((request.query as { limit?: string }).limit ?? 100) || 100, 500)
    return { entries: await store.listAudit(actor.organizationId, limit) }
  })
}
