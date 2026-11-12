/**
 * The rules the scanner runs.
 *
 * They are read out of the gitleaks configuration the worker uses, so the
 * page shows the rules that are really in force.
 */

import { Empty, useAsync } from '../components'
import type { Api } from '../api'

export function Rules({ api }: { api: Api }) {
  const rules = useAsync(
    () => api.get<{ rules: string[]; source: string }>('/rules'),
    [api],
  )

  if (rules.loading) return <p className="empty">Loading&hellip;</p>
  if (rules.error) return <p className="empty error">{rules.error}</p>
  if (!rules.data) return <Empty>No rules.</Empty>

  return (
    <>
      <header className="page-head">
        <h1>Rules</h1>
        <p className="muted">
          The rules the scanner runs, from <span className="mono">{rules.data.source}</span>.
        </p>
      </header>

      <section className="panel">
        <div className="rule-grid">
          {rules.data.rules.map((rule) => (
            <span key={rule} className="rule mono">
              {rule}
            </span>
          ))}
        </div>
      </section>
    </>
  )
}
