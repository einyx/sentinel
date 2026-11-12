/**
 * The database schema and the pool that talks to it.
 *
 * The schema is applied at start-up rather than by a separate migration
 * tool: it is small, it is additive, and a deployment that has to run two
 * commands to come up is a deployment that comes up wrong.
 */

import pg from 'pg'

const { Pool } = pg

/** A pool of connections to Postgres. */
export type Pool = pg.Pool

/** A queryable client. */
export type Client = pg.PoolClient

/**
 * The schema.
 *
 * Every statement is idempotent, so applying it to a database that already
 * has it changes nothing.
 */
export const SCHEMA = `
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists members (
  organization_id uuid not null references organizations(id) on delete cascade,
  subject text not null,
  email text,
  name text,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, subject)
);

create table if not exists credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null default 'token',
  username text,
  secret_ciphertext text not null,
  created_at timestamptz not null default now()
);

create table if not exists connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider text not null,
  name text not null,
  base_url text not null,
  client_id text not null,
  -- The application's secret, encrypted. For GitHub it is the app's private
  -- key, which is what signs the token that mints an installation token.
  client_secret_ciphertext text not null,
  -- The grant itself, encrypted.
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_type text,
  scopes text,
  -- The account the grant belongs to: the login, or the organisation the
  -- app is installed on.
  account text,
  expires_at timestamptz,
  -- The provider's own metadata: the installation, the account.
  metadata jsonb not null default '{}'::jsonb,
  -- pending | active | needs_attention | revoked
  status text not null default 'pending',
  -- The state the authorisation request carried, until it comes back.
  state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table connections add column if not exists account text;

create index if not exists connections_organization_idx on connections (organization_id);
create unique index if not exists connections_state_idx on connections (state) where state is not null;

create table if not exists repositories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  provider text not null default 'generic',
  clone_url text not null,
  credential_id uuid references credentials(id) on delete set null,
  -- The grant the clone uses, when it is not a stored token.
  connection_id uuid references connections(id) on delete set null,
  enabled boolean not null default true,
  scan_interval_minutes integer not null default 360,
  last_scan_at timestamptz,
  last_scan_status text,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references repositories(id) on delete cascade,
  status text not null,
  trigger text not null default 'schedule',
  commit_sha text,
  findings_count integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists scans_repository_started_idx on scans (repository_id, started_at desc);

create table if not exists findings (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references repositories(id) on delete cascade,
  scan_id uuid references scans(id) on delete set null,
  fingerprint text not null,
  rule_id text not null,
  description text,
  file text,
  start_line integer,
  commit_sha text,
  author text,
  committed_at timestamptz,
  match_redacted text,
  secret_redacted text,
  -- The secret itself, encrypted. It is never handed out: the console shows
  -- the masked text. It is here because the validity check needs it, and
  -- because a honeytoken is matched by hashing it.
  secret_ciphertext text,
  status text not null default 'open',
  validity text not null default 'unknown',
  assignee text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  unique (repository_id, fingerprint)
);

alter table repositories add column if not exists connection_id uuid references connections(id) on delete set null;

create index if not exists findings_repository_status_idx on findings (repository_id, status);
create index if not exists findings_status_idx on findings (status);
create index if not exists findings_rule_idx on findings (rule_id);
create index if not exists findings_author_idx on findings (author);

create table if not exists finding_notes (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references findings(id) on delete cascade,
  author text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists finding_notes_finding_idx on finding_notes (finding_id, created_at desc);

create table if not exists repository_ignores (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references repositories(id) on delete cascade,
  kind text not null,
  value text not null,
  created_at timestamptz not null default now(),
  unique (repository_id, kind, value)
);

create table if not exists webhooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  url text not null,
  kind text not null default 'generic',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists honeytokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  label text not null,
  provider text not null default 'generic',
  fingerprint text not null unique,
  created_at timestamptz not null default now(),
  triggered_at timestamptz
);

create table if not exists audit_log (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  actor text not null,
  action text not null,
  target text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_org_idx on audit_log (organization_id, created_at desc);

create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- A database that was created before the role existed still works.
alter table api_tokens add column if not exists role text not null default 'member';

create index if not exists api_tokens_hash_idx on api_tokens (token_hash);
`

/**
 * Open the pool.
 *
 * The pool is small on purpose: the API does not need many connections, and
 * Postgres has a limit per user that a deployment should not sit on.
 */
export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
}

/**
 * Apply the schema.
 *
 * The advisory lock keeps two instances of the API from applying it at the
 * same time when a new host comes up next to an old one. The statements are
 * idempotent anyway, but the lock keeps the logs readable.
 */
export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [8_675_309])
    try {
      await client.query(SCHEMA)
    } finally {
      await client.query('select pg_advisory_unlock($1)', [8_675_309])
    }
  } finally {
    client.release()
  }
}
