'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Editor } from '@tiptap/react'
import type * as Y from 'yjs'
import { fragmentMarkdown } from '@murmuration/shared'
import { duplicatePage } from '@/app/actions'
import { seenBy, type SeenBy } from '@/app/visit-actions'
import { useTree } from '@/lib/tree'
import { Avatar } from './avatar'
import { Icon } from './icons'
import { useDismiss } from './menu'
import { RemindMenu } from './remind'
import { useWorkspace } from './workspace'

/** A filename that works everywhere. */
const fileName = (title: string) =>
  (title.trim() || 'Untitled')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) + '.md'

function stats(editor: Editor | null) {
  if (!editor) return null
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ', ' ')
  const words = (text.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length
  return { words, minutes: Math.max(1, Math.round(words / 230)) }
}

/** The page's "⋯" menu: less frequent tools stay out of the header. */
export function PageMenu({
  pageId,
  title,
  editor,
  doc,
  canDuplicate,
  locked = false,
  onLock,
  onPresent,
  onBlame,
  onLab,
  onCopyLink,
}: {
  pageId: string
  title: string
  editor: Editor | null
  doc: Y.Doc | null
  canDuplicate: boolean
  locked?: boolean
  /** Admins only: lock or unlock the page. */
  onLock?(on: boolean): void
  onPresent(): void
  onBlame(): void
  onLab(): void
  onCopyLink(): void
}) {
  const { workspace, user, toast } = useWorkspace()
  const tree = useTree()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [remind, setRemind] = useState(false)
  const [busy, start] = useTransition()
  const close = useCallback(() => {
    setOpen(false)
    setRemind(false)
  }, [])
  const ref = useDismiss(open, close)
  const run = (fn: () => void) => () => {
    close()
    fn()
  }

  // The body lives in the page's Y.Doc; the title lives in the tree.
  const markdown = () => (doc && editor ? fragmentMarkdown(doc.getXmlFragment('default'), title) : null)

  const download = () => {
    const md = markdown()
    if (md === null) return toast('The page is still loading. Try again in a moment.')
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: fileName(title) })
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const copy = async () => {
    const md = markdown()
    if (md === null) return toast('The page is still loading. Try again in a moment.')
    try {
      await navigator.clipboard.writeText(md)
      toast('Copied as Markdown.')
    } catch {
      toast('Your browser blocked the clipboard.')
    }
  }

  const duplicate = () =>
    start(async () => {
      const res = await duplicatePage(pageId)
      if (!res.id) return toast(res.error ?? 'Could not duplicate the page.')
      const parentId = tree.nodes.get(pageId)?.parentId ?? null
      tree.add({ id: res.id, title: res.title ?? '', parentId, createdBy: user.id })
      tree.move(res.id, pageId, 'after')
      router.push(`/w/${workspace.id}/p/${res.id}`)
    })

  const s = open ? stats(editor) : null

  return (
    <div className="share-wrap" ref={ref}>
      <button
        className="icon-btn"
        type="button"
        aria-label="More page options"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu" role="menu" style={{ top: 38, right: 0, width: 264 }}>
          <button className="menu-item" role="menuitem" type="button" onClick={run(onCopyLink)}>
            <Icon name="link" /> Copy link
          </button>
          {canDuplicate && (
            <button className="menu-item" role="menuitem" type="button" disabled={busy} onClick={run(duplicate)}>
              <Icon name="copy" /> Duplicate
            </button>
          )}
          {canDuplicate && (
            <button
              className="menu-item"
              role="menuitem"
              type="button"
              onClick={run(() => {
                const on = !tree.nodes.get(pageId)?.template
                tree.setProps(pageId, { template: on || null })
                toast(on ? 'Saved as a template. It’s offered on every new page.' : 'No longer a template.')
              })}
            >
              <Icon name="layers" /> {tree.nodes.get(pageId)?.template ? 'Stop using as template' : 'Use as template'}
            </button>
          )}
          <button className="menu-item" role="menuitem" type="button" onClick={run(onPresent)} disabled={!editor}>
            <Icon name="present" /> Present
          </button>
          <button className="menu-item" role="menuitem" type="button" onClick={run(onBlame)}>
            <Icon name="blame" /> Show who wrote what
          </button>
          <button className="menu-item" role="menuitem" type="button" aria-expanded={remind} onClick={() => setRemind((r) => !r)}>
            <Icon name="bell" /> Remind me
            <Icon name="chev" className={`menu-chev${remind ? ' open' : ''}`} />
          </button>
          {remind && <RemindMenu pageId={pageId} onDone={close} />}
          {onLock && (
            <button className="menu-item" role="menuitem" type="button" onClick={run(() => onLock(!locked))}>
              <Icon name="lock" /> {locked ? 'Unlock page' : 'Lock page'}
            </button>
          )}
          <div className="menu-sep" />
          <button className="menu-item" role="menuitem" type="button" onClick={run(download)}>
            <Icon name="download" /> Export as Markdown
          </button>
          <button className="menu-item" role="menuitem" type="button" onClick={run(() => void copy())}>
            <Icon name="markdown" /> Copy as Markdown
          </button>
          <button className="menu-item" role="menuitem" type="button" onClick={run(() => setTimeout(() => window.print(), 50))}>
            <Icon name="print" /> Print or save as PDF
          </button>
          <div className="menu-sep" />
          <button className="menu-item" role="menuitem" type="button" onClick={run(onLab)}>
            <Icon name="lab" />
            <span>
              Network Lab
              <span className="menu-hint">Simulate latency and going offline</span>
            </span>
          </button>
          <SeenLine pageId={pageId} />
          {s && (
            <div className="menu-foot">
              {s.words.toLocaleString()} {s.words === 1 ? 'word' : 'words'} · {s.minutes} min read
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** "Seen by Ana and Rohan · Mei hasn't opened it": read receipts in the menu. */
function SeenLine({ pageId }: { pageId: string }) {
  const [data, setData] = useState<SeenBy | null>(null)
  useEffect(() => {
    let live = true
    void seenBy(pageId).then((d) => live && setData(d))
    return () => {
      live = false
    }
  }, [pageId])
  if (!data || data.latest.length + data.earlier.length + data.notYet.length === 0) return null
  const first = (list: { name: string }[]) => list.map((p) => p.name.split(' ')[0]).join(', ')
  return (
    <div className="menu-seen">
      {data.latest.length > 0 && (
        <div className="seen-row">
          <span className="seen-avs" aria-hidden="true">
            {data.latest.slice(0, 4).map((p) => (
              <Avatar key={p.id} name={p.name} ink={p.ink} />
            ))}
          </span>
          <span>Seen the latest: {first(data.latest)}</span>
        </div>
      )}
      {data.earlier.length > 0 && <div className="seen-row muted-row">Seen an earlier version: {first(data.earlier)}</div>}
      {data.notYet.length > 0 && <div className="seen-row muted-row">Not opened yet: {first(data.notYet)}</div>}
    </div>
  )
}
