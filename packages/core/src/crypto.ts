/**
 * Encryption and hashing for the things the platform stores.
 *
 * The forge credentials are the only secrets in the database. They are
 * encrypted with AES-256-GCM, so a stolen database file does not hand over
 * the tokens. The API tokens are hashed instead of encrypted: they only have
 * to be looked up, never read back.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** The version byte that opens every ciphertext. */
const VERSION = 'v1'

/**
 * Encrypt a secret.
 *
 * The result is `v1:<iv>:<tag>:<ciphertext>`, all base64. The version byte
 * is there so the format can change later without a flag day: an old
 * ciphertext is still readable, a new one is not readable by old code.
 */
export function encrypt(plaintext: string, key: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':')
}

/**
 * Decrypt a secret.
 *
 * A ciphertext that does not authenticate is an error, not an empty string:
 * a tampered credential has to fail loudly.
 */
export function decrypt(payload: string, key: string): string {
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('the ciphertext is not in a format this version understands')
  }
  const [, iv, tag, ciphertext] = parts
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

/**
 * Hash an API token.
 *
 * The hash is what is stored. The token itself is shown once, when it is
 * created, and never again.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Compare two secrets without leaking how much of them matched.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Make a new API token.
 *
 * The token is a random string with a prefix, so it is recognisable in a
 * log or a shell history without being mistaken for a JWT.
 */
export function generateApiToken(): string {
  return `snt_${randomBytes(32).toString('base64url')}`
}
