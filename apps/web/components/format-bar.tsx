'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Icon } from './icons'

/**
 * The toolbar that appears over selected text: inline formatting and links for
 * people who can edit, and "Comment" for anyone who can comment.
 */
export function FormatBar({
  editor,
  top,
  left,
  canEdit,
  canComment,
  range,
  onDone,
  onComment,
}: {
  range: { from: number; to: number }
  onDone(): void
  editor: Editor
  top: number
  left: number
  canEdit: boolean
  canComment: boolean
  onComment(): void
}) {
  const [linking, setLinking] = useState(false)
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [, bump] = useState(0)

  // Re-render when marks change so the active states stay right.
  useEffect(() => {
    const on = () => bump((n) => n + 1)
    editor.on('transaction', on)
    return () => {
      editor.off('transaction', on)
    }
  }, [editor])

  useEffect(() => {
    if (linking) inputRef.current?.focus()
  }, [linking])

  // Ctrl/Cmd+K over a selection adds a link (elsewhere it opens the command palette).
  useEffect(() => {
    if (!canEdit) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k' && editor.isFocused) {
        e.preventDefault()
        e.stopPropagation()
        setUrl((editor.getAttributes('link').href as string | undefined) ?? '')
        setLinking(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editor, canEdit])

  const mark = (name: string, label: string, glyph: React.ReactNode, run: () => void, shortcut: string) => (
    <button
      type="button"
      className="fmt-btn"
      aria-label={label}
      aria-pressed={editor.isActive(name)}
      title={`${label} (${shortcut})`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {glyph}
    </button>
  )

  const applyLink = () => {
    const href = url.trim()
    // Double-click selects the trailing space too; don't link it.
    let { from, to } = range
    while (to > from && /\s/.test(editor.state.doc.textBetween(to - 1, to))) to--
    const chain = editor.chain().focus().setTextSelection({ from, to }).extendMarkRange('link')
    if (!href) chain.unsetLink().run()
    else chain.setLink({ href: /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('/') ? href : `https://${href}` }).run()
    setLinking(false)
    setUrl('')
    // Put the cursor after the link so typing carries on.
    editor.commands.setTextSelection(to)
    // Typing straight after a link shouldn't make it longer.
    const link = editor.schema.marks.link
    if (link) editor.view.dispatch(editor.state.tr.removeStoredMark(link))
    editor.view.focus()
    onDone()
  }

  const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

  return (
    <div
      className="fmt-bar"
      role="toolbar"
      aria-label="Format selection"
      style={{ top, left }}
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
      }}
    >
      {linking ? (
        <form
          className="fmt-link"
          onSubmit={(e) => {
            e.preventDefault()
            applyLink()
          }}
        >
          <input
            ref={inputRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste or type a link"
            aria-label="Link address"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setLinking(false)
                editor.commands.setTextSelection(range)
                editor.view.focus()
              }
            }}
          />
          <button type="submit" className="fmt-btn" aria-label="Apply link">
            <Icon name="check" />
          </button>
        </form>
      ) : (
        <>
          {canEdit && (
            <>
              {mark('bold', 'Bold', <b>B</b>, () => editor.chain().focus().toggleBold().run(), `${mod}B`)}
              {mark('italic', 'Italic', <i>I</i>, () => editor.chain().focus().toggleItalic().run(), `${mod}I`)}
              {mark('underline', 'Underline', <u>U</u>, () => editor.chain().focus().toggleUnderline().run(), `${mod}U`)}
              {mark('strike', 'Strikethrough', <s>S</s>, () => editor.chain().focus().toggleStrike().run(), `${mod}Shift+S`)}
              {mark('highlight', 'Highlight', <Icon name="highlight" />, () => editor.chain().focus().toggleHighlight().run(), `${mod}Shift+H`)}
              {mark('code', 'Inline code', <Icon name="code" />, () => editor.chain().focus().toggleCode().run(), `${mod}E`)}
              {mark(
                'link',
                'Link',
                <Icon name="link" />,
                () => {
                  if (editor.isActive('link')) {
                    editor.chain().focus().extendMarkRange('link').unsetLink().run()
                  } else {
                    setUrl('')
                    setLinking(true)
                  }
                },
                `${mod}K`,
              )}
            </>
          )}
          {canEdit && canComment && <span className="fmt-sep" aria-hidden="true" />}
          {canComment && (
            <button type="button" className="fmt-btn fmt-comment" onClick={onComment} title="Comment (Ctrl+Alt+M)">
              <Icon name="comment" /> Comment
            </button>
          )}
        </>
      )}
    </div>
  )
}
