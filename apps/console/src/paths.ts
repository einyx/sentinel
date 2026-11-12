/**
 * Where the console is served from.
 *
 * The landing page is the front door, so the console lives under a path of
 * its own. The value is fixed at build time, because the bundle is served
 * from one place.
 */

/** The path the console is served from, without a trailing slash. */
export function basePath(): string {
  const configured = import.meta.env.VITE_SENTINEL_BASE_PATH
  if (!configured) {
    return '/console'
  }
  return configured.endsWith('/') ? configured.slice(0, -1) : configured
}

/**
 * The route inside the console, for a path the browser is at.
 *
 * A path outside the console is returned as it is: the sign-in callback
 * arrives at the root, and the console has to recognise it.
 */
export function routePath(pathname: string): string {
  const base = basePath()
  if (pathname === base) return '/'
  if (pathname.startsWith(`${base}/`)) return pathname.slice(base.length)
  return pathname
}

/** The path a route inside the console is served from. */
export function consolePath(route: string): string {
  const base = basePath()
  if (route === '/' || route === '') return `${base}/`
  return `${base}${route.startsWith('/') ? route : `/${route}`}`
}
