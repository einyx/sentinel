/**
 * The small pieces the pages are built from.
 */

import { useCallback, useEffect, useState } from 'react'

import type { FindingStatus, Validity } from './types'

/**
 * Run a request and hold what it returned.
 *
 * The request is run again when `deps` change, and a request that is still
 * running when the page goes away is left to finish.
 */
export function useAsync<T>(work: () => Promise<T>, deps: unknown[]): {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void work()
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setError(null)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])
  return { data, error, loading, reload }
}

/** A card with a number and a label. */
export function Stat({
  label,
  value,
  tone = 'plain',
  hint,
}: {
  label: string
  value: number | string
  tone?: 'plain' | 'danger' | 'warn' | 'good'
  hint?: string
}) {
  return (
    <div className={`stat ${tone}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  )
}

/** A horizontal bar chart, drawn with plain elements. */
export function Bars({
  items,
  onSelect,
  empty = 'Nothing to show.',
}: {
  items: Array<{ label: string; value: number }>
  onSelect?: (label: string) => void
  empty?: string
}) {
  if (!items.length) return <p className="empty">{empty}</p>
  const largest = Math.max(...items.map((item) => item.value), 1)
  return (
    <div className="bars">
      {items.map((item) => (
        <button
          key={item.label}
          className={onSelect ? 'bar clickable' : 'bar'}
          onClick={() => onSelect?.(item.label)}
          title={`${item.label}: ${item.value}`}
        >
          <span className="bar-label">{item.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(item.value / largest) * 100}%` }} />
          </span>
          <span className="bar-value">{item.value}</span>
        </button>
      ))}
    </div>
  )
}

/** The badge of a finding's status. */
export function StatusBadge({ status }: { status: FindingStatus }) {
  return <span className={`badge status-${status}`}>{status}</span>
}

/** The badge of a finding's validity. */
export function ValidityBadge({ validity }: { validity: Validity }) {
  const label =
    validity === 'unknown' ? 'not checked' : validity === 'valid' ? 'still valid' : validity
  return <span className={`badge validity-${validity}`}>{label}</span>
}

/** A message when a list is empty. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>
}

/** A short time ago. */
export function TimeAgo({ at }: { at: string | null }) {
  if (!at) return <span className="muted">never</span>
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 1000))
  if (seconds < 60) return <span>{seconds}s ago</span>
  if (seconds < 3600) return <span>{Math.floor(seconds / 60)}m ago</span>
  if (seconds < 86400) return <span>{Math.floor(seconds / 3600)}h ago</span>
  return <span>{Math.floor(seconds / 86400)}d ago</span>
}
