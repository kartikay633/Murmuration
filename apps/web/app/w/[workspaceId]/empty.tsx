'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { can } from '@murmuration/shared'
import { createPage } from '@/app/actions'
import { Icon } from '@/components/icons'
import { useWorkspace } from '@/components/workspace'
import { useTree } from '@/lib/tree'

export function EmptyWorkspace() {
  const { workspace, user, role, setNavOpen, toast } = useWorkspace()
  const tree = useTree()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const canCreate = can(role, 'manage-pages')

  return (
    <>
      <header className="topbar">
        <button className="icon-btn menu-btn" type="button" aria-label="Open navigation" onClick={(e) => (e.stopPropagation(), setNavOpen(true))}>
          <Icon name="menu" />
        </button>
        <nav className="crumbs"><b>{workspace.name}</b></nav>
      </header>
      <div className="scroll">
        <div className="empty">
          <span className="eyebrow">{workspace.name}</span>
          <h2>A blank workspace.</h2>
          <p>
            {canCreate
              ? 'Start with one page. Anyone you invite will see it the moment it exists, and you’ll see each other typing.'
              : 'Nothing has been written here yet. Pages appear as soon as someone creates them.'}
          </p>
          {canCreate && (
            <button
              className="btn primary"
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await createPage(workspace.id)
                  if (!res.id) return toast(res.error ?? 'Could not create a page.')
                  tree.add({ id: res.id, title: '', parentId: null, createdBy: user.id })
                  router.push(`/w/${workspace.id}/p/${res.id}?new=1`)
                })
              }
            >
              <Icon name="plus" /> Create the first page
            </button>
          )}
        </div>
      </div>
    </>
  )
}
