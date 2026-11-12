/**
 * The dashboard.
 *
 * The page an operator looks at first: how many secrets are out there, how
 * many of them still work, and which repositories are the worst.
 */

import { useAsync, Bars, Stat, TimeAgo } from '../components'
import type { Api } from '../api'
import type { Summary } from '../types'

export function Dashboard({
  api,
  summary,
  onNavigate,
}: {
  api: Api
  summary: Summary | null
  onNavigate: (path: string) => void
}) {
  const scans = useAsync(() => api.get<{ scans: Summary['recentScans'] }>('/scans?limit=8'), [api])

  const data = summary

  return (
    <>
      <header className="page-head">
        <h1>Dashboard</h1>
        <p className="muted">The secrets found across the organisation&rsquo;s repositories.</p>
      </header>

      {!data ? (
        <p className="empty">Loading&hellip;</p>
      ) : (
        <>
          <div className="stats">
            <Stat label="open findings" value={data.open} tone={data.open ? 'danger' : 'good'} />
            <Stat label="being dealt with" value={data.acknowledged} tone={data.acknowledged ? 'warn' : 'plain'} />
            <Stat label="still valid" value={data.valid} tone={data.valid ? 'danger' : 'plain'} />
            <Stat label="new this week" value={data.findingsLastWeek} />
            <Stat
              label="repositories watched"
              value={`${data.enabledRepositories}/${data.repositories}`}
              hint="enabled"
            />
          </div>

          <div className="grid">
            <section className="panel">
              <h2>By rule</h2>
              <Bars
                items={data.byRule.map((rule) => ({ label: rule.ruleId, value: rule.count }))}
                onSelect={(rule) => onNavigate(`/findings?rule=${encodeURIComponent(rule)}`)}
                empty="No findings are open."
              />
            </section>

            <section className="panel">
              <h2>By repository</h2>
              <Bars
                items={data.byRepository.map((repository) => ({
                  label: repository.name,
                  value: repository.open,
                }))}
                empty="No repository has an open finding."
              />
            </section>

            <section className="panel">
              <h2>By author</h2>
              <Bars
                items={data.byAuthor.map((author) => ({ label: author.author, value: author.count }))}
                empty="No finding names an author."
              />
            </section>

            <section className="panel">
              <h2>New findings</h2>
              <Bars
                items={data.byDay.map((day) => ({ label: day.day, value: day.count }))}
                empty="Nothing new in the last thirty days."
              />
            </section>
          </div>

          <section className="panel">
            <h2>Recent scans</h2>
            {scans.loading ? (
              <p className="empty">Loading&hellip;</p>
            ) : scans.data && scans.data.scans.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Status</th>
                    <th>Findings</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.data.scans.map((scan) => (
                    <tr key={scan.id}>
                      <td>{scan.repositoryName ?? scan.repositoryId.slice(0, 8)}</td>
                      <td>
                        <span className={`badge scan-${scan.status}`}>{scan.status}</span>
                      </td>
                      <td>{scan.findingsCount}</td>
                      <td>
                        <TimeAgo at={scan.startedAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty">No scan has run yet.</p>
            )}
          </section>
        </>
      )}
    </>
  )
}
