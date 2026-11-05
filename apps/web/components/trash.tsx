'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { can, isInTrash, subtree, type TreeNode } from '@murmuration/shared'
import { deletePagesForever, unarchivePage } from '@/app/actions'
import { timeAgo } from '@/lib/comments'
import { useTree } from '@/lib/tree'
import { Icon } from './icons'
import { useDismiss } from './menu'
import { useWorkspace } from './workspace'

/** Archived pages (the top of each archived subtree), newest first. */
export function useTrash(): TreeNode[] {
  const tree = useTree()
  return useMemo(() => {
    const out: TreeNode[] = []
    for (const n of tree.nodes.values()) {
      if (!n.archived) continue
      // A page archived inside an archived parent is restored along with it.
      const parent = n.parentId ? tree.nodes.get(n.parentId) : undefined
      if (parent && isInTrash(tree.nodes, parent.id)) continue
      out.push(n)
    }
    return out.sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
  }, [tree.nodes])
}

/** Restore and delete-forever, shared by the trash panel and the in-trash page banner. */
export function useTrashActions() {
  const { workspace, toast } = useWorkspace()
  const tree = useTree()
  const router = useRouter()
  const params = useParams<{ pageId?: string }>()
  const [busy, start] = useTransition()

  const restore = useCallback(
    (node: TreeNode) =>
      start(async () => {
        const res = await unarchivePage(node.id, subtree(tree.nodes.values(), node.id, true).slice(1))
        if (res.error) return toast(res.error)
        tree.unarchive(node.id)
        toast(`Restored “${node.title || 'Untitled'}”.`)
      }),
    [tree, toast],
  )

  const destroy = useCallback(
    (node: TreeNode) =>
      start(async () => {
        const ids = subtree(tree.nodes.values(), node.id)
        const res = await deletePagesForever(workspace.id, ids)
        if (res.error) return toast(res.error)
        tree.purge(ids)
        toast(ids.length > 1 ? `Deleted “${node.title || 'Untitled'}” and ${ids.length - 1} subpage${ids.length > 2 ? 's' : ''}.` : `Deleted “${node.title || 'Untitled'}”.`)
        if (params.pageId && ids.includes(params.pageId)) router.push(`/w/${workspace.id}`)
      }),
    [tree, toast, workspace.id, params.pageId, router],
  )

  return { restore, destroy, busy }
}

export function TrashButton() {
  const { role } = useWorkspace()
  const items = useTrash()
  const tree = useTree()
  const { restore, destroy, busy } = useTrashActions()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const close = useCallback(() => {
    setOpen(false)
    setConfirming(null)
    setFilter('')
  }, [])
  const ref = useDismiss(open, close)
  const canManage = can(role, 'manage-pages')

  const shown = items.filter((n) => (n.title || 'Untitled').toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <div className="trash-wrap" ref={ref}>
      <button
        type="button"
        className={`item trash-item${open ? ' active' : ''}`}
        style={{ paddingLeft: 8, gap: 8 }}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="trash" />
        <span className="label">Trash</span>
      </button>
      {open && (
        <div className="trash-panel" role="dialog" aria-label="Trash">
          {items.length > 5 && (
            <input
              className="trash-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter pages in the trash"
              aria-label="Filter pages in the trash"
              autoFocus
            />
          )}
          {items.length === 0 ? (
            <p className="trash-empty">The trash is empty. Archived pages land here, and can be restored at any time.</p>
          ) : shown.length === 0 ? (
            <p className="trash-empty">Nothing in the trash matches.</p>
          ) : (
            <ul className="trash-list">
              {shown.map((n) => {
                const kids = subtree(tree.nodes.values(), n.id).length - 1
                return (
                  <li key={n.id} className="trash-row">
                    <span className="trash-open">
                      <span className="trash-title">{n.title || 'Untitled'}</span>
                      <span className="trash-meta">
                        {n.archivedAt ? `Archived ${timeAgo(new Date(n.archivedAt).toISOString())}` : 'Archived'}
                        {kids > 0 && ` · ${kids} subpage${kids > 1 ? 's' : ''}`}
                      </span>
                    </span>
                    {canManage &&
                      (confirming === n.id ? (
                        <span className="trash-confirm">
                          <button type="button" className="btn danger sm" disabled={busy} onClick={() => (setConfirming(null), destroy(n))}>
                            Delete forever
                          </button>
                          <button type="button" className="icon-btn sm" aria-label="Cancel" onClick={() => setConfirming(null)}>
                            <Icon name="x" />
                          </button>
                        </span>
                      ) : (
                        <span className="trash-actions">
                          <button type="button" className="icon-btn sm" aria-label={`Restore ${n.title || 'Untitled'}`} title="Restore" disabled={busy} onClick={() => restore(n)}>
                            <Icon name="restore" />
                          </button>
                          <button type="button" className="icon-btn sm" aria-label={`Delete ${n.title || 'Untitled'} forever`} title="Delete forever" onClick={() => setConfirming(n.id)}>
                            <Icon name="trash" />
                          </button>
                        </span>
                      ))}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
