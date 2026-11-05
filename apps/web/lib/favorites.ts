'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { listFavorites, setFavorite } from '@/app/favorite-actions'

/** One shared list per workspace, so the page star and the sidebar agree instantly. */
interface Store {
  ids: string[]
  loaded: boolean
  listeners: Set<() => void>
}
const stores = new Map<string, Store>()
const EMPTY: string[] = []

function storeFor(workspaceId: string): Store {
  let s = stores.get(workspaceId)
  if (!s) stores.set(workspaceId, (s = { ids: EMPTY, loaded: false, listeners: new Set() }))
  return s
}
const emit = (s: Store) => s.listeners.forEach((l) => l())

export function useFavorites(workspaceId: string) {
  const s = storeFor(workspaceId)
  const ids = useSyncExternalStore(
    (cb) => (s.listeners.add(cb), () => s.listeners.delete(cb)),
    () => s.ids,
    () => EMPTY,
  )

  useEffect(() => {
    if (s.loaded) return
    s.loaded = true
    void listFavorites(workspaceId)
      .then((r) => {
        s.ids = r
        emit(s)
      })
      .catch(() => (s.loaded = false))
  }, [s, workspaceId])

  const toggle = useCallback(
    async (pageId: string): Promise<boolean> => {
      const on = !s.ids.includes(pageId)
      const before = s.ids
      s.ids = on ? [...s.ids, pageId] : s.ids.filter((id) => id !== pageId)
      emit(s)
      const res = await setFavorite(pageId, on).catch(() => ({ error: 'Could not save.' }))
      if (res.error) {
        s.ids = before
        emit(s)
        return false
      }
      return true
    },
    [s],
  )

  return { ids, toggle, has: (id: string) => ids.includes(id) }
}
