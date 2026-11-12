/**
 * The forges the platform can hold a grant for.
 */

import { forgejo } from './forgejo.js'
import { github, listInstallations } from './github.js'
import type { ConnectionProvider, ConnectionProviderId } from './types.js'

export * from './types.js'
export { forgejo } from './forgejo.js'
export { github, listInstallations } from './github.js'

/** Every provider, by its identifier. */
export const connectionProviders: Record<ConnectionProviderId, ConnectionProvider> = {
  forgejo,
  github,
}

/**
 * The provider with this identifier.
 *
 * The identifier comes from the console, so it is not trusted: an unknown
 * one is simply not a provider.
 */
export function connectionProvider(id: string): ConnectionProvider | undefined {
  return connectionProviders[id as ConnectionProviderId]
}

/** The identifiers, for the console's list. */
export const connectionProviderIds = Object.keys(connectionProviders) as ConnectionProviderId[]
