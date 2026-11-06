'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ancestors, can, isInTrash, PAGE_STATUSES, STATUS_LABEL, type PageStatus, type TreeNode } from '@murmuration/shared'
import { Avatar } from '@/components/avatar'
import { Icon } from '@/components/icons'
import { dueLabel, isOverdue } from '@/components/page-props'
import { useWorkspace } from '@/components/workspace'
import { useTree, useTreeRole } from '@/lib/tree'

type Who = 'all' | 'mine'

/**
 * Pages with a status, as cards in columns. Drag a card to another column to
 * change its status; everyone sees the move at once (it's the shared tree).
 */
export function BoardView() {
  const { workspace, members, user, setNavOpen } = useWorkspace()
  const tree = useTree()
  const treeRole = useTreeRole() ?? workspace.role
  const canEdit = can(treeRole, 'manage-pages')
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<PageStatus | null>(null)
  const [who, setWho] = useState<Who>('all')
  const people = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])

  const columns = useMemo(() => {
    const cols = new Map<PageStatus, TreeNode[]>(PAGE_STATUSES.map((s) => [s, []]))
    for (const n of tree.nodes.values()) {
      if (!n.status || isInTrash(tree.nodes, n.id)) continue
      if (who === 'mine' && n.owner !== user.id) continue
      cols.get(n.status)!.push(n)
    }
    // Soonest due first; undated after; then by title.
    for (const list of cols.values()) {
      list.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.title || '').localeCompare(b.title || ''))
    }
    return cols
  }, [tree.nodes, who, user.id])

  const total = [...columns.values()].reduce((n, l) => n + l.length, 0)

  const drop = (status: PageStatus) => {
    if (dragging && canEdit && tree.nodes.get(dragging)?.status !== status) tree.setProps(dragging, { status })
    setDragging(null)
    setOver(null)
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
          <b>Board</b>
        </nav>
      </header>
      <div className="scroll">
        <div className="board">
          <div className="board-head">
            <div>
              <h1>Board</h1>
              <span className="eyebrow">Pages with a status · drag a card to move it</span>
            </div>
            <div className="seg" role="radiogroup" aria-label="Whose pages">
              <button type="button" role="radio" aria-checked={who === 'all'} onClick={() => setWho('all')}>
                Everyone
              </button>
              <button type="button" role="radio" aria-checked={who === 'mine'} onClick={() => setWho('mine')}>
                Mine
              </button>
            </div>
          </div>

          {total === 0 ? (
            <div className="inbox-empty">
              <Icon name="board" size={20} />
              <p>
                <b>{who === 'mine' ? 'You don’t own any pages with a status.' : 'No pages have a status yet.'}</b>
                <br />
                Open a page and set its status under the title. It will show up here.
              </p>
            </div>
          ) : (
            <div className="board-cols">
              {PAGE_STATUSES.map((status) => (
                <section
                  key={status}
                  className={`board-col${over === status ? ' over' : ''}`}
                  aria-label={STATUS_LABEL[status]}
                  onDragOver={(e) => {
                    if (!dragging || !canEdit) return
                    e.preventDefault()
                    setOver(status)
                  }}
                  onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(null)}
                  onDrop={(e) => {
                    e.preventDefault()
                    drop(status)
                  }}
                >
                  <h2>
                    <span className={`status-pill s-${status}`}>
                      <i /> {STATUS_LABEL[status]}
                    </span>
                    <span className="board-n">{columns.get(status)!.length}</span>
                  </h2>
                  <ul>
                    {columns.get(status)!.map((n) => {
                      const owner = n.owner ? people.get(n.owner) : undefined
                      const path = ancestors(tree.nodes, n.id)
                        .map((a) => a.title || 'Untitled')
                        .join(' / ')
                      return (
                        <li
                          key={n.id}
                          draggable={canEdit}
                          className={dragging === n.id ? 'dragging' : ''}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('text/plain', n.id)
                            setDragging(n.id)
                          }}
                          onDragEnd={() => (setDragging(null), setOver(null))}
                        >
                          <Link href={`/w/${workspace.id}/p/${n.id}`} className="board-card" draggable={false}>
                            <span className="board-title">{n.title || 'Untitled'}</span>
                            {path && <span className="board-path">{path}</span>}
                            {(owner || n.due) && (
                              <span className="board-meta">
                                {n.due && (
                                  <span className={isOverdue(n.due, n.status) ? 'overdue' : ''}>
                                    <Icon name="calendar" size={12} /> {dueLabel(n.due)}
                                  </span>
                                )}
                                {owner && <Avatar name={owner.name} ink={owner.ink} />}
                              </span>
                            )}
                          </Link>
                          {canEdit && (
                            <label className="board-move">
                              <span className="sr-only">Status of {n.title || 'Untitled'}</span>
                              <select value={status} onChange={(e) => tree.setProps(n.id, { status: e.target.value as PageStatus })}>
                                {PAGE_STATUSES.map((s) => (
                                  <option key={s} value={s}>
                                    {STATUS_LABEL[s]}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
