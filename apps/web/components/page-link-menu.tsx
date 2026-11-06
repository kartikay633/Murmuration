'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { ancestors, isInTrash } from '@murmuration/shared'
import { useTree } from '@/lib/tree'
import { Icon } from './icons'
import { keyExtension } from './slash-menu'
import { useWorkspace } from './workspace'

export const PageLinkKeys = keyExtension('pageLinkKeys')

export function usePageLinkMenu() {
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

/** Type [[ to link to another page in this workspace. */
export function PageLinkMenu({
  editor,
  keyRef,
  pageId,
}: {
  editor: Editor | null
  keyRef: React.RefObject<(e: KeyboardEvent) => boolean>
  pageId: string
}) {
  const { workspace } = useWorkspace()
  const tree = useTree()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [index, setIndex] = useState(0)
  const dismissedAt = useRef<number | null>(null)

  const items = useMemo(() => {
    if (!menu) return []
    const q = menu.query.trim().toLowerCase()
    return [...tree.nodes.values()]
      .filter((n) => n.id !== pageId && !isInTrash(tree.nodes, n.id))
      .filter((n) => !q || (n.title || 'Untitled').toLowerCase().includes(q))
      .sort((a, b) => {
        // Titles that start with the query first, then alphabetical.
        const as = (a.title || '').toLowerCase().startsWith(q) ? 0 : 1
        const bs = (b.title || '').toLowerCase().startsWith(q) ? 0 : 1
        return as - bs || (a.title || 'Untitled').localeCompare(b.title || 'Untitled')
      })
      .slice(0, 8)
  }, [menu, tree.nodes, pageId])

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const { selection } = editor.state
      if (!selection.empty || !editor.isEditable || !editor.isFocused) return setMenu(null)
      const $from = selection.$from
      if ($from.parent.type.name === 'codeBlock') return setMenu(null)
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
      const m = /\[\[([^[\]\n]{0,40})$/.exec(before)
      if (!m) {
        dismissedAt.current = null
        return setMenu(null)
      }
      const from = $from.pos - m[1]!.length - 2
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
      const title = tree.nodes.get(id)?.title || 'Untitled'
      editor
        .chain()
        .focus()
        .deleteRange({ from: menu.from, to: menu.to })
        .insertContent([
          { type: 'text', text: title, marks: [{ type: 'link', attrs: { href: `/w/${workspace.id}/p/${id}`, class: 'page-link', target: null } }] },
          { type: 'text', text: ' ' },
        ])
        .run()
      setMenu(null)
    },
    [editor, menu, tree.nodes, workspace.id],
  )

  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      if (!menu) return false
      if (e.key === 'Escape') {
        dismissedAt.current = menu.from
        setMenu(null)
        return true
      }
      if (!items.length) return false
      if (e.key === 'ArrowDown') return setIndex((i) => (i + 1) % items.length), true
      if (e.key === 'ArrowUp') return setIndex((i) => (i - 1 + items.length) % items.length), true
      if (e.key === 'Enter' || e.key === 'Tab') {
        choose(items[Math.min(index, items.length - 1)]!.id)
        return true
      }
      return false
    }
  }, [keyRef, menu, items, index, choose])

  if (!menu) return null
  const below = menu.top + 320 < window.innerHeight
  const style: React.CSSProperties = below
    ? { left: Math.min(menu.left, window.innerWidth - 320), top: menu.top }
    : { left: Math.min(menu.left, window.innerWidth - 320), bottom: window.innerHeight - menu.top + 30 }

  return (
    <div className="slash-menu" role="listbox" aria-label="Link to a page" style={style}>
      <div className="slash-head">Link to page</div>
      {items.length === 0 ? (
        <p className="slash-empty">No pages match “{menu.query}”.</p>
      ) : (
        items.map((n, i) => {
          const path = ancestors(tree.nodes, n.id)
            .map((a) => a.title || 'Untitled')
            .join(' / ')
          return (
            <button
              key={n.id}
              type="button"
              role="option"
              aria-selected={i === index}
              className="slash-item"
              onMouseDown={(e) => {
                e.preventDefault()
                choose(n.id)
              }}
              onMouseEnter={() => setIndex(i)}
            >
              <span className="slash-glyph" aria-hidden="true">
                <Icon name="page" />
              </span>
              <span>
                <span className="slash-label">{n.title || 'Untitled'}</span>
                {path && <span className="slash-hint">{path}</span>}
              </span>
            </button>
          )
        })
      )}
    </div>
  )
}
