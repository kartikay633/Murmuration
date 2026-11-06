'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import type { Activity, Session } from '@/app/activity-actions'
import { Avatar } from '@/components/avatar'
import { Icon } from '@/components/icons'
import { useWorkspace } from '@/components/workspace'
import { useTree } from '@/lib/tree'

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

function dayLabel(d: Date) {
  if (dayKey(d) === dayKey(new Date())) return 'Today'
  if (dayKey(d) === dayKey(new Date(Date.now() - 86400_000))) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** Who worked on what this week, grouped by day in your own timezone. */
export function ActivityView({ data }: { data: Activity }) {
  const { workspace, setNavOpen } = useWorkspace()
  const tree = useTree()

  const { groups, days, max } = useMemo(() => {
    const byDay = new Map<string, { label: string; items: Session[] }>()
    for (const s of data.sessions) {
      const d = new Date(s.end)
      const k = dayKey(d)
      if (!byDay.has(k)) byDay.set(k, { label: dayLabel(d), items: [] })
      byDay.get(k)!.items.push(s)
    }
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 86400_000)
      return { label: d.toLocaleDateString('en-GB', { weekday: 'short' }), n: byDay.get(dayKey(d))?.items.length ?? 0 }
    })
    return { groups: [...byDay.values()], days, max: Math.max(1, ...days.map((d) => d.n)) }
  }, [data.sessions])

  return (
    <>
      <header className="topbar">
        <button className="icon-btn menu-btn" type="button" aria-label="Open navigation" onClick={(e) => (e.stopPropagation(), setNavOpen(true))}>
          <Icon name="menu" />
        </button>
        <nav className="crumbs">
          <span className="hide-sm">{workspace.name}</span>
          <span className="sep hide-sm">/</span>
          <b>Activity</b>
        </nav>
      </header>
      <div className="scroll">
        <div className="inbox activity">
          <div className="inbox-head">
            <div>
              <h1>Activity</h1>
              <span className="eyebrow">
                Last 7 days · {plural(data.sessions.length, 'session', 'sessions')} · {plural(data.people, 'person', 'people')} ·{' '}
                {plural(data.pages, 'page', 'pages')}
              </span>
            </div>
          </div>

          <div className="act-chart" role="img" aria-label={`Editing sessions per day: ${days.map((d) => `${d.label} ${d.n}`).join(', ')}`}>
            {days.map((d, i) => (
              <div key={i} className="act-col">
                <span className="act-n">{d.n || ''}</span>
                <span className="act-bar" style={{ height: `${(d.n / max) * 70}px` }} />
                <span className="act-day">{d.label}</span>
              </div>
            ))}
          </div>

          {groups.length === 0 ? (
            <div className="inbox-empty">
              <Icon name="pulse" />
              <p>
                <b>Nothing yet this week.</b> Edits to pages in {workspace.name} appear here, grouped by who worked on what.
              </p>
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.label} className="act-day-group">
                <h2 className="act-day-title">{g.label}</h2>
                <ul className="act-list">
                  {g.items.map((s) => (
                    <li key={`${s.authorId}:${s.pageId}:${s.end}`}>
                      <Link href={`/w/${workspace.id}/p/${s.pageId}`} className="act-row">
                        <Avatar name={s.authorName} ink={s.authorInk} />
                        <span className="act-main">
                          <span>
                            <b>{s.authorName}</b> edited <b>{tree.nodes.get(s.pageId)?.title || s.pageTitle || 'Untitled'}</b>
                          </span>
                          <span className="act-meta">
                            {clock(s.start) === clock(s.end) ? clock(s.end) : `${clock(s.start)}–${clock(s.end)}`}
                            {s.added > 0 && ` · ${plural(s.added, 'character', 'characters')} written`}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </>
  )
}
