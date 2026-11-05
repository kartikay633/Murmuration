import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { MSG, SYNC_STEP_1, SYNC_UPDATE, encodeSaved, frame } from '@murmuration/shared'
import type { Peer, Store, StoredRow } from './types'

const LOAD = Symbol('load')

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
    const { updates, lastEventId, eventsSinceSnapshot } = await this.store.load(this.name)
    Y.transact(this.doc, () => updates.forEach((u) => Y.applyUpdate(this.doc, u, LOAD)), LOAD)
    this.lastEventId = lastEventId
    this.sinceSnapshot = eventsSinceSnapshot
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
    this.destroyed = true
    this.awareness.destroy()
    this.doc.destroy()
  }
}
