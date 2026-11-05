'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { TEMPLATES, templateById, type Template } from '@/lib/templates'

/** Fill an empty page from a template and put the cursor in its first blank line. */
export function applyTemplate(editor: Editor, t: Template, rename: (title: string) => void, currentTitle: string) {
  editor.commands.setContent(t.content())
  if (!currentTitle.trim()) rename(t.title())
  let target: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (target !== null) return false
    if (node.isTextblock && node.content.size === 0 && node.type.name !== 'heading') target = pos + 1
    return true
  })
  editor.chain().focus(target ?? 'end').run()
}

function useIsEmpty(editor: Editor | null) {
  const [empty, setEmpty] = useState(() => !!editor?.isEmpty)
  useEffect(() => {
    if (!editor) return
    const on = () => setEmpty(editor.isEmpty)
    on()
    editor.on('update', on)
    editor.on('transaction', on)
    return () => {
      editor.off('update', on)
      editor.off('transaction', on)
    }
  }, [editor])
  return empty
}

/**
 * On an empty page: one-click starting points. Also applies a template asked
 * for in the address (?template=…) when the page was just created from one.
 */
export function TemplatePicker({
  editor,
  ready,
  canEdit,
  title,
  rename,
  requested,
}: {
  editor: Editor | null
  ready: boolean
  canEdit: boolean
  title: string
  rename(title: string): void
  requested: string | null
}) {
  const empty = useIsEmpty(editor)
  const used = useRef(false)

  useEffect(() => {
    const t = templateById(requested)
    if (!t || used.current || !editor || !ready || !canEdit) return
    used.current = true
    if (editor.isEmpty) applyTemplate(editor, t, rename, title)
    const url = new URL(window.location.href)
    url.searchParams.delete('template')
    window.history.replaceState(window.history.state, '', url)
  }, [requested, editor, ready, canEdit, rename, title])

  if (!editor || !ready || !canEdit || !empty || requested) return null
  return (
    <div className="tpl" role="group" aria-label="Start from a template">
      <span className="tpl-label">Start from</span>
      {TEMPLATES.map((t) => (
        <button key={t.id} type="button" className="tpl-chip" title={t.hint} onClick={() => applyTemplate(editor, t, rename, title)}>
          {t.name}
        </button>
      ))}
    </div>
  )
}
