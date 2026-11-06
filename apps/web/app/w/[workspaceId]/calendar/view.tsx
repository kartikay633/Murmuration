'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { monthReminders } from '@/app/reminder-actions'
import { Icon } from '@/components/icons'
import { useJournal } from '@/components/journal'
import { useWorkspace } from '@/components/workspace'
import { useTree } from '@/lib/tree'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

/** Monday-first weeks covering the month. */
function grid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7))
  const days: Date[] = []
  for (let d = new Date(start); days.length < 42; d.setDate(d.getDate() + 1)) days.push(new Date(d))
  // Drop a trailing week that's entirely next month.
  return days[35]!.getMonth() !== month.getMonth() ? days.slice(0, 35) : days
}

/** A month at a glance: each day's journal page and your reminders. */
export function CalendarView() {
  const { workspace, setNavOpen } = useWorkspace()
  const tree = useTree()
  const { entryFor, openDay, busy } = useJournal()
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [reminders, setReminders] = useState<{ pageId: string; title: string; dueAt: string }[]>([])
  const days = useMemo(() => grid(month), [month])
  const today = new Date()

  useEffect(() => {
    let live = true
    const from = days[0]!
    const to = new Date(days[days.length - 1]!)
    to.setDate(to.getDate() + 1)
    void monthReminders(workspace.id, from.toISOString(), to.toISOString()).then((r) => live && setReminders(r))
    return () => {
      live = false
    }
  }, [days, workspace.id])

  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1))
  const label = month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <>
      <header className="topbar">
        <button className="icon-btn menu-btn" type="button" aria-label="Open navigation" onClick={(e) => (e.stopPropagation(), setNavOpen(true))}>
          <Icon name="menu" />
        </button>
        <nav className="crumbs">
          <span className="hide-sm">{workspace.name}</span>
          <span className="sep hide-sm">/</span>
          <b>Calendar</b>
        </nav>
      </header>
      <div className="scroll">
        <div className="cal">
          <div className="cal-head">
            <h1>{label}</h1>
            <div className="cal-nav">
              <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}>
                <Icon name="chev" className="flip" />
              </button>
              <button type="button" className="btn ghost sm" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>
                Today
              </button>
              <button type="button" className="icon-btn" aria-label="Next month" onClick={() => shift(1)}>
                <Icon name="chev" />
              </button>
            </div>
          </div>
          <div className="cal-grid" role="grid" aria-label={label}>
            {WEEKDAYS.map((d) => (
              <div key={d} className="cal-dow" role="columnheader">
                {d}
              </div>
            ))}
            {days.map((d) => {
              const entry = entryFor(d)
              const due = reminders.filter((r) => sameDay(new Date(r.dueAt), d))
              const other = d.getMonth() !== month.getMonth()
              return (
                <div key={d.toISOString()} role="gridcell" className={`cal-day${other ? ' other' : ''}${sameDay(d, today) ? ' today' : ''}`}>
                  <button
                    type="button"
                    className="cal-num"
                    disabled={busy}
                    onClick={() => openDay(d)}
                    aria-label={`${entry ? 'Open' : 'Start'} the log for ${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`}
                  >
                    {d.getDate()}
                  </button>
                  {entry && (
                    <Link href={`/w/${workspace.id}/p/${entry.id}`} className="cal-chip">
                      <Icon name="page" size={12} />
                      Daily log
                    </Link>
                  )}
                  {due.map((r, i) => (
                    <Link key={i} href={`/w/${workspace.id}/p/${r.pageId}`} className="cal-chip reminder" title={`Reminder at ${new Date(r.dueAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}>
                      <Icon name="bell" size={12} />
                      {tree.nodes.get(r.pageId)?.title || r.title || 'Untitled'}
                    </Link>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
