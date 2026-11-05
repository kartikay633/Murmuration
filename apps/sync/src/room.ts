import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { MSG, SYNC_STEP_1, SYNC_UPDATE, encodeSaved, frame } from '@murmuration/shared'
import { docChannel, type Bus } from './bus'
import type { Peer, Store, StoredRow } from './types'

const LOAD = Symbol('load')
/** Changes that arrived from another sync server: shown to our clients, but neither re-published nor stored. */
const REMOTE = Symbol('remote')

/** Messages between sync servers on a document's channel. */
const BUS = { UPDATE: 0, AWARENESS: 1, SV_REQUEST: 2, SV_REPLY: 3 } as const

/** Marks an update as coming from a specific client message. */
export class Origin {
  constructor(readonly peer: Peer, readonly seq: number) {}
}

export interface RoomOptions {
  /** Batch writes for this long before hitting the database. */
  flushMs: number
  /** Write a full snapshot after this many stored events. */
  snapshotEvery: number
  log?: (msg: string, err?: unknown) => void
  /** Other sync servers, when running more than one. */
  bus?: Bus
  /** This server's id on the bus. */
  instanceId?: string
}

/**
 * One live document: the authoritative Y.Doc, who is connected to it, their
 * presence, and the write-behind buffer to the event log.
 */
export class Room {
  readonly doc = new Y.Doc()
  readonly awareness = new awarenessProtocol.Awareness(this.doc)
  /** Each peer and the awareness client ids it has claimed. */
  readonly peers = new Map<Peer, Set<number>>()

  private pending: { authorId: string | null; update: Uint8Array }[] = []
  /** Highest message number per peer that will be stored by the next flush. */
  private awaiting = new Map<Peer, number>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private chain: Promise<void> = Promise.resolve()
  private lastEventId = 0
  private sinceSnapshot = 0
  private destroyed = false
  /** Presence client ids that belong to people on other servers. */
  private remoteIds = new Set<number>()
  private unsubscribe: (() => void) | null = null

  constructor(
    readonly name: string,
    private readonly store: Store,
    private readonly opts: RoomOptions,
  ) {
    this.awareness.setLocalState(null)
    this.doc.on('update', this.onUpdate)
    this.awareness.on('update', this.onAwareness)
  }

  async load() {
    // Listen to other servers before reading the database, so nothing falls in the gap.
    const buffered: Uint8Array[] = []
    let loaded = false
    if (this.opts.bus) {
      this.unsubscribe = this.opts.bus.subscribe(docChannel(this.name), (data) =>
        loaded ? this.onBus(data) : buffered.push(data),
      )
    }
    const { updates, lastEventId, eventsSinceSnapshot } = await this.store.load(this.name)
    Y.transact(this.doc, () => updates.forEach((u) => Y.applyUpdate(this.doc, u, LOAD)), LOAD)
    this.lastEventId = lastEventId
    this.sinceSnapshot = eventsSinceSnapshot
    loaded = true
    buffered.forEach((d) => this.onBus(d))
    // Ask servers that already have this document for edits they haven't stored yet.
    this.publish(BUS.SV_REQUEST, '', Y.encodeStateVector(this.doc))
  }

  /* ---------------- other sync servers ---------------- */

  private publish(kind: number, to: string, payload: Uint8Array) {
    const bus = this.opts.bus
    if (!bus || this.destroyed) return
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, kind)
    encoding.writeVarString(enc, this.opts.instanceId ?? '')
    encoding.writeVarString(enc, to)
    encoding.writeVarUint8Array(enc, payload)
    bus.publish(docChannel(this.name), encoding.toUint8Array(enc))
  }

  private onBus(data: Uint8Array) {
    if (this.destroyed) return
    let kind: number, from: string, to: string, payload: Uint8Array
    try {
      const dec = decoding.createDecoder(data)
      kind = decoding.readVarUint(dec)
      from = decoding.readVarString(dec)
      to = decoding.readVarString(dec)
      payload = decoding.readVarUint8Array(dec)
    } catch {
      return
    }
    if (from === this.opts.instanceId) return // our own message coming back
    if (to && to !== this.opts.instanceId) return
    switch (kind) {
      case BUS.UPDATE:
      case BUS.SV_REPLY:
        Y.applyUpdate(this.doc, payload, REMOTE)
        return
      case BUS.AWARENESS: {
        try {
          const dec = decoding.createDecoder(payload)
          const n = decoding.readVarUint(dec)
          for (let i = 0; i < n; i++) {
            this.remoteIds.add(decoding.readVarUint(dec))
            decoding.readVarUint(dec)
            decoding.readVarString(dec)
          }
        } catch {
          return
        }
        awarenessProtocol.applyAwarenessUpdate(this.awareness, payload, REMOTE)
        return
      }
      case BUS.SV_REQUEST: {
        // Another server just opened this document: send what it's missing and who's here.
        this.publish(BUS.SV_REPLY, from, Y.encodeStateAsUpdate(this.doc, payload))
        // Only ids that still have presence; a client may have claimed an id and since cleared it.
        const local = [...this.peers.values()].flatMap((ids) => [...ids]).filter((id) => this.awareness.meta.has(id))
        if (local.length) this.publish(BUS.AWARENESS, from, awarenessProtocol.encodeAwarenessUpdate(this.awareness, local))
        return
      }
    }
  }

  /* ---------------- peers ---------------- */

  join(peer: Peer) {
    this.peers.set(peer, new Set())
    // Ask the client for anything we're missing (offline edits arrive as its step 2).
    const enc = frame(MSG.SYNC, this.name)
    encoding.writeVarUint(enc, SYNC_STEP_1)
    encoding.writeVarUint8Array(enc, Y.encodeStateVector(this.doc))
    peer.send(encoding.toUint8Array(enc))
    // Current presence of everyone else.
    const states = [...this.awareness.getStates().keys()]
    if (states.length) peer.send(this.awarenessFrame(states))
  }

  leave(peer: Peer) {
    const ids = this.peers.get(peer)
    if (!ids) return
    this.peers.delete(peer)
    this.awaiting.delete(peer)
    if (ids.size) awarenessProtocol.removeAwarenessStates(this.awareness, [...ids], 'leave')
  }

  get empty() {
    return this.peers.size === 0
  }

  /* ---------------- document updates ---------------- */

  /** Reply to a client's step 1 with everything it lacks. */
  diffFor(stateVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, stateVector)
  }

  /**
   * Apply an edit from a peer. Returns false if the update was malformed.
   * If it changed nothing (e.g. a resend after reconnect), the peer is
   * acknowledged right away unless earlier edits of theirs are still queued.
   */
  applyFromPeer(peer: Peer, seq: number, update: Uint8Array): boolean {
    let changed = false
    const mark = () => (changed = true)
    this.doc.on('update', mark)
    try {
      Y.applyUpdate(this.doc, update, new Origin(peer, seq))
    } catch {
      return false
    } finally {
      this.doc.off('update', mark)
    }
    if (!changed) {
      if (this.awaiting.has(peer)) this.awaiting.set(peer, seq)
      else peer.send(encodeSaved(this.name, seq))
    }
    return true
  }

  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === LOAD || this.destroyed) return
    if (origin === REMOTE) {
      // Already stored by the server its author is connected to; just show it to ours.
      const enc = frame(MSG.SYNC, this.name)
      encoding.writeVarUint(enc, SYNC_UPDATE)
      encoding.writeVarUint8Array(enc, update)
      const data = encoding.toUint8Array(enc)
      for (const p of this.peers.keys()) p.send(data)
      return
    }
    this.publish(BUS.UPDATE, '', update)
    const from = origin instanceof Origin ? origin : null
    this.pending.push({ authorId: from?.peer.userId ?? null, update })
    if (from) this.awaiting.set(from.peer, Math.max(from.seq, this.awaiting.get(from.peer) ?? 0))

    const enc = frame(MSG.SYNC, this.name)
    encoding.writeVarUint(enc, SYNC_UPDATE)
    encoding.writeVarUint8Array(enc, update)
    const data = encoding.toUint8Array(enc)
    for (const p of this.peers.keys()) if (p !== from?.peer) p.send(data)

    this.scheduleFlush()
  }

  /* ---------------- presence ---------------- */

  /**
   * Apply a presence update, refusing it if it touches a client id that
   * belongs to someone else (a modified client can't move your cursor).
   */
  applyAwareness(peer: Peer, update: Uint8Array): boolean {
    const owned = this.peers.get(peer)
    if (!owned) return false
    const ids: number[] = []
    try {
      const dec = decoding.createDecoder(update)
      const n = decoding.readVarUint(dec)
      for (let i = 0; i < n; i++) {
        ids.push(decoding.readVarUint(dec))
        decoding.readVarUint(dec) // clock
        decoding.readVarString(dec) // state json
      }
    } catch {
      return false
    }
    for (const [other, set] of this.peers) {
      if (other !== peer && ids.some((id) => set.has(id))) return false
    }
    if (ids.some((id) => this.remoteIds.has(id))) return false
    ids.forEach((id) => owned.add(id))
    awarenessProtocol.applyAwarenessUpdate(this.awareness, update, peer)
    return true
  }

  private onAwareness = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (this.destroyed) return
    const changed = [...added, ...updated, ...removed]
    if (!changed.length) return
    const data = this.awarenessFrame(changed)
    for (const p of this.peers.keys()) if (p !== origin) p.send(data)
    if (origin === REMOTE) {
      removed.forEach((id) => this.remoteIds.delete(id))
    } else {
      this.publish(BUS.AWARENESS, '', awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
    }
  }

  private awarenessFrame(clients: number[]): Uint8Array {
    const enc = frame(MSG.AWARENESS, this.name)
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients))
    return encoding.toUint8Array(enc)
  }

  /* ---------------- persistence ---------------- */

  private scheduleFlush(delay = this.opts.flushMs) {
    if (this.flushTimer || this.destroyed) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, delay)
  }

  /** Write everything buffered so far. Flushes never overlap. */
  flush(): Promise<void> {
    this.chain = this.chain.then(() => this.writeBatch())
    return this.chain
  }

  private async writeBatch() {
    if (!this.pending.length) return
    const batch = this.pending
    const acks = this.awaiting
    this.pending = []
    this.awaiting = new Map()

    // Consecutive updates by the same person become one row.
    const groups: { authorId: string | null; parts: Uint8Array[] }[] = []
    for (const b of batch) {
      const last = groups[groups.length - 1]
      if (last && last.authorId === b.authorId) last.parts.push(b.update)
      else groups.push({ authorId: b.authorId, parts: [b.update] })
    }
    const rows: StoredRow[] = groups.map((g) => ({
      authorId: g.authorId,
      update: g.parts.length === 1 ? g.parts[0]! : Y.mergeUpdates(g.parts),
    }))

    try {
      this.lastEventId = await this.store.append(this.name, rows)
    } catch (err) {
      // Put the batch back in front and retry; nothing is acknowledged until it's stored.
      this.pending = batch.concat(this.pending)
      for (const [p, s] of acks) this.awaiting.set(p, Math.max(s, this.awaiting.get(p) ?? 0))
      this.opts.log?.(`write failed for ${this.name}, retrying`, err)
      this.scheduleFlush(1000)
      return
    }

    for (const [peer, seq] of acks) if (this.peers.has(peer)) peer.send(encodeSaved(this.name, seq))

    this.sinceSnapshot += rows.length
    try {
      if (this.sinceSnapshot >= this.opts.snapshotEvery) {
        // The snapshot may already include updates newer than lastEventId; replaying
        // those events again on load is harmless because Yjs updates are idempotent.
        await this.store.snapshot(this.name, this.lastEventId, Y.encodeStateAsUpdate(this.doc))
        this.sinceSnapshot = 0
      }
      await this.store.afterFlush?.(this.name, this.doc)
    } catch (err) {
      this.opts.log?.(`post-write step failed for ${this.name}`, err)
    }
  }

  async destroy() {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    await this.flush()
    this.unsubscribe?.()
    this.destroyed = true
    this.awareness.destroy()
    this.doc.destroy()
  }
}
