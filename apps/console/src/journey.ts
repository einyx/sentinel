/**
 * The journey the operator is on.
 *
 * Some steps leave the console: the authorisation of a forge happens on the
 * forge's own site, and the browser comes back afterwards. The console
 * remembers where the journey was, so it continues there instead of dropping
 * the operator on a page they did not ask for.
 */

const RETURN_KEY = 'sentinel:return-to'

/** Where the console should send the operator back to. */
export function rememberReturnTo(path: string): void {
  try {
    sessionStorage.setItem(RETURN_KEY, path)
  } catch {
    // A browser that keeps nothing is a browser that loses the way back.
    // The operator lands on the connections page instead, which is where
    // they would have gone anyway.
  }
}

/**
 * Where the console should send the operator back to, and forgets it.
 *
 * The fallback is the connections page: the operator has just authorised a
 * forge, and that is what the page is about.
 */
export function takeReturnTo(fallback: string): string {
  try {
    const value = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    return value ?? fallback
  } catch {
    return fallback
  }
}

/** The repositories page, with the picker open. */
export function repositoriesPath(picking: boolean): string {
  return picking ? '/repositories?pick=1' : '/repositories'
}
