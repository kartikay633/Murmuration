'use client'

import { useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { assignableRoles, can, ROLE_LABEL, ROLES, type Role } from '@murmuration/shared'
import { addMember, setPageRole } from '@/app/actions'
import { Avatar } from './avatar'
import { Icon } from './icons'
import { useDismiss } from './menu'
import { useWorkspace } from './workspace'

export function SharePopover({ pageId, overrides: initial }: { pageId: string; overrides: Record<string, Role> }) {
  const { members, role, user, workspace, toast } = useWorkspace()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [overrides, setOverrides] = useState(initial)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('editor')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const close = useCallback(() => setOpen(false), [])
  const ref = useDismiss(open, close)
  const isAdmin = can(role, 'manage-members')

  const changePage = (userId: string, value: string) =>
    startTransition(async () => {
      const next = value === 'inherit' ? null : (value as Role)
      const res = await setPageRole(pageId, userId, next)
      if (res?.error) return toast(res.error)
      setOverrides((o) => {
        const copy = { ...o }
        if (next) copy[userId] = next
        else delete copy[userId]
        return copy
      })
      toast('Page access updated. It takes effect within a few seconds, even for people already here.')
    })

  return (
    <div className="share-wrap" ref={ref}>
      <button className="btn primary share-btn" type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="link" /> <span className="txt">Share</span>
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Share this page">
          <h3>Who can open this page</h3>
          <p className="lede">Everyone in {workspace.name} gets their workspace role here unless you change it for this page.</p>

          {isAdmin && (
            <form
              className="invite"
              onSubmit={(e) => {
                e.preventDefault()
                setError(null)
                startTransition(async () => {
                  const res = await addMember(workspace.id, email, inviteRole)
                  if (res?.error) return setError(res.error)
                  setEmail('')
                  toast(`Added ${email} to ${workspace.name}.`)
                  router.refresh()
                })
              }}
            >
              <input
                className="input sm"
                type="email"
                placeholder="Add someone by email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Email of the person to add"
              />
              <select className="select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} aria-label="Their workspace role">
                {assignableRoles(role).map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
              <button className="btn" type="submit" disabled={pending || !email.trim()}>Add</button>
            </form>
          )}
          {error && <p className="error-text" style={{ margin: '0 0 8px' }}>{error}</p>}

          {members.map((m) => {
            const locked = m.role === 'owner' || m.role === 'admin'
            const value = overrides[m.id] ?? 'inherit'
            return (
              <div className="member" key={m.id}>
                <Avatar name={m.name} ink={m.ink} size="md" />
                <span className="grow">
                  <span className="n">{m.name}{m.id === user.id ? ' (you)' : ''}</span>
                  <span className="e">{m.email}</span>
                </span>
                <select
                  className="select"
                  value={locked ? m.role : value}
                  disabled={!isAdmin || locked || pending}
                  onChange={(e) => changePage(m.id, e.target.value)}
                  aria-label={`${m.name}'s access to this page`}
                >
                  {locked ? (
                    <option value={m.role}>{ROLE_LABEL[m.role]}</option>
                  ) : (
                    <>
                      <option value="inherit">{ROLE_LABEL[m.role]} (workspace)</option>
                      {ROLES.filter((r) => r !== 'owner' && r !== 'admin').map((r) => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                      ))}
                    </>
                  )}
                </select>
              </div>
            )
          })}
          {!isAdmin && <p className="popover-note">Only admins can change who has access.</p>}
        </div>
      )}
    </div>
  )
}
