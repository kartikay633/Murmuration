'use client'

import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { useUnread } from '@/lib/comments'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from 'react'
import { ancestors, can, presenceUser, readPresenceUser, type PresenceUser, type TreeNode } from '@murmuration/shared'
import { archivePage, createPage, createWorkspace, logout } from '@/app/actions'
import { clearLocalDocs } from '@/lib/sync'
import { useTree, useTreeRole } from '@/lib/tree'
import { Avatar } from './avatar'
import { Icon, Mark } from './icons'
import { useDismiss } from './menu'
import { ThemeToggle } from './theme'
import { useWorkspace } from './workspace'



/** Who is on which page, from presence on the tree document. */
function usePagePresence(): Map<string, PresenceUser[]> {
  const { shared } = useTree()
  const { user } = useWorkspace()
  const params = useParams<{ pageId?: string }>()
  const pageId = params.pageId ?? null

  // Publish where we are.
  useEffect(() => {
    if (!shared) return
    shared.handle.awareness.setLocalState({ user: presenceUser(user), page: pageId })
  }, [shared, pageId, user])
  useEffect(() => {
    if (!shared) return
    const a = shared.handle.awareness
    return () => a.setLocalState(null)
  }, [shared])

  const store = useMemo(() => {
    let snap = new Map<string, PresenceUser[]>()
    if (!shared) return { sub: () => () => {}, get: () => snap }
    const a = shared.handle.awareness
    const read = () => {
      const next = new Map<string, PresenceUser[]>()
      const seen = new Set<string>()
      a.getStates().forEach((s, clientId) => {
        const u = readPresenceUser(s.user)
        const page = typeof s.page === 'string' ? s.page : null
        if (!u || !page || clientId === a.clientID || u.id === user.id) return
        const key = `${u.id}:${page}`
        if (seen.has(key)) return
        seen.add(key)
        next.set(page, [...(next.get(page) ?? []), u])
      })
      snap = next
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
  }, [shared, user.id])
  return useSyncExternalStore(store.sub, store.get, store.get)
}

function useExpanded(workspaceId: string) {
  const key = `mm-expanded:${workspaceId}`
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    try {
      setOpen(new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]))
    } catch {}
  }, [key])
  const update = useCallback(
    (fn: (s: Set<string>) => void) =>
      setOpen((prev) => {
        const next = new Set(prev)
        fn(next)
        try {
          localStorage.setItem(key, JSON.stringify([...next]))
        } catch {}
        return next
      }),
    [key],
  )
  return [open, update] as const
}

export function Sidebar() {
  const { workspace, user, setNavOpen, toast } = useWorkspace()
  const tree = useTree()
  const treeRole = useTreeRole() ?? workspace.role
  const canManage = can(treeRole, 'manage-pages')
  const router = useRouter()
  const params = useParams<{ pageId?: string }>()
  const activeId = params.pageId ?? null
  const presence = usePagePresence()
  const [expanded, updateExpanded] = useExpanded(workspace.id)
  const [, startTransition] = useTransition()
  const pathname = usePathname()
  const unread = useUnread(workspace.id, [pathname])

  // Keep the open page visible in the tree.
  useEffect(() => {
    if (!activeId) return
    const chain = ancestors(tree.nodes, activeId)
    if (chain.some((n) => !expanded.has(n.id))) updateExpanded((s) => chain.forEach((n) => s.add(n.id)))
  }, [activeId, tree.nodes, expanded, updateExpanded])

  const newPage = (parentId: string | null) =>
    startTransition(async () => {
      const res = await createPage(workspace.id)
      if (!res.id) return toast(res.error ?? 'Could not create a page.')
      tree.add({ id: res.id, title: '', parentId, createdBy: user.id })
      if (parentId) updateExpanded((s) => s.add(parentId))
      setNavOpen(false)
      router.push(`/w/${workspace.id}/p/${res.id}`)
    })

  const archive = (node: TreeNode) =>
    startTransition(async () => {
      const res = await archivePage(node.id)
      if (res.error) return toast(res.error)
      tree.archive(node.id)
      toast(`Archived “${node.title || 'Untitled'}”.`)
      const inside = activeId && (activeId === node.id || ancestors(tree.nodes, activeId).some((a) => a.id === node.id))
      if (inside) router.push(`/w/${workspace.id}`)
    })

  const roots = tree.children.get(null) ?? []
  const loading = !tree.shared?.ready

  return (
    <aside className="sidebar" aria-label="Workspace navigation">
      <WorkspaceSwitcher />
      <nav className="nav">
        <Link
          href={`/w/${workspace.id}/inbox`}
          className={`item${pathname.endsWith('/inbox') ? ' active' : ''}`}
          style={{ paddingLeft: 8, gap: 8 }}
          onClick={() => setNavOpen(false)}
        >
          <Icon name="inbox" />
          <span className="label">Inbox</span>
          {unread > 0 && <span className="badge" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}
        </Link>
        <div className="nav-label">
          Pages
          {canManage && (
            <button className="icon-btn sm" type="button" aria-label="New page" title="New page" onClick={() => newPage(null)}>
              <Icon name="plus" />
            </button>
          )}
        </div>
        {loading ? (
          <div className="skeleton" style={{ padding: '4px 8px' }}>
            <i /> <i /> <i />
          </div>
        ) : roots.length === 0 ? (
          <p className="empty-tree">No pages yet.{canManage ? ' Use + to start one.' : ''}</p>
        ) : (
          <ul role="tree" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {roots.map((n) => (
              <TreeItem
                key={n.id}
                node={n}
                depth={0}
                activeId={activeId}
                expanded={expanded}
                toggle={(id) => updateExpanded((s) => (s.has(id) ? s.delete(id) : s.add(id)))}
                presence={presence}
                canManage={canManage}
                onNew={newPage}
                onArchive={archive}
              />
            ))}
          </ul>
        )}
      </nav>
      <div className="side-foot">
        <Avatar name={user.name} ink={user.ink} size="lg" />
        <span className="grow">
          <span className="who">{user.name}</span>
          <br />
          <span className="role">{workspace.role}</span>
        </span>
        <ThemeToggle />
        <form
          action={async () => {
            await clearLocalDocs()
            await logout()
          }}
        >
          <button className="icon-btn" type="submit" aria-label="Sign out" title="Sign out">
            <Icon name="logout" />
          </button>
        </form>
      </div>
    </aside>
  )
}

function TreeItem(props: {
  node: TreeNode
  depth: number
  activeId: string | null
  expanded: Set<string>
  toggle(id: string): void
  presence: Map<string, PresenceUser[]>
  canManage: boolean
  onNew(parentId: string): void
  onArchive(node: TreeNode): void
}) {
  const { node, depth, activeId, expanded, toggle, presence, canManage, onNew, onArchive } = props
  const { workspace, setNavOpen } = useWorkspace()
  const tree = useTree()
  const kids = tree.children.get(node.id) ?? []
  const isOpen = expanded.has(node.id)
  const [menu, setMenu] = useState(false)
  const close = useCallback(() => setMenu(false), [])
  const menuRef = useDismiss(menu, close)
  const here = presence.get(node.id) ?? []

  return (
    <li role="treeitem" aria-expanded={kids.length ? isOpen : undefined} aria-selected={activeId === node.id}>
      <div
        className={`item${activeId === node.id ? ' active' : ''}${menu ? ' menu-open' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        ref={menuRef}
      >
        <button
          type="button"
          className={`tw${isOpen ? ' open' : ''}${kids.length ? '' : ' leaf'}`}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          tabIndex={kids.length ? 0 : -1}
          onClick={() => toggle(node.id)}
        >
          {kids.length > 0 && <Icon name="chev" size={12} />}
        </button>
        <Link
          href={`/w/${workspace.id}/p/${node.id}`}
          className={`label${node.title ? '' : ' untitled'}`}
          onClick={() => setNavOpen(false)}
          aria-current={activeId === node.id ? 'page' : undefined}
        >
          {node.title || 'Untitled'}
        </Link>
        {here.length > 0 && (
          <span className="here" aria-label={`${here.map((u) => u.name).join(', ')} here`} title={here.map((u) => u.name).join(', ')}>
            {here.slice(0, 3).map((u) => (
              <i key={u.id} style={{ '--c': `var(--ink-${u.ink})` } as React.CSSProperties} />
            ))}
          </span>
        )}
        {canManage && (
          <span className="acts">
            <button className="icon-btn" type="button" aria-label="Add a page inside" title="Add a page inside" onClick={() => onNew(node.id)}>
              <Icon name="plus" size={14} />
            </button>
            <button className="icon-btn" type="button" aria-label="More" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <Icon name="more" size={14} />
            </button>
          </span>
        )}
        {menu && (
          <div className="menu" role="menu" style={{ top: 30, right: 0 }}>
            <button className="menu-item" role="menuitem" type="button" onClick={() => (close(), onNew(node.id))}>
              <Icon name="plus" /> Add a page inside
            </button>
            <div className="menu-sep" />
            <button className="menu-item danger" role="menuitem" type="button" onClick={() => (close(), onArchive(node))}>
              <Icon name="archive" /> Archive
            </button>
          </div>
        )}
      </div>
      {isOpen && kids.length > 0 && (
        <ul role="group" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {kids.map((k) => (
            <TreeItem key={k.id} {...props} node={k} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

function WorkspaceSwitcher() {
  const { workspace, workspaces, members } = useWorkspace()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const close = useCallback(() => {
    setOpen(false)
    setCreating(false)
    setError(null)
  }, [])
  const ref = useDismiss(open, close)

  return (
    <div className="ws-switch" ref={ref}>
      <button className="ws-btn" type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Mark />
        <span style={{ minWidth: 0 }}>
          <span className="ws-name">{workspace.name}</span>
          <span className="ws-sub">
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </span>
        </span>
        <Icon name="chev" className="chev" />
      </button>
      {open && (
        <div className="menu" role="menu" style={{ left: 0, right: 0, top: 46 }}>
          <div className="eyebrow" style={{ padding: '6px 9px 6px' }}>Workspaces</div>
          {workspaces.map((w) => (
            <Link key={w.id} href={`/w/${w.id}`} className="menu-item" role="menuitem" onClick={close}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
              {w.id === workspace.id && <Icon name="check" className="check" />}
            </Link>
          ))}
          <div className="menu-sep" />
          {creating ? (
            <form
              className="menu-form"
              onSubmit={(e) => {
                e.preventDefault()
                startTransition(async () => {
                  const res = await createWorkspace(name)
                  if (res.error || !res.id) return setError(res.error ?? 'Something went wrong.')
                  close()
                  setName('')
                  router.push(`/w/${res.id}`)
                })
              }}
            >
              <input
                className="input sm"
                autoFocus
                placeholder="Workspace name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
              {error && <span className="error-text">{error}</span>}
              <button className="btn primary" type="submit" disabled={pending || !name.trim()}>
                Create workspace
              </button>
            </form>
          ) : (
            <button className="menu-item" role="menuitem" type="button" onClick={() => setCreating(true)}>
              <Icon name="plus" /> New workspace
            </button>
          )}
        </div>
      )}
    </div>
  )
}
