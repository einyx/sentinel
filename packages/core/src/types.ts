/**
 * The shapes the platform stores and serves.
 *
 * They are written out rather than inferred from the database so that the
 * API, the worker and the console all agree on what a repository, a scan and
 * a finding are. The database is the source of truth for the rows; these are
 * the rows as the API hands them out.
 */

/** What a member of an organisation may do. */
export type MemberRole = 'owner' | 'member' | 'viewer'

/**
 * Where a finding is in its life.
 *
 * `open` is a finding nobody has looked at yet. `acknowledged` is a finding
 * somebody has seen and is dealing with. `resolved` is a finding that has
 * been dealt with: the secret was revoked. `ignored` is a finding that was
 * never a problem: a test fixture, a placeholder, a false positive. A
 * finding that was dealt with stays dealt with when it is seen again, so the
 * noise does not come back on every scan.
 */
export type FindingStatus = 'open' | 'acknowledged' | 'resolved' | 'ignored'

/**
 * Whether the secret still works.
 *
 * This is the question an operator asks first: a credential that was
 * revoked the moment it leaked is a different problem from one that is
 * still live. gitleaks finds the secret but does not know whether it works,
 * so a finding is `unknown` until something checks it.
 */
export type Validity = 'unknown' | 'valid' | 'revoked' | 'invalid'

/** How a scan ended. */
export type ScanStatus = 'running' | 'succeeded' | 'failed'

/** What asked for a scan. */
export type ScanTrigger = 'schedule' | 'manual' | 'api'

/** A forge the platform knows how to clone from. */
export type Provider = 'github' | 'forgejo' | 'gitlab' | 'generic'

/** An organisation. Everything belongs to one. */
export interface Organization {
  id: string
  slug: string
  name: string
  createdAt: string
}

/** A person in an organisation. */
export interface Member {
  organizationId: string
  subject: string
  email: string | null
  name: string | null
  role: MemberRole
  createdAt: string
}

/** A credential the platform uses to clone a repository. */
export interface Credential {
  id: string
  organizationId: string
  kind: 'token'
  username: string | null
  createdAt: string
}

/**
 * A grant that lets the platform read a forge.
 *
 * The tokens and the application's secret are encrypted before they are
 * stored. The shape the API hands out never carries them.
 */
export interface Connection {
  id: string
  organizationId: string
  provider: string
  name: string
  /** The forge's base URL. */
  baseUrl: string
  /** The application's client identifier. */
  clientId: string
  /** The account the grant belongs to. */
  account: string | null
  /** The scopes the provider granted. */
  scopes: string | null
  /** When the grant stops working, when the provider says so. */
  expiresAt: string | null
  /** The provider's own metadata: the installation, the account. */
  metadata: Record<string, unknown>
  status: string
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
}

/** A repository that is watched for secrets. */
export interface Repository {
  id: string
  organizationId: string
  name: string
  provider: Provider
  cloneUrl: string
  /** The credential the clone uses, when it is a stored token. */
  credentialId: string | null
  /** The connection the clone uses, when it is a grant. */
  connectionId: string | null
  enabled: boolean
  scanIntervalMinutes: number
  lastScanAt: string | null
  lastScanStatus: ScanStatus | null
  openFindings: number
  createdAt: string
}

/** A path or a rule that is not scanned in a repository. */
export interface RepositoryIgnore {
  id: string
  repositoryId: string
  kind: 'path' | 'rule'
  value: string
  createdAt: string
}

/** One run of the scanner over one repository. */
export interface Scan {
  id: string
  repositoryId: string
  /** The name of the repository, when it is known. */
  repositoryName?: string
  status: ScanStatus
  trigger: ScanTrigger
  commitSha: string | null
  findingsCount: number
  error: string | null
  startedAt: string
  finishedAt: string | null
}

/** A secret that was found in a repository. */
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
  /** The matched text, with the secret masked. */
  matchRedacted: string | null
  /** The secret itself, masked. */
  secretRedacted: string | null
  status: FindingStatus
  validity: Validity
  assignee: string | null
  firstSeenAt: string
  lastSeenAt: string
  resolvedAt: string | null
  resolvedBy: string | null
}

/** A note on a finding. */
export interface FindingNote {
  id: string
  findingId: string
  author: string
  body: string
  createdAt: string
}

/** A machine credential for the API. */
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

/** A place findings are sent to. */
export interface Webhook {
  id: string
  organizationId: string
  name: string
  url: string
  kind: 'generic' | 'slack'
  enabled: boolean
  createdAt: string
}

/**
 * A decoy credential.
 *
 * The value is shown once, when the honeytoken is created, and only its
 * hash is kept. A finding whose secret hashes to the honeytoken's hash is
 * the honeytoken: somebody committed it, which is exactly what a honeytoken
 * is for.
 */
export interface Honeytoken {
  id: string
  organizationId: string
  label: string
  provider: string
  createdAt: string
  triggeredAt: string | null
}

/** Something somebody did, and who did it. */
export interface AuditEntry {
  id: string
  organizationId: string
  actor: string
  action: string
  target: string | null
  detail: Record<string, unknown>
  createdAt: string
}

/** The counts the dashboard is built from. */
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

/**
 * The insights the console shows.
 *
 * These are the questions the dashboard cannot answer on its own: who keeps
 * committing secrets, which repository is the worst, and what has been
 * sitting unaddressed the longest.
 */
export interface Insights {
  /** The findings that have been open the longest. */
  oldest: Finding[]
  /** The authors with the most open findings. */
  topAuthors: Array<{ author: string; count: number }>
  /** The repositories with the most open findings. */
  topRepositories: Array<{ repositoryId: string; name: string; count: number }>
  /** The rules that fire the most. */
  topRules: Array<{ ruleId: string; count: number }>
  /** How many findings are still valid. */
  liveSecrets: number
  /** How many findings have not been looked at for more than a week. */
  stale: number
}

/**
 * A finding as gitleaks reports it.
 *
 * The field names are the ones the gitleaks JSON report uses. The report is
 * written by the gitleaks binary, so this is the contract with it: a field
 * that changes name there breaks the import here.
 */
export interface GitleaksFinding {
  RuleID: string
  Description: string
  StartLine: number
  EndLine: number
  StartColumn: number
  Match: string
  Secret: string
  File: string
  SymlinkFile?: string
  Commit: string
  Link?: string
  Entropy: number
  Author: string
  Email: string
  Date: string
  Message: string
  Tags: string[]
  Fingerprint: string
}
