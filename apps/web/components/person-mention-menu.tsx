'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Avatar } from './avatar'
import { keyExtension } from './slash-menu'
import { useWorkspace } from './workspace'

export const MentionKeys = keyExtension('personMentionKeys')

export function useMentionMenu() {
  const keyRef = useRef<(e: KeyboardEvent) => boolean>(() => false)
  const onKey = useCallback((e: KeyboardEvent) => keyRef.current(e), [])
  return { keyRef, onKey }
}

interface MenuState {
  query: string
  from: number
  to: number
  left: number
  top: number
}

/** Type @ in a page to mention someone; they're notified in their inbox. */
export function PersonMentionMenu({ editor, keyRef }: { editor: Editor | null; keyRef: React.RefObject<(e: KeyboardEvent) => boolean> }) {
  const { members, user } = useWorkspace()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [index, setIndex] = useState(0)
  const dismissedAt = useRef<number | null>(null)

  const items = useMemo(() => {
    if (!menu) return []
    const q = menu.query.trim().toLowerCase()
    return members
      .filter((m) => !m.isBot)
      .filter((m) => !q || m.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || m.email.toLowerCase().startsWith(q))
      .sort((a, b) => Number(a.id === user.id) - Number(b.id === user.id) || a.name.localeCompare(b.name))
      .slice(0, 6)
  }, [menu, members, user.id])

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const { selection } = editor.state
      if (!selection.empty || !editor.isEditable || !editor.isFocused) return setMenu(null)
      const $from = selection.$from
      if ($from.parent.type.name === 'codeBlock' || $from.marks().some((m) => m.type.name === 'code')) return setMenu(null)
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
      // "@" at the start or after a space, so email addresses don't trigger it.
      const m = /(?:^|\s)@([\p{L}\p{N}.'-]{0,24})$/u.exec(before)
      if (!m) {
        dismissedAt.current = null
        return setMenu(null)
      }
      const from = $from.pos - m[1]!.length - 1
      if (dismissedAt.current === from) return setMenu(null)
      const c = editor.view.coordsAtPos(from)
      setMenu({ query: m[1]!, from, to: $from.pos, left: c.left, top: c.bottom + 6 })
    }
    editor.on('transaction', update)
    editor.on('blur', update)
    return () => {
      editor.off('transaction', update)
      editor.off('blur', update)
    }
  }, [editor])

  useEffect(() => setIndex(0), [menu?.query])

  const choose = useCallback(
    (id: string) => {
      if (!editor || !menu) return
      const person = members.find((m) => m.id === id)
      if (!person) return
      editor
        .chain()
        .focus()
        .deleteRange({ from: menu.from, to: menu.to })
        .insertContent([
          { type: 'mention', attrs: { id: person.id, label: person.name } },
          { type: 'text', text: ' ' },
        ])
        .run()
      setMenu(null)
    },
    [editor, menu, members],
  )

  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      if (!menu || !items.length) {
        if (menu && e.key === 'Escape') {
          dismissedAt.current = menu.from
          setMenu(null)
          return true
        }
        return false
      }
      if (e.key === 'Escape') {
        dismissedAt.current = menu.from
        setMenu(null)
        return true
      }
      if (e.key === 'ArrowDown') return setIndex((i) => (i + 1) % items.length), true
      if (e.key === 'ArrowUp') return setIndex((i) => (i - 1 + items.length) % items.length), true
      if (e.key === 'Enter' || e.key === 'Tab') {
        choose(items[Math.min(index, items.length - 1)]!.id)
        return true
      }
      return false
    }
  }, [keyRef, menu, items, index, choose])

  // Nobody matches: stay out of the way (the "@" is probably just text).
  if (!menu || !items.length) return null
  const below = menu.top + 260 < window.innerHeight
  const style: React.CSSProperties = below
    ? { left: Math.min(menu.left, window.innerWidth - 300), top: menu.top }
    : { left: Math.min(menu.left, window.innerWidth - 300), bottom: window.innerHeight - menu.top + 30 }

  return (
    <div className="slash-menu" role="listbox" aria-label="Mention someone" style={style}>
      <div className="slash-head">Mention</div>
      {items.map((m, i) => (
        <button
          key={m.id}
          type="button"
          role="option"
          aria-selected={i === index}
          className="slash-item"
          onMouseDown={(e) => {
            e.preventDefault()
            choose(m.id)
          }}
          onMouseEnter={() => setIndex(i)}
        >
          <Avatar name={m.name} ink={m.ink} />
          <span>
            <span className="slash-label">
              {m.name}
              {m.id === user.id ? ' (you)' : ''}
            </span>
            <span className="slash-hint">{m.email}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
