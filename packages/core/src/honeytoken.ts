/**
 * Honeytokens: decoy credentials that must never be used.
 *
 * A honeytoken is a value that looks like a credential but belongs to
 * nobody. It is planted somewhere it should not be — a repository, a
 * configuration file, a ticket — and the rules in the organisation's
 * gitleaks config match it. When the scanner finds it, somebody has picked
 * it up, and that is the signal.
 *
 * Only the hash of the value is kept. The value is shown once, when the
 * honeytoken is created, because that is the moment the operator has to
 * plant it.
 */

import { createHash, randomBytes } from 'node:crypto'

/** The prefix that makes a honeytoken recognisable. */
export const HONEYTOKEN_PREFIX = 'hny_'

/**
 * The hash a honeytoken is matched by.
 *
 * The scanner hashes the secret it found and compares it with this, so the
 * value itself never has to be stored.
 */
export function honeytokenFingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/**
 * Make a new honeytoken.
 *
 * The value is random, and it carries the prefix the rules look for.
 */
export function generateHoneytoken(): string {
  return `${HONEYTOKEN_PREFIX}${randomBytes(20).toString('hex')}`
}

/**
 * Whether a value is a honeytoken.
 *
 * This is the same shape as the rule in the organisation's gitleaks config.
 */
export function isHoneytoken(secret: string): boolean {
  return new RegExp(`^${HONEYTOKEN_PREFIX}[a-f0-9]{40}$`).test(secret)
}
