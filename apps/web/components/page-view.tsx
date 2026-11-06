'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { ancestors, can, pageDoc, readPresenceUser, type PresenceUser, type Role } from '@murmuration/shared'
import type { DocHandle } from '@murmuration/client'
import { useConnectionStatus, useDocState, useSharedDoc, useSyncClient } from '@/lib/sync'
import { useTree, useTreeRole } from '@/lib/tree'
import { useThreads } from '@/lib/comments'
import { useFavorites } from '@/lib/favorites'
import { Avatar } from './avatar'
import { Backlinks, Subpages } from './backlinks'
import { CatchUpBanner } from './catch-up-banner'
import { FollowPill, useFollow } from './follow'
import { CommentLayer } from './comments'
import { HistoryView } from './history'
import { PageMenu } from './page-menu'
import { NetworkLab, useFingerprintPresence } from './network-lab'
import { Editor } from './editor'
import { Icon } from './icons'
import { SharePopover } from './share'
import { TableBar } from './table-bar'
import { TemplatePicker } from './template-picker'
import { useWorkspace } from './workspace'

export function PageView({
  pageId,
  initialRole,
  overrides,
  focusThread,
  isNew = false,
  follow = null,
  template = null,
}: {
  /** Fill the new page from this template once it loads. */
  template?: string | null
  isNew?: boolean
  /** Start out following this person (they moved here while we followed them). */
  follow?: string | null
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
  // Enter in the title before the editor has loaded: move into the body as soon as it's ready.
  const wantsBody = useRef(false)
  const onReady = useCallback((e: TiptapEditor) => {
    setEditor(e)
    if (wantsBody.current) {
      wantsBody.current = false
      e.commands.focus('start')
    }
  }, [])
  const focusBody = useCallback(() => {
    if (editor) editor.commands.focus('start')
    else wantsBody.current = true
  }, [editor])
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
  const favs = useFavorites(workspace.id)
  const router = useRouter()
  // Page links inside the editor navigate in place.
  useEffect(() => {
    const go = (e: Event) => router.push((e as CustomEvent<string>).detail)
    window.addEventListener('mm:navigate', go)
    return () => window.removeEventListener('mm:navigate', go)
  }, [router])
  const rename = useCallback((t: string) => tree.rename(pageId, t), [tree, pageId])
  const followMode = useFollow({ pageId, editor, handle: shared?.handle ?? null, scrollEl: scrollRef, initial: follow })

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

  // The live title wins over the one rendered on the server (which may be stale,
  // e.g. a page created empty and then filled from a template).
  useEffect(() => {
    const want = `${node?.title || 'Untitled'} · Murmuration`
    const apply = () => {
      if (document.title !== want) document.title = want
    }
    apply()
    const mo = new MutationObserver(apply)
    mo.observe(document.head, { subtree: true, childList: true, characterData: true })
    return () => mo.disconnect()
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
        {shared && <PresenceStack handle={shared.handle} selfId={user.id} following={followMode.following} onFollow={followMode.start} />}
        <button
          className="icon-btn star-btn"
          type="button"
          aria-pressed={favs.has(pageId)}
          onClick={() => void favs.toggle(pageId).then((ok) => !ok && toast('Could not update favorites.'))}
          title={favs.has(pageId) ? 'Remove from favorites' : 'Add to favorites'}
          aria-label={favs.has(pageId) ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Icon name="star" />
        </button>
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
          pageId={pageId}
          title={node?.title ?? ''}
          editor={editor}
          doc={shared?.doc ?? null}
          canDuplicate={canRename}
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
          canName={can(role, 'comment')}
          canRestore={canEdit}
          initialBlame={history.blame}
          onClose={closeHistory}
          onRestored={() => setTimeout(() => void reanchorRef.current?.(), 50)}
          stacked={stacked}
        />
      )}
      <FollowPill person={followMode.following ? followMode.person : undefined} onStop={followMode.stop} />
      <div
        className={`scroll${followMode.following ? ' following' : ''}`}
        ref={scrollRef}
        hidden={!!history}
        style={followMode.person ? ({ '--c': `var(--ink-${followMode.person.ink})` } as React.CSSProperties) : undefined}
      >
        <div className={`page-wrap${stacked ? ' stacked' : ''}`} ref={wrapRef}>
        <article className="page">
          <CatchUpBanner pageId={pageId} editor={editor} ready={state.synced} />
          <TitleField
            value={node?.title ?? ''}
            editable={canRename}
            onChange={(t) => tree.rename(pageId, t)}
            onEnter={focusBody}
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
            <>
              <Editor doc={shared.doc} handle={shared.handle} user={user} editable={canEdit} onReady={onReady} activateRef={activateRef} pageId={pageId} />
              <TemplatePicker
                editor={editor}
                ready={state.synced}
                canEdit={canEdit && !(tree.children.get(pageId)?.length)}
                title={node?.title ?? ''}
                rename={rename}
                requested={template}
              />
              <Subpages pageId={pageId} />
              <Backlinks pageId={pageId} />
            </>
          ) : (
            <div className="skeleton" aria-label="Loading page">
              <i /> <i /> <i /> <i />
            </div>
          )}
        </article>
        <TableBar editor={editor} wrapRef={wrapRef} />
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
  // Fit the box to its text, and again whenever its width changes (first layout, rotation,
  // sidebar toggles); a measurement taken before layout settles can be far too tall.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let lastWidth = -1
    const fit = () => {
      if (!el.clientWidth) return
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
    fit()
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e?.contentRect.width ?? 0)
      if (w !== lastWidth) {
        lastWidth = w
        fit()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
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

function PresenceStack({
  handle,
  selfId,
  following,
  onFollow,
}: {
  handle: DocHandle
  selfId: string
  following: string | null
  onFollow(id: string): void
}) {
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
        <button
          type="button"
          className={`p${following === p.id ? ' on' : ''}`}
          key={p.id}
          style={{ '--c': `var(--ink-${p.ink})` } as React.CSSProperties}
          title={following === p.id ? `Stop following ${p.name}` : `Follow ${p.name}`}
          aria-label={following === p.id ? `Stop following ${p.name}` : `Follow ${p.name}`}
          aria-pressed={following === p.id}
          onClick={() => onFollow(p.id)}
        >
          <Avatar name={p.name} ink={p.ink} size="lg" />
        </button>
      ))}
      {people.length > 4 && <span className="more">+{people.length - 4}</span>}
    </div>
  )
}
