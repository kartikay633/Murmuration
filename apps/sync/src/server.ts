import { randomUUID } from 'node:crypto'
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { jwtVerify } from 'jose'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import * as Y from 'yjs'
import {
  CLOSE,
  ERR,
  MSG,
  SYNC_STEP_1,
  SYNC_STEP_2,
  SYNC_UPDATE,
  can,
  encodeEmpty,
  encodeError,
  encodeEvent,
  encodeRole,
  fingerprint,
  frame,
  pageDoc,
  parseDocName,
  readHeader,
  type LiveEvent,
  type Role,
} from '@murmuration/shared'
import type { Bus } from './bus'
import { Room, type RoomOptions } from './room'
import type { Access, Peer, Store } from './types'

export const TOKEN_AUDIENCE = 'murmuration-sync'

export interface SyncServerOptions {
  port: number
  /** HS256 secret shared with the web app, which issues the tokens. */
  secret: string
  store: Store
  access: Access
  flushMs?: number
  snapshotEvery?: number
  /** Re-check a connection's role at most this often (ms). */
  roleTtlMs?: number
  /** Keep an empty room in memory this long before unloading it (ms). */
  idleUnloadMs?: number
  /** Link to other sync servers (Redis in production). Omit to run a single server. */
  bus?: Bus
  /** Source of out-of-band events (Postgres LISTEN in production). Returns an unsubscribe function. */
  events?: (handler: (event: LiveEvent) => void) => () => void
  log?: (msg: string, err?: unknown) => void
}

export interface SyncServer {
  port: number
  http: HttpServer
  stats(): { connections: number; rooms: number }
  close(): Promise<void>
}

interface Subscription {
  room: Room
  role: Role
  checkedAt: number
  /** Count of edit frames received for this doc (see encodeSaved). */
  seq: number
}

export async function createSyncServer(opts: SyncServerOptions): Promise<SyncServer> {
  const log = opts.log ?? ((m: string, e?: unknown) => console.log(`[sync] ${m}`, e ?? ''))
  const instanceId = randomUUID()
  const roomOpts: RoomOptions = {
    flushMs: opts.flushMs ?? 250,
    snapshotEvery: opts.snapshotEvery ?? 200,
    log,
    bus: opts.bus,
    instanceId,
  }
  const roleTtl = opts.roleTtlMs ?? 5000
  const idleUnload = opts.idleUnloadMs ?? 30_000
  const key = new TextEncoder().encode(opts.secret)

  /* ---------------- rooms ---------------- */

  const rooms = new Map<string, Promise<Room>>()
  const unloadTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function getRoom(name: string): Promise<Room> {
    const t = unloadTimers.get(name)
    if (t) {
      clearTimeout(t)
      unloadTimers.delete(name)
    }
    let p = rooms.get(name)
    if (!p) {
      const room = new Room(name, opts.store, roomOpts)
      p = room.load().then(() => room)
      p.catch(() => rooms.delete(name))
      rooms.set(name, p)
    }
    return p
  }

  function maybeUnload(room: Room) {
    if (!room.empty || unloadTimers.has(room.name)) return
    unloadTimers.set(
      room.name,
      setTimeout(async () => {
        unloadTimers.delete(room.name)
        if (!room.empty) return
        rooms.delete(room.name)
        await room.destroy()
      }, idleUnload),
    )
  }

  /* ---------------- connections ---------------- */

  const connections = new Set<Connection>()

  class Connection implements Peer {
    userId = ''
    alive = true
    private authed = false
    private subs = new Map<string, Subscription>()
    private queue: Promise<void> = Promise.resolve()
    private authTimer: ReturnType<typeof setTimeout>

    constructor(readonly ws: WebSocket) {
      connections.add(this)
      this.authTimer = setTimeout(() => {
        if (!this.authed) ws.close(CLOSE.UNAUTHORIZED, 'no auth')
      }, 5000)
      ws.on('pong', () => (this.alive = true))
      ws.on('message', (raw: RawData, isBinary: boolean) => {
        if (!isBinary) return ws.close(1003, 'binary frames only')
        const data = toBytes(raw)
        // Handle one message at a time so a slow subscribe can't be overtaken by its own edits.
        this.queue = this.queue.then(() => this.handle(data)).catch((e) => log('message failed', e))
      })
      ws.on('close', () => {
        clearTimeout(this.authTimer)
        connections.delete(this)
        for (const sub of this.subs.values()) {
          sub.room.leave(this)
          maybeUnload(sub.room)
        }
        this.subs.clear()
      })
    }

    send(data: Uint8Array) {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data)
    }

    private async handle(data: Uint8Array) {
      let header: ReturnType<typeof readHeader>
      try {
        header = readHeader(data)
      } catch {
        return this.ws.close(1002, 'malformed frame')
      }
      const { type, docName, dec } = header

      if (!this.authed) {
        if (type !== MSG.AUTH) return this.ws.close(CLOSE.UNAUTHORIZED, 'auth first')
        try {
          const { payload } = await jwtVerify(decoding.readVarString(dec), key, {
            algorithms: ['HS256'],
            audience: TOKEN_AUDIENCE,
          })
          if (typeof payload.sub !== 'string') throw new Error('no subject')
          this.userId = payload.sub
          this.authed = true
          clearTimeout(this.authTimer)
          this.send(encodeEmpty(MSG.READY, ''))
        } catch {
          this.ws.close(CLOSE.UNAUTHORIZED, 'bad token')
        }
        return
      }

      switch (type) {
        case MSG.SUBSCRIBE:
          return this.subscribe(docName)
        case MSG.UNSUBSCRIBE:
          return this.unsubscribe(docName)
        case MSG.SYNC:
          return this.onSync(docName, dec)
        case MSG.AWARENESS:
          return this.onAwareness(docName, dec)
        case MSG.PROBE: {
          const sub = this.subs.get(docName)
          if (!sub) return
          return this.send(encodeEvent(docName, { kind: 'probe', fp: fingerprint(Y.encodeStateVector(sub.room.doc)) }))
        }
        default:
          this.send(encodeError(docName, ERR.BAD_MESSAGE, `unknown message type ${type}`))
      }
    }

    private async subscribe(docName: string) {
      if (this.subs.has(docName)) return
      const parsed = parseDocName(docName)
      if (!parsed) return this.send(encodeError(docName, ERR.BAD_MESSAGE, 'unknown document'))
      const role = await opts.access.role(this.userId, parsed)
      if (!role) return this.send(encodeError(docName, ERR.FORBIDDEN, 'no access to this document'))
      const room = await getRoom(docName)
      if (this.ws.readyState !== WebSocket.OPEN) return
      this.subs.set(docName, { room, role, checkedAt: Date.now(), seq: 0 })
      this.send(encodeRole(docName, role))
      room.join(this)
    }

    private unsubscribe(docName: string) {
      const sub = this.subs.get(docName)
      if (!sub) return
      this.subs.delete(docName)
      sub.room.leave(this)
      maybeUnload(sub.room)
    }

    /** Refresh a cached role if it's stale. Returns false if access is gone. */
    private async freshRole(docName: string, sub: Subscription): Promise<boolean> {
      if (Date.now() - sub.checkedAt < roleTtl) return true
      const role = await opts.access.role(this.userId, parseDocName(docName)!)
      sub.checkedAt = Date.now()
      if (!role) {
        this.send(encodeError(docName, ERR.FORBIDDEN, 'access was removed'))
        this.unsubscribe(docName)
        return false
      }
      if (role !== sub.role) {
        sub.role = role
        this.send(encodeRole(docName, role))
      }
      return true
    }

    private async onSync(docName: string, dec: decoding.Decoder) {
      const sub = this.subs.get(docName)
      if (!sub) return this.send(encodeError(docName, ERR.BAD_MESSAGE, 'not subscribed'))
      const kind = decoding.readVarUint(dec)

      if (kind === SYNC_STEP_1) {
        const sv = decoding.readVarUint8Array(dec)
        const enc = frame(MSG.SYNC, docName)
        encoding.writeVarUint(enc, SYNC_STEP_2)
        encoding.writeVarUint8Array(enc, sub.room.diffFor(sv))
        return this.send(encoding.toUint8Array(enc))
      }

      if (kind === SYNC_STEP_2 || kind === SYNC_UPDATE) {
        const seq = ++sub.seq
        const update = decoding.readVarUint8Array(dec)
        if (!(await this.freshRole(docName, sub))) return
        // The permission check that matters: a viewer with a modified client still can't write.
        if (!can(sub.role, 'edit')) {
          return this.send(encodeError(docName, ERR.FORBIDDEN, `role "${sub.role}" cannot edit`))
        }
        if (!sub.room.applyFromPeer(this, seq, update)) {
          this.send(encodeError(docName, ERR.BAD_MESSAGE, 'update could not be applied'))
        }
        return
      }

      this.send(encodeError(docName, ERR.BAD_MESSAGE, `unknown sync step ${kind}`))
    }

    private onAwareness(docName: string, dec: decoding.Decoder) {
      const sub = this.subs.get(docName)
      if (!sub) return
      if (!sub.room.applyAwareness(this, decoding.readVarUint8Array(dec))) {
        this.send(encodeError(docName, ERR.FORBIDDEN, 'presence update refused'))
      }
    }
  }

  /* ---------------- out-of-band events ---------------- */

  async function onEvent(event: LiveEvent) {
    if (event.kind === 'comments') {
      const name = pageDoc(event.pageId)
      const room = await rooms.get(name)?.catch(() => null)
      if (!room) return
      const data = encodeEvent(name, { kind: 'comments' })
      for (const peer of room.peers.keys()) peer.send(data)
    } else if (event.kind === 'inbox') {
      const who = new Set(event.userIds)
      const data = encodeEvent('', { kind: 'inbox' })
      for (const c of connections) if (who.has(c.userId)) c.send(data)
    }
  }
  const stopEvents = opts.events?.((e) => void onEvent(e).catch((err) => log('event failed', err)))

  /* ---------------- transport ---------------- */

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, instance: instanceId.slice(0, 8), connections: connections.size, rooms: rooms.size }))
      return
    }
    res.writeHead(404).end()
  })
  const wss = new WebSocketServer({ server: http, maxPayload: 8 * 1024 * 1024 })
  wss.on('connection', (ws) => new Connection(ws))

  const heartbeat = setInterval(() => {
    for (const c of connections) {
      if (!c.alive) {
        c.ws.terminate()
        continue
      }
      c.alive = false
      c.ws.ping()
    }
  }, 30_000)

  await new Promise<void>((resolve) => http.listen(opts.port, resolve))
  const port = (http.address() as AddressInfo).port

  return {
    port,
    http,
    stats: () => ({ connections: connections.size, rooms: rooms.size }),
    async close() {
      clearInterval(heartbeat)
      stopEvents?.()
      for (const c of connections) c.ws.close(1001, 'server shutting down')
      for (const t of unloadTimers.values()) clearTimeout(t)
      const loaded = await Promise.allSettled(rooms.values())
      await Promise.all(loaded.map((r) => (r.status === 'fulfilled' ? r.value.destroy() : null)))
      rooms.clear()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}

function toBytes(raw: RawData): Uint8Array {
  if (Array.isArray(raw)) raw = Buffer.concat(raw)
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
}
