import { afterEach, describe, expect, it } from 'vitest'
import { SignJWT } from 'jose'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import { SyncClient, type DocHandle } from '@murmuration/client'
import { MSG, encodeAuth, encodeEmpty, frame, pageDoc, type LiveEvent, type Role } from '@murmuration/shared'
import { createSyncServer, TOKEN_AUDIENCE, type SyncServer } from './server'
import type { Access, Store, StoredRow } from './types'

const SECRET = 'test-secret-test-secret-test-secret-!!'
const PAGE = '11111111-2222-4333-8444-555555555555'
const DOC = pageDoc(PAGE)

class MemoryStore implements Store {
  events = new Map<string, { id: number; row: StoredRow }[]>()
  snapshots = new Map<string, { upto: number; state: Uint8Array }>()
  private nextId = 1
  async load(name: string) {
    const snap = this.snapshots.get(name)
    const after = snap?.upto ?? 0
    const evs = (this.events.get(name) ?? []).filter((e) => e.id > after)
    return {
      updates: [...(snap ? [snap.state] : []), ...evs.map((e) => e.row.update)],
      lastEventId: evs.at(-1)?.id ?? after,
      eventsSinceSnapshot: evs.length,
    }
  }
  async append(name: string, rows: StoredRow[]) {
    const list = this.events.get(name) ?? []
    for (const row of rows) list.push({ id: this.nextId++, row })
    this.events.set(name, list)
    return this.nextId - 1
  }
  async snapshot(name: string, upto: number, state: Uint8Array) {
    this.snapshots.set(name, { upto, state })
  }
}

class Roles implements Access {
  map = new Map<string, Role>()
  async role(userId: string) {
    return this.map.get(userId) ?? null
  }
}

const token = (userId: string) =>
  new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setAudience(TOKEN_AUDIENCE)
    .setExpirationTime('5m').sign(new TextEncoder().encode(SECRET))

const waitFor = async (check: () => boolean, ms = 3000) => {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 10))
  }
}

let server: SyncServer | null = null
const clients: SyncClient[] = []
afterEach(async () => {
  clients.splice(0).forEach((c) => c.destroy())
  await server?.close()
  server = null
})

async function start(store = new MemoryStore(), roles = new Roles(), extra: { roleTtlMs?: number } = {}) {
  server = await createSyncServer({ port: 0, secret: SECRET, store, access: roles, flushMs: 10, log: () => {}, ...extra })
  return { store, roles, url: `ws://localhost:${server.port}` }
}

function connect(url: string, userId: string): { client: SyncClient; handle: DocHandle; text: Y.Text } {
  const client = new SyncClient({ url, getToken: () => token(userId) })
  clients.push(client)
  const doc = new Y.Doc()
  const handle = client.open(DOC, doc)
  return { client, handle, text: doc.getText('t') }
}

describe('sync server', () => {
  it('two editors converge and edits are stored', async () => {
    const { store, roles, url } = await start()
    roles.map.set('ana', 'editor').set('rohan', 'editor')
    const a = connect(url, 'ana')
    const b = connect(url, 'rohan')
    await waitFor(() => a.handle.state.synced && b.handle.state.synced)

    a.text.insert(0, 'hello ')
    b.text.insert(0, 'world ')
    await waitFor(() => a.text.toString() === b.text.toString() && a.text.length === 12)
    await waitFor(() => a.handle.state.saved && b.handle.state.saved)

    const authors = (store.events.get(DOC) ?? []).map((e) => e.row.authorId)
    expect(authors).toContain('ana')
    expect(authors).toContain('rohan')
  })

  it('refuses edits from a viewer, even from a modified client', async () => {
    const { store, roles, url } = await start()
    roles.map.set('ana', 'editor').set('mei', 'viewer')
    const a = connect(url, 'ana')
    const m = connect(url, 'mei')
    await waitFor(() => a.handle.state.synced && m.handle.state.synced)
    expect(m.handle.state.role).toBe('viewer')

    m.text.insert(0, 'sneaky') // the UI would be read-only; this simulates a tampered client
    await waitFor(() => m.handle.state.error?.code === 'forbidden')
    await new Promise((r) => setTimeout(r, 50))
    expect(a.text.toString()).toBe('')
    expect(store.events.get(DOC) ?? []).toHaveLength(0)
  })

  it('merges edits made while offline', async () => {
    const { roles, url } = await start()
    roles.map.set('ana', 'editor').set('rohan', 'editor')
    const a = connect(url, 'ana')
    const b = connect(url, 'rohan')
    await waitFor(() => a.handle.state.synced && b.handle.state.synced)

    a.client.disconnect()
    await waitFor(() => a.client.status === 'offline')
    a.text.insert(0, 'written on a train. ')
    b.text.insert(0, 'written at the office. ')
    await new Promise((r) => setTimeout(r, 50))
    expect(a.text.toString()).not.toBe(b.text.toString())

    a.client.reconnect()
    await waitFor(() => a.text.toString() === b.text.toString() && a.text.length > 40)
    await waitFor(() => a.handle.state.saved)
  })

  it('survives a restart: the document is rebuilt from the event log', async () => {
    const first = await start()
    first.roles.map.set('ana', 'editor')
    const a = connect(first.url, 'ana')
    await waitFor(() => a.handle.state.synced)
    a.text.insert(0, 'persist me')
    await waitFor(() => a.handle.state.saved)
    clients.splice(0).forEach((c) => c.destroy())
    await server!.close()

    const second = await start(first.store, first.roles)
    const b = connect(second.url, 'ana')
    await waitFor(() => b.handle.state.synced)
    expect(b.text.toString()).toBe('persist me')
  })

  it('takes a role change into account without reconnecting', async () => {
    const { store, roles, url } = await start(undefined, undefined, { roleTtlMs: 20 })
    roles.map.set('rohan', 'editor')
    const r = connect(url, 'rohan')
    await waitFor(() => r.handle.state.synced)
    r.text.insert(0, 'a')
    await waitFor(() => r.handle.state.saved)

    roles.map.set('rohan', 'viewer')
    await new Promise((res) => setTimeout(res, 30))
    r.text.insert(1, 'b')
    await waitFor(() => r.handle.state.role === 'viewer')
    await waitFor(() => r.handle.state.error?.code === 'forbidden')
    expect(store.events.get(DOC)).toHaveLength(1)
  })

  it("refuses a presence update that claims someone else's client id", async () => {
    const { roles, url } = await start()
    roles.map.set('ana', 'editor').set('mallory', 'editor')
    const a = connect(url, 'ana')
    a.handle.awareness.setLocalStateField('user', { name: 'Ana' })
    await waitFor(() => a.handle.state.synced)
    await new Promise((r) => setTimeout(r, 30))

    // A raw socket pretending to be Ana's client id.
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    const received: number[] = []
    ws.onmessage = (e) => received.push(new Uint8Array(e.data as ArrayBuffer)[0]!)
    await new Promise((r) => (ws.onopen = r))
    ws.send(encodeAuth(await token('mallory')))
    ws.send(encodeEmpty(MSG.SUBSCRIBE, DOC))
    const impostor = new Y.Doc()
    impostor.clientID = a.handle.doc.clientID
    const fake = new awarenessProtocol.Awareness(impostor)
    fake.setLocalStateField('user', { name: 'Not Ana' })
    const enc = frame(MSG.AWARENESS, DOC)
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(fake, [fake.clientID]))
    ws.send(encoding.toUint8Array(enc))
    await waitFor(() => received.includes(MSG.ERROR))
    ws.close()
    fake.destroy()

    const seenByServer = [...a.handle.awareness.getStates().values()].map((s) => s.user?.name)
    expect(seenByServer).not.toContain('Not Ana')
  })

  it('forwards out-of-band events to the page and to the right people', async () => {
    const roles = new Roles()
    roles.map.set('ana', 'editor').set('rohan', 'viewer')
    let emit: (e: LiveEvent) => void = () => {}
    server = await createSyncServer({
      port: 0, secret: SECRET, store: new MemoryStore(), access: roles, flushMs: 10, log: () => {},
      events: (h) => ((emit = h), () => {}),
    })
    const url = `ws://localhost:${server.port}`
    const a = connect(url, 'ana')
    const r = connect(url, 'rohan')
    await waitFor(() => a.handle.state.synced && r.handle.state.synced)
    const got: { who: string; docName: string; kind?: string }[] = []
    a.client.on('event', (e) => got.push({ who: 'ana', docName: e.docName, kind: e.data.kind }))
    r.client.on('event', (e) => got.push({ who: 'rohan', docName: e.docName, kind: e.data.kind }))

    emit({ kind: 'comments', pageId: PAGE })
    emit({ kind: 'inbox', userIds: ['rohan'] })
    await waitFor(() => got.length === 3)
    expect(got).toContainEqual({ who: 'ana', docName: DOC, kind: 'comments' })
    expect(got).toContainEqual({ who: 'rohan', docName: DOC, kind: 'comments' })
    expect(got).toContainEqual({ who: 'rohan', docName: '', kind: 'inbox' })
  })

  it('stops the presence timer it created when a document is closed', async () => {
    const { roles, url } = await start()
    roles.map.set('ana', 'editor')
    const a = connect(url, 'ana')
    await waitFor(() => a.handle.state.synced)
    const aw = a.handle.awareness as unknown as { _checkInterval: ReturnType<typeof setInterval> | undefined }
    let cleared = false
    const original = clearInterval
    globalThis.clearInterval = ((id: Parameters<typeof clearInterval>[0]) => {
      if (id === aw._checkInterval) cleared = true
      return original(id)
    }) as typeof clearInterval
    try {
      a.client.close(DOC)
    } finally {
      globalThis.clearInterval = original
    }
    expect(cleared).toBe(true)
  })

  it('closes a socket that sends a bad token', async () => {
    const { url } = await start()
    const ws = new WebSocket(url)
    const closed = new Promise<number>((r) => (ws.onclose = (e) => r(e.code)))
    await new Promise((r) => (ws.onopen = r))
    ws.send(encodeAuth('not-a-token'))
    expect(await closed).toBe(4401)
  })
})
