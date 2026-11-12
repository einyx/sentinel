/**
 * The console's view of the API.
 *
 * Every call carries the credential the person signed in with. A call that
 * is refused with 401 ends the session: the credential is no longer good
 * for anything.
 */

import type { AuditEntry, Connection, Finding, FindingStatus, GitHubInstallation, Honeytoken, Member, Repository, RepositoryIgnore, Scan, Summary, Insights, Validity, Webhook } from './types'
import { fixtureFor } from './fixtures'

/** How an API call failed. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** The base of the API. It is the same origin as the console. */
const BASE = '/api/v1'

/**
 * Whether the console answers from the fixtures.
 *
 * It is a development switch: the console is a static bundle, and this is
 * how it is worked on without a service behind it.
 */
export const useFixtures = import.meta.env.VITE_SENTINEL_USE_FIXTURES === '1'

/** The API client. */
export class Api {
  constructor(private readonly credential: () => Promise<string | null>) {}

  /** A request, with the credential attached. */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (useFixtures) {
      const answer = fixtureFor(path.split('?')[0])
      if (answer !== null) return answer as T
      // A path the fixtures do not know about is a path the console would
      // not call in the first place.
      return {} as T
    }

    const token = await this.credential()
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    if (response.status === 204) {
      return undefined as T
    }

    const text = await response.text()
    const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}

    if (!response.ok) {
      const message = typeof parsed.error === 'string' ? parsed.error : `the request failed: ${response.status}`
      throw new ApiError(message, response.status)
    }
    return parsed as T
  }

  /** Read something. */
  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  /** Change something. */
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  /** Change something else. */
  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }

  /** Replace something. */
  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body)
  }

  /**
   * The installations a GitHub connection can read.
   *
   * A GitHub App can be installed in several places, and the installation
   * is what says which repositories the token can read.
   */
  listInstallations(connectionId: string): Promise<{ installations: GitHubInstallation[] }> {
    return this.get<{ installations: GitHubInstallation[] }>(`/connections/${connectionId}/installations`)
  }

  /** Choose the installation a GitHub connection reads. */
  selectInstallation(connectionId: string, installationId: number): Promise<{ connection: Connection }> {
    return this.put<{ connection: Connection }>(`/connections/${connectionId}/installation`, { installationId })
  }

  /** Remove something. */
  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }
}

/** The query a findings list is built from. */
export interface FindingsQuery {
  status?: FindingStatus
  validity?: Validity
  repositoryId?: string
  ruleId?: string
  author?: string
  search?: string
  limit?: number
  offset?: number
}

/** The findings of an organisation. */
export interface FindingsPage {
  findings: Finding[]
  total: number
  limit: number
  offset: number
}

/** The repositories of an organisation. */
export interface RepositoriesResponse {
  repositories: Repository[]
}

/** One repository, with its ignores. */
export interface RepositoryDetail {
  repository: Repository
  ignores: RepositoryIgnore[]
}

/** The token the console holds. */
export interface Session {
  credential: string
  refreshToken?: string
  expiresAt: number
  name?: string
  email?: string
  roles: string[]
}

/** The settings the console is built with. */
export interface ConsoleConfig {
  issuer: string
  clientId: string
  audience: string
  redirectUri: string
  scopes: string[]
}

export type {
  AuditEntry,
  Finding,
  FindingStatus,
  Honeytoken,
  Insights,
  Member,
  Repository,
  RepositoryIgnore,
  Scan,
  Summary,
  Validity,
  Webhook,
}
