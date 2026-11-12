/**
 * The shapes the console shows.
 *
 * They are the API's shapes. The console keeps its own copy so that it can
 * be built without the server: the console is a static bundle with nothing
 * to ask.
 */

export type MemberRole = 'owner' | 'member' | 'viewer'

export type FindingStatus = 'open' | 'acknowledged' | 'resolved' | 'ignored'

export type Validity = 'unknown' | 'valid' | 'revoked' | 'invalid'

export type ScanStatus = 'running' | 'succeeded' | 'failed'

export type Provider = 'github' | 'forgejo' | 'gitlab' | 'generic'

/**
 * A forge the platform can be connected to.
 *
 * The API's description of a provider: what it is called, whether the
 * deployment has already registered an application with it, and what the
 * operator has to do when it has not.
 */
export interface ConnectionProvider {
  id: string
  title: string
  /**
   * Whether the deployment has already registered an application with this
   * forge.
   *
   * When it has, the operator only authorises it: there is nothing to
   * register and nothing to copy.
   */
  preRegistered: boolean
  registration: {
    where: string
    scopes: string[]
    redirectUri: string
    notes?: string[]
  }
}

export interface Organization {
  id: string
  slug: string
  name: string
  createdAt: string
}

export interface Member {
  organizationId: string
  subject: string
  email: string | null
  name: string | null
  role: MemberRole
  createdAt: string
}

/** A grant that lets the platform read a forge. */
export interface Connection {
  id: string
  organizationId: string
  provider: string
  name: string
  baseUrl: string
  clientId: string
  account: string | null
  scopes: string | null
  expiresAt: string | null
  metadata: Record<string, unknown>
  status: 'pending' | 'active' | 'needs_attention' | 'revoked'
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
}


/**
 * A GitHub App installation.
 *
 * The app is installed on an organisation or on a person's account, and the
 * installation is what says which repositories its token can read. A person
 * who has it in several places chooses which one the platform reads.
 */
export interface GitHubInstallation {
  id: number
  account: string
  target: string
  selected: boolean
}

export interface Repository {
  id: string
  organizationId: string
  name: string
  provider: Provider
  cloneUrl: string
  credentialId: string | null
  /** The grant the clone uses, when it is not a stored token. */
  connectionId: string | null
  enabled: boolean
  scanIntervalMinutes: number
  lastScanAt: string | null
  lastScanStatus: ScanStatus | null
  openFindings: number
  createdAt: string
}

export interface RepositoryIgnore {
  id: string
  repositoryId: string
  kind: 'path' | 'rule'
  value: string
  createdAt: string
}

export interface Scan {
  id: string
  repositoryId: string
  /** The name of the repository, when it is known. */
  repositoryName?: string
  status: ScanStatus
  trigger: string
  commitSha: string | null
  findingsCount: number
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export interface Finding {
  id: string
  repositoryId: string
  repositoryName?: string
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
  status: FindingStatus
  validity: Validity
  assignee: string | null
  firstSeenAt: string
  lastSeenAt: string
  resolvedAt: string | null
  resolvedBy: string | null
}

export interface FindingNote {
  id: string
  findingId: string
  author: string
  body: string
  createdAt: string
}

export interface ApiToken {
  id: string
  organizationId: string
  name: string
  /** What the token may do. */
  role: MemberRole
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export interface Webhook {
  id: string
  organizationId: string
  name: string
  url: string
  kind: 'generic' | 'slack'
  enabled: boolean
  createdAt: string
}

export interface Honeytoken {
  id: string
  organizationId: string
  label: string
  provider: string
  createdAt: string
  triggeredAt: string | null
}

export interface AuditEntry {
  id: string
  organizationId: string
  actor: string
  action: string
  target: string | null
  detail: Record<string, unknown>
  createdAt: string
}

export interface Summary {
  repositories: number
  enabledRepositories: number
  open: number
  acknowledged: number
  resolved: number
  ignored: number
  valid: number
  findingsLastWeek: number
  byRule: Array<{ ruleId: string; count: number }>
  byRepository: Array<{ repositoryId: string; name: string; open: number; total: number }>
  byAuthor: Array<{ author: string; count: number }>
  byDay: Array<{ day: string; count: number }>
  recentScans: Scan[]
}

export interface Insights {
  oldest: Finding[]
  topAuthors: Array<{ author: string; count: number }>
  topRepositories: Array<{ repositoryId: string; name: string; count: number }>
  topRules: Array<{ ruleId: string; count: number }>
  liveSecrets: number
  stale: number
}
