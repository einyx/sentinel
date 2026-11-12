/// <reference types="vite/client" />

/**
 * The build's environment.
 *
 * The variables are baked in at build time: they are not secrets, and the
 * console is a static bundle with no server to ask.
 */
interface ImportMetaEnv {
  readonly VITE_SENTINEL_OIDC_ISSUER?: string
  readonly VITE_SENTINEL_OIDC_CLIENT_ID?: string
  readonly VITE_SENTINEL_OIDC_AUDIENCE?: string
  readonly VITE_SENTINEL_OIDC_REDIRECT_URI?: string
  readonly VITE_SENTINEL_OIDC_SCOPES?: string
  readonly VITE_SENTINEL_PUBLIC_ORIGIN?: string
  readonly VITE_SENTINEL_PUBLIC_SCHEME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
