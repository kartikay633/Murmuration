'use client'

import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Sort the table's rows by the column the cursor is in. A first row of header
 * cells stays on top. Empty cells sort last either way.
 */
function sortByColumn(editor: Editor, dir: 1 | -1): boolean {
  const { state } = editor
  const { $from } = state.selection
  let tableDepth = $from.depth
  while (tableDepth > 0 && $from.node(tableDepth).type.name !== 'table') tableDepth--
  if (!tableDepth) return false
  // Which column: the cell's index within its row.
  let cellDepth = $from.depth
  while (cellDepth > tableDepth && !['tableCell', 'tableHeader'].includes($from.node(cellDepth).type.name)) cellDepth--
  if (cellDepth <= tableDepth) return false
  const col = $from.index(cellDepth - 1)
  const table = $from.node(tableDepth)
  const rows: typeof table[] = []
  table.forEach((row) => rows.push(row))
  const isHeader = (row: (typeof rows)[number]) => row.childCount > 0 && row.firstChild!.type.name === 'tableHeader'
  const head = rows.length && isHeader(rows[0]!) ? [rows[0]!] : []
  const body = rows.slice(head.length)
  const key = (row: (typeof rows)[number]) => (col < row.childCount ? row.child(col).textContent.trim() : '')
  const sorted = [...body].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    if (!ka || !kb) return ka ? -1 : kb ? 1 : 0
    return dir * collator.compare(ka, kb)
  })
  if (sorted.every((r, i) => r === body[i])) return true
  const start = $from.before(tableDepth)
  const next = table.type.create(table.attrs, [...head, ...sorted], table.marks)
  const tr = state.tr.replaceWith(start, start + table.nodeSize, next)
  // Same table, same size: keep the cursor in it so the toolbar stays.
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min($from.pos, start + next.nodeSize - 1))))
  editor.view.dispatch(tr)
  return true
}

/** Row and column controls that appear above a table while the cursor is in it. */
export function TableBar({ editor, wrapRef }: { editor: Editor | null; wrapRef: React.RefObject<HTMLDivElement | null> }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const wrap = wrapRef.current
      if (!editor.isEditable || !editor.isFocused || !editor.isActive('table') || !wrap) return setPos(null)
      const { $from } = editor.state.selection
      let depth = $from.depth
      while (depth > 0 && $from.node(depth).type.name !== 'table') depth--
      if (!depth) return setPos(null)
      const dom = editor.view.nodeDOM($from.before(depth)) as HTMLElement | null
      const table = dom?.closest?.('.tableWrapper') ?? dom
      if (!table) return setPos(null)
      const r = table.getBoundingClientRect()
      const w = wrap.getBoundingClientRect()
      setPos({ top: r.top - w.top - 40, left: r.left - w.left })
    }
    update()
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    editor.on('focus', update)
    editor.on('blur', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
      editor.off('focus', update)
      editor.off('blur', update)
    }
  }, [editor, wrapRef])

  if (!editor || !pos) return null
  const act = (label: string, run: () => boolean, danger = false) => (
    <button
      type="button"
      className={`tbl-btn${danger ? ' danger' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run()}
    >
      {label}
    </button>
  )
  return (
    <div className="tbl-bar" role="toolbar" aria-label="Table" style={pos}>
      {act('+ Row', () => editor.chain().focus().addRowAfter().run())}
      {act('+ Column', () => editor.chain().focus().addColumnAfter().run())}
      <span className="fmt-sep" aria-hidden="true" />
      {act('− Row', () => editor.chain().focus().deleteRow().run())}
      {act('− Column', () => editor.chain().focus().deleteColumn().run())}
      <span className="fmt-sep" aria-hidden="true" />
      {act('Sort A–Z', () => sortByColumn(editor, 1))}
      {act('Sort Z–A', () => sortByColumn(editor, -1))}
      <span className="fmt-sep" aria-hidden="true" />
      {act('Header row', () => editor.chain().focus().toggleHeaderRow().run())}
      {act('Delete table', () => editor.chain().focus().deleteTable().run(), true)}
    </div>
  )
}
