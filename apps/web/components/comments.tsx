'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { can, type Role } from '@murmuration/shared'
import {
  createThread,
  deleteComment,
  markThreadRead,
  moveThreadAnchor,
  replyToThread,
  setThreadResolved,
  type ThreadView,
} from '@/app/comment-actions'
import { anchorFor, anchorRanges, findQuote, setAnchors, type Anchor } from '@/lib/comment-anchors'
import { splitMentions, timeAgo } from '@/lib/comments'
import { Avatar } from './avatar'
import { Icon } from './icons'
import { MentionInput } from './mention-input'
import { useWorkspace } from './workspace'

interface Draft {
  start: string
  end: string
  quote: string
}

const GAP = 12

export function CommentLayer({
  editor,
  pageId,
  role,
  threads,
  refresh,
  focusThread,
  wrapRef,
  stacked,
  activateRef,
  reanchorRef,
}: {
  activateRef: React.RefObject<((id: string) => void) | null>
  reanchorRef: React.RefObject<(() => Promise<number>) | null>
  editor: Editor | null
  pageId: string
  role: Role
  threads: ThreadView[] | null
  refresh(): Promise<void>
  focusThread: string | null
  wrapRef: React.RefObject<HTMLDivElement | null>
  stacked: boolean
}) {
  const { toast, user, role: wsRole } = useWorkspace()
  const canComment = can(role, 'comment')
  const isAdmin = can(wsRole, 'manage-members')
  const [active, setActive] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const railRef = useRef<HTMLDivElement>(null)
  const [, bump] = useState(0)

  const visible = useMemo(
    () => (threads ?? []).filter((t) => showResolved || !t.resolvedAt || t.id === active),
    [threads, showResolved, active],
  )
  const resolvedCount = (threads ?? []).filter((t) => t.resolvedAt).length

  // Keep the editor's highlights in step with the threads on screen.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const anchors: Anchor[] = visible.map((t) => ({ id: t.id, start: t.anchorStart, end: t.anchorEnd }))
    if (draft) anchors.push({ id: 'draft', start: draft.start, end: draft.end })
    editor.view.dispatch(setAnchors(editor.state.tr, anchors, draft ? 'draft' : active))
  }, [editor, visible, draft, active])

  const activate = useCallback((id: string | null) => {
    setActive(id)
    if (id) void markThreadRead(id)
  }, [])

  // Clicking highlighted text in the editor opens its thread.
  useEffect(() => {
    activateRef.current = activate
    return () => {
      activateRef.current = null
    }
  }, [activate, activateRef])

  // After a version restore the text exists again but as new characters; re-pin
  // any detached thread to the first place its quote now appears.
  const reanchor = useCallback(async () => {
    if (!editor || !threads) return 0
    const ranges = anchorRanges(editor.state)
    let moved = 0
    for (const t of threads) {
      if (ranges.has(t.id)) continue
      const hit = findQuote(editor.state, t.quote)
      const anchor = hit && anchorFor(editor.state, hit.from, hit.to)
      if (anchor && !(await moveThreadAnchor(t.id, anchor.start, anchor.end)).error) moved++
    }
    if (moved) await refresh()
    return moved
  }, [editor, threads, refresh])
  useEffect(() => {
    reanchorRef.current = reanchor
    return () => {
      reanchorRef.current = null
    }
  }, [reanchor, reanchorRef])

  // Arriving from the inbox: open that thread and bring its text into view.
  const focused = useRef<string | null>(null)
  useEffect(() => {
    if (!focusThread || !editor || !threads || focused.current === focusThread) return
    const t = threads.find((x) => x.id === focusThread)
    if (!t) return
    focused.current = focusThread
    if (t.resolvedAt) setShowResolved(true)
    activate(focusThread)
    requestAnimationFrame(() => {
      const r = anchorRanges(editor.state).get(focusThread)
      if (r) {
        const dom = editor.view.domAtPos(r.from).node as HTMLElement
        ;(dom.nodeType === 1 ? dom : dom.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    })
  }, [focusThread, editor, threads, activate])

  /* ---------- placing cards beside their text ---------- */

  const layout = useCallback(() => {
    const rail = railRef.current
    if (!rail || !editor || editor.isDestroyed) return
    const cards = [...rail.querySelectorAll<HTMLElement>('[data-card]')]
    if (stacked) {
      cards.forEach((c) => (c.style.top = ''))
      return
    }
    const ranges = anchorRanges(editor.state)
    const base = rail.getBoundingClientRect().top
    const placed: { el: HTMLElement; want: number; id: string }[] = []
    const detached: HTMLElement[] = []
    for (const el of cards) {
      const id = el.dataset.card!
      const r = ranges.get(id)
      if (!r) {
        detached.push(el)
        continue
      }
      let want = 0
      try {
        want = editor.view.coordsAtPos(r.from).top - base - 4
      } catch {
        detached.push(el)
        continue
      }
      placed.push({ el, want, id })
    }
    placed.sort((a, b) => a.want - b.want)
    const tops = new Array<number>(placed.length)
    const focusId = draft ? 'draft' : active
    const pivot = Math.max(0, placed.findIndex((p) => p.id === focusId))
    // The focused card sits exactly beside its text; others move out of its way.
    if (placed.length) {
      tops[pivot] = Math.max(0, placed[pivot]!.want)
      for (let i = pivot + 1; i < placed.length; i++) {
        tops[i] = Math.max(placed[i]!.want, tops[i - 1]! + placed[i - 1]!.el.offsetHeight + GAP)
      }
      for (let i = pivot - 1; i >= 0; i--) {
        tops[i] = Math.min(placed[i]!.want, tops[i + 1]! - placed[i]!.el.offsetHeight - GAP)
      }
      const shift = Math.min(0, tops[0]!)
      placed.forEach((p, i) => (p.el.style.top = `${tops[i]! - shift}px`))
    }
    let y = placed.length ? Math.max(...placed.map((p, i) => tops[i]! + p.el.offsetHeight)) + GAP * 2 : 0
    for (const el of detached) {
      el.style.top = `${y}px`
      y += el.offsetHeight + GAP
    }
    rail.style.minHeight = `${y}px`
  }, [editor, stacked, active, draft])

  useLayoutEffect(layout)
  useEffect(() => {
    if (!editor) return
    let raf = 0
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(layout)
    }
    editor.on('transaction', schedule)
    const ro = new ResizeObserver(schedule)
    if (wrapRef.current) ro.observe(wrapRef.current)
    if (railRef.current) ro.observe(railRef.current)
    return () => {
      cancelAnimationFrame(raf)
      editor.off('transaction', schedule)
      ro.disconnect()
    }
  }, [editor, layout, wrapRef])

  /* ---------- starting a comment from a selection ---------- */

  const [bubble, setBubble] = useState<{ top: number; left: number; from: number; to: number } | null>(null)

  useEffect(() => {
    if (!editor || !canComment) return
    const onSel = () => {
      const sel = window.getSelection()
      const wrap = wrapRef.current
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !wrap) return setBubble(null)
      const range = sel.getRangeAt(0)
      if (!editor.view.dom.contains(range.commonAncestorContainer)) return setBubble(null)
      let from: number, to: number
      try {
        from = editor.view.posAtDOM(range.startContainer, range.startOffset)
        to = editor.view.posAtDOM(range.endContainer, range.endOffset)
      } catch {
        return setBubble(null)
      }
      if (to <= from || !editor.state.doc.textBetween(from, to, ' ').trim()) return setBubble(null)
      const rect = range.getBoundingClientRect()
      const w = wrap.getBoundingClientRect()
      setBubble({ top: rect.top - w.top - 42, left: Math.max(8, rect.left - w.left + rect.width / 2 - 52), from, to })
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [editor, canComment, wrapRef])

  const startDraft = useCallback(
    (from: number, to: number) => {
      if (!editor) return
      const anchor = anchorFor(editor.state, from, to)
      if (!anchor) return toast('The page is still loading. Try again in a moment.')
      setDraft({ ...anchor, quote: editor.state.doc.textBetween(from, to, ' ').slice(0, 500) })
      setActive(null)
      setBubble(null)
      window.getSelection()?.removeAllRanges()
    },
    [editor, toast],
  )

  // Ctrl/Cmd + Alt + M comments on the current selection.
  useEffect(() => {
    if (!canComment) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'm' && bubble) {
        e.preventDefault()
        startDraft(bubble.from, bubble.to)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [bubble, canComment, startDraft])

  /* ---------- actions ---------- */

  const submitDraft = async (body: string) => {
    if (!draft) return false
    const res = await createThread(pageId, draft, body)
    if (res.error !== undefined) {
      toast(res.error)
      return false
    }
    setDraft(null)
    await refresh()
    activate(res.threadId)
    return true
  }

  const reply = async (threadId: string, body: string) => {
    const res = await replyToThread(threadId, body)
    if (res.error) {
      toast(res.error)
      return false
    }
    await refresh()
    return true
  }

  const resolve = async (t: ThreadView, resolved: boolean) => {
    const res = await setThreadResolved(t.id, resolved)
    if (res.error) return toast(res.error)
    if (resolved && active === t.id) setActive(null)
    await refresh()
    toast(resolved ? 'Resolved. Find it again under “Show resolved”.' : 'Reopened.')
  }

  const remove = async (commentId: string, isFirst: boolean) => {
    const res = await deleteComment(commentId)
    if (res.error) return toast(res.error)
    await refresh()
    toast(isFirst ? 'Thread deleted.' : 'Comment deleted.')
  }

  useEffect(() => bump((n) => n + 1), [threads])
  const ranges = editor ? anchorRanges(editor.state) : new Map()

  return (
    <>
      {bubble && !draft && (
        <button
          className="comment-bubble"
          type="button"
          style={{ top: bubble.top, left: bubble.left }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => startDraft(bubble.from, bubble.to)}
        >
          <Icon name="comment" /> Comment <kbd>Ctrl Alt M</kbd>
        </button>
      )}
      <aside className="rail" aria-label="Comments" ref={railRef} onClick={() => setActive(null)}>
        {stacked && (visible.length > 0 || draft) && <div className="eyebrow rail-title">Comments</div>}
        {draft && (
          <section className="card active" data-card="draft">
            <p className="card-quote">“{draft.quote}”</p>
            <MentionInput placeholder="Add a comment…" autoFocus onSubmit={submitDraft} onCancel={() => setDraft(null)} />
          </section>
        )}
        {visible.map((t) => (
          <ThreadCard
            key={t.id}
            thread={t}
            active={active === t.id}
            detached={!!editor && !ranges.has(t.id)}
            canComment={canComment}
            canDelete={(authorId) => isAdmin || authorId === user.id}
            onActivate={() => activate(t.id)}
            onReply={(b) => reply(t.id, b)}
            onResolve={(r) => resolve(t, r)}
            onDelete={remove}
          />
        ))}
        {threads && threads.length === 0 && !draft && canComment && !stacked && (
          <p className="rail-hint">Select text to leave a comment.</p>
        )}
        {resolvedCount > 0 && (
          <button className="rail-toggle" type="button" onClick={(e) => (e.stopPropagation(), setShowResolved((s) => !s))}>
            {showResolved ? 'Hide resolved' : `Show resolved (${resolvedCount})`}
          </button>
        )}
      </aside>
    </>
  )
}

function ThreadCard({
  thread,
  active,
  detached,
  canComment,
  canDelete,
  onActivate,
  onReply,
  onResolve,
  onDelete,
}: {
  thread: ThreadView
  active: boolean
  detached: boolean
  canComment: boolean
  canDelete(authorId: string | null): boolean
  onActivate(): void
  onReply(body: string): Promise<boolean>
  onResolve(resolved: boolean): void
  onDelete(commentId: string, isFirst: boolean): void
}) {
  const shown = active ? thread.comments : thread.comments.slice(0, 1)
  const more = thread.comments.length - shown.length
  return (
    <section
      className={`card${active ? ' active' : ''}${thread.resolvedAt ? ' resolved' : ''}`}
      data-card={thread.id}
      onClick={(e) => {
        e.stopPropagation()
        if (!active) onActivate()
      }}
    >
      {detached && (
        <p className="card-quote detached">
          The text this was on has been deleted. It said “{thread.quote}”.
        </p>
      )}
      {canComment && !thread.resolvedAt && (
        <button
          className="icon-btn sm card-resolve"
          type="button"
          title="Resolve"
          aria-label="Resolve thread"
          onClick={(e) => (e.stopPropagation(), onResolve(true))}
        >
          <Icon name="check" size={14} />
        </button>
      )}
      {shown.map((c, i) => (
        <div className="c" key={c.id}>
          <div className="c-head">
            <Avatar name={c.authorName} ink={c.authorInk} />
            <span className="c-name">{c.authorName.split(' ')[0]}</span>
            <time className="c-time" dateTime={c.createdAt} title={new Date(c.createdAt).toLocaleString()}>
              {timeAgo(c.createdAt)}
            </time>
            {active && canDelete(c.authorId) && (
              <button
                className="icon-btn sm c-del"
                type="button"
                title={i === 0 ? 'Delete thread' : 'Delete comment'}
                aria-label={i === 0 ? 'Delete thread' : 'Delete comment'}
                onClick={(e) => (e.stopPropagation(), onDelete(c.id, i === 0))}
              >
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
          <Body text={c.body} />
        </div>
      ))}
      {more > 0 && <p className="card-more">{more === 1 ? '1 reply' : `${more} replies`}</p>}
      {thread.resolvedAt && (
        <p className="card-resolved">
          Resolved{thread.resolvedBy ? ` by ${thread.resolvedBy.split(' ')[0]}` : ''}
          {canComment && (
            <button type="button" className="link-btn" onClick={(e) => (e.stopPropagation(), onResolve(false))}>
              Reopen
            </button>
          )}
        </p>
      )}
      {active && canComment && <MentionInput placeholder="Reply…" submitLabel="Reply" autoFocus={false} onSubmit={onReply} />}
    </section>
  )
}

function Body({ text }: { text: string }) {
  const { members, user } = useWorkspace()
  const names = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members])
  return (
    <p className="c-body">
      {splitMentions(text).map((p, i) =>
        p.mention ? (
          <span key={i} className={`mention${p.mention === user.id ? ' me' : ''}`}>
            @{names.get(p.mention)?.split(' ')[0] ?? 'someone'}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  )
}
