/**
 * The settings the platform reads from the environment.
 *
 * Everything that differs between a developer's machine, a test run and a
 * deployment is here, so the rest of the code never reads `process.env`.
 */

import { readFileSync } from 'node:fs'

/** A forge the deployment has registered an application with. */
export interface PreRegisteredProvider {
  /** The name the operator sees. */
  name: string
  /** The provider the application belongs to. */
  provider: 'forgejo' | 'github'
  /** The forge's base URL. */
  baseUrl: string
  /** The application's client identifier. */
  clientId: string
  /** The application's secret. */
  clientSecret: string
}

/** The settings, once they have been read and checked. */
export interface Settings {
  /** The port the API listens on. */
  apiPort: number
  /** The Postgres connection string. */
  databaseUrl: string
  /**
   * The key that encrypts the credentials at rest.
   *
   * Thirty-two bytes, as base64. The credentials are the forge tokens: they
   * are the only thing in the database worth stealing, so they are encrypted
   * rather than stored in the clear.
   */
  encryptionKey: string
  /**
   * The OpenID Connect issuer the console signs in against.
   *
   * This is the Prysm auth platform, the same one the Zero Trust console
   * uses. When it is empty the API accepts no browser sign-in, and only API
   * tokens work.
   */
  oidcIssuer: string
  /** The audience the API's tokens are minted for. */
  oidcAudience: string
  /**
   * The other audiences a token may carry.
   *
   * The provider mints two kinds of token for this deployment. The
   * console's identity token carries the application's identifier as its
   * audience, because the provider issues it for the application rather
   * than for a resource server. The access token carries the resource
   * server's indicator. Both have to be accepted.
   */
  oidcAudiences: string[]
  /**
   * The role that makes a member an owner.
   *
   * The provider puts the roles the user holds in the token's `roles`
   * claim, and this is the one that says the person may manage the
   * organisation.
   */
  oidcOperatorRole: string
  /**
   * The forges the deployment has already registered with.
   *
   * The platform owns the application, not the operator: the operator
   * authorises it and that is all. The application id and secret are
   * deployment settings, so nobody has to copy them anywhere.
   *
   * The secret is read from a file rather than the environment: a GitHub
   * App's private key is a PEM, and a file is the only sane way to keep
   * one.
   */
  preRegisteredProviders: PreRegisteredProvider[]
  /** Where the scanner keeps its clones. */
  workDir: string
  /** The gitleaks binary. */
  gitleaksPath: string
  /** The rules every repository is scanned with. */
  gitleaksConfig: string
  /** How many scans may run at the same time. */
  scanConcurrency: number
  /** How long a single scan may take, in seconds. */
  scanTimeoutSeconds: number
  /** Whether the worker loop runs at all. */
  workerEnabled: boolean
  /** The log level. */
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

/**
 * The forges the deployment has registered with.
 *
 * A provider is pre-registered when its address, its application id and the
 * file its secret is in are all named. The secret is read once, at
 * start-up: it is a deployment setting, not something the operator types.
 */
function readPreRegisteredProviders(env: NodeJS.ProcessEnv): PreRegisteredProvider[] {
  const providers: PreRegisteredProvider[] = []

  const forgejoUrl = env.FORGEJO_URL?.trim()
  const forgejoId = env.FORGEJO_CLIENT_ID?.trim()
  const forgejoSecret = env.FORGEJO_CLIENT_SECRET_FILE?.trim()
  if (forgejoUrl && forgejoId && forgejoSecret) {
    providers.push({
      name: env.FORGEJO_NAME?.trim() || forgejoUrl.replace(/^https?:\/\//, ''),
      provider: 'forgejo',
      baseUrl: forgejoUrl.replace(/\/+$/, ''),
      clientId: forgejoId,
      clientSecret: readSecretFile(forgejoSecret),
    })
  }

  const githubUrl = env.GITHUB_URL?.trim()
  const githubId = env.GITHUB_APP_ID?.trim()
  const githubKey = env.GITHUB_APP_PRIVATE_KEY_FILE?.trim()
  if (githubUrl && githubId && githubKey) {
    providers.push({
      name: env.GITHUB_NAME?.trim() || githubUrl.replace(/^https?:\/\//, ''),
      provider: 'github',
      baseUrl: githubUrl.replace(/\/+$/, ''),
      clientId: githubId,
      clientSecret: readSecretFile(githubKey),
    })
  }

  return providers
}

/** A secret, from the file it is in. */
function readSecretFile(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch (cause) {
    throw new Error(
      `the secret file could not be read: ${path} (${cause instanceof Error ? cause.message : String(cause)})`,
    )
  }
}

/**
 * Read the settings.
 *
 * A missing or malformed required setting stops the process here rather than
 * halfway through a request: a service that cannot decrypt its credentials
 * has no business serving traffic.
 */
export function readSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const required = (name: string): string => {
    const value = env[name]?.trim()
    if (!value) {
      throw new Error(`${name} must be set`)
    }
    return value
  }

  const number = (name: string, fallback: number): number => {
    const raw = env[name]?.trim()
    if (!raw) return fallback
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive number`)
    }
    return value
  }

  const encryptionKey = required('ENCRYPTION_KEY')
  if (Buffer.from(encryptionKey, 'base64').length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes, base64 encoded')
  }

  const logLevel = env.LOG_LEVEL?.trim()
  if (logLevel && !['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error('LOG_LEVEL must be one of debug, info, warn, error')
  }

  return {
    preRegisteredProviders: readPreRegisteredProviders(env),
    apiPort: number('API_PORT', 3000),
    databaseUrl: required('DATABASE_URL'),
    encryptionKey,
    oidcIssuer: env.OIDC_ISSUER?.trim() ?? '',
    oidcAudience: env.OIDC_AUDIENCE?.trim() ?? '',
    oidcAudiences: (env.OIDC_AUDIENCES?.trim() ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    oidcOperatorRole: env.OIDC_OPERATOR_ROLE?.trim() || 'sentinel:operator',
    workDir: env.WORK_DIR?.trim() || '/var/lib/sentinel/work',
    gitleaksPath: env.GITLEAKS_PATH?.trim() || '/usr/local/bin/gitleaks',
    gitleaksConfig: env.GITLEAKS_CONFIG?.trim() || '/etc/sentinel/gitleaks.toml',
    scanConcurrency: number('SCAN_CONCURRENCY', 1),
    scanTimeoutSeconds: number('SCAN_TIMEOUT_SECONDS', 1800),
    workerEnabled: env.WORKER_ENABLED?.trim() !== '0' && env.WORKER_ENABLED?.trim() !== 'false',
    logLevel: (logLevel as Settings['logLevel']) || 'info',
  }
}
