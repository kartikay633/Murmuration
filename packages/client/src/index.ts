import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import {
  CLOSE,
  MSG,
  SYNC_STEP_1,
  SYNC_STEP_2,
  SYNC_UPDATE,
  decodeError,
  decodeRole,
  encodeAuth,
  encodeEmpty,
  frame,
  readHeader,
  type Role,
} from '@murmuration/shared'

export type Status = 'connecting' | 'online' | 'offline'

type Listener<T> = (value: T) => void
class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<Listener<never>>>()
  on<K extends keyof E>(k: K, fn: Listener<E[K]>): () => void {
    let s = this.map.get(k)
    if (!s) this.map.set(k, (s = new Set()))
    s.add(fn as Listener<never>)
    return () => s!.delete(fn as Listener<never>)
  }
  protected emit<K extends keyof E>(k: K, v: E[K]) {
    this.map.get(k)?.forEach((fn) => (fn as Listener<E[K]>)(v))
  }
}

export interface DocState {
  role: Role | null
  /** Received the server's copy at least once since (re)subscribing. */
  synced: boolean
  /** Every local edit has been durably stored by the server. */
  saved: boolean
  error: { code: string; message: string } | null
}

/**
 * One document followed over the shared connection. Pass `handle` as the
 * provider to Tiptap's CollaborationCaret; it exposes `awareness`.
 */
export class DocHandle extends Emitter<{ change: DocState }> {
  state: DocState = { role: null, synced: false, saved: true, error: null }
  /** Edit frames sent / acknowledged since the current subscription began. */
  sentSeq = 0
  savedSeq = 0
  subscribed = false
  everSynced = false
  /** The connection dropped after this document had synced; the next sync is a reconnect. */
  dropped = false
  /** When each still-unacknowledged edit frame was sent, for round-trip timing. */
  sentAt = new Map<number, number>()

  /** Edit frames sent but not yet stored by the server. */
  get pending() {
    return Math.max(0, this.sentSeq - this.savedSeq)
  }

  constructor(
    readonly client: SyncClient,
    readonly name: string,
    readonly doc: Y.Doc,
    readonly awareness: awarenessProtocol.Awareness,
  ) {
    super()
  }

  set(patch: Partial<DocState>) {
    const next = { ...this.state, ...patch }
    if (
      next.role === this.state.role &&
      next.synced === this.state.synced &&
      next.saved === this.state.saved &&
      next.error === this.state.error
    )
      return
    this.state = next
    this.emit('change', next)
  }
}

export interface LinkConditions {
  latencyMs: number
}

export interface LinkStats {
  framesIn: number
  framesOut: number
  bytesIn: number
  bytesOut: number
  /** Time from sending an edit to the server confirming it's stored. */
  lastRttMs: number | null
  edits: number
}

export interface SyncClientOptions {
  url: string
  /** Fetches a fresh token; called before every (re)connect. */
  getToken: () => Promise<string>
  WebSocketImpl?: typeof WebSocket
  /** Called with every frame sent/received; the Network Lab hooks in here later. */
  tap?: (direction: 'in' | 'out', bytes: number) => void
}

export interface ClientEvent {
  docName: string
  data: { kind?: string } & Record<string, unknown>
}

export class SyncClient extends Emitter<{ status: Status; event: ClientEvent }> {
  status: Status = 'connecting'
  private ws: WebSocket | null = null
  private ready = false
  private handles = new Map<string, DocHandle>()
  private cleanups = new Map<string, () => void>()
  private attempts = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  constructor(private readonly opts: SyncClientOptions) {
    super()
    void this.connect()
  }

  /* ---------------- documents ---------------- */

  open(name: string, doc: Y.Doc, given?: awarenessProtocol.Awareness): DocHandle {
    const existing = this.handles.get(name)
    if (existing) return existing
    // Awareness runs a timer; if we create it, we're the ones who must stop it on close.
    const awareness = given ?? new awarenessProtocol.Awareness(doc)
    const h = new DocHandle(this, name, doc, awareness)
    this.handles.set(name, h)

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === this) return
      h.set({ saved: false })
      if (!this.ready || !h.subscribed) return // sent as step 2 after reconnect
      const enc = frame(MSG.SYNC, name)
      encoding.writeVarUint(enc, SYNC_UPDATE)
      encoding.writeVarUint8Array(enc, update)
      h.sentSeq++
      h.sentAt.set(h.sentSeq, Date.now())
      this.stats.edits++
      this.send(encoding.toUint8Array(enc))
    }
    const onAwareness = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin !== 'local' || !this.ready || !h.subscribed) return
      const enc = frame(MSG.AWARENESS, name)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]))
      this.send(encoding.toUint8Array(enc))
    }
    doc.on('update', onUpdate)
    awareness.on('update', onAwareness)
    this.cleanups.set(name, () => {
      doc.off('update', onUpdate)
      awareness.off('update', onAwareness)
    })
    if (!given) this.owned.add(name)

    if (this.ready) this.subscribe(h)
    return h
  }

  close(name: string) {
    const h = this.handles.get(name)
    if (!h) return
    this.cleanups.get(name)?.()
    this.cleanups.delete(name)
    this.handles.delete(name)
    if (this.ready) {
      // Tell others our cursor is gone before we stop listening.
      awarenessProtocol.removeAwarenessStates(h.awareness, [h.doc.clientID], 'local')
      const enc = frame(MSG.AWARENESS, name)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(h.awareness, [h.doc.clientID]))
      this.send(encoding.toUint8Array(enc))
      this.send(encodeEmpty(MSG.UNSUBSCRIBE, name))
    }
    if (this.owned.delete(name)) h.awareness.destroy()
  }
  private owned = new Set<string>()

  get(name: string) {
    return this.handles.get(name)
  }

  /** Drop the connection on purpose (offline mode, tests). */
  disconnect() {
    this.manualOffline = true
    this.ws?.close(1000, 'client went offline')
  }
  reconnect() {
    this.manualOffline = false
    this.attempts = 0
    if (!this.ws) void this.connect()
  }
  private manualOffline = false

  destroy() {
    this.destroyed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    for (const name of [...this.handles.keys()]) this.close(name)
    this.ws?.close(1000, 'client closed')
  }

  /* ---------------- transport ---------------- */

  private setStatus(s: Status) {
    if (s === this.status) return
    this.status = s
    this.emit('status', s)
  }

  /* ---------- link conditioner (Network Lab) ---------- */

  /** Artificial delay applied to every frame in both directions. Order is always preserved. */
  conditions: LinkConditions = { latencyMs: 0 }
  readonly stats: LinkStats = { framesIn: 0, framesOut: 0, bytesIn: 0, bytesOut: 0, lastRttMs: null, edits: 0 }
  private outAt = 0
  private inAt = 0

  setLatency(ms: number) {
    this.conditions = { latencyMs: Math.max(0, Math.min(5000, Math.round(ms))) }
  }

  get isOffline() {
    return this.manualOffline
  }

  /** Ask the server for its copy's fingerprint; it replies with an EVENT {kind:'probe', fp}. */
  probe(name: string) {
    if (this.ready && this.handles.get(name)?.subscribed) this.send(encodeEmpty(MSG.PROBE, name))
  }

  /** Delay a step so frames leave/arrive in order, `latency` ms after they were produced. */
  private later(kind: 'out' | 'in', fn: () => void) {
    const lat = this.conditions.latencyMs
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const last = kind === 'out' ? this.outAt : this.inAt
    if (!lat && last <= now) return fn()
    const at = Math.max(now + lat, last)
    if (kind === 'out') this.outAt = at
    else this.inAt = at
    setTimeout(fn, at - now)
  }

  private send(data: Uint8Array) {
    const ws = this.ws
    if (ws?.readyState !== 1) return
    this.stats.framesOut++
    this.stats.bytesOut += data.byteLength
    this.later('out', () => {
      if (this.ws === ws && ws.readyState === 1) {
        ws.send(data)
        this.opts.tap?.('out', data.byteLength)
      }
    })
  }

  private async connect() {
    if (this.destroyed || this.manualOffline) return
    this.setStatus(this.attempts === 0 ? 'connecting' : 'offline')
    let token: string
    try {
      token = await this.opts.getToken()
    } catch {
      return this.retry()
    }
    if (this.destroyed || this.manualOffline) return

    const WS = this.opts.WebSocketImpl ?? WebSocket
    const ws = new WS(this.opts.url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => this.send(encodeAuth(token))
    ws.onmessage = (ev) => {
      const data = new Uint8Array(ev.data as ArrayBuffer)
      this.later('in', () => {
        if (this.ws !== ws) return
        this.stats.framesIn++
        this.stats.bytesIn += data.byteLength
        this.opts.tap?.('in', data.byteLength)
        try {
          this.receive(data)
        } catch (e) {
          console.error('[sync] bad frame', e)
        }
      })
    }
    ws.onclose = (ev) => {
      if (this.ws !== ws) return
      this.ws = null
      this.ready = false
      for (const h of this.handles.values()) {
        h.subscribed = false
        if (h.everSynced) h.dropped = true
        h.set({ synced: false })
        // Other people's cursors are stale once we can't hear from them.
        const others = [...h.awareness.getStates().keys()].filter((id) => id !== h.doc.clientID)
        awarenessProtocol.removeAwarenessStates(h.awareness, others, this)
      }
      this.setStatus('offline')
      if (ev.code === CLOSE.UNAUTHORIZED) this.attempts = Math.max(this.attempts, 3)
      this.retry()
    }
    ws.onerror = () => {
      /* onclose follows */
    }
  }

  private retry() {
    if (this.destroyed || this.manualOffline || this.retryTimer) return
    const base = Math.min(15_000, 400 * 2 ** this.attempts)
    const delay = base / 2 + Math.random() * (base / 2)
    this.attempts++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.connect()
    }, delay)
  }

  private subscribe(h: DocHandle) {
    h.subscribed = true
    h.sentSeq = 0
    h.savedSeq = 0
    h.sentAt.clear()
    this.send(encodeEmpty(MSG.SUBSCRIBE, h.name))
    const enc = frame(MSG.SYNC, h.name)
    encoding.writeVarUint(enc, SYNC_STEP_1)
    encoding.writeVarUint8Array(enc, Y.encodeStateVector(h.doc))
    this.send(encoding.toUint8Array(enc))
    if (h.awareness.getLocalState() !== null) {
      const a = frame(MSG.AWARENESS, h.name)
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(h.awareness, [h.doc.clientID]))
      this.send(encoding.toUint8Array(a))
    }
  }

  private receive(data: Uint8Array) {
    const { type, docName, dec } = readHeader(data)
    if (type === MSG.READY) {
      this.ready = true
      this.attempts = 0
      this.setStatus('online')
      for (const h of this.handles.values()) this.subscribe(h)
      return
    }
    if (type === MSG.EVENT) {
      try {
        this.emit('event', { docName, data: JSON.parse(decoding.readVarString(dec)) })
      } catch {
        /* ignore malformed */
      }
      return
    }
    const h = this.handles.get(docName)
    if (!h) return

    switch (type) {
      case MSG.SYNC: {
        const kind = decoding.readVarUint(dec)
        const payload = decoding.readVarUint8Array(dec)
        if (kind === SYNC_STEP_1) {
          // Server wants what we have that it doesn't: our offline edits.
          const diff = Y.encodeStateAsUpdate(h.doc, payload)
          const enc = frame(MSG.SYNC, docName)
          encoding.writeVarUint(enc, SYNC_STEP_2)
          encoding.writeVarUint8Array(enc, diff)
          h.sentSeq++
          this.send(encoding.toUint8Array(enc))
        } else {
          Y.applyUpdate(h.doc, payload, this)
          if (kind === SYNC_STEP_2) {
            // An empty Yjs update is 2 bytes. Anything more after a reconnect is
            // other people's work that happened while we were away.
            // Only a sync that follows a dropped connection is a merge worth announcing;
            // a late reply to a previous subscription of the same document is not.
            if (h.dropped && payload.byteLength > 2) {
              this.emit('event', { docName, data: { kind: 'merged', bytes: payload.byteLength } })
            }
            h.dropped = false
            h.everSynced = true
            h.set({ synced: true, error: null })
          }
        }
        return
      }
      case MSG.AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(h.awareness, decoding.readVarUint8Array(dec), this)
        return
      case MSG.ROLE:
        h.set({ role: decodeRole(dec) })
        return
      case MSG.SAVED: {
        const seq = decoding.readVarUint(dec)
        const at = h.sentAt.get(seq)
        if (at) this.stats.lastRttMs = Date.now() - at
        for (const k of h.sentAt.keys()) if (k <= seq) h.sentAt.delete(k)
        h.savedSeq = Math.max(h.savedSeq, seq)
        if (h.savedSeq >= h.sentSeq) h.set({ saved: true })
        return
      }
      case MSG.ERROR:
        h.set({ error: decodeError(dec) })
        return
    }
  }
}
