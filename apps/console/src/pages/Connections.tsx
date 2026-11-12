/**
 * The connections.
 *
 * A connection is a grant that lets the platform read a forge. The operator
 * registers an application with the forge once, authorises it here, and the
 * repositories are picked from the list the forge returns — no token pasted
 * into every repository.
 */

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Plus, Trash2 } from 'lucide-react'

import { Empty, TimeAgo, useAsync } from '../components'
import { takeReturnTo } from '../journey'
import type { Api } from '../api'
import type { Connection, ConnectionProvider as Provider } from '../types'

/** One field of the form. */
interface Field {
  label: string
  placeholder: string
  secret?: boolean
  multiline?: boolean
}

/** The fields the form collects, per provider. */
const FIELDS: Record<string, Field[]> = {
  forgejo: [
    { label: 'The forge', placeholder: 'https://git.prysm.sh' },
    { label: 'Client id', placeholder: 'the id the forge gave the application' },
    { label: 'Client secret', placeholder: 'the secret the forge gave the application', secret: true },
  ],
  github: [
    { label: 'GitHub', placeholder: 'https://github.com' },
    { label: 'App id', placeholder: 'the client id of the GitHub App' },
    { label: 'Private key', placeholder: '-----BEGIN RSA PRIVATE KEY-----', secret: true, multiline: true },
  ],
}

export function Connections({ api, onNavigate }: { api: Api; onNavigate: (path: string) => void }) {
  const [provider, setProvider] = useState('forgejo')
  const [name, setName] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const providers = useAsync(() => api.get<{ providers: Provider[] }>('/connections/providers'), [api])
  const connections = useAsync(() => api.get<{ connections: Connection[] }>('/connections'), [api])

  const chosen = providers.data?.providers?.find((entry) => entry.id === provider)
  const fields: Field[] = FIELDS[provider] ?? []

  const set = (index: number, value: string) => {
    setValues((current) => {
      const next = { ...current }
      next[`field${index}`] = value
      return next
    })
  }

  /**
   * Start the authorisation.
   *
   * The API answers with the URL the browser goes to, and the forge sends
   * the browser back to the callback with a code.
   */
  const connect = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { provider, name: name.trim() || undefined }
      // A forge the deployment has registered with needs nothing: the
      // application is already there.
      if (!chosen?.preRegistered) {
        fields.forEach((_field, index) => {
          body[['baseUrl', 'clientId', 'clientSecret'][index]] = values[`field${index}`]?.trim() ?? ''
        })
      }
      const result = await api.post<{ authorizeUrl: string }>('/connections', body)
      window.location.assign(result.authorizeUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }, [api, provider, name, fields, values])

  const revoke = useCallback(
    async (connection: Connection) => {
      await api.delete(`/connections/${connection.id}`)
      connections.reload()
    },
    [api, connections],
  )

  const ready =
    (chosen?.preRegistered ?? false) ||
    fields.every((_field, index) => (values[`field${index}`] ?? '').trim() !== '')

  return (
    <>
      <header className="page-head">
        <h1>Connections</h1>
        <p className="muted">
          Authorise a forge once, and the repositories it can read are picked from a list. No token
          pasted into every repository.
        </p>
      </header>

      <section className="panel">
        <h2>Add a connection</h2>

        <div className="filters">
          {(providers.data?.providers ?? []).map((entry: Provider) => (
            <button
              key={entry.id}
              className={provider === entry.id ? 'button primary' : 'button'}
              onClick={() => {
                setProvider(entry.id)
                setValues({})
              }}
            >
              {entry.title}
            </button>
          ))}
        </div>

        {chosen?.preRegistered ? (
          <div className="callout">
            <p>
              <strong>Already registered.</strong> The platform has an application with{' '}
              {chosen.title}. Authorising it is the only thing left to do — there is no id to
              copy and no secret to paste.
            </p>
            <p className="muted">
              It asks for <span className="mono">{chosen.registration.scopes.join(' ')}</span>, and
              comes back to{' '}
              <span className="mono break">{chosen.registration.redirectUri}</span>.
            </p>
          </div>
        ) : chosen ? (
          <div className="callout">
            <p>
              <strong>What to register.</strong> {chosen.registration.where}
            </p>
            <p>
              <strong>Scopes.</strong> <span className="mono">{chosen.registration.scopes.join(' ')}</span>
            </p>
            <p>
              <strong>Redirect URI.</strong>{' '}
              <span className="mono break">{chosen.registration.redirectUri}</span>
            </p>
            {chosen.registration.notes?.map((note) => (
              <p key={note} className="muted">
                {note}
              </p>
            ))}
          </div>
        ) : null}

        <div className="form-grid">
          <label className="field">
            <span>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="the forge"
            />
          </label>
          {chosen?.preRegistered
            ? null
            : fields.map((field, index) => (
            <label className="field wide" key={field.label}>
              <span>{field.label}</span>
                {field.multiline ? (
                  <textarea
                    rows={4}
                    value={values[`field${index}`] ?? ''}
                    onChange={(event) => set(index, event.target.value)}
                    placeholder={field.placeholder}
                  />
                ) : (
                  <input
                    type={field.secret ? 'password' : 'text'}
                    value={values[`field${index}`] ?? ''}
                    onChange={(event) => set(index, event.target.value)}
                    placeholder={field.placeholder}
                  />
                )}
              </label>
            ))}
        </div>

        {error ? <p className="empty error">{error}</p> : null}

        <div className="actions">
          <button className="button primary" disabled={busy || !ready} onClick={() => void connect()}>
            <Plus size={14} />
            {chosen?.preRegistered ? 'Connect' : 'Authorise'}
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Connected</h2>
        {connections.loading ? (
          <p className="empty">Loading&hellip;</p>
        ) : connections.data && connections.data.connections.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Provider</th>
                <th>Account</th>
                <th>Status</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {connections.data.connections.map((connection) => (
                <tr key={connection.id}>
                  <td>
                    <strong>{connection.name}</strong>
                    <div className="mono small muted">{connection.baseUrl}</div>
                  </td>
                  <td>{connection.provider}</td>
                  <td>{connection.account ?? '—'}</td>
                  <td>
                    <span className={`badge connection-${connection.status}`}>{connection.status}</span>
                  </td>
                  <td>
                    <TimeAgo at={connection.lastUsedAt} />
                  </td>
                  <td className="row-actions">
                    <button className="icon-button" title="Withdraw" onClick={() => void revoke(connection)}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No forge is connected yet.</Empty>
        )}
      </section>
    </>
  )
}

/**
 * Finish a connection.
 *
 * The forge sends the browser back to the callback with a code. The console
 * exchanges it and the connection becomes usable.
 */
export function useConnectionCallback(api: Api, onDone: () => void): { error: string | null } {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const match = window.location.pathname.match(/^\/auth\/connect\/([^/]+)\/callback\/?$/)
    if (!match) return

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')

    // The state carries the connection it belongs to.
    const id = state?.split('.')[0] ?? ''

    const finish = async () => {
      if (!code || !state || !id) {
        setError('the forge sent no authorisation code')
        return
      }
      try {
        await api.post(`/connections/${id}/complete`, { code, state })
        // The operator goes back to where the journey was: the repositories
        // they were picking from, if that is where it started.
        window.history.replaceState({}, '', takeReturnTo('/console/connections'))
        onDone()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void finish()
  }, [api, onDone])

  return { error }
}

/** The icon the nav uses. */
export const ConnectionsIcon = KeyRound
