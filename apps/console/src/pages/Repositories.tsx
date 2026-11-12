/**
 * The repositories that are watched.
 *
 * The short way to watch a repository is to pick it from the list the forge
 * already returns: the operator connects a forge once, and from then on the
 * repositories are a list they can search and click. Nothing is pasted, no
 * name is typed, and the repository is watched with the grant the forge gave
 * the platform.
 *
 * The long way — a clone URL and a token — is still there, folded away, for
 * a public repository and for the forges that cannot be connected.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Play, Plus, Search, Trash2 } from 'lucide-react'

import { Empty, TimeAgo, useAsync } from '../components'
import { rememberReturnTo, repositoriesPath } from '../journey'
import type { Api } from '../api'
import type { Connection, ConnectionProvider, GitHubInstallation, Provider, Repository } from '../types'

/** A repository, as the forge's API returned it. */
interface RemoteRepository {
  fullName: string
  cloneUrl: string
  private: boolean
  defaultBranch?: string
}

/** The forges the platform knows. */
const PROVIDERS: Provider[] = ['github', 'forgejo', 'gitlab', 'generic']

export function Repositories({
  api,
  onChanged,
  onNavigate,
}: {
  api: Api
  onChanged: () => void
  onNavigate: (path: string) => void
}) {
  const [name, setName] = useState('')
  const [cloneUrl, setCloneUrl] = useState('')
  const [provider, setProvider] = useState<Provider>('forgejo')
  const [token, setToken] = useState('')
  const [username, setUsername] = useState('')
  const [interval, setInterval] = useState(360)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The connection path: the repositories the platform can already read.
  const [connectionId, setConnectionId] = useState('')
  const [search, setSearch] = useState('')
  const [watching, setWatching] = useState<string | null>(null)
  const [switching, setSwitching] = useState<number | null>(null)
  // The long way, folded away until it is asked for.
  const [manual, setManual] = useState(false)
  // The operator comes back from a forge's authorisation to the page the
  // journey started on, with the picker open.
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('pick') !== '1') return
    setPicking(true)
    const url = new URL(window.location.href)
    url.searchParams.delete('pick')
    window.history.replaceState({}, '', url.toString())
  }, [])

  const repositories = useAsync(
    () => api.get<{ repositories: Repository[] }>('/repositories'),
    [api],
  )
  const connections = useAsync(
    () => api.get<{ connections: Connection[] }>('/connections'),
    [api],
  )
  const providers = useAsync(
    () => api.get<{ providers: ConnectionProvider[] }>('/connections/providers'),
    [api],
  )

  const active = (connections.data?.connections ?? []).filter(
    (connection) => connection.status === 'active',
  )

  // One connection is the common case, and the operator is not asked to
  // choose between one thing.
  useEffect(() => {
    if (connectionId && active.some((connection) => connection.id === connectionId)) return
    setConnectionId(active.length === 1 ? active[0].id : '')
  }, [active, connectionId])

  // The installations of a GitHub connection. The app can be installed in
  // several places, and the installation is what says which repositories
  // the token can read, so it is the operator's choice.
  //
  // The dependencies are primitives: an array that is rebuilt on every render
  // would re-run the effect on every render, and the fetch would never settle.
  const selectedProvider =
    active.find((connection) => connection.id === connectionId)?.provider ?? ''
  const installations = useAsync(
    () =>
      connectionId && selectedProvider === 'github'
        ? api.listInstallations(connectionId)
        : Promise.resolve({ installations: [] as GitHubInstallation[] }),
    [api, connectionId, selectedProvider],
  )

  const remote = useAsync(
    () =>
      connectionId
        ? api.get<{ repositories: RemoteRepository[] }>(
            `/connections/${connectionId}/repositories`,
          )
        : Promise.resolve({ repositories: [] }),
    [api, connectionId],
  )

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = remote.data?.repositories ?? []
    if (!needle) return list
    return list.filter((entry) => entry.fullName.toLowerCase().includes(needle))
  }, [remote.data, search])

  /**
   * Watch a repository from the list.
   *
   * One click: the grant the connection holds is what clones it, and the
   * name is the one the forge gave it.
   */
  const watch = useCallback(
    async (entry: RemoteRepository) => {
      if (!connectionId) return
      setWatching(entry.fullName)
      setError(null)
      try {
        await api.post('/repositories', {
          connectionId,
          remoteName: entry.fullName,
          scanIntervalMinutes: 360,
        })
        repositories.reload()
        onChanged()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setWatching(null)
      }
    },
    [api, connectionId, repositories, onChanged],
  )

  /**
   * Choose the installation a GitHub connection reads.
   *
   * The repositories that follow are the installation's, so this is the
   * switch that decides what the operator watches.
   */
  const chooseInstallation = useCallback(
    async (installation: GitHubInstallation) => {
      setSwitching(installation.id)
      setError(null)
      try {
        await api.selectInstallation(connectionId, installation.id)
        installations.reload()
        remote.reload()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setSwitching(null)
      }
    },
    [api, connectionId, installations, remote],
  )

  /**
   * Start the authorisation of a forge.
   *
   * The browser leaves for the forge and comes back to the repositories,
   * where the list is waiting.
   */
  const connect = useCallback(
    async (providerId: string) => {
      setError(null)
      try {
        const result = await api.post<{ authorizeUrl: string }>('/connections', {
          provider: providerId,
        })
        if (!result?.authorizeUrl) {
          setError('The forge did not give an address to authorise at.')
          return
        }
        rememberReturnTo(repositoriesPath(true))
        window.location.assign(result.authorizeUrl)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [api],
  )

  const add = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await api.post('/repositories', {
        name: name.trim(),
        cloneUrl: cloneUrl.trim(),
        provider,
        token: token.trim() || undefined,
        username: username.trim() || undefined,
        scanIntervalMinutes: interval,
      })
      setName('')
      setCloneUrl('')
      setToken('')
      repositories.reload()
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [api, name, cloneUrl, provider, token, username, interval, repositories, onChanged])

  const scanNow = useCallback(
    async (id: string) => {
      await api.post(`/repositories/${id}/scan`)
      repositories.reload()
    },
    [api, repositories],
  )

  const toggle = useCallback(
    async (repository: Repository) => {
      await api.patch(`/repositories/${repository.id}`, { enabled: !repository.enabled })
      repositories.reload()
      onChanged()
    },
    [api, repositories, onChanged],
  )

  const remove = useCallback(
    async (repository: Repository) => {
      await api.delete(`/repositories/${repository.id}`)
      repositories.reload()
      onChanged()
    },
    [api, repositories, onChanged],
  )

  // GitHub leads: the repositories most organisations watch are on GitHub,
  // and the app is the grant that reads them.
  const byPreference = (left: ConnectionProvider, right: ConnectionProvider) =>
    left.id === 'github' ? -1 : right.id === 'github' ? 1 : 0
  const allProviders = [...(providers.data?.providers ?? [])].sort(byPreference)
  const preRegistered = allProviders.filter((entry) => entry.preRegistered)
  const needsRegistration = allProviders.filter((entry) => !entry.preRegistered)

  return (
    <>
      <header className="page-head">
        <h1>Repositories</h1>
        <p className="muted">The repositories that are scanned for secrets.</p>
      </header>

      <section className="panel">
        <h2>Watch a repository</h2>

        {active.length === 0 ? (
          <div className="callout">
            <p>
              <strong>No forge is connected yet.</strong> Connect one and the repositories it can
              read are a list you can pick from — nothing is pasted into every repository.
            </p>
            <div className="actions">
              {preRegistered.map((entry) => (
                <button
                  key={entry.id}
                  className="button primary"
                  onClick={() => void connect(entry.id)}
                >
                  <Plus size={14} />
                  Connect {entry.title}
                </button>
              ))}
              {needsRegistration.map((entry) => (
                <button
                  key={entry.id}
                  className={entry.id === 'github' ? 'button primary' : 'button'}
                  onClick={() => onNavigate('/connections')}
                >
                  <Plus size={14} />
                  Connect {entry.title}
                </button>
              ))}
            </div>
            <p className="muted small">
              {needsRegistration.length > 0
                ? `${needsRegistration.map((entry) => entry.title).join(' and ')} need an application registered with them first; the connections page says what to register.`
                : 'The platform has already registered an application with the forge, so there is nothing to copy.'}
            </p>
          </div>
        ) : (
          <div className="picker">
            {picking ? (
              <p className="muted small">
                Connected. Pick a repository to watch.
              </p>
            ) : null}
            {active.length > 1 ? (
              <label className="field">
                <span>Forge</span>
                <select
                  value={connectionId}
                  onChange={(event) => {
                    setConnectionId(event.target.value)
                    setSearch('')
                  }}
                >
                  {active.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name} — {connection.provider}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {installations.data && installations.data.installations.length > 0 ? (
              <div className="installations">
                <span className="muted small">
                  The app is installed in {installations.data.installations.length} place
                  {installations.data.installations.length === 1 ? '' : 's'}. The
                  installation says which repositories it can read.
                </span>
                <div className="filters">
                  {installations.data.installations.map((installation) => (
                    <button
                      key={installation.id}
                      className={installation.selected ? 'button primary' : 'button'}
                      disabled={switching !== null}
                      onClick={() => void chooseInstallation(installation)}
                    >
                      {installation.account || `installation ${installation.id}`}
                      {installation.target ? ` · ${installation.target}` : ''}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {remote.loading ? (
              <p className="empty">Reading the repositories…</p>
            ) : filtered.length === 0 ? (
              <p className="empty">
                {search.trim()
                  ? 'No repository matches that search.'
                  : 'The forge has no repository this connection can read.'}
              </p>
            ) : (
              <>
                <label className="field search">
                  <Search size={14} />
                  <input
                    placeholder="Search repositories"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <ul className="repo-list">
                  {filtered.map((entry) => (
                    <li key={entry.fullName}>
                      <button
                        className="repo-row"
                        disabled={watching !== null}
                        onClick={() => void watch(entry)}
                      >
                        <span className="repo-name">{entry.fullName}</span>
                        <span className="muted small">
                          {entry.private ? 'private' : 'public'}
                          {entry.defaultBranch ? ` · ${entry.defaultBranch}` : ''}
                        </span>
                        <span className="repo-action">
                          {watching === entry.fullName ? 'watching…' : 'watch'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {error ? <p className="empty error">{error}</p> : null}

        <div className="actions">
          {active.length > 0 ? (
            <>
              {preRegistered.map((entry) => (
                <button
                  key={entry.id}
                  className="button"
                  onClick={() => void connect(entry.id)}
                >
                  <Plus size={14} />
                  Connect another {entry.title}
                </button>
              ))}
              <button className="button" onClick={() => setManual((value) => !value)}>
                {manual ? 'Keep it simple' : 'Watch a repository without a connection'}
              </button>
            </>
          ) : null}
        </div>

        {manual ? (
          <div className="form-grid">
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="zt" />
            </label>
            <label className="field">
              <span>Clone URL</span>
              <input
                value={cloneUrl}
                onChange={(event) => setCloneUrl(event.target.value)}
                placeholder="https://git.prysm.sh/prysmsh/zt.git"
              />
            </label>
            <label className="field">
              <span>Forge</span>
              <select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>
                {PROVIDERS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Token</span>
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="a read-only token"
                type="password"
              />
            </label>
            <label className="field">
              <span>User name</span>
              <input value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label className="field">
              <span>Scan every (minutes)</span>
              <input
                type="number"
                value={interval}
                onChange={(event) => setInterval(Number(event.target.value))}
              />
            </label>
            <div className="actions">
              <button
                className="button primary"
                disabled={busy || !name.trim() || !cloneUrl.trim()}
                onClick={() => void add()}
              >
                <Plus size={14} />
                Watch it
              </button>
            </div>
            <p className="muted small">
              The token is encrypted before it is stored. A repository that is public needs no token.
            </p>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2>Watched</h2>
        {repositories.loading ? (
          <p className="empty">Loading&hellip;</p>
        ) : repositories.data && repositories.data.repositories.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Forge</th>
                <th>Open findings</th>
                <th>Last scan</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {repositories.data.repositories.map((repository) => (
                <tr key={repository.id}>
                  <td>
                    <strong>{repository.name}</strong>
                    <div className="mono small muted">{repository.cloneUrl}</div>
                  </td>
                  <td>{repository.provider}</td>
                  <td>{repository.openFindings}</td>
                  <td>
                    <TimeAgo at={repository.lastScanAt} />
                    {repository.lastScanStatus ? (
                      <span className={`badge scan-${repository.lastScanStatus}`}>
                        {repository.lastScanStatus}
                      </span>
                    ) : null}
                  </td>
                  <td>{repository.enabled ? 'watching' : 'paused'}</td>
                  <td className="row-actions">
                    <button className="icon-button" title="Scan now" onClick={() => void scanNow(repository.id)}>
                      <Play size={15} />
                    </button>
                    <button className="icon-button" title={repository.enabled ? 'Pause' : 'Watch'} onClick={() => void toggle(repository)}>
                      {repository.enabled ? 'Pause' : 'Watch'}
                    </button>
                    <button className="icon-button" title="Stop watching" onClick={() => void remove(repository)}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No repository is watched yet.</Empty>
        )}
      </section>
    </>
  )
}
