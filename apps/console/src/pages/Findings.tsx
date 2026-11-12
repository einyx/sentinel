/**
 * The findings.
 *
 * This is the list an operator works through: what was found, where it is,
 * and what has been done about it.
 */

import { useState } from 'react'
import { Filter, Search } from 'lucide-react'

import { Empty, StatusBadge, TimeAgo, ValidityBadge, useAsync } from '../components'
import type { Api, FindingsPage, FindingsQuery } from '../api'
import type { FindingStatus, Repository, Validity } from '../types'

/** The statuses a finding may be filtered by. */
const STATUSES: FindingStatus[] = ['open', 'acknowledged', 'resolved', 'ignored']

/** The validities a finding may be filtered by. */
const VALIDITIES: Validity[] = ['unknown', 'valid', 'revoked', 'invalid']

export function Findings({
  api,
  onNavigate,
  onChanged,
}: {
  api: Api
  onNavigate: (path: string) => void
  onChanged: () => void
}) {
  const [status, setStatus] = useState<FindingStatus | ''>('')
  const [validity, setValidity] = useState<Validity | ''>('')
  const [repositoryId, setRepositoryId] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const limit = 50

  const repositories = useAsync(
    () => api.get<{ repositories: Repository[] }>('/repositories'),
    [api],
  )

  const query: FindingsQuery = {
    ...(status ? { status } : {}),
    ...(validity ? { validity } : {}),
    ...(repositoryId ? { repositoryId } : {}),
    ...(search ? { search } : {}),
    limit,
    offset,
  }

  const findings = useAsync(
    () =>
      api.get<FindingsPage>(
        `/findings?${new URLSearchParams(
          Object.entries(query).filter(([, value]) => value !== undefined) as [string, string][],
        ).toString()}`,
      ),
    [api, status, validity, repositoryId, search, offset],
  )

  const change = <T extends string>(setter: React.Dispatch<React.SetStateAction<T>>) => (value: T) => {
    setter(value)
    setOffset(0)
  }

  return (
    <>
      <header className="page-head">
        <h1>Findings</h1>
        <p className="muted">
          {findings.data ? `${findings.data.total} finding(s)` : 'Loading…'}
        </p>
      </header>

      <div className="filters">
        <label className="field search">
          <Search size={14} />
          <input
            placeholder="Search a file, a rule or an author"
            value={search}
            onChange={(event) => change(setSearch)(event.target.value)}
          />
        </label>

        <label className="field inline">
          <Filter size={14} />
          <select value={status} onChange={(event) => change(setStatus)(event.target.value as FindingStatus | '')}>
            <option value="">every status</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="field inline">
          <select value={validity} onChange={(event) => change(setValidity)(event.target.value as Validity | '')}>
            <option value="">every validity</option>
            {VALIDITIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="field inline">
          <select
            value={repositoryId}
            onChange={(event) => change(setRepositoryId)(event.target.value)}
          >
            <option value="">every repository</option>
            {(repositories.data?.repositories ?? []).map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {findings.loading ? (
        <p className="empty">Loading&hellip;</p>
      ) : findings.error ? (
        <p className="empty error">{findings.error}</p>
      ) : findings.data && findings.data.findings.length ? (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Validity</th>
                <th>Rule</th>
                <th>Repository</th>
                <th>Where</th>
                <th>Author</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {findings.data.findings.map((finding) => (
                <tr
                  key={finding.id}
                  className="clickable"
                  onClick={() => onNavigate(`/findings/${finding.id}`)}
                >
                  <td>
                    <StatusBadge status={finding.status} />
                  </td>
                  <td>
                    <ValidityBadge validity={finding.validity} />
                  </td>
                  <td className="mono">{finding.ruleId}</td>
                  <td>{finding.repositoryName}</td>
                  <td className="mono truncate">
                    {finding.file}
                    {finding.startLine ? `:${finding.startLine}` : ''}
                  </td>
                  <td>{finding.author ?? '—'}</td>
                  <td>
                    <TimeAgo at={finding.lastSeenAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pager">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
              Previous
            </button>
            <span className="muted">
              {offset + 1}–{Math.min(offset + limit, findings.data.total)} of {findings.data.total}
            </span>
            <button
              disabled={offset + limit >= findings.data.total}
              onClick={() => setOffset(offset + limit)}
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <Empty>No finding matches these filters.</Empty>
      )}
    </>
  )
}
