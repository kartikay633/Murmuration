'use client'

import { useTransition } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { can, isInTrash } from '@murmuration/shared'
import { createPage } from '@/app/actions'
import { journalTitle } from '@/lib/templates'
import { useTree } from '@/lib/tree'
import { Icon } from './icons'
import { useWorkspace } from './workspace'

const JOURNAL = 'Journal'

/**
 * A shared daily log: one page per day under a "Journal" page, created the
 * first time anyone opens it that day.
 */
export function JournalButton() {
  const { workspace, user, role, toast, setNavOpen } = useWorkspace()
  const tree = useTree()
  const router = useRouter()
  const params = useParams<{ pageId?: string }>()
  const [busy, start] = useTransition()
  const today = journalTitle(new Date())

  const live = (id: string) => !isInTrash(tree.nodes, id)
  const parent = (tree.children.get(null) ?? []).find((n) => n.title === JOURNAL && live(n.id))
  const entry = parent ? (tree.children.get(parent.id) ?? []).find((n) => n.title === today) : undefined
  const here = !!entry && params.pageId === entry.id

  const open = () =>
    start(async () => {
      setNavOpen(false)
      if (entry) return router.push(`/w/${workspace.id}/p/${entry.id}`)
      if (!can(role, 'manage-pages')) return toast('Nobody has started today’s log yet.')
      let parentId = parent?.id
      if (!parentId) {
        const res = await createPage(workspace.id, JOURNAL)
        if (!res.id) return toast(res.error ?? 'Could not start the journal.')
        tree.add({ id: res.id, title: JOURNAL, parentId: null, createdBy: user.id })
        parentId = res.id
      }
      const res = await createPage(workspace.id, today)
      if (!res.id) return toast(res.error ?? 'Could not start today’s log.')
      tree.add({ id: res.id, title: today, parentId, createdBy: user.id })
      // Newest day first under the journal.
      const first = (tree.children.get(parentId) ?? [])[0]
      if (first) tree.move(res.id, first.id, 'before')
      router.push(`/w/${workspace.id}/p/${res.id}?template=daily`)
    })

  return (
    <button
      type="button"
      className={`item journal-item${here ? ' active' : ''}`}
      style={{ paddingLeft: 8, gap: 8 }}
      disabled={busy}
      onClick={open}
      title={today}
    >
      <Icon name="calendar" />
      <span className="label">Today</span>
    </button>
  )
}
