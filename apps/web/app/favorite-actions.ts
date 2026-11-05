'use server'

import { and, asc, desc, eq, favorites, getDb, isNull, pageRole, pages, pageVisits, workspaceRole } from '@murmuration/db'
import { can } from '@murmuration/shared'
import { requireUser } from '@/lib/auth'

/** Your starred pages in a workspace, in the order you starred them. */
export async function listFavorites(workspaceId: string): Promise<string[]> {
  const user = await requireUser()
  if (!can(await workspaceRole(user.id, workspaceId), 'view')) return []
  const rows = await getDb()
    .select({ id: favorites.pageId })
    .from(favorites)
    .innerJoin(pages, eq(pages.id, favorites.pageId))
    .where(and(eq(favorites.userId, user.id), eq(pages.workspaceId, workspaceId), isNull(pages.archivedAt)))
    .orderBy(asc(favorites.createdAt))
  return rows.map((r) => r.id)
}

export async function setFavorite(pageId: string, on: boolean): Promise<{ error?: string }> {
  const user = await requireUser()
  const access = await pageRole(user.id, pageId)
  if (!access || !can(access.role, 'view')) return { error: 'You can’t see this page.' }
  const db = getDb()
  if (on) await db.insert(favorites).values({ userId: user.id, pageId }).onConflictDoNothing()
  else await db.delete(favorites).where(and(eq(favorites.userId, user.id), eq(favorites.pageId, pageId)))
  return {}
}

/** Pages you opened most recently in a workspace. */
export async function recentPages(workspaceId: string, limit = 8): Promise<string[]> {
  const user = await requireUser()
  if (!can(await workspaceRole(user.id, workspaceId), 'view')) return []
  const rows = await getDb()
    .select({ id: pageVisits.pageId })
    .from(pageVisits)
    .innerJoin(pages, eq(pages.id, pageVisits.pageId))
    .where(and(eq(pageVisits.userId, user.id), eq(pages.workspaceId, workspaceId), isNull(pages.archivedAt)))
    .orderBy(desc(pageVisits.visitedAt))
    .limit(Math.min(Math.max(limit, 1), 20))
  return rows.map((r) => r.id)
}
