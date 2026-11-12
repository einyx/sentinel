/**
 * Whether a secret still works.
 *
 * gitleaks finds the secret; it does not know whether the secret is still
 * good. This is the part that answers the question an operator asks first:
 * a credential that was revoked the moment it leaked is a different problem
 * from one that is still live.
 *
 * A check is a request to the provider with the credential. It tells the
 * provider that the credential exists, which is why only the providers that
 * are asked for are checked, and why the answer is cached with the finding.
 */

import type { Validity } from './types.js'

/** How long a check may take. */
const TIMEOUT_MS = 10_000

/**
 * A provider that can be asked about a credential.
 */
export interface Verifier {
  /** The name shown in the console. */
  name: string
  /** Whether this verifier knows about this secret. */
  matches(secret: string): boolean
  /** Whether the secret still works. */
  check(secret: string): Promise<Validity>
}

/** Ask a provider about a credential. */
async function ask(url: string, secret: string, headers: Record<string, string>): Promise<Validity> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { ...headers, Authorization: `Bearer ${secret}`, 'User-Agent': 'Sentinel' },
      signal: controller.signal,
    })
    if (response.status === 200) return 'valid'
    // The provider recognised the credential and refused it. It was a
    // credential once and it is not one any more.
    if (response.status === 401) return 'revoked'
    // Anything else — a rate limit, a server error, a gateway — says nothing
    // about the credential.
    return 'unknown'
  } catch {
    return 'unknown'
  } finally {
    clearTimeout(timer)
  }
}

/** GitHub personal access tokens and OAuth tokens. */
const github: Verifier = {
  name: 'github',
  matches: (secret) => /^(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})$/.test(secret),
  check: (secret) => ask('https://api.github.com/user', secret, { Accept: 'application/vnd.github+json' }),
}

/** GitLab personal access tokens. */
const gitlab: Verifier = {
  name: 'gitlab',
  matches: (secret) => /^glpat-[A-Za-z0-9_-]{20,}$/.test(secret),
  check: (secret) => ask('https://gitlab.com/api/v4/user', secret, {}),
}

/**
 * The verifiers.
 *
 * A secret that no verifier knows about stays `unknown`: the platform finds
 * the secret, but it does not claim to know whether it works.
 */
export const verifiers: Verifier[] = [github, gitlab]

/**
 * Check whether a secret still works.
 *
 * The check is made with the secret itself, so the caller has to have it in
 * hand. The answer is `unknown` when nothing can be said.
 */
export async function checkValidity(secret: string): Promise<Validity> {
  const verifier = verifiers.find((candidate) => candidate.matches(secret))
  if (!verifier) return 'unknown'
  try {
    return await verifier.check(secret)
  } catch {
    return 'unknown'
  }
}

/**
 * The provider a secret belongs to, if the platform knows it.
 *
 * It is used to label a finding: "this is a GitHub token" is more useful
 * than "this matched a rule".
 */
export function providerOf(secret: string): string | null {
  const verifier = verifiers.find((candidate) => candidate.matches(secret))
  return verifier ? verifier.name : null
}
