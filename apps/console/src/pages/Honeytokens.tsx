/**
 * The honeytokens.
 *
 * A honeytoken is a value that looks like a credential and belongs to
 * nobody. It is planted somewhere it should not be, and the platform
 * notices when somebody picks it up.
 */

import { useCallback, useState } from 'react'
import { Plus } from 'lucide-react'

import { Empty, TimeAgo, useAsync } from '../components'
import type { Api } from '../api'
import type { Honeytoken } from '../types'

export function Honeytokens({ api }: { api: Api }) {
  const [label, setLabel] = useState('')
  const [created, setCreated] = useState<{ secret: string; label: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const honeytokens = useAsync(
    () => api.get<{ honeytokens: Honeytoken[] }>('/honeytokens'),
    [api],
  )

  const create = useCallback(async () => {
    setBusy(true)
    try {
      const result = await api.post<{ honeytoken: Honeytoken; secret: string }>('/honeytokens', {
        label: label.trim() || 'Honeytoken',
      })
      setCreated({ secret: result.secret, label: result.honeytoken.label })
      setLabel('')
      honeytokens.reload()
    } finally {
      setBusy(false)
    }
  }, [api, label, honeytokens])

  return (
    <>
      <header className="page-head">
        <h1>Honeytokens</h1>
        <p className="muted">
          Decoy credentials. Plant one somewhere it should not be, and the platform notices when
          somebody picks it up.
        </p>
      </header>

      <section className="panel">
        <h2>Make one</h2>
        <div className="actions">
          <label className="field grow">
            <span>What is it for</span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="the staging database"
            />
          </label>
          <button className="button primary" disabled={busy} onClick={() => void create()}>
            <Plus size={14} />
            Make a honeytoken
          </button>
        </div>

        {created ? (
          <div className="callout">
            <p>
              Plant this value where it should not be. It is shown once and only its hash is kept.
            </p>
            <pre className="secret">{created.secret}</pre>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2>Made</h2>
        {honeytokens.loading ? (
          <p className="empty">Loading&hellip;</p>
        ) : honeytokens.data && honeytokens.data.honeytokens.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Made</th>
                <th>Triggered</th>
              </tr>
            </thead>
            <tbody>
              {honeytokens.data.honeytokens.map((honeytoken) => (
                <tr key={honeytoken.id}>
                  <td>{honeytoken.label}</td>
                  <td>
                    <TimeAgo at={honeytoken.createdAt} />
                  </td>
                  <td>
                    {honeytoken.triggeredAt ? (
                      <span className="badge status-open">yes</span>
                    ) : (
                      <span className="muted">not yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No honeytoken has been made.</Empty>
        )}
      </section>
    </>
  )
}
