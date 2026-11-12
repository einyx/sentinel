/**
 * One finding.
 *
 * The page shows what was found, where it came from, and what has been
 * done about it. The secret itself is never shown: the platform keeps it
 * so it can ask the provider whether it still works, and shows the masked
 * text instead.
 */

import { useCallback, useState } from 'react'
import { ArrowLeft, Check, CircleSlash, Loader, ShieldQuestion } from 'lucide-react'

import { Empty, StatusBadge, TimeAgo, ValidityBadge, useAsync } from '../components'
import type { Api } from '../api'
import type { Finding, FindingNote, FindingStatus } from '../types'

export function FindingDetail({
  api,
  id,
  onNavigate,
  onChanged,
}: {
  api: Api
  id: string
  onNavigate: (path: string) => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [assignee, setAssignee] = useState('')

  const detail = useAsync(
    () => api.get<{ finding: Finding; notes: FindingNote[] }>(`/findings/${id}`),
    [api, id],
  )

  /** Move the finding to another status. */
  const setStatus = useCallback(
    async (status: FindingStatus) => {
      setBusy(true)
      try {
        await api.patch(`/findings/${id}`, { status })
        detail.reload()
        onChanged()
      } finally {
        setBusy(false)
      }
    },
    [api, id, detail, onChanged],
  )

  /** Ask the provider whether the secret still works. */
  const verify = useCallback(async () => {
    setBusy(true)
    try {
      await api.post(`/findings/${id}/verify`)
      detail.reload()
    } finally {
      setBusy(false)
    }
  }, [api, id, detail])

  /** Give the finding to somebody. */
  const assign = useCallback(async () => {
    setBusy(true)
    try {
      await api.patch(`/findings/${id}`, { assignee: assignee.trim() || null })
      detail.reload()
    } finally {
      setBusy(false)
    }
  }, [api, id, assignee, detail])

  /** Leave a note. */
  const addNote = useCallback(async () => {
    if (!note.trim()) return
    setBusy(true)
    try {
      await api.post(`/findings/${id}/notes`, { body: note.trim() })
      setNote('')
      detail.reload()
    } finally {
      setBusy(false)
    }
  }, [api, id, note, detail])

  if (detail.loading) return <p className="empty">Loading&hellip;</p>
  if (detail.error) return <p className="empty error">{detail.error}</p>
  if (!detail.data) return <Empty>No such finding.</Empty>

  const { finding, notes } = detail.data

  return (
    <>
      <header className="page-head">
        <button className="icon-button" onClick={() => onNavigate('/findings')} title="Back to the findings">
          <ArrowLeft size={16} />
        </button>
        <div>
          <h1>{finding.ruleId}</h1>
          <p className="muted">{finding.description ?? 'A secret was found in this repository.'}</p>
        </div>
        <div className="badges">
          <StatusBadge status={finding.status} />
          <ValidityBadge validity={finding.validity} />
        </div>
      </header>

      <div className="grid two">
        <section className="panel">
          <h2>The secret</h2>
          <pre className="secret">{finding.secretRedacted ?? '—'}</pre>
          {finding.matchRedacted ? (
            <>
              <h3>Where it was found</h3>
              <pre className="match">{finding.matchRedacted}</pre>
            </>
          ) : null}
          <button className="button" onClick={() => void verify()} disabled={busy}>
            {busy ? <Loader size={14} /> : <ShieldQuestion size={14} />}
            Check whether it still works
          </button>
          <p className="muted small">
            The check asks the provider. The secret is kept encrypted and is never shown.
          </p>
        </section>

        <section className="panel">
          <h2>The finding</h2>
          <dl className="details">
            <dt>Repository</dt>
            <dd>{finding.repositoryName}</dd>
            <dt>File</dt>
            <dd className="mono">{finding.file ?? '—'}</dd>
            <dt>Line</dt>
            <dd>{finding.startLine ?? '—'}</dd>
            <dt>Commit</dt>
            <dd className="mono">{finding.commitSha ? finding.commitSha.slice(0, 12) : '—'}</dd>
            <dt>Author</dt>
            <dd>{finding.author ?? '—'}</dd>
            <dt>First seen</dt>
            <dd>
              <TimeAgo at={finding.firstSeenAt} />
            </dd>
            <dt>Last seen</dt>
            <dd>
              <TimeAgo at={finding.lastSeenAt} />
            </dd>
            {finding.resolvedBy ? (
              <>
                <dt>Resolved by</dt>
                <dd>{finding.resolvedBy}</dd>
              </>
            ) : null}
          </dl>
        </section>
      </div>

      <section className="panel">
        <h2>What to do</h2>
        <div className="actions">
          <button className="button" disabled={busy} onClick={() => void setStatus('acknowledged')}>
            I am dealing with it
          </button>
          <button className="button good" disabled={busy} onClick={() => void setStatus('resolved')}>
            <Check size={14} />
            The secret is revoked
          </button>
          <button className="button" disabled={busy} onClick={() => void setStatus('ignored')}>
            <CircleSlash size={14} />
            Not a secret
          </button>
          <button className="button" disabled={busy} onClick={() => void setStatus('open')}>
            Put it back
          </button>
        </div>

        <div className="actions">
          <label className="field">
            <span>Assigned to</span>
            <input
              placeholder="a name or an address"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            />
          </label>
          <button className="button" disabled={busy} onClick={() => void assign()}>
            Assign
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Notes</h2>
        {notes.length ? (
          <ul className="notes">
            {notes.map((entry) => (
              <li key={entry.id}>
                <div className="note-head">
                  <strong>{entry.author}</strong>
                  <span className="muted">
                    <TimeAgo at={entry.createdAt} />
                  </span>
                </div>
                <p>{entry.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No notes yet.</Empty>
        )}
        <div className="actions">
          <label className="field grow">
            <textarea
              rows={2}
              placeholder="What was done about it?"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button className="button" disabled={busy || !note.trim()} onClick={() => void addNote()}>
            Add
          </button>
        </div>
      </section>
    </>
  )
}
