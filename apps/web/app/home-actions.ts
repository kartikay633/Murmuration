'use server'

import { and, asc, desc, eq, getDb, gt, isNull, pages, pageTasks, pageVisits, reminders, sql, workspaceRole } from '@murmuration/db'
import { can } from '@murmuration/shared'
import { requireUser } from '@/lib/auth'
import { unseenPages } from './visit-actions'

export interface HomeData {
  recent: { id: string; title: string; visitedAt: string }[]
  changed: { id: string; title: string; updatedAt: string }[]
  tasks: { pageId: string; title: string; text: string }[]
  reminders: { pageId: string; title: string; dueAt: string }[]
  pageCount: number
}

/** Everything the workspace home shows, in one round trip. */
export async function homeData(workspaceId: string): Promise<HomeData | null> {
  const user = await requireUser()
  if (!can(await workspaceRole(user.id, workspaceId), 'view')) return null
  const db = getDb()
  const live = and(eq(pages.workspaceId, workspaceId), isNull(pages.archivedAt))

  const [recent, changedIds, tasks, upcoming, [count]] = await Promise.all([
    db
      .select({ id: pages.id, title: pages.title, at: pageVisits.visitedAt })
      .from(pageVisits)
      .innerJoin(pages, eq(pages.id, pageVisits.pageId))
      .where(and(eq(pageVisits.userId, user.id), live))
      .orderBy(desc(pageVisits.visitedAt))
      .limit(6),
    unseenPages(workspaceId),
    db
      .select({ pageId: pages.id, title: pages.title, text: pageTasks.text })
      .from(pageTasks)
      .innerJoin(pages, eq(pages.id, pageTasks.pageId))
      .where(and(live, eq(pageTasks.done, false), sql`${user.id}::uuid = any(${pageTasks.assignees})`))
      .orderBy(desc(pages.updatedAt), asc(pageTasks.position))
      .limit(8),
    db
      .select({ pageId: pages.id, title: pages.title, dueAt: reminders.dueAt })
      .from(reminders)
      .innerJoin(pages, eq(pages.id, reminders.pageId))
      .where(and(eq(reminders.userId, user.id), live, gt(reminders.dueAt, new Date())))
      .orderBy(asc(reminders.dueAt))
      .limit(5),
    db.select({ n: sql<number>`count(*)::int` }).from(pages).where(live),
  ])

  const changed = changedIds.length
    ? await db
        .select({ id: pages.id, title: pages.title, updatedAt: pages.updatedAt })
        .from(pages)
        .where(and(live, sql`${pages.id} = any(${changedIds}::uuid[])`))
        .orderBy(desc(pages.updatedAt))
        .limit(6)
    : []

  return {
    recent: recent.map((r) => ({ id: r.id, title: r.title, visitedAt: r.at.toISOString() })),
    changed: changed.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() })),
    tasks,
    reminders: upcoming.map((r) => ({ pageId: r.pageId, title: r.title, dueAt: r.dueAt.toISOString() })),
    pageCount: count?.n ?? 0,
  }
}
