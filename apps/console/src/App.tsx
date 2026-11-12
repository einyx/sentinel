/**
 * The console.
 *
 * It is a static bundle: the browser loads the JavaScript, and every call
 * goes to /api, which the console's own proxy forwards to the API service.
 * One origin, so there are no cross-origin concerns.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Boxes,
  FileClock,
  Fingerprint,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Radio,
  Settings2,
  ShieldAlert,
  Users,
  Webhook,
} from 'lucide-react'

import { Api, ApiError, useFixtures } from './api'
import { basePath, consolePath, routePath } from './paths'
import {
  beginSignIn,
  CALLBACK_PATH,
  canRenew,
  clearSession,
  completeSignIn,
  loadSession,
  needsRefresh,
  oidcConfig,
  refreshSession,
  storeSession,
  type Session,
} from './oidc'
import { AuditLog } from './pages/AuditLog'
import { Connections, useConnectionCallback } from './pages/Connections'
import { Dashboard } from './pages/Dashboard'
import { FindingDetail } from './pages/FindingDetail'
import { Findings } from './pages/Findings'
import { Honeytokens } from './pages/Honeytokens'
import { Insights } from './pages/Insights'
import { Members } from './pages/Members'
import { Repositories } from './pages/Repositories'
import { Rules } from './pages/Rules'
import { Tokens } from './pages/Tokens'
import { Webhooks } from './pages/Webhooks'
import type { Organization, Summary } from './types'

/** How long before the credential lapses the console renews it. */
const RENEW_WITHIN_SECONDS = 300

/** The pages of the console, and the paths they live at. */
const PAGES = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/findings', label: 'Findings', icon: ShieldAlert },
  { path: '/repositories', label: 'Repositories', icon: Boxes },
  { path: '/connections', label: 'Connections', icon: KeyRound },
  { path: '/insights', label: 'Insights', icon: Activity },
  { path: '/rules', label: 'Rules', icon: Fingerprint },
  { path: '/honeytokens', label: 'Honeytokens', icon: Radio },
  { path: '/webhooks', label: 'Integrations', icon: Webhook },
  { path: '/members', label: 'Members', icon: Users },
  {path: '/tokens', label: 'API tokens', icon: KeyRound },
  { path: '/audit', label: 'Audit log', icon: FileClock },
] as const

/**
 * The current path, and a way to change it.
 *
 * The console has a handful of pages, so it does not carry a router: the
 * history API is enough, and the bundle stays small.
 */
function useRoute(): [string, (path: string) => void] {
  const [path, setPath] = useState(() => routePath(window.location.pathname))

  useEffect(() => {
    const onPop = () => setPath(routePath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((next: string) => {
    const target = consolePath(next)
    if (target === window.location.pathname) return
    window.history.pushState({}, '', target)
    setPath(next)
  }, [])

  return [path, navigate]
}

/**
 * The sign-in gate.
 *
 * It is shown when there is no session, and it is the only thing that can
 * start one.
 */
function SignIn({ onSession }: { onSession: (session: Session) => void }) {
  const [error, setError] = useState<string | null>(null)
  const config = oidcConfig()

  useEffect(() => {
    // The provider sends the browser back here after the exchange.
    if (window.location.pathname === '/auth/callback') {
      void completeSignIn(config)
        .then(onSession)
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : 'the sign-in did not complete')
          window.history.replaceState({}, '', '/')
        })
    }
  }, [config, onSession])

  if (error) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1>Sentinel</h1>
          <p className="gate-error">{error}</p>
          <button className="button primary" onClick={() => void beginSignIn(config)}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <h1>Sentinel</h1>
        <p>Secret scanning for the organisation&rsquo;s repositories.</p>
        <button className="button primary" onClick={() => void beginSignIn(config)}>
          Sign in
        </button>
      </div>
    </div>
  )
}

/**
 * The console, once somebody is signed in.
 */
function Console({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [path, navigate] = useRoute()
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const config = useMemo(() => oidcConfig(), [])

  /** The credential for a request, renewed when it is about to lapse. */
  const credential = useCallback(async (): Promise<string | null> => {
    const current = loadSession()
    if (!current) {
      onSignOut()
      return null
    }
    if (canRenew(current) && needsRefresh(current, RENEW_WITHIN_SECONDS)) {
      try {
        const renewed = await refreshSession(config, current)
        return renewed.credential
      } catch {
        onSignOut()
        return null
      }
    }
    return current.credential
  }, [config, onSignOut])

  const api = useMemo(() => new Api(credential), [credential])

  /** Report a failure to the operator. */
  const fail = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      onSignOut()
      return
    }
    setBanner(error instanceof Error ? error.message : String(error))
  }, [onSignOut])

  /** Run a request and report what went wrong. */
  const guard = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | null> => {
      try {
        return await work()
      } catch (error) {
        fail(error)
        return null
      }
    },
    [fail],
  )

  /** Reload the counts the sidebar shows. */
  const refreshSummary = useCallback(async () => {
    const result = await guard(() => api.get<Summary>('/summary'))
    if (result) setSummary(result)
  }, [api, guard])

  useEffect(() => {
    void (async () => {
      const me = await guard(() =>
        api.get<{ organization: Organization }>('/me'),
      )
      if (me) setOrganization(me.organization)
      await refreshSummary()
    })()
  }, [api, guard, refreshSummary])

  // A forge sends the browser back to the callback when an authorisation
  // comes back. The code is exchanged here, and the console moves itself to
  // the connections.
  useConnectionCallback(
    api,
    useCallback(() => {
      navigate('/connections')
    }, [navigate]),
  )

  // The sign-in callback arrives at the root, because the provider sends
  // the browser back to the redirect URI it was given. The console takes
  // the code out of the address and moves itself into its own path, so
  // that a reload does not send the browser to the callback again.
  useEffect(() => {
    if (window.location.pathname === CALLBACK_PATH) {
      window.history.replaceState({}, '', consolePath('/'))
    }
  }, [])

  // The counts are refreshed whenever a page changes, so that a triage
  // action shows up in the sidebar straight away.
  useEffect(() => {
    void refreshSummary()
  }, [path, refreshSummary])

  const findingsPath = path.startsWith('/findings/')
  const active = findingsPath ? '/findings' : PAGES.some((page) => page.path === path) ? path : '/'

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="https://prysm.sh" title="Prysm — all services">
          <span className="brand-name">
            prysm<span className="brand-dot">.</span>
          </span>
          <span className="brand-sub">Sentinel</span>
        </a>
        <nav>
          {PAGES.map((page) => {
            const Icon = page.icon
            const count =
              page.path === '/findings' && summary ? summary.open + summary.acknowledged : null
            return (
              <button
                key={page.path}
                className={active === page.path ? 'nav-item active' : 'nav-item'}
                onClick={() => navigate(page.path)}
              >
                <Icon size={16} />
                <span>{page.label}</span>
                {count !== null && count > 0 ? <em>{count}</em> : null}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-foot">
          <Settings2 size={14} />
          <span>{organization?.name ?? '—'}</span>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          {banner ? (
            <div className="banner" role="alert">
              <AlertTriangle size={15} />
              <span>{banner}</span>
              <button onClick={() => setBanner(null)}>Dismiss</button>
            </div>
          ) : null}
          <div className="spacer" />
          <span className="who">{session.name ?? session.email ?? 'Signed in'}</span>
          <button
            className="icon-button"
            title="Sign out"
            onClick={() => {
              clearSession()
              onSignOut()
            }}
          >
            <LogOut size={16} />
          </button>
        </header>

        <div className="page">
          {active === '/' ? <Dashboard api={api} summary={summary} onNavigate={navigate} /> : null}
          {active === '/findings' && !findingsPath ? (
            <Findings api={api} onNavigate={navigate} onChanged={refreshSummary} />
          ) : null}
          {findingsPath ? (
            <FindingDetail
              api={api}
              id={path.slice('/findings/'.length)}
              onNavigate={navigate}
              onChanged={refreshSummary}
            />
          ) : null}
          {active === '/repositories' ? (
            <Repositories api={api} onChanged={refreshSummary} onNavigate={navigate} />
          ) : null}
          {active === '/connections' ? (
            <Connections api={api} onNavigate={navigate} />
          ) : null}
          {active === '/insights' ? <Insights api={api} onNavigate={navigate} /> : null}
          {active === '/rules' ? <Rules api={api} /> : null}
          {active === '/honeytokens' ? <Honeytokens api={api} /> : null}
          {active === '/webhooks' ? <Webhooks api={api} /> : null}
          {active === '/members' ? <Members api={api} /> : null}
          {active === '/tokens' ? <Tokens api={api} /> : null}
          {active === '/audit' ? <AuditLog api={api} /> : null}
        </div>
      </main>
    </div>
  )
}

/**
 * A session for a console that runs without a provider.
 *
 * The fixtures mode has no identity provider behind it, so the console
 * carries a placeholder session instead: every code path that reads a
 * credential keeps working, and nothing ever tries to renew it.
 */
function fixturesSession(): Session {
  return {
    credential: 'fixtures',
    expiresAt: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    name: 'Alessio',
    email: 'alessio@example.invalid',
    roles: ['admin'],
  }
}

/**
 * The console's root.
 *
 * It holds the session and hands it to the console once there is one.
 */
export function App() {
  const [session, setSession] = useState<Session | null>(() =>
    useFixtures ? fixturesSession() : loadSession(),
  )
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (useFixtures) {
      setChecking(false)
      return
    }
    // The console asks the provider for a fresh identity once, so a change
    // made on the account since — a name corrected, a role granted — is
    // shown without signing in again.
    if (!session) {
      setChecking(false)
      return
    }
    const config = oidcConfig()
    void (async () => {
      try {
        const renewed = await refreshSession(config, session)
        setSession(renewed)
      } catch {
        // The stored session keeps working; the regular renewal handles it.
      } finally {
        setChecking(false)
      }
    })()
  }, [session])

  if (checking) {
    return <div className="loading">Loading&hellip;</div>
  }

  if (!session) {
    return (
      <SignIn
        onSession={(established) => {
          storeSession(established)
          setSession(established)
        }}
      />
    )
  }

  return (
    <Console
      session={session}
      onSignOut={() => {
        setSession(null)
      }}
    />
  )
}
