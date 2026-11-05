import { and, eq, isNull } from 'drizzle-orm'
import { effectiveRole, type Role } from '@murmuration/shared'
import { getDb } from './client'
import { memberships, pageRoles, pages } from './schema'

export async function workspaceRole(userId: string, workspaceId: string): Promise<Role | null> {
  const [row] = await getDb()
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
  return row?.role ?? null
}

/** The role a user has on a page, or null if the page is gone or they have no access. */
export async function pageRole(userId: string, pageId: string): Promise<{ role: Role | null; workspaceId: string } | null> {
  const db = getDb()
  const [page] = await db
    .select({ workspaceId: pages.workspaceId })
    .from(pages)
    .where(and(eq(pages.id, pageId), isNull(pages.archivedAt)))
  if (!page) return null
  const [ws, override] = await Promise.all([
    workspaceRole(userId, page.workspaceId),
    db
      .select({ role: pageRoles.role })
      .from(pageRoles)
      .where(and(eq(pageRoles.pageId, pageId), eq(pageRoles.userId, userId)))
      .then((r) => r[0]?.role ?? null),
  ])
  return { role: effectiveRole(ws, override), workspaceId: page.workspaceId }
}
