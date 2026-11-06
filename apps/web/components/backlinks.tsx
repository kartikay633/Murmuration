'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { backlinks } from '@/app/link-actions'
import { useTree } from '@/lib/tree'
import { Icon } from './icons'
import { useWorkspace } from './workspace'

/** "Linked from": the pages that point here. Only shown when there are some. */
export function Backlinks({ pageId }: { pageId: string }) {
  const { workspace } = useWorkspace()
  const tree = useTree()
  const pathname = usePathname()
  const [items, setItems] = useState<{ id: string; title: string }[]>([])

  useEffect(() => {
    let live = true
    const load = () => void backlinks(pageId).then((r) => live && setItems(r)).catch(() => {})
    load()
    // Links are indexed as people save, so look again now and then.
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 30_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [pageId, pathname])

  if (!items.length) return null
  return (
    <section className="backlinks" aria-label="Linked from">
      <h2 className="backlinks-title">Linked from</h2>
      <ul>
        {items.map((b) => (
          <li key={b.id}>
            <Link href={`/w/${workspace.id}/p/${b.id}`}>
              <Icon name="page" />
              {tree.nodes.get(b.id)?.title || b.title || 'Untitled'}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The pages directly under this one, in sidebar order. */
export function Subpages({ pageId }: { pageId: string }) {
  const { workspace } = useWorkspace()
  const tree = useTree()
  const kids = tree.children.get(pageId) ?? []
  if (!kids.length) return null
  return (
    <section className="backlinks subpages" aria-label="Subpages">
      <h2 className="backlinks-title">Subpages</h2>
      <ul>
        {kids.map((n) => (
          <li key={n.id}>
            <Link href={`/w/${workspace.id}/p/${n.id}`}>
              <Icon name="page" />
              {n.title || 'Untitled'}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
