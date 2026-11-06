'use server'

import { and, asc, eq, getDb, pageRole, pageVersions, users, workspaceRole } from '@murmuration/db'
import { can } from '@murmuration/shared'
import { requireUser } from '@/lib/auth'

export interface NamedVersion {
  id: string
  eventId: number
  name: string
  by: string
  at: string
  mine: boolean
}

export async function listVersions(pageId: string): Promise<NamedVersion[]> {
  const user = await requireUser()
  const access = await pageRole(user.id, pageId)
  if (!access || !can(access.role, 'view')) return []
  const rows = await getDb()
    .select({
      id: pageVersions.id,
      eventId: pageVersions.eventId,
      name: pageVersions.name,
      by: users.name,
      byId: pageVersions.createdBy,
      at: pageVersions.createdAt,
    })
    .from(pageVersions)
    .leftJoin(users, eq(users.id, pageVersions.createdBy))
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(asc(pageVersions.eventId))
  return rows.map((r) => ({
    id: r.id,
    eventId: r.eventId,
    name: r.name,
    by: r.by ?? 'Someone',
    at: r.at.toISOString(),
    mine: r.byId === user.id,
  }))
}

/** Name the page as it was right after event `eventId`. Anyone who can comment may do this. */
export async function saveVersion(pageId: string, eventId: number, name: string): Promise<{ error?: string }> {
  const user = await requireUser()
  const access = await pageRole(user.id, pageId)
  if (!access || !can(access.role, 'comment')) return { error: 'You can’t name versions of this page.' }
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!clean) return { error: 'Give the version a name.' }
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return { error: 'That version no longer exists.' }
  await getDb().insert(pageVersions).values({ pageId, eventId, name: clean, createdBy: user.id })
  return {}
}

/** Remove a name (your own, or any as an admin). The edits themselves are untouched. */
export async function deleteVersion(id: string): Promise<{ error?: string }> {
  const user = await requireUser()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return {}
  const db = getDb()
  const [v] = await db.select({ pageId: pageVersions.pageId, by: pageVersions.createdBy }).from(pageVersions).where(eq(pageVersions.id, id))
  if (!v) return {}
  const access = await pageRole(user.id, v.pageId)
  const admin = access ? can(await workspaceRole(user.id, access.workspaceId), 'manage-members') : false
  if (v.by !== user.id && !admin) return { error: 'Only the person who named it, or an admin, can remove it.' }
  await db.delete(pageVersions).where(and(eq(pageVersions.id, id)))
  return {}
}
