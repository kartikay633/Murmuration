'use server'

import { and, asc, eq, getDb, isNull, pageLinks, pageRole, pages } from '@murmuration/db'
import { can } from '@murmuration/shared'
import { requireUser } from '@/lib/auth'

/** Pages that link to this one. */
export async function backlinks(pageId: string): Promise<{ id: string; title: string }[]> {
  const user = await requireUser()
  const access = await pageRole(user.id, pageId)
  if (!access || !can(access.role, 'view')) return []
  return getDb()
    .select({ id: pages.id, title: pages.title })
    .from(pageLinks)
    .innerJoin(pages, eq(pages.id, pageLinks.fromPageId))
    .where(and(eq(pageLinks.toPageId, pageId), eq(pages.workspaceId, access.workspaceId), isNull(pages.archivedAt)))
    .orderBy(asc(pages.title))
}
