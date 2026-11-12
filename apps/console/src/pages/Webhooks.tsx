/**
 * The integrations.
 *
 * A webhook is a URL the organisation owns. It is called when a new
 * finding shows up, so that the channel the team already watches is the
 * place the finding lands in.
 */

import { useCallback, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { Empty, useAsync } from '../components'
import type { Api } from '../api'
import type { Webhook } from '../types'

export function Webhooks({ api }: { api: Api }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<'generic' | 'slack'>('slack')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const webhooks = useAsync(() => api.get<{ webhooks: Webhook[] }>('/webhooks'), [api])

  const create = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await api.post('/webhooks', { name: name.trim() || 'Webhook', url: url.trim(), kind })
      setName('')
      setUrl('')
      webhooks.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [api, name, url, kind, webhooks])

  const remove = useCallback(
    async (webhook: Webhook) => {
      await api.delete(`/webhooks/${webhook.id}`)
      webhooks.reload()
    },
    [api, webhooks],
  )

  return (
    <>
      <header className="page-head">
        <h1>Integrations</h1>
        <p className="muted">Where a new finding is announced.</p>
      </header>

      <section className="panel">
        <h2>Add one</h2>
        <div className="form-grid">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="the team channel" />
          </label>
          <label className="field">
            <span>Kind</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as 'generic' | 'slack')}>
              <option value="slack">Slack</option>
              <option value="generic">A JSON webhook</option>
            </select>
          </label>
          <label className="field wide">
            <span>URL</span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://hooks.example.invalid/sentinel"
            />
          </label>
        </div>
        {error ? <p className="empty error">{error}</p> : null}
        <div className="actions">
          <button className="button primary" disabled={busy || !url.trim()} onClick={() => void create()}>
            <Plus size={14} />
            Add
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Added</h2>
        {webhooks.loading ? (
          <p className="empty">Loading&hellip;</p>
        ) : webhooks.data && webhooks.data.webhooks.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>URL</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {webhooks.data.webhooks.map((webhook) => (
                <tr key={webhook.id}>
                  <td>{webhook.name}</td>
                  <td>{webhook.kind}</td>
                  <td className="mono truncate">{webhook.url}</td>
                  <td className="row-actions">
                    <button className="icon-button" title="Remove" onClick={() => void remove(webhook)}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No webhook has been added.</Empty>
        )}
      </section>
    </>
  )
}
