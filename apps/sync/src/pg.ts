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
  pageMentions,
  pageTasks,
  memberships,
  mentionNotices,
  publish,
  pageRole,
  pages,
  sql,
  workspaceRole,
} from '@murmuration/db'
import { fragmentMentions, fragmentPageLinks, fragmentTasks, fragmentText, pageDoc, parseDocName, TREE_PAGES, type TaskInfo } from '@murmuration/shared'
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

const mirroredMentions = new Map<string, string>()
const mirroredTasks = new Map<string, string>()
const remember = (m: Map<string, string>, k: string, v: string) => {
  m.set(k, v)
  if (m.size > 5000) m.delete(m.keys().next().value!)
}

/**
 * Keep page_mentions in step with the page, and notify people who were just
 * mentioned (not the person who mentioned them, and only if they can see the page).
 */
async function mirrorMentions(pageId: string, docName: string, ids: string[], actor: string | null) {
  const key = ids.slice().sort().join(',')
  if (mirroredMentions.get(docName) === key) return
  const db = getDb()
  const [page] = await db.select({ ws: pages.workspaceId }).from(pages).where(eq(pages.id, pageId))
  if (!page) return
  const before = new Set(
    (await db.select({ id: pageMentions.userId }).from(pageMentions).where(eq(pageMentions.pageId, pageId))).map((r) => r.id),
  )
  // Only real members of this workspace count.
  const members = ids.length
    ? (await db
        .select({ id: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, page.ws), inArray(memberships.userId, ids.slice(0, 200))))).map((r) => r.id)
    : []
  await db.transaction(async (tx) => {
    await tx.delete(pageMentions).where(eq(pageMentions.pageId, pageId))
    if (members.length) await tx.insert(pageMentions).values(members.map((userId) => ({ pageId, userId })))
  })
  const fresh: string[] = []
  for (const id of members) {
    if (before.has(id) || id === actor) continue
    const access = await pageRole(id, pageId)
    if (access?.role) fresh.push(id)
  }
  if (fresh.length) {
    await db.insert(mentionNotices).values(fresh.map((userId) => ({ userId, workspaceId: page.ws, pageId, actorId: actor })))
    await publish({ kind: 'inbox', userIds: fresh })
  }
  remember(mirroredMentions, docName, key)
}

/** Replace a page's mirrored to-dos when they change. */
async function mirrorTasks(pageId: string, docName: string, tasks: TaskInfo[]) {
  const key = JSON.stringify(tasks)
  if (mirroredTasks.get(docName) === key) return
  await getDb().transaction(async (tx) => {
    await tx.delete(pageTasks).where(eq(pageTasks.pageId, pageId))
    if (tasks.length) {
      await tx.insert(pageTasks).values(
        tasks.slice(0, 1000).map((t, position) => ({ pageId, position, text: t.text, done: t.done, assignees: t.assignees })),
      )
    }
  })
  remember(mirroredTasks, docName, key)
}


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

  async afterFlush(docName, doc, authorIds) {
    const parsed = parseDocName(docName)
    if (!parsed) return
    const db = getDb()
    if (parsed.kind === 'page') {
      const body = doc.getXmlFragment('default')
      // Who made these edits: the latest author in the batch.
      const actor = [...authorIds].reverse().find((a): a is string => !!a) ?? null
      await mirrorMentions(parsed.id, docName, fragmentMentions(body), actor)
      await mirrorTasks(parsed.id, docName, fragmentTasks(body))
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

/** Mirror to-dos for pages edited before the task list existed. Runs once at startup. */
export async function backfillTasks(log: (msg: string) => void = () => {}): Promise<number> {
  const db = getDb()
  const rows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(isNull(pages.archivedAt), sql`not exists (select 1 from ${pageTasks} t where t.page_id = ${pages.id})`))
    .orderBy(desc(pages.updatedAt))
    .limit(500)
  let filled = 0
  for (const { id } of rows) {
    const { updates } = await pgStore.load(pageDoc(id))
    if (!updates.length) continue
    const doc = new Y.Doc()
    for (const u of updates) Y.applyUpdate(doc, u)
    const tasks = fragmentTasks(doc.getXmlFragment('default'))
    doc.destroy()
    if (!tasks.length) continue
    await mirrorTasks(id, pageDoc(id), tasks)
    filled++
  }
  if (filled) log(`[sync] listed to-dos from ${filled} page(s)`)
  return filled
}
