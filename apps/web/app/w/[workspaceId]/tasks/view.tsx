'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import { pageDoc, taskElements, type TaskInfo } from '@murmuration/shared'
import type { TaskPage, TaskRow } from '@/app/task-actions'
import { Avatar } from '@/components/avatar'
import { Icon } from '@/components/icons'
import { useWorkspace } from '@/components/workspace'
import { useSharedDoc } from '@/lib/sync'
import { useTree } from '@/lib/tree'

type Filter = 'mine' | 'all'

/** The page's to-dos, live from its document once it has loaded. */
function useLiveTasks(doc: Y.Doc | null): TaskInfo[] | null {
  const store = useMemo(() => {
    let snap: TaskInfo[] | null = null
    if (!doc) return { sub: () => () => {}, get: () => snap }
    const fragment = doc.getXmlFragment('default')
    const read = () => (snap = taskElements(fragment).map((t) => t.info))
    read()
    return {
      sub: (cb: () => void) => {
        const h = () => (read(), cb())
        fragment.observeDeep(h)
        return () => fragment.unobserveDeep(h)
      },
      get: () => snap,
    }
  }, [doc])
  return useSyncExternalStore(store.sub, store.get, () => null)
}

interface Counts {
  open: number
  mine: number
}

function PageGroup({
  page,
  filter,
  showDone,
  members,
  report,
}: {
  page: TaskPage
  filter: Filter
  showDone: boolean
  members: Map<string, { name: string; ink: TaskRow['assignees'][number]['ink'] }>
  report(pageId: string, counts: Counts): void
}) {
  const { workspace, user } = useWorkspace()
  const tree = useTree()
  const shared = useSharedDoc(pageDoc(page.id))
  const live = useLiveTasks(shared?.ready ? shared.doc : null)

  // Live rows when the page is open here, the server's copy until then.
  const rows: TaskRow[] = live
    ? live.map((t, position) => ({
        pageId: page.id,
        position,
        text: t.text,
        done: t.done,
        assignees: t.assignees.map((id) => ({ id, ...(members.get(id) ?? { name: 'Someone', ink: 'ochre' as const }) })),
      }))
    : page.tasks

  const shown = rows.filter((r) => (showDone || !r.done) && (filter === 'all' || r.assignees.some((a) => a.id === user.id)))
  const open = rows.filter((r) => !r.done).length
  const mine = rows.filter((r) => !r.done && r.assignees.some((a) => a.id === user.id)).length
  useEffect(() => report(page.id, { open, mine }), [report, page.id, open, mine])
  if (!shown.length) return null

  const toggle = (position: number) => {
    if (!shared?.ready || !page.canEdit) return
    const t = taskElements<Y.XmlElement>(shared.doc.getXmlFragment('default'))[position]
    if (!t) return
    shared.doc.transact(() => t.el.setAttribute('checked', !t.info.done as unknown as string))
  }

  return (
    <section className="task-group">
      <h2 className="task-page">
        <Link href={`/w/${workspace.id}/p/${page.id}`}>
          <Icon name="page" />
          {tree.nodes.get(page.id)?.title || page.title}
        </Link>
      </h2>
      <ul className="task-list">
        {shown.map((r) => (
          <li key={r.position} className={r.done ? 'done' : ''}>
            <input
              type="checkbox"
              checked={r.done}
              disabled={!page.canEdit || !shared?.ready}
              onChange={() => toggle(r.position)}
              aria-label={`${r.done ? 'Reopen' : 'Complete'}: ${r.text}`}
              title={page.canEdit ? undefined : 'You can’t edit this page'}
            />
            <span className="task-text">{r.text}</span>
            {r.assignees.length > 0 && (
              <span className="task-who">
                {r.assignees.slice(0, 3).map((a) => (
                  <Avatar key={a.id} name={a.name} ink={a.ink} />
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Every to-do across the workspace, filterable to the ones that @mention you. */
export function TasksView({ pages }: { pages: TaskPage[] }) {
  const { workspace, members, user, setNavOpen } = useWorkspace()
  const [filter, setFilter] = useState<Filter>('mine')
  const [showDone, setShowDone] = useState(false)
  const people = useMemo(() => new Map(members.map((m) => [m.id, { name: m.name, ink: m.ink }])), [members])

  // Remember the last filter on this device.
  useEffect(() => {
    try {
      const f = localStorage.getItem('mm-task-filter')
      if (f === 'all' || f === 'mine') setFilter(f)
    } catch {}
  }, [])
  const pick = (f: Filter) => {
    setFilter(f)
    try {
      localStorage.setItem('mm-task-filter', f)
    } catch {}
  }

  // Live counts, reported by each page as its to-dos change.
  const [counts, setCounts] = useState<Record<string, Counts>>(() =>
    Object.fromEntries(
      pages.map((p) => [
        p.id,
        {
          open: p.tasks.filter((t) => !t.done).length,
          mine: p.tasks.filter((t) => !t.done && t.assignees.some((a) => a.id === user.id)).length,
        },
      ]),
    ),
  )
  const report = useCallback(
    (pageId: string, c: Counts) =>
      setCounts((prev) => (prev[pageId]?.open === c.open && prev[pageId]?.mine === c.mine ? prev : { ...prev, [pageId]: c })),
    [],
  )
  const open = Object.values(counts).reduce((n, c) => n + c.open, 0)
  const mine = Object.values(counts).reduce((n, c) => n + c.mine, 0)
  const withOpen = Object.values(counts).filter((c) => c.open > 0).length

  return (
    <>
      <header className="topbar">
        <button className="icon-btn menu-btn" type="button" aria-label="Open navigation" onClick={(e) => (e.stopPropagation(), setNavOpen(true))}>
          <Icon name="menu" />
        </button>
        <nav className="crumbs">
          <span className="hide-sm">{workspace.name}</span>
          <span className="sep hide-sm">/</span>
          <b>Tasks</b>
        </nav>
      </header>
      <div className="scroll">
        <div className="inbox tasks">
          <div className="inbox-head">
            <div>
              <h1>Tasks</h1>
              <span className="eyebrow">
                {open} open {withOpen ? `across ${withOpen} ${withOpen === 1 ? 'page' : 'pages'} ` : ''}· {mine} assigned to you
              </span>
            </div>
          </div>
          <div className="task-filters" role="toolbar" aria-label="Filter tasks">
            <div className="seg" role="radiogroup" aria-label="Whose tasks">
              <button type="button" role="radio" aria-checked={filter === 'mine'} onClick={() => pick('mine')}>
                Assigned to me
              </button>
              <button type="button" role="radio" aria-checked={filter === 'all'} onClick={() => pick('all')}>
                All tasks
              </button>
            </div>
            <label className="task-done-toggle">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed
            </label>
          </div>

          {pages.map((p) => (
            <PageGroup key={p.id} page={p} filter={filter} showDone={showDone} members={people} report={report} />
          ))}
          {(filter === 'mine' ? mine : open) === 0 && !showDone && (
            <div className="inbox-empty">
              <Icon name="check" size={20} />
              <p>
                <b>{filter === 'mine' ? 'Nothing assigned to you.' : 'No open tasks.'}</b>
                <br />
                Add a to-do on any page with <kbd>/</kbd>, and @mention someone in it to assign it to them.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
