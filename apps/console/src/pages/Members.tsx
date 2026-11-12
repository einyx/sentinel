/**
 * The members of the organisation.
 */

import { useCallback, useState } from 'react'
import { useAsync } from '../components'
import type { Api } from '../api'
import type { Member, MemberRole } from '../types'

/** The roles a member may take. */
const ROLES: MemberRole[] = ['owner', 'member', 'viewer']

export function Members({ api }: { api: Api }) {
  const [busy, setBusy] = useState(false)
  const members = useAsync(() => api.get<{ members: Member[] }>('/members'), [api])

  const setRole = useCallback(
    async (member: Member, role: MemberRole) => {
      setBusy(true)
      try {
        await api.patch(`/members/${encodeURIComponent(member.subject)}`, { role })
        members.reload()
      } finally {
        setBusy(false)
      }
    },
    [api, members],
  )

  return (
    <>
      <header className="page-head">
        <h1>Members</h1>
        <p className="muted">Who can see the findings, and who can change them.</p>
      </header>

      <section className="panel">
        {members.loading ? (
          <p className="empty">Loading&hellip;</p>
        ) : members.data && members.data.members.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Address</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {members.data.members.map((member) => (
                <tr key={member.subject}>
                  <td>{member.name ?? member.subject}</td>
                  <td className="muted">{member.email ?? '—'}</td>
                  <td>
                    <select
                      value={member.role}
                      disabled={busy}
                      onChange={(event) => void setRole(member, event.target.value as MemberRole)}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">
            Nobody has signed in yet. The first person to sign in becomes the owner.
          </p>
        )}
      </section>
    </>
  )
}
