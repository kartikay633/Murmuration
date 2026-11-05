'use server'

import { and, asc, docEvents, eq, getDb, gt, inArray, isNull, memberships, pageRole, pages, pageVisits, sql, users, workspaceRole } from '@murmuration/db'
import { can, isInk, pageDoc, type Ink } from '@murmuration/shared'
import { requireUser } from '@/lib/auth'

export interface CatchUp {
  /** When you last had this page open. */
  since: string
  authors: { id: string; name: string; ink: Ink }[]
  /** Other people's updates since then, oldest first (base64 Yjs updates). */
  updates: { authorId: string; update: string }[]
}

/** The most updates we hand back; beyond that, the page was rewritten anyway. */
const MAX_UPDATES = 400

const b64 = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString('base64')

async function latestEventId(pageId: string): Promise<number> {
  const [row] = await getDb()
    .select({ max: sql<string | null>`max(${docEvents.id})` })
    .from(docEvents)
    .where(eq(docEvents.docName, pageDoc(pageId)))
  return Number(row?.max ?? 0)
}

async function recordVisit(userId: string, pageId: string, lastEventId: number) {
  await getDb()
    .insert(pageVisits)
    .values({ userId, pageId, lastEventId })
    .onConflictDoUpdate({
      target: [pageVisits.userId, pageVisits.pageId],
      set: { lastEventId: sql`greatest(${pageVisits.lastEventId}, ${lastEventId})`, visitedAt: sql`now()` },
    })
}

/**
 * Called when a page opens: what other people wrote since your last visit
 * (null on a first visit or when nothing changed), and marks the page seen.
 */
export async function openPage(pageId: string): Promise<CatchUp | null> {
  const user = await requireUser()
  const access = await pageRole(user.id, pageId)
  if (!access || !can(access.role, 'view')) return null
  const db = getDb()
  const [prev] = await db
    .select({ lastEventId: pageVisits.lastEventId, visitedAt: pageVisits.visitedAt })
    .from(pageVisits)
    .where(and(eq(pageVisits.userId, user.id), eq(pageVisits.pageId, pageId)))
  const latest = await latestEventId(pageId)
  await recordVisit(user.id, pageId, latest)
  if (!prev || latest <= prev.lastEventId) return null

  const rows = await db
    .select({ authorId: docEvents.authorId, update: docEvents.update })
    .from(docEvents)
    .where(
      and(
        eq(docEvents.docName, pageDoc(pageId)),
        gt(docEvents.id, prev.lastEventId),
        sql`${docEvents.authorId} is distinct from ${user.id}`,
        sql`${docEvents.authorId} is not null`,
      ),
    )
    .orderBy(asc(docEvents.id))
    .limit(MAX_UPDATES)
  if (!rows.length) return null

  const ids = [...new Set(rows.map((r) => r.authorId!))]
  const people = await db.select({ id: users.id, name: users.name, ink: users.ink }).from(users).where(inArray(users.id, ids))
  return {
    since: prev.visitedAt.toISOString(),
    authors: people.map((p) => ({ id: p.id, name: p.name, ink: isInk(p.ink) ? p.ink : 'ochre' })),
    updates: rows.map((r) => ({ authorId: r.authorId!, update: b64(r.update) })),
  }
}

/** While a page is open, keep its "seen up to" mark current. */
export async function markPageSeen(pageId: string): Promise<void> {
  const user = await requireUser()
  const access = await pageRole(user.id, pageId)
  if (!access || !can(access.role, 'view')) return
  await recordVisit(user.id, pageId, await latestEventId(pageId))
}

/**
 * Pages in a workspace that other people changed since you last looked. Pages
 * you have never opened count only for edits made after you joined.
 */
export async function unseenPages(workspaceId: string): Promise<string[]> {
  const user = await requireUser()
  if (!can(await workspaceRole(user.id, workspaceId), 'view')) return []
  const rows = await getDb()
    .select({ id: pages.id })
    .from(pages)
    .innerJoin(memberships, and(eq(memberships.workspaceId, pages.workspaceId), eq(memberships.userId, user.id)))
    .leftJoin(pageVisits, and(eq(pageVisits.pageId, pages.id), eq(pageVisits.userId, user.id)))
    .where(
      and(
        eq(pages.workspaceId, workspaceId),
        isNull(pages.archivedAt),
        sql`exists (
          select 1 from ${docEvents} e
          where e.doc_name = 'page:' || ${pages.id}
            and e.author_id is not null and e.author_id <> ${user.id}
            and case when ${pageVisits.pageId} is null
                     -- Content that came with the workspace (or predates you) isn't news.
                     then e.created_at > ${memberships.createdAt} + interval '1 minute'
                     else e.id > ${pageVisits.lastEventId} end
        )`,
      ),
    )
  return rows.map((r) => r.id)
}
