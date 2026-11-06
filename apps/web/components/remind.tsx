'use client'

import { useEffect, useState, useTransition } from 'react'
import { cancelReminder, pageReminders, setReminder } from '@/app/reminder-actions'
import { Icon } from './icons'
import { useWorkspace } from './workspace'

const at = (d: Date, h: number) => {
  const x = new Date(d)
  x.setHours(h, 0, 0, 0)
  return x
}

/** Reminder times in your own timezone. */
function choices(now = new Date()) {
  const out: { label: string; due: Date }[] = [{ label: 'In 1 hour', due: new Date(now.getTime() + 3600_000) }]
  if (now.getHours() < 17) out.push({ label: 'This evening', due: at(now, 18) })
  const tomorrow = new Date(now.getTime() + 86400_000)
  out.push({ label: 'Tomorrow morning', due: at(tomorrow, 9) })
  const monday = new Date(now)
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7))
  out.push({ label: 'Next week', due: at(monday, 9) })
  return out
}

const when = (d: Date) => {
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return sameDay ? time : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`
}

/** "Remind me" choices inside the page menu, plus any reminder already set. */
export function RemindMenu({ pageId, onDone }: { pageId: string; onDone(): void }) {
  const { toast } = useWorkspace()
  const [upcoming, setUpcoming] = useState<{ id: string; dueAt: string }[]>([])
  const [pending, start] = useTransition()

  useEffect(() => {
    let live = true
    void pageReminders(pageId).then((r) => live && setUpcoming(r))
    return () => {
      live = false
    }
  }, [pageId])

  const remind = (label: string, due: Date) =>
    start(async () => {
      const res = await setReminder(pageId, due.toISOString())
      if (res.error) return toast(res.error)
      toast(`Reminder set for ${when(due)}. It will show up in your inbox.`)
      onDone()
    })

  const cancel = (id: string) =>
    start(async () => {
      await cancelReminder(id)
      setUpcoming((u) => u.filter((r) => r.id !== id))
      toast('Reminder cancelled.')
    })

  return (
    <div className="menu-sub" role="group" aria-label="Remind me">
      {upcoming.map((r) => (
        <div key={r.id} className="menu-item static">
          <Icon name="bell" />
          <span>Set for {when(new Date(r.dueAt))}</span>
          <button type="button" className="link-btn" disabled={pending} onClick={() => cancel(r.id)}>
            Cancel
          </button>
        </div>
      ))}
      {choices().map((c) => (
        <button key={c.label} type="button" role="menuitem" className="menu-item" disabled={pending} onClick={() => remind(c.label, c.due)}>
          {c.label}
          <span className="when">{when(c.due)}</span>
        </button>
      ))}
    </div>
  )
}
