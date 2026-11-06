'use client'

import { useEffect } from 'react'
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { Placeholder } from '@tiptap/extensions'
import type * as Y from 'yjs'
import type { DocHandle } from '@murmuration/client'
import { presenceUser, readPresenceUser } from '@murmuration/shared'
import type { CurrentUser } from '@/lib/auth'
import { CatchUp } from '@/lib/catch-up'
import { contentExtensions } from '@/lib/content-schema'
import { CommentAnchors } from '@/lib/comment-anchors'
import { PageLinkKeys, PageLinkMenu, usePageLinkMenu } from './page-link-menu'
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
  pageId,
}: {
  pageId: string
  doc: Y.Doc
  handle: DocHandle
  user: CurrentUser
  editable: boolean
  onReady?: (editor: TiptapEditor) => void
  /** Called with a thread id when someone clicks highlighted text. */
  activateRef?: React.RefObject<((id: string) => void) | null>
}) {
  const slash = useSlashMenu()
  const pageLink = usePageLinkMenu()
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      extensions: [
        ...contentExtensions(),
        Placeholder.configure({
          // Empty page: an invitation. Empty line you're on: how to insert blocks.
          placeholder: ({ editor: e, node }) =>
            e.isEmpty ? 'Start writing, or press / for headings, lists and more…' : node.type.name === 'paragraph' ? 'Press / for blocks' : '',
        }),
        SlashKeys.configure({ onKey: slash.onKey }),
        PageLinkKeys.configure({ onKey: pageLink.onKey }),
        Collaboration.configure({ document: doc }),
        CatchUp,
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
          // Links to pages in this app open in place, like moving through a wiki.
          const url = new URL((a as HTMLAnchorElement).href, window.location.href)
          if (url.origin === window.location.origin && url.pathname.startsWith('/w/')) {
            if (event.metaKey || event.ctrlKey) window.open(url.href, '_blank', 'noopener')
            else window.dispatchEvent(new CustomEvent('mm:navigate', { detail: url.pathname + url.search }))
            return true
          }
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
      <PageLinkMenu editor={editor} keyRef={pageLink.keyRef} pageId={pageId} />
    </>
  )
}
