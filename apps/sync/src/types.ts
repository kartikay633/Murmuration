import type * as Y from 'yjs'
import type { DocKind, Role } from '@murmuration/shared'

export interface StoredRow {
  authorId: string | null
  update: Uint8Array
}

/** Where documents live. Postgres in production, memory in tests. */
export interface Store {
  /** Latest snapshot (if any) followed by every event after it. */
  load(docName: string): Promise<{ updates: Uint8Array[]; lastEventId: number; eventsSinceSnapshot: number }>
  /** Append rows in order; resolves with the id of the last one. */
  append(docName: string, rows: StoredRow[]): Promise<number>
  snapshot(docName: string, uptoEventId: number, state: Uint8Array): Promise<void>
  /**
   * Called after each successful write, e.g. to mirror page titles. `authorIds`
   * are the people whose edits were in that write, oldest first.
   */
  afterFlush?(docName: string, doc: Y.Doc, authorIds: (string | null)[]): Promise<void>
}

/** Who may do what. Asked on subscribe and again whenever a cached answer is older than the TTL. */
export interface Access {
  role(userId: string, doc: { kind: DocKind; id: string }): Promise<Role | null>
}

/** One side of a connection, as a room sees it. */
export interface Peer {
  readonly userId: string
  send(data: Uint8Array): void
}
