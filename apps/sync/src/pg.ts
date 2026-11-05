import * as Y from 'yjs'
import {
  and,
  asc,
  desc,
  docEvents,
  docSnapshots,
  eq,
  getDb,
  gt,
  pageRole,
  pages,
  sql,
  workspaceRole,
} from '@murmuration/db'
import { parseDocName, TREE_PAGES } from '@murmuration/shared'
import type { Access, Store } from './types'

export const pgAccess: Access = {
  async role(userId, doc) {
    if (doc.kind === 'tree') return workspaceRole(userId, doc.id)
    return (await pageRole(userId, doc.id))?.role ?? null
  },
}

/** Titles we last wrote to the pages table, per tree doc, so we only write changes. */
const mirroredTitles = new Map<string, Map<string, string>>()

export const pgStore: Store = {
  async load(docName) {
    const db = getDb()
    const [snap] = await db
      .select()
      .from(docSnapshots)
      .where(eq(docSnapshots.docName, docName))
      .orderBy(desc(docSnapshots.uptoEventId))
      .limit(1)
    const after = snap?.uptoEventId ?? 0
    const events = await db
      .select({ id: docEvents.id, update: docEvents.update })
      .from(docEvents)
      .where(and(eq(docEvents.docName, docName), gt(docEvents.id, after)))
      .orderBy(asc(docEvents.id))
    return {
      updates: [...(snap ? [snap.state] : []), ...events.map((e) => e.update)],
      lastEventId: events.at(-1)?.id ?? after,
      eventsSinceSnapshot: events.length,
    }
  },

  async append(docName, rows) {
    const inserted = await getDb()
      .insert(docEvents)
      .values(rows.map((r) => ({ docName, authorId: r.authorId, update: r.update })))
      .returning({ id: docEvents.id })
    return Math.max(...inserted.map((r) => r.id))
  },

  async snapshot(docName, uptoEventId, state) {
    await getDb().insert(docSnapshots).values({ docName, uptoEventId, state }).onConflictDoNothing()
  },

  async afterFlush(docName, doc) {
    const parsed = parseDocName(docName)
    if (!parsed) return
    const db = getDb()
    if (parsed.kind === 'page') {
      await db.update(pages).set({ updatedAt: sql`now()` }).where(eq(pages.id, parsed.id))
      return
    }
    // Mirror titles from the tree document into the pages table.
    let known = mirroredTitles.get(docName)
    if (!known) mirroredTitles.set(docName, (known = new Map()))
    const map = doc.getMap<Y.Map<unknown>>(TREE_PAGES)
    for (const [id, node] of map) {
      const title = String(node.get('title') ?? '')
      if (known.get(id) === title) continue
      await db
        .update(pages)
        .set({ title })
        .where(and(eq(pages.id, id), eq(pages.workspaceId, parsed.id)))
      known.set(id, title)
    }
  },
}
