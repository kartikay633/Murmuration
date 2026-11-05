'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * The "/" menu: type a slash at the start of a line (or after a space) to turn
 * the line into a heading, list, to-do list, quote, code block or divider.
 */

type Chain = ReturnType<Editor['chain']>

interface BlockItem {
  id: string
  label: string
  hint: string
  keywords: string
  glyph: string
  run(chain: Chain): Chain
}

const ITEMS: BlockItem[] = [
  { id: 'text', label: 'Text', hint: 'Plain paragraph', keywords: 'text paragraph p', glyph: 'Aa', run: (c) => c.setParagraph() },
  { id: 'h1', label: 'Heading 1', hint: 'Large section heading', keywords: 'heading title h1 big', glyph: 'H1', run: (c) => c.setHeading({ level: 1 }) },
  { id: 'h2', label: 'Heading 2', hint: 'Medium section heading', keywords: 'heading subtitle h2', glyph: 'H2', run: (c) => c.setHeading({ level: 2 }) },
  { id: 'h3', label: 'Heading 3', hint: 'Small section heading', keywords: 'heading h3 small', glyph: 'H3', run: (c) => c.setHeading({ level: 3 }) },
  { id: 'todo', label: 'To-do list', hint: 'Track tasks with checkboxes', keywords: 'todo task checkbox check list', glyph: '☐', run: (c) => c.toggleTaskList() },
  { id: 'bullet', label: 'Bulleted list', hint: 'A simple list', keywords: 'bullet list ul unordered', glyph: '•', run: (c) => c.toggleBulletList() },
  { id: 'numbered', label: 'Numbered list', hint: 'A list with numbers', keywords: 'numbered ordered list ol 1', glyph: '1.', run: (c) => c.toggleOrderedList() },
  { id: 'quote', label: 'Quote', hint: 'Set off a quotation', keywords: 'quote blockquote citation', glyph: '“', run: (c) => c.toggleBlockquote() },
  { id: 'code', label: 'Code block', hint: 'Monospaced code', keywords: 'code snippet pre', glyph: '</>', run: (c) => c.toggleCodeBlock() },
  { id: 'divider', label: 'Divider', hint: 'A horizontal rule', keywords: 'divider rule line hr separator', glyph: '—', run: (c) => c.setHorizontalRule() },
]

interface MenuState {
  query: string
  from: number
  to: number
  left: number
  top: number
}

/** Hands key presses to the open menu before the editor sees them. */
export const SlashKeys = Extension.create<{ onKey: (e: KeyboardEvent) => boolean }>({
  name: 'slashKeys',
  addOptions() {
    return { onKey: () => false }
  },
  addProseMirrorPlugins() {
    const options = this.options
    return [new Plugin({ key: new PluginKey('slashKeys'), props: { handleKeyDown: (_view, event) => options.onKey(event) } })]
  },
})

export function useSlashMenu() {
  const keyRef = useRef<(e: KeyboardEvent) => boolean>(() => false)
  const onKey = useCallback((e: KeyboardEvent) => keyRef.current(e), [])
  return { keyRef, onKey }
}

export function SlashMenu({ editor, keyRef }: { editor: Editor | null; keyRef: React.RefObject<(e: KeyboardEvent) => boolean> }) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [index, setIndex] = useState(0)
  const dismissedAt = useRef<number | null>(null)

  const items = useMemo(() => {
    if (!menu) return []
    const q = menu.query.trim().toLowerCase()
    if (!q) return ITEMS
    return ITEMS.filter((i) => i.label.toLowerCase().includes(q) || i.keywords.includes(q))
  }, [menu])

  // Watch the text before the cursor for "/query".
  useEffect(() => {
    if (!editor) return
    const update = () => {
      const { selection } = editor.state
      if (!selection.empty || !editor.isEditable || !editor.isFocused) return setMenu(null)
      const $from = selection.$from
      if ($from.parent.type.name === 'codeBlock') return setMenu(null)
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
      const m = /(?:^|\s)\/([\p{L}\d ]{0,24})$/u.exec(before)
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
    (item: BlockItem) => {
      if (!editor || !menu) return
      item.run(editor.chain().focus().deleteRange({ from: menu.from, to: menu.to })).run()
      setMenu(null)
    },
    [editor, menu],
  )

  // Keyboard handling while the menu is open.
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      if (!menu) return false
      if (e.key === 'Escape') {
        dismissedAt.current = menu.from
        setMenu(null)
        return true
      }
      if (!items.length) return false
      if (e.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % items.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        setIndex((i) => (i - 1 + items.length) % items.length)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        choose(items[Math.min(index, items.length - 1)]!)
        return true
      }
      return false
    }
  }, [keyRef, menu, items, index, choose])

  if (!menu || !items.length) return null
  // Keep the menu on screen near the bottom edge.
  const below = menu.top + 340 < window.innerHeight
  const style: React.CSSProperties = below
    ? { left: Math.min(menu.left, window.innerWidth - 300), top: menu.top }
    : { left: Math.min(menu.left, window.innerWidth - 300), bottom: window.innerHeight - menu.top + 30 }

  return (
    <div className="slash-menu" role="listbox" aria-label="Insert a block" style={style}>
      <div className="slash-head">Blocks</div>
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={i === index}
          className="slash-item"
          onMouseDown={(e) => {
            e.preventDefault()
            choose(item)
          }}
          onMouseEnter={() => setIndex(i)}
        >
          <span className="slash-glyph" aria-hidden="true">{item.glyph}</span>
          <span>
            <span className="slash-label">{item.label}</span>
            <span className="slash-hint">{item.hint}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
