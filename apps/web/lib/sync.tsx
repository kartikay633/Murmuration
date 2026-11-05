'use client'

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { SyncClient, type DocHandle, type DocState, type Status } from '@murmuration/client'

const SyncContext = createContext<SyncClient | null>(null)

async function fetchToken(): Promise<string> {
  const res = await fetch('/api/sync-token', { cache: 'no-store' })
  if (res.status === 401) {
    window.location.href = '/login'
    throw new Error('signed out')
  }
  const body = (await res.json()) as { token?: string }
  if (!body.token) throw new Error('no token')
  return body.token
}

/** One connection per tab, shared by every document on screen. */
export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<SyncClient | null>(null)
  useEffect(() => {
    const c = new SyncClient({ url: process.env.NEXT_PUBLIC_SYNC_URL!, getToken: fetchToken })
    setClient(c)
    return () => c.destroy()
  }, [])
  return <SyncContext.Provider value={client}>{children}</SyncContext.Provider>
}

export function useSyncClient() {
  return useContext(SyncContext)
}

const noop = () => () => {}

export function useConnectionStatus(): Status {
  const client = useSyncClient()
  return useSyncExternalStore(
    (cb) => (client ? client.on('status', cb) : noop()),
    () => client?.status ?? 'connecting',
    () => 'connecting',
  )
}

export interface SharedDoc {
  doc: Y.Doc
  handle: DocHandle
  /** Local copy (IndexedDB) or server copy has loaded. */
  ready: boolean
}

/**
 * Open a document over the shared connection, backed by IndexedDB so it opens
 * instantly next time and keeps edits made while offline.
 */
export function useSharedDoc(name: string | null): SharedDoc | null {
  const client = useSyncClient()
  const [entry, setEntry] = useState<SharedDoc | null>(null)

  useEffect(() => {
    if (!client || !name) return
    const doc = new Y.Doc()
    const local = new IndexeddbPersistence(`mm:${name}`, doc)
    const handle = client.open(name, doc)
    let alive = true
    let ready = false
    const markReady = () => {
      if (!alive || ready) return
      ready = true
      setEntry({ doc, handle, ready: true })
    }
    setEntry({ doc, handle, ready: false })
    void local.whenSynced.then(() => {
      // An empty local copy isn't worth showing; wait for the server unless we're offline.
      if (doc.share.size > 0 && hasContent(doc)) markReady()
    })
    const off = handle.on('change', (s) => s.synced && markReady())
    if (handle.state.synced) markReady()
    // Offline with nothing cached: show the empty doc rather than a skeleton forever.
    const fallback = setTimeout(() => client.status !== 'online' && markReady(), 2500)
    return () => {
      alive = false
      clearTimeout(fallback)
      off()
      client.close(name)
      void local.destroy()
      doc.destroy()
      setEntry(null)
    }
  }, [client, name])

  return entry
}

function hasContent(doc: Y.Doc): boolean {
  for (const type of doc.share.values()) {
    if (type instanceof Y.XmlFragment && type.length > 0) return true
    if (type instanceof Y.Map && type.size > 0) return true
  }
  return false
}

const EMPTY: DocState = { role: null, synced: false, saved: true, error: null }

export function useDocState(handle: DocHandle | undefined | null): DocState {
  return useSyncExternalStore(
    (cb) => (handle ? handle.on('change', cb) : noop()),
    () => handle?.state ?? EMPTY,
    () => EMPTY,
  )
}

/** Forget every cached document (on sign-out, so the next person on this device can't read them). */
export async function clearLocalDocs() {
  if (!('databases' in indexedDB)) return
  const dbs = await indexedDB.databases()
  await Promise.all(
    dbs
      .filter((d) => d.name?.startsWith('mm:'))
      .map((d) => new Promise((r) => {
        const req = indexedDB.deleteDatabase(d.name!)
        req.onsuccess = req.onerror = req.onblocked = r
      })),
  )
}
