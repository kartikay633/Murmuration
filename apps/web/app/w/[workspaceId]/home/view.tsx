'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { HomeData } from '@/app/home-actions'
import { Icon } from '@/components/icons'
import { openPalette } from '@/components/command-palette'
import { useWorkspace } from '@/components/workspace'
import { timeAgo } from '@/lib/comments'
import { useTree } from '@/lib/tree'

function greeting(h: number) {
  if (h < 5) return 'Working late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** "just now", "5m ago", "3h ago", "on Tue", "on 5 Nov". */
function ago(iso: string) {
  const t = timeAgo(iso)
  return t === 'just now' ? t : /^\d/.test(t) ? `${t} ago` : `on ${t}`
}

const due = (iso: string) => {
  const d = new Date(iso)
  const same = d.toDateString() === new Date().toDateString()
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return same ? `Today ${t}` : `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${t}`
}

/** The workspace's front page: where you were, what changed, what's yours to do. */
export function HomeView({ data }: { data: HomeData }) {
  const { workspace, user, setNavOpen } = useWorkspace()
  const tree = useTree()
  const title = (id: string, fallback: string) => tree.nodes.get(id)?.title || fallback || 'Untitled'
  // The greeting depends on the reader's clock, so it's decided after hydration.
  const [hello, setHello] = useState('Welcome back')
  useEffect(() => setHello(greeting(new Date().getHours())), [])
  const first = user.name.split(' ')[0]
  const nothing = !data.recent.length && !data.changed.length && !data.tasks.length && !data.reminders.length

  return (
    <>
      <header className="topbar">
        <button className="icon-btn menu-btn" type="button" aria-label="Open navigation" onClick={(e) => (e.stopPropagation(), setNavOpen(true))}>
          <Icon name="menu" />
        </button>
        <nav className="crumbs">
          <span className="hide-sm">{workspace.name}</span>
          <span className="sep hide-sm">/</span>
          <b>Home</b>
        </nav>
      </header>
      <div className="scroll">
        <div className="inbox home">
          <div className="inbox-head">
            <div>
              <h1>
                {hello}, {first}.
              </h1>
              <span className="eyebrow">
                {workspace.name} · {data.pageCount} {data.pageCount === 1 ? 'page' : 'pages'}
              </span>
            </div>
            <button type="button" className="btn" onClick={openPalette}>
              <Icon name="search" /> Search
            </button>
          </div>

          {data.recent.length > 0 && (
            <section className="home-section">
              <h2>Jump back in</h2>
              <div className="home-cards">
                {data.recent.map((p) => (
                  <Link key={p.id} href={`/w/${workspace.id}/p/${p.id}`} className="home-card">
                    <Icon name="page" />
                    <span className="home-card-title">{title(p.id, p.title)}</span>
                    <span className="home-card-meta">Opened {ago(p.visitedAt)}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {data.changed.length > 0 && (
            <section className="home-section">
              <h2>Changed since you looked</h2>
              <ul className="home-list">
                {data.changed.map((p) => (
                  <li key={p.id}>
                    <Link href={`/w/${workspace.id}/p/${p.id}`}>
                      <span className="unseen-dot" aria-hidden="true" />
                      <span className="grow">{title(p.id, p.title)}</span>
                      <span className="home-meta">{ago(p.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.tasks.length > 0 && (
            <section className="home-section">
              <h2>
                Assigned to you <Link href={`/w/${workspace.id}/tasks`} className="home-more">All tasks</Link>
              </h2>
              <ul className="home-list">
                {data.tasks.map((t, i) => (
                  <li key={i}>
                    <Link href={`/w/${workspace.id}/p/${t.pageId}`}>
                      <span className="home-box" aria-hidden="true" />
                      <span className="grow">{t.text}</span>
                      <span className="home-meta">{title(t.pageId, t.title)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.reminders.length > 0 && (
            <section className="home-section">
              <h2>Coming up</h2>
              <ul className="home-list">
                {data.reminders.map((r, i) => (
                  <li key={i}>
                    <Link href={`/w/${workspace.id}/p/${r.pageId}`}>
                      <Icon name="bell" />
                      <span className="grow">{title(r.pageId, r.title)}</span>
                      <span className="home-meta">{due(r.dueAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {nothing && (
            <div className="inbox-empty">
              <Icon name="page" size={20} />
              <p>
                <b>Pick up where you left off.</b>
                <br />
                Pages you open, to-dos assigned to you and changes from your team will gather here.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
