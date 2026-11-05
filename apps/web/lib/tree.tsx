'use client'

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { buildTree, keyBetween, TREE_PAGES, treeDoc, type TreeNode } from '@murmuration/shared'
import { useDocState, useSharedDoc, type SharedDoc } from './sync'

interface TreeApi {
  shared: SharedDoc | null
  nodes: Map<string, TreeNode>
  children: Map<string | null, TreeNode[]>
  add(node: { id: string; title: string; parentId: string | null; createdBy: string }): void
  rename(id: string, title: string): void
  archive(id: string): void
}

const TreeContext = createContext<TreeApi | null>(null)

function readNode(id: string, m: Y.Map<unknown>): TreeNode {
  return {
    id,
    title: String(m.get('title') ?? ''),
    parentId: (m.get('parentId') as string | null) ?? null,
    position: String(m.get('position') ?? ''),
    icon: (m.get('icon') as string | null) ?? null,
    createdAt: Number(m.get('createdAt') ?? 0),
    createdBy: String(m.get('createdBy') ?? ''),
    archived: Boolean(m.get('archived')),
  }
}

/** Live, immutable snapshots of the tree map; a new object only when something changed. */
function useTreeSnapshot(shared: SharedDoc | null): Map<string, TreeNode> {
  const store = useMemo(() => {
    let snapshot = new Map<string, TreeNode>()
    if (!shared) return { subscribe: () => () => {}, get: () => snapshot }
    const map = shared.doc.getMap<Y.Map<unknown>>(TREE_PAGES)
    const read = () => {
      const next = new Map<string, TreeNode>()
      map.forEach((m, id) => m instanceof Y.Map && next.set(id, readNode(id, m)))
      snapshot = next
    }
    read()
    return {
      subscribe: (cb: () => void) => {
        const h = () => {
          read()
          cb()
        }
        map.observeDeep(h)
        return () => map.unobserveDeep(h)
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

  const api: TreeApi = useMemo(
    () => ({
      shared,
      nodes,
      children: tree,
      add({ id, title, parentId, createdBy }) {
        const m = map()
        if (!m) return
        const siblings = tree.get(parentId) ?? []
        const last = siblings[siblings.length - 1]
        const node = new Y.Map<unknown>()
        shared!.doc.transact(() => {
          m.set(id, node)
          node.set('id', id)
          node.set('title', title)
          node.set('parentId', parentId)
          node.set('position', keyBetween(last?.position ?? '', ''))
          node.set('icon', null)
          node.set('createdAt', Date.now())
          node.set('createdBy', createdBy)
          node.set('archived', false)
        })
      },
      rename(id, title) {
        const n = map()?.get(id)
        if (n && n.get('title') !== title) n.set('title', title)
      },
      archive(id) {
        map()?.get(id)?.set('archived', true)
      },
    }),
    [shared, nodes, tree, map],
  )

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
