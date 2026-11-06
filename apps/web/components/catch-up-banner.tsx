'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { markPageSeen, openPage, type CatchUp } from '@/app/visit-actions'
import { catchUpKey, insertedRanges } from '@/lib/catch-up'
import { timeAgo } from '@/lib/comments'
import { Avatar } from './avatar'

/** "5 minutes ago", "3 hours ago", "on Tue", "on 5 Nov". */
function when(iso: string) {
  const t = timeAgo(iso)
  if (t === 'just now') return 'a moment ago'
  const m = /^(\d+)([mh])$/.exec(t)
  if (m) return `${m[1]} ${m[2] === 'm' ? 'minute' : 'hour'}${m[1] === '1' ? '' : 's'} ago`
  return `on ${t}`
}

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

function names(list: string[]) {
  const first = list.map((n) => n.split(' ')[0] ?? n)
  if (first.length <= 2) return first.join(' and ')
  return `${first.slice(0, 2).join(', ')} and ${first.length - 2} other${first.length > 3 ? 's' : ''}`
}

/**
 * "Since you were last here": highlights what other people wrote while you
 * were away, and keeps your seen-mark current while the page is open.
 */
export function CatchUpBanner({ pageId, editor, ready }: { pageId: string; editor: Editor | null; ready: boolean }) {
  // Survives React's development double-mount, so the visit is read once.
  const request = useRef<Promise<CatchUp | null> | null>(null)
  const [data, setData] = useState<CatchUp | null>(null)
  const [shown, setShown] = useState(false)
  const applied = useRef(false)

  useEffect(() => {
    request.current ??= openPage(pageId).catch(() => null)
    let live = true
    void request.current.then((d) => live && setData(d))
    return () => {
      live = false
    }
  }, [pageId])

  // Highlight once both the changes and the page content are in.
  useEffect(() => {
    if (!data || !editor || !ready || applied.current || editor.isDestroyed) return
    applied.current = true
    const ink = new Map(data.authors.map((a) => [a.id, a.ink]))
    const ranges = insertedRanges(data.updates.map((u) => ({ update: fromB64(u.update), ink: ink.get(u.authorId) ?? 'ochre' })))
    editor.view.dispatch(editor.state.tr.setMeta(catchUpKey, ranges))
    // Only worth a banner if some of their text is still on the page.
    setShown((catchUpKey.getState(editor.state)?.deco.find().length ?? 0) > 0)
  }, [data, editor, ready])

  // Keep "seen up to" current while you're here, and when you leave.
  useEffect(() => {
    // Throttled: visibility can flip many times a second (tab switching,
    // embedded browsers); one mark every 20 seconds is plenty, plus one on leaving.
    let last = 0
    const send = () => {
      last = Date.now()
      void markPageSeen(pageId).catch(() => {})
    }
    const seen = () => {
      if (Date.now() - last >= 20_000) send()
    }
    const timer = setInterval(() => document.visibilityState === 'visible' && seen(), 45_000)
    const onHide = () => document.visibilityState === 'hidden' && seen()
    document.addEventListener('visibilitychange', onHide)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onHide)
      send()
    }
  }, [pageId])

  if (!shown || !data) return null

  const hide = () => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(catchUpKey, []))
    setShown(false)
  }
  const jump = () => {
    const first = editor?.view.dom.querySelector('.catchup')
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="catchup-bar" role="status">
      <span className="catchup-who" aria-hidden="true">
        {data.authors.slice(0, 3).map((a) => (
          <Avatar key={a.id} name={a.name} ink={a.ink} />
        ))}
      </span>
      <span className="catchup-text">
        {names(data.authors.map((a) => a.name))} edited this page since your visit {when(data.since)}. Their changes are highlighted.
      </span>
      <button type="button" className="btn ghost sm" onClick={jump}>
        Jump to changes
      </button>
      <button type="button" className="btn ghost sm" onClick={hide}>
        Hide highlights
      </button>
    </div>
  )
}
