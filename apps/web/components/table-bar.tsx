'use client'

import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'

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
      {act('Header row', () => editor.chain().focus().toggleHeaderRow().run())}
      {act('Delete table', () => editor.chain().focus().deleteTable().run(), true)}
    </div>
  )
}
