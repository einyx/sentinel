/**
 * The API tokens.
 *
 * A token is for a machine: a pipeline that posts findings, or a script
 * that asks for the state of the organisation. The value is shown once.
 */

import { useCallback, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { Empty, TimeAgo, useAsync } from '../components'
import type { Api } from '../api'
import type { ApiToken, MemberRole } from '../types'

/** The roles a token may carry. */
const ROLES: MemberRole[] = ['owner', 'member', 'viewer']

export function Tokens({ api }: { api: Api }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<MemberRole>('member')
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tokens = useAsync(() => api.get<{ tokens: ApiToken[] }>('/tokens'), [api])

  const create = useCallback(async () => {
    setBusy(true)
    try {
      const result = await api.post<{ token: ApiToken; secret: string }>('/tokens', {
        name: name.trim() || 'API token',
        role,
      })
      setCreated(result.secret)
      setName('')
      tokens.reload()
    } finally {
      setBusy(false)
    }
  }, [api, name, role, tokens])

  const revoke = useCallback(
    async (token: ApiToken) => {
      await api.delete(`/tokens/${token.id}`)
      tokens.reload()
    },
    [api, tokens],
  )

  return (
    <>
      <header className="page-head">
        <h1>API tokens</h1>
        <p className="muted">For the machines that read the findings.</p>
      </header>

      <section className="panel">
        <h2>Make one</h2>
        <div className="actions">
          <label className="field grow">
            <span>What is it for</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="the pipeline" />
          </label>
          <label className="field">
            <span>What it may do</span>
            <select value={role} onChange={(event) => setRole(event.target.value as MemberRole)}>
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button className="button primary" disabled={busy} onClick={() => void create()}>
            <Plus size={14} />
            Make a token
          </button>
        </div>

        {created ? (
          <div className="callout">
            <p>This value is shown once. Only its hash is stored.</p>
            <pre className="secret">{created}</pre>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2>Made</h2>
        {tokens.loading ? (
          <p className="empty">Loading&hellip;</p>
        ) : tokens.data && tokens.data.tokens.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Made</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.data.tokens.map((token) => (
                <tr key={token.id} className={token.revokedAt ? 'muted' : undefined}>
                  <td>{token.name}</td>
                  <td>{token.role}</td>
                  <td>
                    <TimeAgo at={token.createdAt} />
                  </td>
                  <td>
                    <TimeAgo at={token.lastUsedAt} />
                  </td>
                  <td className="row-actions">
                    {token.revokedAt ? (
                      <span className="badge status-ignored">revoked</span>
                    ) : (
                      <button className="icon-button" title="Revoke" onClick={() => void revoke(token)}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No token has been made.</Empty>
        )}
      </section>
    </>
  )
}
