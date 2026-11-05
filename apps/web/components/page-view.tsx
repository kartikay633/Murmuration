'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { ancestors, can, pageDoc, readPresenceUser, type PresenceUser, type Role } from '@murmuration/shared'
import type { DocHandle } from '@murmuration/client'
import { useConnectionStatus, useDocState, useSharedDoc, useSyncClient } from '@/lib/sync'
import { useTree, useTreeRole } from '@/lib/tree'
import { useThreads } from '@/lib/comments'
import { Avatar } from './avatar'
import { CommentLayer } from './comments'
import { HistoryView } from './history'
import { PageMenu } from './page-menu'
import { NetworkLab, useFingerprintPresence } from './network-lab'
import { Editor } from './editor'
import { Icon } from './icons'
import { SharePopover } from './share'
import { useWorkspace } from './workspace'

export function PageView({
  pageId,
  initialRole,
  overrides,
  focusThread,
  isNew = false,
}: {
  isNew?: boolean
  pageId: string
  initialRole: Role
  overrides: Record<string, Role>
  focusThread: string | null
}) {
  const { user, workspace, setNavOpen, toast } = useWorkspace()
  const tree = useTree()
  const shared = useSharedDoc(pageDoc(pageId))
  const state = useDocState(shared?.handle)
  const role = state.role ?? initialRole
  const canEdit = can(role, 'edit')
  const treeRole = useTreeRole()
  const canRename = can(treeRole ?? workspace.role, 'manage-pages')
  const node = tree.nodes.get(pageId)
  const trail = useMemo(() => ancestors(tree.nodes, pageId), [tree.nodes, pageId])
  const [editor, setEditor] = useState<TiptapEditor | null>(null)
  const onReady = useCallback((e: TiptapEditor) => setEditor(e), [])
  const { threads, refresh } = useThreads(pageId)
  const activateRef = useRef<((id: string) => void) | null>(null)
  const reanchorRef = useRef<(() => Promise<number>) | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [stacked, setStacked] = useState(false)
  const [history, setHistory] = useState<{ blame: boolean } | null>(null)
  const closeHistory = useCallback(() => setHistory(null), [])
  const [labOpen, setLabOpen] = useState(false)
  const closeLab = useCallback(() => setLabOpen(false), [])
  const client = useSyncClient()
  useFingerprintPresence(shared?.handle ?? null)

  // Coming back online: say what was merged, so the moment is visible.
  useEffect(() => {
    if (!client) return
    return client.on('event', (e) => {
      if (e.docName !== pageDoc(pageId) || e.data.kind !== 'merged') return
      const bytes = Number(e.data.bytes)
      toast(`Back online. Merged ${bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`} of edits made while you were away.`)
    })
  }, [client, pageId, toast])

  // Comments sit in a margin beside the text when there's room, and below it otherwise.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const w = e?.contentRect.width ?? 0
      // A hidden element (e.g. while history is open) measures 0; keep the last layout.
      if (w > 0) setStacked(w < 1080)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    document.title = `${node?.title || 'Untitled'} · Murmuration`
  }, [node?.title])

  return (
    <>
      <header className="topbar">
        <button className="icon-btn menu-btn" type="button" aria-label="Open navigation" onClick={(e) => (e.stopPropagation(), setNavOpen(true))}>
          <Icon name="menu" />
        </button>
        <nav className="crumbs" aria-label="Breadcrumbs">
          <span className="hide-sm">{workspace.name}</span>
          {trail.map((a) => (
            <span key={a.id} className="hide-sm" style={{ display: 'contents' }}>
              <span className="sep">/</span>
              <Link href={`/w/${workspace.id}/p/${a.id}`}>{a.title || 'Untitled'}</Link>
            </span>
          ))}
          <span className="sep hide-sm">/</span>
          <b>{node?.title || 'Untitled'}</b>
        </nav>
        <div className="spacer" />
        <SyncStatus saved={state.saved} />
        {shared && <PresenceStack handle={shared.handle} selfId={user.id} />}
        <button
          className="icon-btn"
          type="button"
          aria-pressed={history ? !history.blame : false}
          onClick={() => setHistory((h) => (h && !h.blame ? null : { blame: false }))}
          title="Page history"
          aria-label="Page history"
        >
          <Icon name="history" />
        </button>
        <PageMenu
          onBlame={() => setHistory((h) => (h?.blame ? null : { blame: true }))}
          onLab={() => setLabOpen((o) => !o)}
          onCopyLink={() => {
            void navigator.clipboard?.writeText(window.location.href.split('?')[0]!)
            toast('Link copied.')
          }}
        />
        <SharePopover pageId={pageId} overrides={overrides} />
      </header>

      <NetworkLab open={labOpen} onClose={closeLab} handle={shared?.handle ?? null} pageId={pageId} canEdit={canEdit} />
      {history && (
        <HistoryView
          key={history.blame ? 'blame' : 'history'}
          pageId={pageId}
          title={node?.title ?? ''}
          liveEditor={editor}
          canRestore={canEdit}
          initialBlame={history.blame}
          onClose={closeHistory}
          onRestored={() => setTimeout(() => void reanchorRef.current?.(), 50)}
          stacked={stacked}
        />
      )}
      <div className="scroll" ref={scrollRef} hidden={!!history}>
        <div className={`page-wrap${stacked ? ' stacked' : ''}`} ref={wrapRef}>
        <article className="page">
          <TitleField
            value={node?.title ?? ''}
            editable={canRename}
            onChange={(t) => tree.rename(pageId, t)}
            onEnter={() => editor?.commands.focus('start')}
            autoFocus={isNew}
          />
          <hr className="page-rule" />
          {!canEdit && (
            <p className="readonly-note">
              <Icon name="eye" />
              {role === 'commenter'
                ? 'You can read this page and leave comments, but not edit it.'
                : 'You can read this page but not edit it.'}
            </p>
          )}
          {state.error?.code === 'forbidden' && canEdit && (
            <p className="readonly-note">
              <Icon name="eye" /> Your access to this page has changed, so recent edits weren’t saved. Reload to see the latest version.
            </p>
          )}
          {shared?.ready ? (
            <Editor doc={shared.doc} handle={shared.handle} user={user} editable={canEdit} onReady={onReady} activateRef={activateRef} />
          ) : (
            <div className="skeleton" aria-label="Loading page">
              <i /> <i /> <i /> <i />
            </div>
          )}
        </article>
        <CommentLayer
          editor={editor}
          pageId={pageId}
          role={role}
          threads={threads}
          refresh={refresh}
          focusThread={focusThread}
          wrapRef={wrapRef}
          stacked={stacked}
          activateRef={activateRef}
          reanchorRef={reanchorRef}
        />
        </div>
      </div>
    </>
  )
}

function TitleField({
  value,
  editable,
  onChange,
  onEnter,
  autoFocus = false,
}: {
  autoFocus?: boolean
  value: string
  editable: boolean
  onChange(v: string): void
  onEnter(): void
}) {
  // While you're typing, your draft wins; others' changes show once you leave the field.
  const [draft, setDraft] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const shown = draft ?? value
  // A brand-new page: put the cursor in the title so you can type straight away.
  useEffect(() => {
    if (!autoFocus) return
    if (editable) ref.current?.focus()
    // Drop the one-time ?new=1 from the address bar.
    const url = new URL(window.location.href)
    if (url.searchParams.has('new')) {
      url.searchParams.delete('new')
      window.history.replaceState(window.history.state, '', url)
    }
  }, [autoFocus, editable])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [shown])
  return (
    <textarea
      ref={ref}
      className="title-input"
      rows={1}
      value={shown}
      placeholder="Untitled"
      readOnly={!editable}
      aria-label="Page title"
      maxLength={300}
      onChange={(e) => {
        const v = e.target.value.replace(/\n/g, ' ')
        setDraft(v)
        onChange(v)
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onEnter()
        }
      }}
    />
  )
}

/**
 * Quiet when all is well. "Saving…" only if a save takes a moment, a brief
 * "Saved" after that, and a lasting notice only when the connection is down.
 */
function SyncStatus({ saved }: { saved: boolean }) {
  const status = useConnectionStatus()
  const [slow, setSlow] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [lateConnect, setLateConnect] = useState(false)
  const wasSaving = useRef(false)

  useEffect(() => {
    if (saved) {
      if (wasSaving.current) {
        setJustSaved(true)
        const t = setTimeout(() => setJustSaved(false), 1800)
        wasSaving.current = false
        setSlow(false)
        return () => clearTimeout(t)
      }
      setSlow(false)
      return
    }
    const t = setTimeout(() => {
      setSlow(true)
      wasSaving.current = true
    }, 700)
    return () => clearTimeout(t)
  }, [saved])

  useEffect(() => {
    if (status !== 'connecting') return setLateConnect(false)
    const t = setTimeout(() => setLateConnect(true), 2500)
    return () => clearTimeout(t)
  }, [status])

  let label: string | null = null
  let tone = 'ok'
  if (status === 'offline') {
    label = saved ? 'Offline' : 'Offline · changes kept on this device'
    tone = 'warn'
  } else if (status === 'connecting') {
    label = lateConnect ? 'Connecting…' : null
    tone = 'busy'
  } else if (!saved && slow) {
    label = 'Saving…'
    tone = 'busy'
  } else if (justSaved) {
    label = 'Saved'
  }
  return (
    <span className={`status${label ? ' on' : ''}`} data-tone={tone} role="status" aria-live="polite">
      {label && <span className="dot" />}
      <span className="txt">{label}</span>
    </span>
  )
}

function PresenceStack({ handle, selfId }: { handle: DocHandle; selfId: string }) {
  const store = useMemo(() => {
    let snap: PresenceUser[] = []
    const a = handle.awareness
    const read = () => {
      const byId = new Map<string, PresenceUser>()
      a.getStates().forEach((s, clientId) => {
        const u = readPresenceUser(s.user)
        if (u && clientId !== a.clientID && u.id !== selfId) byId.set(u.id, u)
      })
      snap = [...byId.values()]
    }
    read()
    return {
      sub: (cb: () => void) => {
        const h = () => (read(), cb())
        a.on('change', h)
        return () => a.off('change', h)
      },
      get: () => snap,
    }
  }, [handle, selfId])
  const people = useSyncExternalStore(store.sub, store.get, store.get)
  if (!people.length) return null
  return (
    <div className="stack" aria-label={`Also here: ${people.map((p) => p.name).join(', ')}`}>
      {people.slice(0, 4).map((p) => (
        <span className="p" key={p.id} title={`${p.name} is here`}>
          <Avatar name={p.name} ink={p.ink} size="lg" />
        </span>
      ))}
      {people.length > 4 && <span className="more">+{people.length - 4}</span>}
    </div>
  )
}
