'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Editor } from '@tiptap/react'
import { relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import type { DocHandle } from '@murmuration/client'
import { readPresenceUser, type PresenceUser } from '@murmuration/shared'
import { useTree } from '@/lib/tree'
import { Avatar } from './avatar'
import { Icon } from './icons'
import { useWorkspace } from './workspace'

type YState = { doc: Y.Doc; type: Y.XmlFragment; binding: { mapping: Map<unknown, unknown> } | null }

/** Where someone's cursor is on this page, as a ProseMirror position. */
function cursorOf(editor: Editor, handle: DocHandle, userId: string): number | null {
  const y = ySyncPluginKey.getState(editor.state) as YState | undefined
  if (!y?.binding) return null
  let pos: number | null = null
  handle.awareness.getStates().forEach((s) => {
    if (pos !== null || readPresenceUser(s.user)?.id !== userId) return
    const head = (s.cursor as { head?: unknown } | null | undefined)?.head
    if (!head) return
    try {
      pos = relativePositionToAbsolutePosition(y.doc, y.type, Y.createRelativePositionFromJSON(head), y.binding!.mapping as never)
    } catch {
      /* stale position */
    }
  })
  return pos
}

function isHere(handle: DocHandle, userId: string) {
  let here = false
  handle.awareness.getStates().forEach((s) => {
    if (readPresenceUser(s.user)?.id === userId) here = true
  })
  return here
}

/**
 * Follow someone: keep their cursor in view as they type and move around, and
 * go with them when they open another page. Scrolling or typing yourself stops it.
 */
export function useFollow({
  pageId,
  editor,
  handle,
  scrollEl,
  initial,
}: {
  pageId: string
  editor: Editor | null
  handle: DocHandle | null
  scrollEl: React.RefObject<HTMLElement | null>
  initial: string | null
}) {
  const { workspace, toast, members } = useWorkspace()
  const tree = useTree()
  const router = useRouter()
  const [following, setFollowing] = useState<string | null>(initial)
  const [seen, setSeen] = useState<PresenceUser | null>(null)
  const missingSince = useRef<number | null>(null)

  // Name and ink of the person we follow, from their live presence (practice
  // collaborators aren't workspace members), else from the member list.
  useEffect(() => {
    if (!following || !handle) return
    const read = () =>
      handle.awareness.getStates().forEach((s) => {
        const u = readPresenceUser(s.user)
        if (u?.id === following) setSeen((prev) => (prev?.id === u.id ? prev : u))
      })
    read()
    handle.awareness.on('change', read)
    return () => handle.awareness.off('change', read)
  }, [following, handle])
  const member = following ? members.find((m) => m.id === following) : undefined
  const person: Pick<PresenceUser, 'id' | 'name' | 'ink'> | undefined =
    seen && seen.id === following ? seen : member ? { id: member.id, name: member.name, ink: member.ink } : undefined

  const stop = useCallback(() => setFollowing(null), [])
  const start = useCallback((id: string) => setFollowing((f) => (f === id ? null : id)), [])

  // Track their cursor.
  useEffect(() => {
    if (!following || !editor || !handle) return
    let raf = 0
    const sync = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (editor.isDestroyed) return
        const pos = cursorOf(editor, handle, following)
        const el = scrollEl.current
        if (pos === null || !el) return
        const c = editor.view.coordsAtPos(Math.min(pos, editor.state.doc.content.size))
        const box = el.getBoundingClientRect()
        const margin = Math.min(120, box.height / 4)
        if (c.top < box.top + margin || c.bottom > box.bottom - margin) {
          el.scrollBy({ top: c.top - box.top - box.height / 2, behavior: 'smooth' })
        }
      })
    }
    sync()
    handle.awareness.on('change', sync)
    editor.on('transaction', sync)
    return () => {
      cancelAnimationFrame(raf)
      handle.awareness.off('change', sync)
      editor.off('transaction', sync)
    }
  }, [following, editor, handle, scrollEl])

  // Go where they go: the tree's presence says which page each person is on.
  useEffect(() => {
    if (!following || !handle) return
    missingSince.current = null
    const check = () => {
      if (isHere(handle, following)) {
        missingSince.current = null
        return
      }
      // Give presence a moment to arrive after a page change.
      missingSince.current ??= Date.now()
      if (Date.now() - missingSince.current < 3000) return
      let elsewhere: string | null = null
      tree.shared?.handle.awareness.getStates().forEach((s) => {
        if (readPresenceUser(s.user)?.id === following && typeof s.page === 'string' && s.page !== pageId) elsewhere = s.page
      })
      const name = person?.name.split(' ')[0] ?? 'They'
      if (elsewhere && tree.nodes.has(elsewhere)) {
        router.push(`/w/${workspace.id}/p/${elsewhere}?follow=${following}`)
      } else {
        toast(`${name} left the page.`)
        setFollowing(null)
      }
    }
    const t = setInterval(check, 1000)
    return () => clearInterval(t)
  }, [following, handle, tree, pageId, router, workspace.id, person?.name, toast])

  // Your own scrolling, typing or Escape takes back control.
  useEffect(() => {
    const el = scrollEl.current
    if (!following || !el) return
    const off = () => setFollowing(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1)) off()
    }
    el.addEventListener('wheel', off, { passive: true })
    el.addEventListener('touchmove', off, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('wheel', off)
      el.removeEventListener('touchmove', off)
      window.removeEventListener('keydown', onKey)
    }
  }, [following, scrollEl])

  // Drop ?follow= from the address once we've picked it up.
  useEffect(() => {
    if (initial && window.location.search.includes('follow=')) {
      const url = new URL(window.location.href)
      url.searchParams.delete('follow')
      window.history.replaceState(window.history.state, '', url)
    }
  }, [initial])

  return { following, person, start, stop }
}

export function FollowPill({ person, onStop }: { person: Pick<PresenceUser, 'id' | 'name' | 'ink'> | undefined; onStop(): void }) {
  if (!person) return null
  return (
    <div className="follow-pill" role="status" style={{ '--c': `var(--ink-${person.ink})` } as React.CSSProperties}>
      <Avatar name={person.name} ink={person.ink} />
      <span>Following {person.name.split(' ')[0]}</span>
      <button type="button" className="icon-btn sm" aria-label="Stop following" title="Stop following (Esc)" onClick={onStop}>
        <Icon name="x" />
      </button>
    </div>
  )
}
