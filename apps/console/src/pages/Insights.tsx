/**
 * The insights.
 *
 * The questions the dashboard cannot answer on its own: who keeps
 * committing secrets, which repository is the worst, and what has been
 * sitting unaddressed the longest.
 */

import { Bars, Empty, Stat, TimeAgo, useAsync } from '../components'
import type { Api } from '../api'
import type { Insights } from '../types'

export function Insights({ api, onNavigate }: { api: Api; onNavigate: (path: string) => void }) {
  const insights = useAsync(() => api.get<Insights>('/insights'), [api])

  if (insights.loading) return <p className="empty">Loading&hellip;</p>
  if (insights.error) return <p className="empty error">{insights.error}</p>
  if (!insights.data) return <Empty>Nothing to show.</Empty>

  const data = insights.data

  return (
    <>
      <header className="page-head">
        <h1>Insights</h1>
        <p className="muted">Where the risk is.</p>
      </header>

      <div className="stats">
        <Stat label="secrets that still work" value={data.liveSecrets} tone={data.liveSecrets ? 'danger' : 'good'} />
        <Stat label="open for more than a week" value={data.stale} tone={data.stale ? 'warn' : 'plain'} />
      </div>

      <div className="grid">
        <section className="panel">
          <h2>By author</h2>
          <Bars
            items={data.topAuthors.map((author) => ({ label: author.author, value: author.count }))}
            onSelect={(author) => onNavigate(`/findings?author=${encodeURIComponent(author)}`)}
            empty="No finding names an author."
          />
        </section>

        <section className="panel">
          <h2>By repository</h2>
          <Bars
            items={data.topRepositories.map((repository) => ({
              label: repository.name,
              value: repository.count,
            }))}
            empty="No repository has an open finding."
          />
        </section>

        <section className="panel">
          <h2>By rule</h2>
          <Bars
            items={data.topRules.map((rule) => ({ label: rule.ruleId, value: rule.count }))}
            empty="No rule has fired."
          />
        </section>
      </div>

      <section className="panel">
        <h2>The oldest open findings</h2>
        {data.oldest.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Repository</th>
                <th>Where</th>
                <th>First seen</th>
              </tr>
            </thead>
            <tbody>
              {data.oldest.map((finding) => (
                <tr
                  key={finding.id}
                  className="clickable"
                  onClick={() => onNavigate(`/findings/${finding.id}`)}
                >
                  <td className="mono">{finding.ruleId}</td>
                  <td>{finding.repositoryName}</td>
                  <td className="mono truncate">
                    {finding.file}
                    {finding.startLine ? `:${finding.startLine}` : ''}
                  </td>
                  <td>
                    <TimeAgo at={finding.firstSeenAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>Nothing has been open for long.</Empty>
        )}
      </section>
    </>
  )
}
