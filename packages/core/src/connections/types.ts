/**
 * Repository connections.
 *
 * A connection is a grant that lets the platform read a forge on the
 * operator's behalf. It is what replaces a token pasted into every
 * repository: the operator authorises the forge once, the platform keeps the
 * grant, and the repositories are picked from the list the forge returns.
 *
 * A connection holds a *person's* grant, so it is stored encrypted and it is
 * revoked when the operator revokes it. The one exception is GitHub, where
 * the platform mints a short-lived installation token from the app's own
 * key and never holds a user token at all.
 */

/** What a provider is called. */
export type ConnectionProviderId = 'forgejo' | 'github'

/** The state a connection is in. */
export type ConnectionStatus =
  /** The operator has not finished the authorisation yet. */
  | 'pending'
  /** The grant is good. */
  | 'active'
  /** The grant could not be refreshed: the consent was revoked, or the
   * credentials were changed. Somebody has to connect it again. */
  | 'needs_attention'
  /** The operator withdrew it. */
  | 'revoked'

/** A grant, as the provider's token endpoint returned it. */
export interface Grant {
  /** The bearer token. */
  accessToken: string
  /** The refresh token, when the provider issues one. */
  refreshToken?: string
  /** The token type. */
  tokenType?: string
  /** The scopes the provider granted. */
  scopes?: string
  /** When the access token stops working. */
  expiresAt?: Date
  /** The account the grant belongs to. */
  account?: string
}

/** A repository, as the provider's API returned it. */
export interface RemoteRepository {
  /** The name the forge knows it by: "owner/repo". */
  fullName: string
  /** The URL to clone it from. */
  cloneUrl: string
  /** Whether it is private. */
  private: boolean
  /** The branch the forge calls the default. */
  defaultBranch?: string
}

/** What the operator has to register with the provider. */
export interface Registration {
  /** Where the provider's application is registered. */
  where: string
  /** What to ask for. */
  scopes: string[]
  /** The redirect URI to give the provider. */
  redirectUri: string
  /** What else the provider wants to know. */
  notes?: string[]
}

/** The parameters of the authorisation request. */
export interface AuthorizeParams {
  /** The provider's base URL. */
  baseUrl: string
  /** The application's client identifier. */
  clientId: string
  /** Where the provider sends the browser back. */
  redirectUri: string
  /** The state, which the provider echoes back. */
  state: string
  /** The scopes to ask for. */
  scopes: string[]
}

/** The parameters of the code exchange. */
export interface ExchangeParams {
  baseUrl: string
  clientId: string
  /** The application's secret. For GitHub this is the app's private key. */
  clientSecret: string
  code: string
  redirectUri: string
}

/** The parameters of the calls that need a token. */
export interface GrantParams {
  baseUrl: string
  clientId: string
  clientSecret: string
  accessToken: string
  refreshToken?: string
  /** When the access token stops working, when the provider says so. */
  expiresAt?: Date | null
  /** The provider's own metadata: the installation, the account. */
  metadata: Record<string, unknown>
}

/**
 * A forge the platform can hold a grant for.
 */
export interface ConnectionProvider {
  /** The provider's identifier, as it is stored. */
  readonly id: ConnectionProviderId
  /** The name the operator sees. */
  readonly title: string
  /**
   * The user name a clone uses with the provider's token.
   *
   * The token is the password; the user name tells the provider which grant
   * to use.
   */
  readonly cloneUser: string
  /** What the operator has to register. */
  registration(redirectUri: string): Registration
  /** The URL the browser goes to. */
  authorizeUrl(params: AuthorizeParams): string
  /** Exchange an authorisation code for a grant. */
  exchange(params: ExchangeParams): Promise<Grant>
  /** The repositories the grant can read. */
  listRepositories(params: GrantParams): Promise<RemoteRepository[]>
  /**
   * The token to clone with.
   *
   * A provider whose tokens expire mints a fresh one here, and the
   * connection's grant is updated with the result.
   */
  cloneToken(params: GrantParams): Promise<Grant>
  /**
   * Withdraw the grant at the provider.
   *
   * It is best effort: a provider that cannot be reached must not stop the
   * platform from forgetting the grant.
   */
  revoke?(params: GrantParams): Promise<void>
}
