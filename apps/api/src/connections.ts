/**
 * Connections, as the API and the worker see them.
 *
 * A connection holds a grant and the credentials of the application the
 * grant belongs to. Everything that has to call the provider goes through
 * here, so the encryption and the decryption happen in one place.
 */

import {
  connectionProvider,
  decrypt,
  encrypt,
  type Connection,
  type ConnectionProvider,
  type PreRegisteredProvider,
  type RemoteRepository,
  type Store,
} from '@sentinel/core'

/** A connection, with its secrets decrypted. */
export interface ResolvedConnection {
  connection: Connection
  provider: ConnectionProvider
  /** The application's client identifier. */
  clientId: string
  /** The application's secret: the forge's client secret, or GitHub's private key. */
  clientSecret: string
  /** The grant's access token. */
  accessToken: string
  /** The grant's refresh token, when the provider issues one. */
  refreshToken?: string
  /** When the access token stops working. */
  expiresAt: Date | null
  /** The provider's own metadata. */
  metadata: Record<string, unknown>
}

/**
 * The connection, ready to be used.
 *
 * Throws when the connection cannot be used: it does not exist, it was
 * withdrawn, or its grant was revoked. The message says which, because the
 * difference matters to whoever has to fix it.
 */
export async function resolveConnection(
  store: Store,
  connectionId: string,
  encryptionKey: string,
  preRegistered: PreRegisteredProvider[] = [],
): Promise<ResolvedConnection> {
  const connection = await store.getConnection(connectionId)
  if (!connection) {
    throw new Error('the connection does not exist')
  }
  if (connection.status === 'revoked') {
    throw new Error('the connection was withdrawn')
  }

  const provider = connectionProvider(connection.provider)
  if (!provider) {
    throw new Error(`the connection names an unknown provider: ${connection.provider}`)
  }

  const secrets = await store.getConnectionSecrets(connection.id)
  if (!secrets) {
    throw new Error('the connection has no secrets')
  }

  if (!secrets.accessToken) {
    throw new Error('the connection has no grant: it was never authorised, or the grant was withdrawn')
  }

  // A connection the deployment registered takes the application's
  // credentials from the deployment: rotating the secret there must not
  // break the connections that were made with it.
  const deployment = preRegistered.find(
    (entry) =>
      entry.provider === connection.provider && entry.baseUrl === connection.baseUrl,
  )

  return {
    connection,
    provider,
    clientSecret: deployment
      ? deployment.clientSecret
      : decrypt(secrets.clientSecret, encryptionKey),
    clientId: deployment ? deployment.clientId : connection.clientId,
    accessToken: decrypt(secrets.accessToken, encryptionKey),
    refreshToken: secrets.refreshToken ? decrypt(secrets.refreshToken, encryptionKey) : undefined,
    expiresAt: connection.expiresAt ? new Date(connection.expiresAt) : null,
    metadata: connection.metadata,
  }
}

/**
 * The repositories the grant can read.
 */
export async function listRemoteRepositories(resolved: ResolvedConnection): Promise<RemoteRepository[]> {
  return resolved.provider.listRepositories({
    baseUrl: resolved.connection.baseUrl,
    clientId: resolved.clientId,
    clientSecret: resolved.clientSecret,
    accessToken: resolved.accessToken,
    refreshToken: resolved.refreshToken,
    expiresAt: resolved.expiresAt,
    metadata: resolved.metadata,
  })
}

/**
 * The token to clone with.
 *
 * A provider whose tokens expire mints a fresh one, and the connection's
 * grant is updated with the result so the next clone does not have to.
 */
export async function cloneTokenFor(
  store: Store,
  resolved: ResolvedConnection,
  encryptionKey: string,
): Promise<{ username: string; token: string }> {
  const grant = await resolved.provider.cloneToken({
    baseUrl: resolved.connection.baseUrl,
    clientId: resolved.clientId,
    clientSecret: resolved.clientSecret,
    accessToken: resolved.accessToken,
    refreshToken: resolved.refreshToken,
    expiresAt: resolved.expiresAt,
    metadata: resolved.metadata,
  })

  // A renewed grant is kept, so the next clone starts with a good one.
  if (grant.accessToken !== resolved.accessToken) {
    await store.updateConnectionGrant(resolved.connection.id, {
      accessTokenCiphertext: encrypt(grant.accessToken, encryptionKey),
      refreshTokenCiphertext: grant.refreshToken ? encrypt(grant.refreshToken, encryptionKey) : null,
      expiresAt: grant.expiresAt ? grant.expiresAt.toISOString() : null,
      scopes: grant.scopes ?? null,
    })
  }

  await store.touchConnection(resolved.connection.id)

  return { username: resolved.provider.cloneUser, token: grant.accessToken }
}
