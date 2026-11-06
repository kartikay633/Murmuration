'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { assignableRoles, can, rank, ROLE_LABEL, type Role } from '@murmuration/shared'
import { addMember, setMemberRole } from '@/app/actions'
import { leaveWorkspace, removeMember, renameWorkspace } from '@/app/settings-actions'
import { Avatar } from '@/components/avatar'
import { Icon } from '@/components/icons'
import { useWorkspace } from '@/components/workspace'

/** Workspace settings: name, people, export, leaving. */
export function SettingsView() {
  const { workspace, members, user, role, toast, setNavOpen, workspaces } = useWorkspace()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [name, setName] = useState(workspace.name)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('editor')
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const isAdmin = can(role, 'manage-members')
  const people = members.filter((m) => !m.isBot)

  const done = (res: { error?: string } | undefined, ok: string) => {
    if (res?.error) return toast(res.error)
    toast(ok)
    router.refresh()
  }

  return (
    <>
      <header className="topbar">
        <button className="icon-btn menu-btn" type="button" aria-label="Open navigation" onClick={(e) => (e.stopPropagation(), setNavOpen(true))}>
          <Icon name="menu" />
        </button>
        <nav className="crumbs">
          <span className="hide-sm">{workspace.name}</span>
          <span className="sep hide-sm">/</span>
          <b>Settings</b>
        </nav>
      </header>
      <div className="scroll">
        <div className="inbox settings">
          <div className="inbox-head">
            <div>
              <h1>Settings</h1>
              <span className="eyebrow">{role === 'owner' ? 'You own this workspace' : `Your role: ${ROLE_LABEL[role]}`}</span>
            </div>
          </div>

          <section className="set-section">
            <h2>Workspace name</h2>
            <form
              className="set-row"
              onSubmit={(e) => {
                e.preventDefault()
                start(async () => done(await renameWorkspace(workspace.id, name), 'Workspace renamed.'))
              }}
            >
              <input className="input" value={name} maxLength={80} disabled={!isAdmin} onChange={(e) => setName(e.target.value)} aria-label="Workspace name" />
              {isAdmin && (
                <button className="btn" type="submit" disabled={pending || !name.trim() || name.trim() === workspace.name}>
                  Save
                </button>
              )}
            </form>
          </section>

          <section className="set-section">
            <h2>People</h2>
            {isAdmin && (
              <form
                className="set-row"
                onSubmit={(e) => {
                  e.preventDefault()
                  start(async () => {
                    const res = await addMember(workspace.id, email, inviteRole)
                    if (res?.error) return toast(res.error)
                    toast(`Added ${email}.`)
                    setEmail('')
                    router.refresh()
                  })
                }}
              >
                <input className="input" type="email" placeholder="Add someone by email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email of the person to add" />
                <select className="select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} aria-label="Their role">
                  {assignableRoles(role).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <button className="btn" type="submit" disabled={pending || !email.trim()}>
                  Add
                </button>
              </form>
            )}
            <ul className="set-people">
              {people.map((m) => {
                const editable = isAdmin && m.id !== user.id && m.role !== 'owner' && rank(m.role) < rank(role)
                return (
                  <li key={m.id}>
                    <Avatar name={m.name} ink={m.ink} size="md" />
                    <span className="grow">
                      <span className="n">
                        {m.name}
                        {m.id === user.id ? ' (you)' : ''}
                      </span>
                      <span className="e">{m.email}</span>
                    </span>
                    {editable ? (
                      <>
                        <select
                          className="select"
                          value={m.role}
                          disabled={pending}
                          aria-label={`${m.name}'s role`}
                          onChange={(e) => start(async () => done(await setMemberRole(workspace.id, m.id, e.target.value as Role), 'Role updated.'))}
                        >
                          {assignableRoles(role).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                        {removing === m.id ? (
                          <button
                            type="button"
                            className="btn danger sm"
                            disabled={pending}
                            onClick={() => start(async () => (setRemoving(null), done(await removeMember(workspace.id, m.id), `Removed ${m.name}.`)))}
                          >
                            Remove
                          </button>
                        ) : (
                          <button type="button" className="icon-btn sm" aria-label={`Remove ${m.name}`} title="Remove from workspace" onClick={() => setRemoving(m.id)}>
                            <Icon name="x" />
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="set-role">{ROLE_LABEL[m.role]}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="set-section">
            <h2>Export</h2>
            <p className="set-hint">Every page in {workspace.name} as Markdown files, in folders that match the sidebar.</p>
            <a className="btn" href={`/api/workspaces/${workspace.id}/export`} download>
              <Icon name="download" /> Download .zip
            </a>
          </section>

          {role !== 'owner' && (
            <section className="set-section">
              <h2>Leave workspace</h2>
              <p className="set-hint">You’ll lose access to its pages until someone adds you again.</p>
              {confirmLeave ? (
                <div className="set-row">
                  <button
                    type="button"
                    className="btn danger"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await leaveWorkspace(workspace.id)
                        if (res.error) return toast(res.error)
                        const next = workspaces.find((w) => w.id !== workspace.id)
                        router.push(next ? `/w/${next.id}` : '/')
                      })
                    }
                  >
                    Leave {workspace.name}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setConfirmLeave(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" className="btn" onClick={() => setConfirmLeave(true)}>
                  Leave workspace
                </button>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  )
}
