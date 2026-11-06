'use client'

import { useCallback, useTransition } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { can, isInTrash, type TreeNode } from '@murmuration/shared'
import { createPage } from '@/app/actions'
import { journalTitle } from '@/lib/templates'
import { useTree } from '@/lib/tree'
import { Icon } from './icons'
import { useWorkspace } from './workspace'

const JOURNAL = 'Journal'

/**
 * A shared daily log: one page per day under a "Journal" page, created the
 * first time anyone opens that day.
 */
export function useJournal() {
  const { workspace, user, role, toast, setNavOpen } = useWorkspace()
  const tree = useTree()
  const router = useRouter()
  const [busy, start] = useTransition()

  const parent = (tree.children.get(null) ?? []).find((n) => n.title === JOURNAL && !isInTrash(tree.nodes, n.id))
  const entries = parent ? (tree.children.get(parent.id) ?? []) : []
  const entryFor = useCallback((day: Date): TreeNode | undefined => entries.find((n) => n.title === journalTitle(day)), [entries])

  const openDay = useCallback(
    (day: Date) =>
      start(async () => {
        setNavOpen(false)
        const existing = entryFor(day)
        if (existing) return router.push(`/w/${workspace.id}/p/${existing.id}`)
        if (!can(role, 'manage-pages')) return toast('Nobody has started that day’s log yet.')
        let parentId = parent?.id
        if (!parentId) {
          const res = await createPage(workspace.id, JOURNAL)
          if (!res.id) return toast(res.error ?? 'Could not start the journal.')
          tree.add({ id: res.id, title: JOURNAL, parentId: null, createdBy: user.id })
          parentId = res.id
        }
        const title = journalTitle(day)
        const res = await createPage(workspace.id, title)
        if (!res.id) return toast(res.error ?? 'Could not start that day’s log.')
        tree.add({ id: res.id, title, parentId, createdBy: user.id })
        // Keep the newest day first: place it before the first entry that's older.
        const newer = (n: TreeNode) => {
          const t = Date.parse(n.title.replace(/^\w+, /, ''))
          return Number.isNaN(t) ? false : t > day.getTime()
        }
        const siblings = tree.children.get(parentId) ?? []
        const after = siblings.filter(newer).pop()
        const before = siblings.find((n) => !newer(n))
        if (after) tree.move(res.id, after.id, 'after')
        else if (before) tree.move(res.id, before.id, 'before')
        router.push(`/w/${workspace.id}/p/${res.id}?template=daily`)
      }),
    [entryFor, role, toast, parent?.id, workspace.id, tree, user.id, router, setNavOpen],
  )

  return { entryFor, openDay, busy, hasJournal: !!parent }
}

export function JournalButton() {
  const params = useParams<{ pageId?: string }>()
  const { entryFor, openDay, busy } = useJournal()
  const today = new Date()
  const entry = entryFor(today)
  return (
    <button
      type="button"
      className={`item journal-item${entry && params.pageId === entry.id ? ' active' : ''}`}
      style={{ paddingLeft: 8, gap: 8 }}
      disabled={busy}
      onClick={() => openDay(today)}
      title={journalTitle(today)}
    >
      <Icon name="calendar" />
      <span className="label">Today</span>
    </button>
  )
}
