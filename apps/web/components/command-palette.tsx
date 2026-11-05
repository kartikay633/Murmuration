'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isInTrash } from '@murmuration/shared'
import { recentPages } from '@/app/favorite-actions'
import { searchPages, type SearchHit } from '@/app/search-actions'
import { TEMPLATES } from '@/lib/templates'
import { useTree } from '@/lib/tree'
import { Icon, type IconName } from './icons'
import { currentTheme, setTheme } from './theme'
import { useWorkspace } from './workspace'

interface Row {
  key: string
  icon: IconName
  label: string
  path?: string
  snippet?: string
  hint?: string
  run(): void
}

/** "⌘" on Apple devices, "Ctrl " elsewhere (decided after hydration). */
export function useModKey() {
  const [mod, setMod] = useState('Ctrl ')
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setMod('⌘')
  }, [])
  return mod
}

/** Ask the palette to open from anywhere (e.g. the sidebar's Search button). */
export const openPalette = () => window.dispatchEvent(new Event('mm:palette'))

/** Render "…a \u0001match\u0002 here…" with the matches marked, without innerHTML. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/)
  return (
    <span className="pal-snippet">
      {parts.map((p, i) =>
        p.startsWith('\u0001') ? <mark key={i}>{p.slice(1, -1)}</mark> : <Fragment key={i}>{p}</Fragment>,
      )}
    </span>
  )
}

export function CommandPalette() {
  const { workspace, workspaces, setNavOpen } = useWorkspace()
  const tree = useTree()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const openRef = useRef(false)
  openRef.current = open

  const close = useCallback(() => {
    setOpen(false)
    returnFocus.current?.focus?.()
  }, [])

  // Ctrl/Cmd+K or Ctrl/Cmd+P from anywhere. (Over selected text in the editor,
  // Ctrl/Cmd+K adds a link instead; that handler runs first and stops this one.)
  useEffect(() => {
    const show = () => {
      returnFocus.current = document.activeElement as HTMLElement | null
      setQuery('')
      setHits(null)
      setIndex(0)
      setOpen(true)
    }
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (k === 'k' || k === 'p')) {
        e.preventDefault()
        if (openRef.current) setOpen(false)
        else show()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mm:palette', show)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mm:palette', show)
    }
  }, [])

  // Search as you type, newest answer wins. With no query: pages you opened
  // recently, or (before you've opened any) the most recently edited.
  useEffect(() => {
    if (!open) return
    let stale = false
    const t = setTimeout(
      () => {
        const load = query.trim()
          ? searchPages(workspace.id, query)
          : recentPages(workspace.id).then((ids) =>
              ids.length
                ? ids.map((id) => ({ id, title: '', snippet: '', updatedAt: '' }))
                : searchPages(workspace.id, ''),
            )
        load.then((r) => !stale && setHits(r)).catch(() => !stale && setHits([]))
      },
      query ? 120 : 0,
    )
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [open, query, workspace.id])

  const go = useCallback(
    (href: string) => {
      setOpen(false)
      setNavOpen(false)
      router.push(href)
    },
    [router, setNavOpen],
  )

  const pathOf = useCallback(
    (id: string) => {
      const names: string[] = []
      let n = tree.nodes.get(id)
      while (n?.parentId) {
        n = tree.nodes.get(n.parentId)
        if (n) names.unshift(n.title || 'Untitled')
      }
      return names.join(' / ')
    },
    [tree.nodes],
  )

  const rows = useMemo(() => {
    if (!open) return { pageRows: [], actions: [], all: [] }
    const q = query.trim().toLowerCase()
    const pageRows: Row[] = (hits ?? [])
      .filter((h) => !isInTrash(tree.nodes, h.id))
      .map((h) => ({
        key: `p:${h.id}`,
        icon: 'page' as const,
        // The tree has the live title; the index may be a moment behind.
        label: tree.nodes.get(h.id)?.title || h.title || 'Untitled',
        path: pathOf(h.id),
        snippet: h.snippet,
        run: () => go(`/w/${workspace.id}/p/${h.id}`),
      }))
    const dark = currentTheme() === 'dark'
    const actions: Row[] = [
      { key: 'a:new', icon: 'plus' as const, label: 'New page', run: () => (setOpen(false), window.dispatchEvent(new Event('mm:new-page'))) },
      ...TEMPLATES.map((t) => ({
        key: `t:${t.id}`,
        icon: 'page' as const,
        label: `New ${t.name.toLowerCase()} page`,
        run: () => (setOpen(false), window.dispatchEvent(new CustomEvent('mm:new-page', { detail: { template: t.id } }))),
      })),
      { key: 'a:inbox', icon: 'inbox' as const, label: 'Open inbox', run: () => go(`/w/${workspace.id}/inbox`) },
      {
        key: 'a:theme',
        icon: (dark ? 'sun' : 'moon') as IconName,
        label: dark ? 'Switch to light theme' : 'Switch to dark theme',
        run: () => (setTheme(dark ? 'light' : 'dark'), close()),
      },
      ...workspaces
        .filter((w) => w.id !== workspace.id)
        .map((w) => ({ key: `w:${w.id}`, icon: 'layers' as const, label: `Switch to ${w.name}`, run: () => go(`/w/${w.id}`) })),
    ]
      // Template shortcuts appear once you type, so the empty palette stays short.
      .filter((a) => (q ? a.label.toLowerCase().includes(q) : !a.key.startsWith('t:')))
    return { pageRows, actions, all: [...pageRows, ...actions] }
  }, [open, hits, query, tree.nodes, pathOf, go, workspace.id, workspaces, close])

  useEffect(() => setIndex(0), [query])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = rows.all.length
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown' && n) {
      e.preventDefault()
      setIndex((i) => (i + 1) % n)
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault()
      setIndex((i) => (i - 1 + n) % n)
    } else if (e.key === 'Enter' && n) {
      e.preventDefault()
      rows.all[Math.min(index, n - 1)]!.run()
    }
  }

  const renderRow = (r: Row, i: number) => (
    <button
      key={r.key}
      type="button"
      role="option"
      id={`pal-${i}`}
      aria-selected={i === index}
      className="pal-row"
      onMouseMove={() => i !== index && setIndex(i)}
      onClick={r.run}
    >
      <Icon name={r.icon} />
      <span className="pal-main">
        <span className="pal-label">
          {r.label}
          {r.path && <span className="pal-path">{r.path}</span>}
        </span>
        {r.snippet && <Snippet text={r.snippet} />}
      </span>
    </button>
  )

  const searching = hits === null
  return (
    <div className="pal-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="Search and commands">
        <div className="pal-input">
          <Icon name="search" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Search ${workspace.name}…`}
            aria-label="Search pages and commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-activedescendant={rows.all.length ? `pal-${index}` : undefined}
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="pal-list" id="pal-list" role="listbox" ref={listRef}>
          {rows.pageRows.length > 0 && (
            <>
              <div className="pal-group">{query.trim() ? 'Pages' : 'Recent'}</div>
              {rows.pageRows.map((r, i) => renderRow(r, i))}
            </>
          )}
          {!searching && query.trim() && rows.pageRows.length === 0 && (
            <p className="pal-empty">No pages match “{query.trim()}”.</p>
          )}
          {rows.actions.length > 0 && (
            <>
              <div className="pal-group">Actions</div>
              {rows.actions.map((r, i) => renderRow(r, rows.pageRows.length + i))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
