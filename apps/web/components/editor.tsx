'use client'

import { useEffect } from 'react'
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { Placeholder } from '@tiptap/extensions'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import type * as Y from 'yjs'
import type { DocHandle } from '@murmuration/client'
import { presenceUser, readPresenceUser } from '@murmuration/shared'
import type { CurrentUser } from '@/lib/auth'
import { CommentAnchors } from '@/lib/comment-anchors'
import { SlashKeys, SlashMenu, useSlashMenu } from './slash-menu'

// Presence comes from other people's browsers, so treat it as untrusted:
// only a known ink name ever reaches a style.
const inkOf = (u: Record<string, unknown>) => readPresenceUser(u)?.ink ?? 'ochre'

function renderCaret(user: Record<string, unknown>) {
  const caret = document.createElement('span')
  caret.className = 'collaboration-carets__caret'
  caret.style.setProperty('--c', `var(--ink-${inkOf(user)})`)
  const label = document.createElement('span')
  label.className = 'collaboration-carets__label'
  label.textContent = String(user.name ?? '').split(' ')[0] ?? ''
  caret.append(label)
  return caret
}

export function Editor({
  doc,
  handle,
  user,
  editable,
  onReady,
  activateRef,
}: {
  doc: Y.Doc
  handle: DocHandle
  user: CurrentUser
  editable: boolean
  onReady?: (editor: TiptapEditor) => void
  /** Called with a thread id when someone clicks highlighted text. */
  activateRef?: React.RefObject<((id: string) => void) | null>
}) {
  const slash = useSlashMenu()
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      extensions: [
        // Collaboration brings its own history, scoped to this user's edits:
        // undo never takes back what someone else typed.
        StarterKit.configure({
          undoRedo: false,
          heading: { levels: [1, 2, 3] },
          // Clicking a link while writing places the cursor; Ctrl/Cmd-click (or read-only) opens it.
          link: { openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
        }),
        Placeholder.configure({
          // Empty page: an invitation. Empty line you're on: how to insert blocks.
          placeholder: ({ editor: e, node }) =>
            e.isEmpty ? 'Start writing, or press / for headings, lists and more…' : node.type.name === 'paragraph' ? 'Press / for blocks' : '',
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        SlashKeys.configure({ onKey: slash.onKey }),
        Collaboration.configure({ document: doc }),
        CommentAnchors.configure({ onActivate: (id) => activateRef?.current?.(id) }),
        CollaborationCaret.configure({
          provider: handle,
          user: presenceUser(user),
          render: renderCaret,
          selectionRender: (u: Record<string, unknown>) => ({
            nodeName: 'span',
            class: 'collaboration-carets__selection',
            style: `--c: var(--ink-${inkOf(u)})`,
          }),
        }),
      ],
      editorProps: {
        attributes: { 'aria-label': 'Page content', spellcheck: 'true' },
        handleClick: (view, _pos, event) => {
          const a = (event.target as HTMLElement).closest('a[href]')
          if (!a || !view.dom.contains(a)) return false
          if (view.editable && !(event.metaKey || event.ctrlKey)) return false
          window.open((a as HTMLAnchorElement).href, '_blank', 'noopener,noreferrer')
          return true
        },
      },
    },
    [doc, handle],
  )

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])

  useEffect(() => {
    if (editor) onReady?.(editor)
  }, [editor, onReady])

  return (
    <>
      <EditorContent editor={editor} />
      <SlashMenu editor={editor} keyRef={slash.keyRef} />
    </>
  )
}
