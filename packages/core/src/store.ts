/**
 * Every query the platform runs.
 *
 * The rows are written out as the shapes the API serves, so a column rename
 * is a change in one place.
 */

import type pg from 'pg'

import type { Pool } from './db.js'
import type {
  ApiToken,
  AuditEntry,
  Connection,
  Credential,
  Finding,
  FindingNote,
  FindingStatus,
  Honeytoken,
  Insights,
  Member,
  MemberRole,
  Organization,
  Provider,
  Repository,
  RepositoryIgnore,
  Scan,
  ScanStatus,
  ScanTrigger,
  Summary,
  Validity,
  Webhook,
} from './types.js'

/** A row, as Postgres returns it. */
type Row = Record<string, unknown>

const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : value === null || value === undefined ? null : String(value)

const toOrganization = (row: Row): Organization => ({
  id: String(row.id),
  slug: String(row.slug),
  name: String(row.name),
  createdAt: iso(row.created_at) as string,
})

const toMember = (row: Row): Member => ({
  organizationId: String(row.organization_id),
  subject: String(row.subject),
  email: row.email === null ? null : String(row.email),
  name: row.name === null ? null : String(row.name),
  role: String(row.role) as MemberRole,
  createdAt: iso(row.created_at) as string,
})

const toCredential = (row: Row): Credential => ({
  id: String(row.id),
  organizationId: String(row.organization_id),
  kind: 'token',
  username: row.username === null ? null : String(row.username),
  createdAt: iso(row.created_at) as string,
})

const toRepository = (row: Row): Repository => ({
  id: String(row.id),
  organizationId: String(row.organization_id),
  name: String(row.name),
  provider: String(row.provider) as Provider,
  cloneUrl: String(row.clone_url),
  credentialId: row.credential_id === null ? null : String(row.credential_id),
  connectionId: row.connection_id === null || row.connection_id === undefined ? null : String(row.connection_id),
  enabled: Boolean(row.enabled),
  scanIntervalMinutes: Number(row.scan_interval_minutes),
  lastScanAt: iso(row.last_scan_at),
  lastScanStatus: (row.last_scan_status === null ? null : String(row.last_scan_status)) as ScanStatus | null,
  openFindings: Number(row.open_findings ?? 0),
  createdAt: iso(row.created_at) as string,
})

const toIgnore = (row: Row): RepositoryIgnore => ({
  id: String(row.id),
  repositoryId: String(row.repository_id),
  kind: String(row.kind) as 'path' | 'rule',
  value: String(row.value),
  createdAt: iso(row.created_at) as string,
})

const toScan = (row: Row): Scan => ({
  id: String(row.id),
  repositoryId: String(row.repository_id),
  repositoryName:
    row.repository_name === undefined || row.repository_name === null ? undefined : String(row.repository_name),
  status: String(row.status) as ScanStatus,
  trigger: String(row.trigger) as ScanTrigger,
  commitSha: row.commit_sha === null ? null : String(row.commit_sha),
  findingsCount: Number(row.findings_count),
  error: row.error === null ? null : String(row.error),
  startedAt: iso(row.started_at) as string,
  finishedAt: iso(row.finished_at),
})

const toFinding = (row: Row): Finding => ({
  id: String(row.id),
  repositoryId: String(row.repository_id),
  repositoryName:
    row.repository_name === undefined || row.repository_name === null ? undefined : String(row.repository_name),
  fingerprint: String(row.fingerprint),
  ruleId: String(row.rule_id),
  description: row.description === null ? null : String(row.description),
  file: row.file === null ? null : String(row.file),
  startLine: row.start_line === null ? null : Number(row.start_line),
  commitSha: row.commit_sha === null ? null : String(row.commit_sha),
  author: row.author === null ? null : String(row.author),
  committedAt: row.committed_at === null ? null : String(row.committed_at),
  matchRedacted: row.match_redacted === null ? null : String(row.match_redacted),
  secretRedacted: row.secret_redacted === null ? null : String(row.secret_redacted),
  status: String(row.status) as FindingStatus,
  validity: String(row.validity) as Validity,
  assignee: row.assignee === null ? null : String(row.assignee),
  firstSeenAt: iso(row.first_seen_at) as string,
  lastSeenAt: iso(row.last_seen_at) as string,
  resolvedAt: iso(row.resolved_at),
  resolvedBy: row.resolved_by === null ? null : String(row.resolved_by),
})

const toNote = (row: Row): FindingNote => ({
  id: String(row.id),
  findingId: String(row.finding_id),
  author: String(row.author),
  body: String(row.body),
  createdAt: iso(row.created_at) as string,
})

const toConnection = (row: Row): Connection => ({
  id: String(row.id),
  organizationId: String(row.organization_id),
  provider: String(row.provider),
  name: String(row.name),
  baseUrl: String(row.base_url),
  clientId: String(row.client_id),
  account: row.account === null || row.account === undefined ? null : String(row.account),
  scopes: row.scopes === null || row.scopes === undefined ? null : String(row.scopes),
  expiresAt: iso(row.expires_at),
  metadata: (row.metadata ?? {}) as Record<string, unknown>,
  status: String(row.status),
  createdAt: iso(row.created_at) as string,
  updatedAt: iso(row.updated_at) as string,
  lastUsedAt: iso(row.last_used_at),
})

const toApiToken = (row: Row): ApiToken => ({
  id: String(row.id),
  organizationId: String(row.organization_id),
  name: String(row.name),
  role: String(row.role ?? 'member') as MemberRole,
  createdAt: iso(row.created_at) as string,
  lastUsedAt: iso(row.last_used_at),
  revokedAt: iso(row.revoked_at),
})

const toWebhook = (row: Row): Webhook => ({
  id: String(row.id),
  organizationId: String(row.organization_id),
  name: String(row.name),
  url: String(row.url),
  kind: String(row.kind) as 'generic' | 'slack',
  enabled: Boolean(row.enabled),
  createdAt: iso(row.created_at) as string,
})

const toHoneytoken = (row: Row): Honeytoken => ({
  id: String(row.id),
  organizationId: String(row.organization_id),
  label: String(row.label),
  provider: String(row.provider),
  createdAt: iso(row.created_at) as string,
  triggeredAt: iso(row.triggered_at),
})

const toAuditEntry = (row: Row): AuditEntry => ({
  id: String(row.id),
  organizationId: String(row.organization_id),
  actor: String(row.actor),
  action: String(row.action),
  target: row.target === null ? null : String(row.target),
  detail: (row.detail ?? {}) as Record<string, unknown>,
  createdAt: iso(row.created_at) as string,
})

/** A finding that is being written. */
export interface FindingInput {
  fingerprint: string
  ruleId: string
  description: string | null
  file: string | null
  startLine: number | null
  commitSha: string | null
  author: string | null
  committedAt: string | null
  matchRedacted: string | null
  secretRedacted: string | null
  secretCiphertext: string | null
  /** The hash of the secret, used to match honeytokens. */
  secretHash?: string
}

/**
 * The store: every query the platform runs, in one place.
 */
export class Store {
  constructor(private readonly pool: Pool) {}

  // -- organizations --------------------------------------------------------

  /** Create an organisation if it is not there yet, and return it. */
  async ensureOrganization(slug: string, name: string): Promise<Organization> {
    const { rows } = await this.pool.query(
      `insert into organizations (slug, name)
       values ($1, $2)
       on conflict (slug) do update set name = excluded.name
       returning *`,
      [slug, name],
    )
    return toOrganization(rows[0])
  }

  /** Every organisation. */
  async listOrganizations(): Promise<Organization[]> {
    const { rows } = await this.pool.query('select * from organizations order by slug')
    return rows.map(toOrganization)
  }

  /** One organisation. */
  async getOrganization(id: string): Promise<Organization | null> {
    const { rows } = await this.pool.query('select * from organizations where id = $1', [id])
    return rows[0] ? toOrganization(rows[0]) : null
  }

  // -- members --------------------------------------------------------------

  /**
   * Record a member, and their role the first time they are seen.
   *
   * The role is only taken from the caller when it is one the platform
   * knows: a token that claims to be an owner does not become one by being
   * written down. A member who is already known keeps the role they have,
   * because a sign-in must not undo a role an owner set by hand.
   */
  async upsertMember(
    organizationId: string,
    subject: string,
    email: string | null,
    name: string | null,
    role: MemberRole,
  ): Promise<Member> {
    const { rows } = await this.pool.query(
      `insert into members (organization_id, subject, email, name, role)
       values ($1, $2, $3, $4, $5)
       on conflict (organization_id, subject) do update
         set email = excluded.email,
             name = excluded.name
       returning *`,
      [organizationId, subject, email, name, role],
    )
    return toMember(rows[0])
  }

  /**
   * Change a member's role.
   *
   * This is the only way a role changes after a member is known: a sign-in
   * keeps it, so that a demotion an owner made by hand survives, and a
   * provider that takes a role away takes effect at the next sign-in
   * through the weaker of the two.
   */
  async setMemberRole(organizationId: string, subject: string, role: MemberRole): Promise<Member | null> {
    const { rows } = await this.pool.query(
      'update members set role = $3 where organization_id = $1 and subject = $2 returning *',
      [organizationId, subject, role],
    )
    return rows[0] ? toMember(rows[0]) : null
  }

  /** The members of an organisation. */
  async listMembers(organizationId: string): Promise<Member[]> {
    const { rows } = await this.pool.query(
      'select * from members where organization_id = $1 order by created_at',
      [organizationId],
    )
    return rows.map(toMember)
  }

  /** The member with this subject, if there is one. */
  async findMember(organizationId: string, subject: string): Promise<Member | null> {
    const { rows } = await this.pool.query(
      'select * from members where organization_id = $1 and subject = $2',
      [organizationId, subject],
    )
    return rows[0] ? toMember(rows[0]) : null
  }

  // -- connections ----------------------------------------------------------

  /** Start a connection: the row, and the state the authorisation carries. */
  async createConnection(input: {
    id: string
    organizationId: string
    provider: string
    name: string
    baseUrl: string
    clientId: string
    clientSecretCiphertext: string
    state: string
  }): Promise<Connection> {
    const { rows } = await this.pool.query(
      `insert into connections
         (id, organization_id, provider, name, base_url, client_id, client_secret_ciphertext, state, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       returning *`,
      [
        input.id,
        input.organizationId,
        input.provider,
        input.name,
        input.baseUrl,
        input.clientId,
        input.clientSecretCiphertext,
        input.state,
      ],
    )
    return toConnection(rows[0])
  }

  /** The connections of an organisation. */
  async listConnections(organizationId: string): Promise<Connection[]> {
    const { rows } = await this.pool.query(
      'select * from connections where organization_id = $1 order by created_at',
      [organizationId],
    )
    return rows.map(toConnection)
  }

  /** One connection. */
  async getConnection(id: string): Promise<Connection | null> {
    const { rows } = await this.pool.query('select * from connections where id = $1', [id])
    return rows[0] ? toConnection(rows[0]) : null
  }

  /** The connection waiting for an authorisation to come back. */
  async findConnectionByState(state: string): Promise<Connection | null> {
    const { rows } = await this.pool.query(
      "select * from connections where state = $1 and status = 'pending'",
      [state],
    )
    return rows[0] ? toConnection(rows[0]) : null
  }

  /** The encrypted parts of a connection, for the provider calls. */
  async getConnectionSecrets(id: string): Promise<{
    clientSecret: string
    accessToken: string | null
    refreshToken: string | null
  } | null> {
    const { rows } = await this.pool.query(
      `select client_secret_ciphertext, access_token_ciphertext, refresh_token_ciphertext
         from connections where id = $1`,
      [id],
    )
    if (!rows[0]) return null
    return {
      clientSecret: String(rows[0].client_secret_ciphertext),
      accessToken: rows[0].access_token_ciphertext === null ? null : String(rows[0].access_token_ciphertext),
      refreshToken: rows[0].refresh_token_ciphertext === null ? null : String(rows[0].refresh_token_ciphertext),
    }
  }

  /** The grant is in: the connection becomes usable. */
  async completeConnection(
    id: string,
    grant: {
      accessTokenCiphertext: string | null
      refreshTokenCiphertext: string | null
      tokenType: string | null
      scopes: string | null
      expiresAt: string | null
      account: string | null
    },
    metadata: Record<string, unknown>,
  ): Promise<Connection | null> {
    const { rows } = await this.pool.query(
      `update connections
          set access_token_ciphertext = $2,
              refresh_token_ciphertext = $3,
              token_type = $4,
              scopes = $5,
              expires_at = $6,
              account = $7,
              metadata = $8,
              status = 'active',
              state = null,
              updated_at = now()
        where id = $1
        returning *`,
      [
        id,
        grant.accessTokenCiphertext,
        grant.refreshTokenCiphertext,
        grant.tokenType,
        grant.scopes,
        grant.expiresAt,
        grant.account,
        JSON.stringify(metadata),
      ],
    )
    return rows[0] ? toConnection(rows[0]) : null
  }

  /** A new grant, after a refresh. */
  async updateConnectionGrant(
    id: string,
    grant: {
      accessTokenCiphertext: string | null
      refreshTokenCiphertext: string | null
      expiresAt: string | null
      scopes: string | null
    },
  ): Promise<Connection | null> {
    const { rows } = await this.pool.query(
      `update connections
          set access_token_ciphertext = coalesce($2, access_token_ciphertext),
              refresh_token_ciphertext = coalesce($3, refresh_token_ciphertext),
              expires_at = $4,
              scopes = coalesce($5, scopes),
              updated_at = now()
        where id = $1
        returning *`,
      [id, grant.accessTokenCiphertext, grant.refreshTokenCiphertext, grant.expiresAt, grant.scopes],
    )
    return rows[0] ? toConnection(rows[0]) : null
  }

  /** The provider's own metadata. */
  async setConnectionMetadata(id: string, metadata: Record<string, unknown>): Promise<Connection | null> {
    const { rows } = await this.pool.query(
      'update connections set metadata = $2, updated_at = now() where id = $1 returning *',
      [id, JSON.stringify(metadata)],
    )
    return rows[0] ? toConnection(rows[0]) : null
  }

  /** The state of a connection. */
  async setConnectionStatus(id: string, status: string): Promise<Connection | null> {
    const { rows } = await this.pool.query(
      'update connections set status = $2, updated_at = now() where id = $1 returning *',
      [id, status],
    )
    return rows[0] ? toConnection(rows[0]) : null
  }

  /** Note that a connection was used. */
  async touchConnection(id: string): Promise<void> {
    await this.pool.query('update connections set last_used_at = now() where id = $1', [id])
  }

  /** Withdraw a connection. */
  async revokeConnection(id: string, organizationId: string): Promise<boolean> {
    const result = await this.pool.query(
      `update connections
          set status = 'revoked', revoked_at = now(), updated_at = now(),
              access_token_ciphertext = null, refresh_token_ciphertext = null, state = null
        where id = $1 and organization_id = $2`,
      [id, organizationId],
    )
    return (result.rowCount ?? 0) > 0
  }

  // -- credentials ----------------------------------------------------------

  /** Store an encrypted credential. */
  async createCredential(
    organizationId: string,
    username: string | null,
    secretCiphertext: string,
  ): Promise<Credential> {
    const { rows } = await this.pool.query(
      `insert into credentials (organization_id, kind, username, secret_ciphertext)
       values ($1, 'token', $2, $3)
       returning id, organization_id, kind, username, created_at`,
      [organizationId, username, secretCiphertext],
    )
    return toCredential(rows[0])
  }

  /** The encrypted secret of a credential. */
  async getCredentialSecret(id: string): Promise<{ username: string | null; secret: string } | null> {
    const { rows } = await this.pool.query(
      'select username, secret_ciphertext from credentials where id = $1',
      [id],
    )
    if (!rows[0]) return null
    return {
      username: rows[0].username === null ? null : String(rows[0].username),
      secret: String(rows[0].secret_ciphertext),
    }
  }

  // -- repositories ---------------------------------------------------------

  /** Watch a repository. */
  async createRepository(input: {
    organizationId: string
    name: string
    provider: Provider
    cloneUrl: string
    credentialId: string | null
    connectionId?: string | null
    scanIntervalMinutes: number
  }): Promise<Repository> {
    const { rows } = await this.pool.query(
      `insert into repositories
         (organization_id, name, provider, clone_url, credential_id, connection_id, scan_interval_minutes)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [
        input.organizationId,
        input.name,
        input.provider,
        input.cloneUrl,
        input.credentialId,
        input.connectionId ?? null,
        input.scanIntervalMinutes,
      ],
    )
    return toRepository(rows[0])
  }

  /** The repositories of an organisation, with the open findings counted. */
  async listRepositories(organizationId: string): Promise<Repository[]> {
    const { rows } = await this.pool.query(
      `select r.*,
              coalesce(f.open, 0) as open_findings
         from repositories r
         left join (
           select repository_id, count(*) as open
             from findings
            where status in ('open', 'acknowledged')
            group by repository_id
         ) f on f.repository_id = r.id
        where r.organization_id = $1
        order by r.name`,
      [organizationId],
    )
    return rows.map(toRepository)
  }

  /** One repository. */
  async getRepository(id: string): Promise<Repository | null> {
    const { rows } = await this.pool.query(
      `select r.*, coalesce(f.open, 0) as open_findings
         from repositories r
         left join (
           select repository_id, count(*) as open
             from findings
            where status in ('open', 'acknowledged')
            group by repository_id
         ) f on f.repository_id = r.id
        where r.id = $1`,
      [id],
    )
    return rows[0] ? toRepository(rows[0]) : null
  }

  /** Change a repository. */
  async updateRepository(
    id: string,
    changes: Partial<Pick<Repository, 'name' | 'enabled' | 'scanIntervalMinutes' | 'credentialId'>>,
  ): Promise<Repository | null> {
    const sets: string[] = []
    const values: unknown[] = []
    const add = (column: string, value: unknown) => {
      values.push(value)
      sets.push(`${column} = $${values.length}`)
    }
    if (changes.name !== undefined) add('name', changes.name)
    if (changes.enabled !== undefined) add('enabled', changes.enabled)
    if (changes.scanIntervalMinutes !== undefined) add('scan_interval_minutes', changes.scanIntervalMinutes)
    if (changes.credentialId !== undefined) add('credential_id', changes.credentialId)
    if (!sets.length) return this.getRepository(id)
    values.push(id)
    const { rows } = await this.pool.query(
      `update repositories set ${sets.join(', ')} where id = $${values.length} returning *`,
      values,
    )
    return rows[0] ? toRepository(rows[0]) : null
  }

  /** Stop watching a repository. */
  async deleteRepository(id: string): Promise<boolean> {
    const result = await this.pool.query('delete from repositories where id = $1', [id])
    return (result.rowCount ?? 0) > 0
  }

  /**
   * The repositories that are due for a scan.
   *
   * A repository is due when it has never been scanned, or when the last
   * scan is older than its interval. The rows are locked while they are
   * read, so two workers cannot pick up the same repository.
   */
  async listDueRepositories(limit: number): Promise<Repository[]> {
    const { rows } = await this.pool.query(
      `select r.* from repositories r
        where r.enabled
          and (r.last_scan_at is null
               or r.last_scan_at < now() - (r.scan_interval_minutes || ' minutes')::interval)
        order by r.last_scan_at nulls first
        limit $1
        for update of r skip locked`,
      [limit],
    )
    return rows.map(toRepository)
  }

  /** Record that a repository was scanned. */
  async markRepositoryScanned(id: string, status: ScanStatus): Promise<void> {
    await this.pool.query(
      'update repositories set last_scan_at = now(), last_scan_status = $2 where id = $1',
      [id, status],
    )
  }

  /**
   * Ask for a repository to be scanned now.
   *
   * The scan is picked up by the worker, which looks for the repositories
   * that are due. Clearing the last scan is what makes it due, and the
   * notification is what makes the worker look straight away instead of
   * waiting for its next turn.
   */
  async requestScan(id: string): Promise<void> {
    await this.pool.query('update repositories set last_scan_at = null where id = $1', [id])
    await this.pool.query(`select pg_notify('sentinel_scan_requested', $1)`, [id])
  }

  /**
   * Wait for a request to scan.
   *
   * The worker listens on the channel, so a scan that somebody asked for
   * starts at once rather than at the next turn of the loop.
   */
  async listenForScanRequests(onRequest: () => void): Promise<() => Promise<void>> {
    const client = await this.pool.connect()
    await client.query('listen sentinel_scan_requested')
    const handler = (message: pg.Notification) => {
      if (message.channel === 'sentinel_scan_requested') onRequest()
    }
    client.on('notification', handler)
    return async () => {
      client.off('notification', handler)
      try {
        await client.query('unlisten sentinel_scan_requested')
      } finally {
        client.release()
      }
    }
  }

  // -- ignores --------------------------------------------------------------

  /** The paths and rules that are not scanned in a repository. */
  async listIgnores(repositoryId: string): Promise<RepositoryIgnore[]> {
    const { rows } = await this.pool.query(
      'select * from repository_ignores where repository_id = $1 order by created_at',
      [repositoryId],
    )
    return rows.map(toIgnore)
  }

  /** Stop scanning a path or a rule in a repository. */
  async createIgnore(repositoryId: string, kind: 'path' | 'rule', value: string): Promise<RepositoryIgnore> {
    const { rows } = await this.pool.query(
      `insert into repository_ignores (repository_id, kind, value)
       values ($1, $2, $3)
       on conflict (repository_id, kind, value) do update set value = excluded.value
       returning *`,
      [repositoryId, kind, value],
    )
    return toIgnore(rows[0])
  }

  /** Scan a path or a rule again. */
  async deleteIgnore(id: string, repositoryId: string): Promise<boolean> {
    const result = await this.pool.query(
      'delete from repository_ignores where id = $1 and repository_id = $2',
      [id, repositoryId],
    )
    return (result.rowCount ?? 0) > 0
  }

  // -- scans ----------------------------------------------------------------

  /** Start a scan. */
  async createScan(repositoryId: string, trigger: ScanTrigger): Promise<Scan> {
    const { rows } = await this.pool.query(
      `insert into scans (repository_id, status, trigger) values ($1, 'running', $2) returning *`,
      [repositoryId, trigger],
    )
    return toScan(rows[0])
  }

  /** Finish a scan. */
  async finishScan(
    id: string,
    status: ScanStatus,
    findingsCount: number,
    commitSha: string | null,
    error: string | null,
  ): Promise<void> {
    await this.pool.query(
      `update scans set status = $2, findings_count = $3, commit_sha = $4, error = $5, finished_at = now()
        where id = $1`,
      [id, status, findingsCount, commitSha, error],
    )
  }

  /** The recent scans of an organisation. */
  async listRecentScans(organizationId: string, limit: number): Promise<Scan[]> {
    const { rows } = await this.pool.query(
      `select s.*, r.name as repository_name from scans s
         join repositories r on r.id = s.repository_id
        where r.organization_id = $1
        order by s.started_at desc
        limit $2`,
      [organizationId, limit],
    )
    return rows.map(toScan)
  }

  // -- findings -------------------------------------------------------------

  /**
   * Record the findings of a scan.
   *
   * A finding is identified by its fingerprint, which is computed from the
   * rule, the file and the secret. A finding that is already known keeps
   * its status, its assignee and its validity: a secret that was marked
   * resolved stays resolved, so it does not come back as new noise on every
   * scan.
   */
  async recordFindings(repositoryId: string, scanId: string, findings: FindingInput[]): Promise<number> {
    if (!findings.length) return 0
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      for (const finding of findings) {
        await client.query(
          `insert into findings
             (repository_id, scan_id, fingerprint, rule_id, description, file, start_line,
              commit_sha, author, committed_at, match_redacted, secret_redacted, secret_ciphertext, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'open')
           on conflict (repository_id, fingerprint) do update
             set scan_id = excluded.scan_id,
                 last_seen_at = now(),
                 rule_id = excluded.rule_id,
                 description = excluded.description,
                 file = excluded.file,
                 start_line = excluded.start_line,
                 commit_sha = excluded.commit_sha,
                 author = excluded.author,
                 committed_at = excluded.committed_at,
                 match_redacted = excluded.match_redacted,
                 secret_redacted = excluded.secret_redacted,
                 secret_ciphertext = excluded.secret_ciphertext`,
          [
            repositoryId,
            scanId,
            finding.fingerprint,
            finding.ruleId,
            finding.description,
            finding.file,
            finding.startLine,
            finding.commitSha,
            finding.author,
            finding.committedAt,
            finding.matchRedacted,
            finding.secretRedacted,
            finding.secretCiphertext,
          ],
        )
      }
      await client.query('commit')
      return findings.length
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * The fingerprints that are already known in a repository.
   *
   * The worker uses it to tell a finding that is new from one that was
   * seen before, so that only the new ones are announced.
   */
  async knownFingerprints(repositoryId: string, fingerprints: string[]): Promise<Set<string>> {
    if (!fingerprints.length) return new Set()
    const { rows } = await this.pool.query(
      'select fingerprint from findings where repository_id = $1 and fingerprint = any($2::text[])',
      [repositoryId, fingerprints],
    )
    return new Set(rows.map((row: Row) => String(row.fingerprint)))
  }

  /** The findings of an organisation, filtered and paged. */
  async listFindings(
    organizationId: string,
    filter: {
      repositoryId?: string
      status?: FindingStatus
      validity?: Validity
      ruleId?: string
      author?: string
      assignee?: string
      search?: string
      limit: number
      offset: number
    },
  ): Promise<{ findings: Finding[]; total: number }> {
    const conditions = ['r.organization_id = $1']
    const values: unknown[] = [organizationId]

    const add = (sql: string, value: unknown) => {
      values.push(value)
      conditions.push(sql.replace('?', `$${values.length}`))
    }

    if (filter.repositoryId) add('f.repository_id = ?', filter.repositoryId)
    if (filter.status) add('f.status = ?', filter.status)
    if (filter.validity) add('f.validity = ?', filter.validity)
    if (filter.ruleId) add('f.rule_id = ?', filter.ruleId)
    if (filter.author) add('f.author = ?', filter.author)
    if (filter.assignee) add('f.assignee = ?', filter.assignee)
    if (filter.search) {
      values.push(`%${filter.search}%`)
      const index = values.length
      conditions.push(
        `(f.file ilike $${index} or f.rule_id ilike $${index} or f.author ilike $${index} or f.match_redacted ilike $${index})`,
      )
    }

    const where = conditions.join(' and ')
    const totalResult = await this.pool.query(
      `select count(*) as count from findings f join repositories r on r.id = f.repository_id where ${where}`,
      values,
    )

    values.push(filter.limit)
    const limitIndex = values.length
    values.push(filter.offset)
    const offsetIndex = values.length

    const { rows } = await this.pool.query(
      `select f.*, r.name as repository_name
         from findings f
         join repositories r on r.id = f.repository_id
        where ${where}
        order by f.last_seen_at desc
        limit $${limitIndex} offset $${offsetIndex}`,
      values,
    )

    return {
      findings: rows.map(toFinding),
      total: Number(totalResult.rows[0].count),
    }
  }

  /** One finding. */
  async getFinding(id: string): Promise<Finding | null> {
    const { rows } = await this.pool.query(
      `select f.*, r.name as repository_name
         from findings f join repositories r on r.id = f.repository_id
        where f.id = $1`,
      [id],
    )
    return rows[0] ? toFinding(rows[0]) : null
  }

  /** The encrypted secret of a finding. It is never handed out. */
  async getFindingSecret(id: string): Promise<string | null> {
    const { rows } = await this.pool.query('select secret_ciphertext from findings where id = $1', [id])
    if (!rows[0] || rows[0].secret_ciphertext === null) return null
    return String(rows[0].secret_ciphertext)
  }

  /**
   * Move a finding to a new status.
   *
   * Resolving records who resolved it and when. Acknowledging, reopening and
   * ignoring clear the resolution, because a finding that is being looked
   * at again is not resolved any more.
   */
  async setFindingStatus(id: string, status: FindingStatus, actor: string): Promise<Finding | null> {
    const { rows } = await this.pool.query(
      `update findings
          set status = $2,
              resolved_at = case when $2 in ('resolved', 'ignored') then now() else null end,
              resolved_by = case when $2 in ('resolved', 'ignored') then $3 else null end
        where id = $1
        returning *`,
      [id, status, actor],
    )
    return rows[0] ? toFinding(rows[0]) : null
  }

  /** Give a finding to somebody. */
  async assignFinding(id: string, assignee: string | null): Promise<Finding | null> {
    const { rows } = await this.pool.query(
      'update findings set assignee = $2 where id = $1 returning *',
      [id, assignee],
    )
    return rows[0] ? toFinding(rows[0]) : null
  }

  /** Record what is known about whether the secret still works. */
  async setFindingValidity(id: string, validity: Validity): Promise<Finding | null> {
    const { rows } = await this.pool.query(
      'update findings set validity = $2 where id = $1 returning *',
      [id, validity],
    )
    return rows[0] ? toFinding(rows[0]) : null
  }

  /** A note on a finding. */
  async createNote(findingId: string, author: string, body: string): Promise<FindingNote> {
    const { rows } = await this.pool.query(
      'insert into finding_notes (finding_id, author, body) values ($1, $2, $3) returning *',
      [findingId, author, body],
    )
    return toNote(rows[0])
  }

  /** The notes on a finding. */
  async listNotes(findingId: string): Promise<FindingNote[]> {
    const { rows } = await this.pool.query(
      'select * from finding_notes where finding_id = $1 order by created_at desc',
      [findingId],
    )
    return rows.map(toNote)
  }

  // -- api tokens -----------------------------------------------------------

  /**
   * Create an API token. The hash is what is stored.
   *
   * The token carries a role, so a machine can be given the permissions it
   * needs and no more.
   */
  async createApiToken(
    organizationId: string,
    name: string,
    tokenHash: string,
    role: MemberRole = 'member',
  ): Promise<ApiToken> {
    const { rows } = await this.pool.query(
      'insert into api_tokens (organization_id, name, token_hash, role) values ($1, $2, $3, $4) returning *',
      [organizationId, name, tokenHash, role],
    )
    return toApiToken(rows[0])
  }

  /** The tokens of an organisation. */
  async listApiTokens(organizationId: string): Promise<ApiToken[]> {
    const { rows } = await this.pool.query(
      'select * from api_tokens where organization_id = $1 order by created_at desc',
      [organizationId],
    )
    return rows.map(toApiToken)
  }

  /** The token with this hash, if it exists and has not been revoked. */
  async findApiTokenByHash(tokenHash: string): Promise<ApiToken | null> {
    const { rows } = await this.pool.query(
      'select * from api_tokens where token_hash = $1 and revoked_at is null',
      [tokenHash],
    )
    return rows[0] ? toApiToken(rows[0]) : null
  }

  /** Note that a token was used. */
  async touchApiToken(id: string): Promise<void> {
    await this.pool.query('update api_tokens set last_used_at = now() where id = $1', [id])
  }

  /** Revoke a token. */
  async revokeApiToken(id: string, organizationId: string): Promise<boolean> {
    const result = await this.pool.query(
      'update api_tokens set revoked_at = now() where id = $1 and organization_id = $2 and revoked_at is null',
      [id, organizationId],
    )
    return (result.rowCount ?? 0) > 0
  }

  // -- webhooks -------------------------------------------------------------

  /** Send findings to a place. */
  async createWebhook(input: {
    organizationId: string
    name: string
    url: string
    kind: 'generic' | 'slack'
  }): Promise<Webhook> {
    const { rows } = await this.pool.query(
      'insert into webhooks (organization_id, name, url, kind) values ($1, $2, $3, $4) returning *',
      [input.organizationId, input.name, input.url, input.kind],
    )
    return toWebhook(rows[0])
  }

  /** The webhooks of an organisation. */
  async listWebhooks(organizationId: string): Promise<Webhook[]> {
    const { rows } = await this.pool.query(
      'select * from webhooks where organization_id = $1 order by created_at',
      [organizationId],
    )
    return rows.map(toWebhook)
  }

  /** Stop sending to a webhook. */
  async deleteWebhook(id: string, organizationId: string): Promise<boolean> {
    const result = await this.pool.query(
      'delete from webhooks where id = $1 and organization_id = $2',
      [id, organizationId],
    )
    return (result.rowCount ?? 0) > 0
  }

  // -- honeytokens ----------------------------------------------------------

  /** Record a honeytoken. Only its hash is kept. */
  async createHoneytoken(input: {
    organizationId: string
    label: string
    provider: string
    fingerprint: string
  }): Promise<Honeytoken> {
    const { rows } = await this.pool.query(
      `insert into honeytokens (organization_id, label, provider, fingerprint)
       values ($1, $2, $3, $4) returning *`,
      [input.organizationId, input.label, input.provider, input.fingerprint],
    )
    return toHoneytoken(rows[0])
  }

  /** The honeytokens of an organisation. */
  async listHoneytokens(organizationId: string): Promise<Honeytoken[]> {
    const { rows } = await this.pool.query(
      'select * from honeytokens where organization_id = $1 order by created_at desc',
      [organizationId],
    )
    return rows.map(toHoneytoken)
  }

  /** The fingerprints of every honeytoken, so a scan can be matched against them. */
  async listHoneytokenFingerprints(): Promise<Array<{ id: string; fingerprint: string }>> {
    const { rows } = await this.pool.query('select id, fingerprint from honeytokens')
    return rows.map((row: Row) => ({ id: String(row.id), fingerprint: String(row.fingerprint) }))
  }

  /** Note that a honeytoken was found in a repository. */
  async markHoneytokenTriggered(id: string): Promise<void> {
    await this.pool.query(
      'update honeytokens set triggered_at = coalesce(triggered_at, now()) where id = $1',
      [id],
    )
  }

  // -- audit log ------------------------------------------------------------

  /** Record what somebody did. */
  async audit(
    organizationId: string,
    actor: string,
    action: string,
    target?: string | null,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    await this.pool.query(
      'insert into audit_log (organization_id, actor, action, target, detail) values ($1, $2, $3, $4, $5)',
      [organizationId, actor, action, target ?? null, JSON.stringify(detail)],
    )
  }

  /** What happened, most recent first. */
  async listAudit(organizationId: string, limit: number): Promise<AuditEntry[]> {
    const { rows } = await this.pool.query(
      'select * from audit_log where organization_id = $1 order by created_at desc limit $2',
      [organizationId, limit],
    )
    return rows.map(toAuditEntry)
  }

  // -- reporting ------------------------------------------------------------

  /** The counts the dashboard is built from. */
  async summary(organizationId: string): Promise<Summary> {
    const [repositoryCounts, statusCounts, weekCounts, byRule, byRepository, byAuthor, byDay, recentScans] =
      await Promise.all([
        this.pool.query(
          `select count(*) as total, count(*) filter (where enabled) as enabled
             from repositories where organization_id = $1`,
          [organizationId],
        ),
        this.pool.query(
          `select
             count(*) filter (where f.status = 'open') as open,
             count(*) filter (where f.status = 'acknowledged') as acknowledged,
             count(*) filter (where f.status = 'resolved') as resolved,
             count(*) filter (where f.status = 'ignored') as ignored,
             count(*) filter (where f.validity = 'valid') as valid
           from findings f join repositories r on r.id = f.repository_id
          where r.organization_id = $1`,
          [organizationId],
        ),
        this.pool.query(
          `select count(*) as count
             from findings f join repositories r on r.id = f.repository_id
            where r.organization_id = $1 and f.first_seen_at > now() - interval '7 days'`,
          [organizationId],
        ),
        this.pool.query(
          `select f.rule_id, count(*) as count
             from findings f join repositories r on r.id = f.repository_id
            where r.organization_id = $1 and f.status in ('open', 'acknowledged')
            group by f.rule_id
            order by count desc
            limit 10`,
          [organizationId],
        ),
        this.pool.query(
          `select r.id as repository_id, r.name,
                  count(*) filter (where f.status in ('open', 'acknowledged')) as open,
                  count(*) as total
             from repositories r left join findings f on f.repository_id = r.id
            where r.organization_id = $1
            group by r.id, r.name
            order by open desc, total desc`,
          [organizationId],
        ),
        this.pool.query(
          `select f.author, count(*) as count
             from findings f join repositories r on r.id = f.repository_id
            where r.organization_id = $1 and f.status in ('open', 'acknowledged') and f.author is not null
            group by f.author
            order by count desc
            limit 10`,
          [organizationId],
        ),
        this.pool.query(
          `select to_char(date_trunc('day', f.first_seen_at), 'YYYY-MM-DD') as day, count(*) as count
             from findings f join repositories r on r.id = f.repository_id
            where r.organization_id = $1 and f.first_seen_at > now() - interval '30 days'
            group by day
            order by day`,
          [organizationId],
        ),
        this.listRecentScans(organizationId, 10),
      ])

    const repositoryRow = repositoryCounts.rows[0]
    const statusRow = statusCounts.rows[0]

    return {
      repositories: Number(repositoryRow.total),
      enabledRepositories: Number(repositoryRow.enabled),
      open: Number(statusRow.open),
      acknowledged: Number(statusRow.acknowledged),
      resolved: Number(statusRow.resolved),
      ignored: Number(statusRow.ignored),
      valid: Number(statusRow.valid),
      findingsLastWeek: Number(weekCounts.rows[0].count),
      byRule: byRule.rows.map((row: Row) => ({ ruleId: String(row.rule_id), count: Number(row.count) })),
      byRepository: byRepository.rows.map((row: Row) => ({
        repositoryId: String(row.repository_id),
        name: String(row.name),
        open: Number(row.open),
        total: Number(row.total),
      })),
      byAuthor: byAuthor.rows.map((row: Row) => ({ author: String(row.author), count: Number(row.count) })),
      byDay: byDay.rows.map((row: Row) => ({ day: String(row.day), count: Number(row.count) })),
      recentScans,
    }
  }

  /** The questions the dashboard cannot answer on its own. */
  async insights(organizationId: string): Promise<Insights> {
    const [oldest, topAuthors, topRepositories, topRules, live, stale] = await Promise.all([
      this.pool.query(
        `select f.*, r.name as repository_name
           from findings f join repositories r on r.id = f.repository_id
          where r.organization_id = $1 and f.status in ('open', 'acknowledged')
          order by f.first_seen_at asc
          limit 10`,
        [organizationId],
      ),
      this.pool.query(
        `select f.author, count(*) as count
           from findings f join repositories r on r.id = f.repository_id
          where r.organization_id = $1 and f.status in ('open', 'acknowledged') and f.author is not null
          group by f.author order by count desc limit 10`,
        [organizationId],
      ),
      this.pool.query(
        `select r.id as repository_id, r.name, count(*) as count
           from findings f join repositories r on r.id = f.repository_id
          where r.organization_id = $1 and f.status in ('open', 'acknowledged')
          group by r.id, r.name order by count desc limit 10`,
        [organizationId],
      ),
      this.pool.query(
        `select f.rule_id, count(*) as count
           from findings f join repositories r on r.id = f.repository_id
          where r.organization_id = $1 and f.status in ('open', 'acknowledged')
          group by f.rule_id order by count desc limit 10`,
        [organizationId],
      ),
      this.pool.query(
        `select count(*) as count
           from findings f join repositories r on r.id = f.repository_id
          where r.organization_id = $1 and f.validity = 'valid'`,
        [organizationId],
      ),
      this.pool.query(
        `select count(*) as count
           from findings f join repositories r on r.id = f.repository_id
          where r.organization_id = $1 and f.status in ('open', 'acknowledged')
            and f.first_seen_at < now() - interval '7 days'`,
        [organizationId],
      ),
    ])

    return {
      oldest: oldest.rows.map(toFinding),
      topAuthors: topAuthors.rows.map((row: Row) => ({ author: String(row.author), count: Number(row.count) })),
      topRepositories: topRepositories.rows.map((row: Row) => ({
        repositoryId: String(row.repository_id),
        name: String(row.name),
        count: Number(row.count),
      })),
      topRules: topRules.rows.map((row: Row) => ({ ruleId: String(row.rule_id), count: Number(row.count) })),
      liveSecrets: Number(live.rows[0].count),
      stale: Number(stale.rows[0].count),
    }
  }
}
