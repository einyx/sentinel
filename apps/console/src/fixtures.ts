/**
 * Fixtures.
 *
 * The console is a static bundle, so the data it shows comes from the API.
 * When the fixtures are switched on, the API client answers from here
 * instead: the console can be worked on, and shown, without a running
 * service or a database.
 *
 * The shapes are the API's shapes. A change to the API that the fixtures do
 * not follow shows up as a broken console in this mode, which is the point.
 */

import type {
  AuditEntry,
  Finding,
  FindingNote,
  Honeytoken,
  Insights,
  Member,
  Repository,
  RepositoryIgnore,
  Scan,
  Summary,
  Webhook,
} from './types'

/** The repositories the fixtures know about. */
const repositories: Repository[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    organizationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'zt',
    provider: 'forgejo',
    cloneUrl: 'https://git.prysm.sh/prysmsh/zt.git',
    credentialId: 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
    connectionId: null,
    enabled: true,
    scanIntervalMinutes: 360,
    lastScanAt: new Date(Date.now() - 3600_000).toISOString(),
    lastScanStatus: 'succeeded',
    openFindings: 12,
    createdAt: new Date(Date.now() - 86400_000).toISOString(),
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    organizationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'prysm',
    provider: 'forgejo',
    cloneUrl: 'https://git.prysm.sh/prysmsh/prysm.git',
    credentialId: null,
    connectionId: null,
    enabled: true,
    scanIntervalMinutes: 360,
    lastScanAt: new Date(Date.now() - 7200_000).toISOString(),
    lastScanStatus: 'succeeded',
    openFindings: 5,
    createdAt: new Date(Date.now() - 86400_000).toISOString(),
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    organizationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'prysm-compose',
    provider: 'generic',
    cloneUrl: 'https://git.prysm.sh/prysmsh/prysm-compose.git',
    credentialId: null,
    connectionId: null,
    enabled: false,
    scanIntervalMinutes: 1440,
    lastScanAt: new Date(Date.now() - 172800_000).toISOString(),
    lastScanStatus: 'failed',
    openFindings: 0,
    createdAt: new Date(Date.now() - 172800_000).toISOString(),
  },
]

/** The findings the fixtures know about. */
const findings: Finding[] = [
  {
    id: 'f0000000-0000-0000-0000-000000000001',
    repositoryId: repositories[0].id,
    repositoryName: 'zt',
    fingerprint: 'aaa',
    ruleId: 'connection-string-with-password',
    description: 'Database or broker URL with an inline password',
    file: 'deploy/postgres-ha/20-hba.sql',
    startLine: 14,
    commitSha: '9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293',
    author: 'Alessio',
    committedAt: new Date(Date.now() - 86400_000).toISOString(),
    matchRedacted: 'postgres://zt:REDACTED@postgres:5432/zt',
    secretRedacted: 'REDACTED',
    status: 'open',
    validity: 'valid',
    assignee: null,
    firstSeenAt: new Date(Date.now() - 86400_000).toISOString(),
    lastSeenAt: new Date(Date.now() - 3600_000).toISOString(),
    resolvedAt: null,
    resolvedBy: null,
  },
  {
    id: 'f0000000-0000-0000-0000-000000000002',
    repositoryId: repositories[0].id,
    repositoryName: 'zt',
    fingerprint: 'bbb',
    ruleId: 'github-pat',
    description: 'GitHub Personal Access Token',
    file: 'deploy/.env.example',
    startLine: 6,
    commitSha: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
    author: 'Alessio',
    committedAt: new Date(Date.now() - 172800_000).toISOString(),
    matchRedacted: 'GH_TOKEN=REDACTED',
    secretRedacted: 'REDACTED',
    status: 'acknowledged',
    validity: 'unknown',
    assignee: 'alessio',
    firstSeenAt: new Date(Date.now() - 172800_000).toISOString(),
    lastSeenAt: new Date(Date.now() - 7200_000).toISOString(),
    resolvedAt: null,
    resolvedBy: null,
  },
  {
    id: 'f0000000-0000-0000-0000-000000000003',
    repositoryId: repositories[1].id,
    repositoryName: 'prysm',
    fingerprint: 'ccc',
    ruleId: 'slack-bot-token',
    description: 'Slack Bot Token',
    file: 'packages/core/src/connectors/slack.ts',
    startLine: 88,
    commitSha: '2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e',
    author: 'Someone Else',
    committedAt: new Date(Date.now() - 604800_000).toISOString(),
    matchRedacted: 'xoxb-REDACTED',
    secretRedacted: 'REDACTED',
    status: 'open',
    validity: 'revoked',
    assignee: null,
    firstSeenAt: new Date(Date.now() - 604800_000).toISOString(),
    lastSeenAt: new Date(Date.now() - 604800_000).toISOString(),
    resolvedAt: null,
    resolvedBy: null,
  },
  {
    id: 'f0000000-0000-0000-0000-000000000004',
    repositoryId: repositories[1].id,
    repositoryName: 'prysm',
    fingerprint: 'ddd',
    ruleId: 'generic-api-key',
    description: 'Generic API Key',
    file: 'deploy/verity/.env.example',
    startLine: 21,
    commitSha: '3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f',
    author: 'Someone Else',
    committedAt: new Date(Date.now() - 1209600_000).toISOString(),
    matchRedacted: 'API_KEY=REDACTED',
    secretRedacted: 'REDACTED',
    status: 'resolved',
    validity: 'invalid',
    assignee: null,
    firstSeenAt: new Date(Date.now() - 1209600_000).toISOString(),
    lastSeenAt: new Date(Date.now() - 1209600_000).toISOString(),
    resolvedAt: new Date(Date.now() - 90000_000).toISOString(),
    resolvedBy: 'alessio',
  },
]

const notes: FindingNote[] = [
  {
    id: 'n1',
    findingId: findings[1].id,
    author: 'alessio',
    body: 'The token was rotated on the forge side. Waiting for the history to be rewritten.',
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
  },
]

const scans: Scan[] = [
  {
    id: 's1',
    repositoryId: repositories[0].id,
    repositoryName: repositories[0].name,
    status: 'succeeded',
    trigger: 'schedule',
    commitSha: '9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293',
    findingsCount: 12,
    error: null,
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
    finishedAt: new Date(Date.now() - 3590_000).toISOString(),
  },
  {
    id: 's2',
    repositoryId: repositories[1].id,
    repositoryName: repositories[1].name,
    status: 'succeeded',
    trigger: 'manual',
    commitSha: '2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e',
    findingsCount: 5,
    error: null,
    startedAt: new Date(Date.now() - 7200_000).toISOString(),
    finishedAt: new Date(Date.now() - 7190_000).toISOString(),
  },
  {
    id: 's3',
    repositoryId: repositories[2].id,
    repositoryName: repositories[2].name,
    status: 'failed',
    trigger: 'schedule',
    commitSha: null,
    findingsCount: 0,
    error: 'the clone failed: could not read Username for https://git.prysm.sh',
    startedAt: new Date(Date.now() - 172800_000).toISOString(),
    finishedAt: new Date(Date.now() - 172790_000).toISOString(),
  },
]

const summary: Summary = {
  repositories: repositories.length,
  enabledRepositories: repositories.filter((repository) => repository.enabled).length,
  open: findings.filter((finding) => finding.status === 'open').length,
  acknowledged: findings.filter((finding) => finding.status === 'acknowledged').length,
  resolved: findings.filter((finding) => finding.status === 'resolved').length,
  ignored: 0,
  valid: findings.filter((finding) => finding.validity === 'valid').length,
  findingsLastWeek: 3,
  byRule: [
    { ruleId: 'connection-string-with-password', count: 12 },
    { ruleId: 'github-pat', count: 9 },
    { ruleId: 'generic-api-key', count: 7 },
    { ruleId: 'slack-bot-token', count: 4 },
    { ruleId: 'aws-access-token', count: 2 },
  ],
  byRepository: [
    { repositoryId: repositories[0].id, name: 'zt', open: 12, total: 19 },
    { repositoryId: repositories[1].id, name: 'prysm', open: 5, total: 11 },
  ],
  byAuthor: [
    { author: 'Alessio', count: 14 },
    { author: 'Someone Else', count: 3 },
  ],
  byDay: [
    { day: '2026-11-05', count: 1 },
    { day: '2026-11-07', count: 4 },
    { day: '2026-11-09', count: 2 },
    { day: '2026-11-11', count: 6 },
  ],
  recentScans: scans,
}

const insights: Insights = {
  oldest: findings.filter((finding) => finding.status === 'open' || finding.status === 'acknowledged'),
  topAuthors: summary.byAuthor,
  topRepositories: summary.byRepository.map((entry) => ({
    repositoryId: entry.repositoryId,
    name: entry.name,
    count: entry.open,
  })),
  topRules: summary.byRule,
  liveSecrets: summary.valid,
  stale: 2,
}

const members: Member[] = [
  {
    organizationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    subject: 'alessio',
    email: 'alessio@example.invalid',
    name: 'Alessio',
    role: 'owner',
    createdAt: new Date(Date.now() - 86400_000).toISOString(),
  },
]

const webhooks: Webhook[] = [
  {
    id: 'w1',
    organizationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'the team channel',
    url: 'https://hooks.example.invalid/sentinel',
    kind: 'slack',
    enabled: true,
    createdAt: new Date(Date.now() - 86400_000).toISOString(),
  },
]

const honeytokens: Honeytoken[] = [
  {
    id: 'h1',
    organizationId: 'aaaaaaaa-aaaa-aaaa-aaaaaaaaaaaa',
    label: 'the staging database',
    provider: 'generic',
    createdAt: new Date(Date.now() - 86400_000).toISOString(),
    triggeredAt: null,
  },
]

const audit: AuditEntry[] = [
  {
    id: 'a1',
    organizationId: 'aaaaaaaa-aaaa-aaaa-aaaaaaaaaaaa',
    actor: 'alessio',
    action: 'finding.acknowledged',
    target: findings[1].id,
    detail: {},
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
  },
  {
    id: 'a2',
    organizationId: 'aaaaaaaa-aaaa-aaaa-aaaaaaaaaaaa',
    actor: 'alessio',
    action: 'repository.scan',
    target: repositories[0].id,
    detail: {},
    createdAt: new Date(Date.now() - 7200_000).toISOString(),
  },
]

const ignores: RepositoryIgnore[] = [
  {
    id: 'i1',
    repositoryId: repositories[0].id,
    kind: 'path',
    value: '(^|/)tests?/fixtures/',
    createdAt: new Date(Date.now() - 86400_000).toISOString(),
  },
]

/** The answers the fixtures give. */
/**
 * The repositories a forge can be watched from.
 *
 * The forge's own list: what the connection would read. The picker shows
 * these, so the fixtures have to have them.
 */
const remoteRepositories = [
  {
    fullName: 'prysmsh/zt',
    cloneUrl: 'https://git.prysm.sh/prysmsh/zt.git',
    private: true,
    defaultBranch: 'main',
  },
  {
    fullName: 'prysmsh/prysm',
    cloneUrl: 'https://git.prysm.sh/prysmsh/prysm.git',
    private: true,
    defaultBranch: 'master',
  },
  {
    fullName: 'prysmsh/prysm-compose',
    cloneUrl: 'https://git.prysm.sh/prysmsh/prysm-compose.git',
    private: true,
    defaultBranch: 'main',
  },
  {
    fullName: 'prysmsh/sentinel',
    cloneUrl: 'https://git.prysm.sh/prysmsh/sentinel.git',
    private: true,
    defaultBranch: 'main',
  },
  {
    fullName: 'prysmsh/zt-cli',
    cloneUrl: 'https://git.prysm.sh/prysmsh/zt-cli.git',
    private: false,
    defaultBranch: 'main',
  },
  {
    fullName: 'prysmsh/homebrew-zt',
    cloneUrl: 'https://git.prysm.sh/prysmsh/homebrew-zt.git',
    private: false,
    defaultBranch: 'main',
  },
  {
    fullName: 'prysmsh/prysm-landing',
    cloneUrl: 'https://git.prysm.sh/prysmsh/prysm-landing.git',
    private: false,
    defaultBranch: 'main',
  },
]

export const fixtures: Record<string, unknown> = {  '/me': {
    actor: { subject: 'alessio', name: 'Alessio', email: 'alessio@example.invalid', role: 'owner', kind: 'user' },
    organization: {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      slug: 'prysmsh',
      name: 'Prysm',
      createdAt: new Date(Date.now() - 86400_000).toISOString(),
    },
    identityProvider: 'https://prysm.sh/oidc',
  },
  '/summary': summary,
  '/insights': insights,
  '/repositories': { repositories },
  '/scans': { scans },
  '/findings': { findings, total: findings.length, limit: 50, offset: 0 },
  '/members': { members },
  '/connections': {
    connections: [
      {
        id: 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
        organizationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        provider: 'forgejo',
        name: 'git.prysm.sh',
        baseUrl: 'https://git.prysm.sh',
        clientId: 'an-app',
        account: 'prysmsh',
        scopes: 'read:repository',
        expiresAt: null,
        metadata: {},
        status: 'active',
        createdAt: new Date(Date.now() - 86400_000).toISOString(),
        updatedAt: new Date(Date.now() - 3600_000).toISOString(),
        lastUsedAt: new Date(Date.now() - 1800_000).toISOString(),
      },
      {
        id: 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
        organizationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        provider: 'github',
        name: 'GitHub',
        baseUrl: 'https://github.com',
        clientId: 'an-app',
        account: 'prysmsh',
        scopes: 'read:user',
        expiresAt: null,
        metadata: { installationId: 42 },
        status: 'needs_attention',
        createdAt: new Date(Date.now() - 172800_000).toISOString(),
        updatedAt: new Date(Date.now() - 3600_000).toISOString(),
        lastUsedAt: null,
      },
    ],
  },
  '/connections/providers': {
    providers: [
      {
        id: 'forgejo',
        title: 'git.prysm.sh',
        preRegistered: true,
        registration: {
          where: 'Settings → Applications → OAuth2 Applications → Generate a new token',
          scopes: ['read:repository'],
          redirectUri: 'https://sentinel.prysm.sh/auth/connect/forgejo/callback',
          notes: ['The client secret is the one the forge shows when the application is created.'],
        },
      },
      {
        id: 'github',
        title: 'GitHub',
        preRegistered: false,
        registration: {
          where: 'Settings → Developer settings → GitHub Apps → New GitHub App',
          scopes: ['Contents: read'],
          redirectUri: 'https://sentinel.prysm.sh/auth/connect/github/callback',
          notes: ['Install the app on the organisations or repositories to watch.'],
        },
      },
    ],
  },
  '/webhooks': { webhooks },
  '/honeytokens': { honeytokens },
  '/audit': { entries: audit },
  '/rules': {
    rules: [
      'aws-access-token',
      'connection-string-with-password',
      'forgejo-access-token',
      'generic-api-key',
      'github-pat',
      'sentinel-honeytoken',
      'slack-bot-token',
    ],
    descriptions: {},
    source: '/etc/sentinel/gitleaks.toml',
  },
}

/**
 * The answer for a path, or null when the fixtures do not have one.
 *
 * The lookup is by prefix, so a path with a query string still finds its
 * answer.
 */
export function fixtureFor(path: string): unknown | null {
  if (path in fixtures) return fixtures[path]

  if (path.startsWith('/findings/')) {
    const id = path.slice('/findings/'.length).split('?')[0]
    const finding = findings.find((entry) => entry.id === id)
    if (finding) return { finding, notes: notes.filter((note) => note.findingId === id) }
  }

  if (path.startsWith('/connections/') && path.endsWith('/repositories')) {
    return { repositories: remoteRepositories }
  }

  if (path.startsWith('/repositories/') && path.endsWith('/ignores')) {
    const id = path.split('/')[2]
    return { ignores: ignores.filter((ignore) => ignore.repositoryId === id) }
  }

  if (path.startsWith('/repositories/')) {
    const id = path.split('/')[2]
    const repository = repositories.find((entry) => entry.id === id)
    if (repository) return { repository, ignores }
  }

  return null
}
