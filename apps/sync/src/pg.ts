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
  inArray,
  isNull,
  pageLinks,
  pageRole,
  pages,
  sql,
  workspaceRole,
} from '@murmuration/db'
import { fragmentPageLinks, fragmentText, pageDoc, parseDocName, TREE_PAGES } from '@murmuration/shared'
import type { Access, Store } from './types'

export const pgAccess: Access = {
  async role(userId, doc) {
    if (doc.kind === 'tree') return workspaceRole(userId, doc.id)
    return (await pageRole(userId, doc.id))?.role ?? null
  },
}

/** Titles we last wrote to the pages table, per tree doc, so we only write changes. */
const mirroredTitles = new Map<string, Map<string, string>>()
const mirroredBodies = new Map<string, string>()
const mirroredLinks = new Map<string, string>()

/** Replace a page's outgoing links, keeping only targets in the same workspace. */
async function syncLinks(fromPageId: string, toIds: string[]) {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.delete(pageLinks).where(eq(pageLinks.fromPageId, fromPageId))
    if (!toIds.length) return
    const [from] = await tx.select({ ws: pages.workspaceId }).from(pages).where(eq(pages.id, fromPageId))
    if (!from) return
    const targets = await tx
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.workspaceId, from.ws), inArray(pages.id, toIds.slice(0, 500))))
    if (targets.length) await tx.insert(pageLinks).values(targets.map((t) => ({ fromPageId, toPageId: t.id }))).onConflictDoNothing()
  })
}

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
      // Mirror links to other pages (for backlinks), only when they changed.
      const links = fragmentPageLinks(doc.getXmlFragment('default')).filter((id) => id !== parsed.id)
      const linkKey = links.slice().sort().join(',')
      if (mirroredLinks.get(docName) !== linkKey) {
        await syncLinks(parsed.id, links)
        mirroredLinks.set(docName, linkKey)
        if (mirroredLinks.size > 5000) mirroredLinks.delete(mirroredLinks.keys().next().value!)
      }
      // Mirror the body's plain text for search, only when it changed.
      const text = fragmentText(doc.getXmlFragment('default')).slice(0, 200_000)
      if (mirroredBodies.get(docName) !== text) {
        await db.update(pages).set({ updatedAt: sql`now()`, bodyText: text }).where(eq(pages.id, parsed.id))
        mirroredBodies.set(docName, text)
        if (mirroredBodies.size > 5000) mirroredBodies.delete(mirroredBodies.keys().next().value!)
      } else {
        await db.update(pages).set({ updatedAt: sql`now()` }).where(eq(pages.id, parsed.id))
      }
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

/**
 * Fill in search text for pages written before it was mirrored (or by other
 * tools). Runs once at startup, a page at a time.
 */
export async function backfillSearchText(log: (msg: string) => void = () => {}): Promise<number> {
  const db = getDb()
  const rows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.bodyText, ''), isNull(pages.archivedAt)))
    .limit(2000)
  let filled = 0
  for (const { id } of rows) {
    const { updates } = await pgStore.load(pageDoc(id))
    if (!updates.length) continue
    const doc = new Y.Doc()
    for (const u of updates) Y.applyUpdate(doc, u)
    const text = fragmentText(doc.getXmlFragment('default')).slice(0, 200_000)
    doc.destroy()
    if (!text) continue
    await db.update(pages).set({ bodyText: text }).where(eq(pages.id, id))
    filled++
  }
  if (filled) log(`[sync] indexed ${filled} page(s) for search`)
  return filled
}
