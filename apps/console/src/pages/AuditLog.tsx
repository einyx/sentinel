/**
 * The audit log.
 *
 * What somebody did, and when. It is the record of every change the
 * platform was told to make.
 */

import { Empty, TimeAgo, useAsync } from '../components'
import type { Api } from '../api'
import type { AuditEntry } from '../types'

export function AuditLog({ api }: { api: Api }) {
  const audit = useAsync(() => api.get<{ entries: AuditEntry[] }>('/audit?limit=200'), [api])

  return (
    <>
      <header className="page-head">
        <h1>Audit log</h1>
        <p className="muted">What was done, and by whom.</p>
      </header>

      <section className="panel">
        {audit.loading ? (
          <p className="empty">Loading&hellip;</p>
        ) : audit.data && audit.data.entries.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <TimeAgo at={entry.createdAt} />
                  </td>
                  <td>{entry.actor}</td>
                  <td className="mono">{entry.action}</td>
                  <td className="mono truncate">{entry.target ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>Nothing has happened yet.</Empty>
        )}
      </section>
    </>
  )
}
