'use client'

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import {
  buildTree,
  isWithin,
  keyBetween,
  nextClock,
  resolveMoves,
  TREE_MOVES,
  TREE_PAGES,
  treeDoc,
  type MoveOp,
  type TreeNode,
} from '@murmuration/shared'
import { useDocState, useSharedDoc, type SharedDoc } from './sync'

export type DropPlace = 'before' | 'after' | 'inside'

interface TreeApi {
  shared: SharedDoc | null
  nodes: Map<string, TreeNode>
  children: Map<string | null, TreeNode[]>
  add(node: { id: string; title: string; parentId: string | null; createdBy: string }): void
  rename(id: string, title: string): void
  archive(id: string): void
  /** Move a page relative to another (or to the top level). Returns false if the move isn't allowed. */
  move(id: string, target: string | null, place: DropPlace): boolean
  canMove(id: string, target: string, place: DropPlace): boolean
}

const TreeContext = createContext<TreeApi | null>(null)

/**
 * Page metadata (title, archived…) lives in a Y.Map per page. Where a page sits
 * lives in the move log (see packages/shared/src/tree-crdt.ts), which is what
 * keeps concurrent drags from ever producing a cycle. Pages created before the
 * log existed fall back to the parent/position stored on the page itself.
 */
function readNodes(map: Y.Map<Y.Map<unknown>>, log: Y.Array<MoveOp>): Map<string, TreeNode> {
  const { placements } = resolveMoves(log.toArray())
  const out = new Map<string, TreeNode>()
  map.forEach((m, id) => {
    if (!(m instanceof Y.Map)) return
    const placed = placements.get(id)
    out.set(id, {
      id,
      title: String(m.get('title') ?? ''),
      parentId: placed ? placed.parentId : ((m.get('parentId') as string | null) ?? null),
      position: placed ? placed.position : String(m.get('position') ?? ''),
      icon: (m.get('icon') as string | null) ?? null,
      createdAt: Number(m.get('createdAt') ?? 0),
      createdBy: String(m.get('createdBy') ?? ''),
      archived: Boolean(m.get('archived')),
    })
  })
  return out
}

/** Live, immutable snapshots of the tree; a new object only when something changed. */
function useTreeSnapshot(shared: SharedDoc | null): Map<string, TreeNode> {
  const store = useMemo(() => {
    let snapshot = new Map<string, TreeNode>()
    if (!shared) return { subscribe: () => () => {}, get: () => snapshot }
    const map = shared.doc.getMap<Y.Map<unknown>>(TREE_PAGES)
    const log = shared.doc.getArray<MoveOp>(TREE_MOVES)
    snapshot = readNodes(map, log)
    return {
      subscribe: (cb: () => void) => {
        const h = () => {
          snapshot = readNodes(map, log)
          cb()
        }
        map.observeDeep(h)
        log.observe(h)
        return () => {
          map.unobserveDeep(h)
          log.unobserve(h)
        }
      },
      get: () => snapshot,
    }
  }, [shared])
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

export function TreeProvider({ workspaceId, children }: { workspaceId: string; children: React.ReactNode }) {
  const shared = useSharedDoc(treeDoc(workspaceId))
  const nodes = useTreeSnapshot(shared)
  const tree = useMemo(() => buildTree([...nodes.values()]), [nodes])

  const map = useCallback(() => shared?.doc.getMap<Y.Map<unknown>>(TREE_PAGES), [shared])
  const log = useCallback(() => shared?.doc.getArray<MoveOp>(TREE_MOVES), [shared])

  const api: TreeApi = useMemo(() => {
    const placements = new Map([...nodes].map(([id, n]) => [id, { parentId: n.parentId, position: n.position }]))

    /** Where a drop would put `id`: its new parent and a key between the right neighbours. */
    const target = (id: string, over: string | null, place: DropPlace) => {
      if (over === null) {
        const roots = (tree.get(null) ?? []).filter((n) => n.id !== id)
        return { parentId: null, key: keyBetween(roots[roots.length - 1]?.position ?? '', '') }
      }
      if (place === 'inside') {
        const kids = (tree.get(over) ?? []).filter((n) => n.id !== id)
        return { parentId: over, key: keyBetween(kids[kids.length - 1]?.position ?? '', '') }
      }
      const parentId = nodes.get(over)?.parentId ?? null
      const siblings = (tree.get(nodes.has(parentId ?? '') ? parentId : null) ?? []).filter((n) => n.id !== id)
      const i = siblings.findIndex((n) => n.id === over)
      const before = place === 'before' ? siblings[i - 1] : siblings[i]
      const after = place === 'before' ? siblings[i] : siblings[i + 1]
      return { parentId, key: keyBetween(before?.position ?? '', after?.position ?? '') }
    }

    const canMove = (id: string, over: string, place: DropPlace) => {
      if (id === over) return false
      const t = target(id, over, place)
      // Refuse locally what the CRDT would skip anyway: a page can't go inside itself.
      return !(t.parentId && isWithin(placements, t.parentId, id))
    }

    const pushMove = (n: string, p: string | null, k: string) => {
      const l = log()
      if (!l || !shared) return
      l.push([{ n, p, k, l: nextClock(l.toArray()), c: shared.doc.clientID }])
    }

    return {
      shared,
      nodes,
      children: tree,
      add({ id, title, parentId, createdBy }) {
        const m = map()
        if (!m || !shared) return
        const siblings = tree.get(parentId) ?? []
        const position = keyBetween(siblings[siblings.length - 1]?.position ?? '', '')
        const node = new Y.Map<unknown>()
        shared.doc.transact(() => {
          m.set(id, node)
          node.set('id', id)
          node.set('title', title)
          // Kept for older clients; the move log is authoritative.
          node.set('parentId', parentId)
          node.set('position', position)
          node.set('icon', null)
          node.set('createdAt', Date.now())
          node.set('createdBy', createdBy)
          node.set('archived', false)
          pushMove(id, parentId, position)
        })
      },
      rename(id, title) {
        const n = map()?.get(id)
        if (n && n.get('title') !== title) n.set('title', title)
      },
      archive(id) {
        map()?.get(id)?.set('archived', true)
      },
      canMove,
      move(id, over, place) {
        if (over !== null && !canMove(id, over, place)) return false
        const t = target(id, over, place)
        pushMove(id, t.parentId, t.key)
        return true
      },
    }
  }, [shared, nodes, tree, map, log])

  return <TreeContext.Provider value={api}>{children}</TreeContext.Provider>
}

export function useTree(): TreeApi {
  const ctx = useContext(TreeContext)
  if (!ctx) throw new Error('useTree outside TreeProvider')
  return ctx
}

export function useTreeRole() {
  const { shared } = useTree()
  return useDocState(shared?.handle).role
}
