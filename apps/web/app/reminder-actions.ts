'use server'

import { and, asc, eq, getDb, gt, isNull, pageRole, publish, reminders } from '@murmuration/db'
import { can } from '@murmuration/shared'
import { requireUser } from '@/lib/auth'

/** Your upcoming reminders for a page, soonest first. */
export async function pageReminders(pageId: string): Promise<{ id: string; dueAt: string }[]> {
  const user = await requireUser()
  const rows = await getDb()
    .select({ id: reminders.id, dueAt: reminders.dueAt })
    .from(reminders)
    .where(and(eq(reminders.userId, user.id), eq(reminders.pageId, pageId), gt(reminders.dueAt, new Date())))
    .orderBy(asc(reminders.dueAt))
  return rows.map((r) => ({ id: r.id, dueAt: r.dueAt.toISOString() }))
}

/** Remind me about this page at a time (chosen in my own timezone, sent as an instant). */
export async function setReminder(pageId: string, dueAt: string): Promise<{ error?: string }> {
  const user = await requireUser()
  const access = await pageRole(user.id, pageId)
  if (!access || !can(access.role, 'view')) return { error: 'You can’t see this page.' }
  const due = new Date(dueAt)
  const now = Date.now()
  if (Number.isNaN(due.getTime()) || due.getTime() < now - 60_000 || due.getTime() > now + 366 * 86400_000) {
    return { error: 'Pick a time within the next year.' }
  }
  const db = getDb()
  const open = await db
    .select({ id: reminders.id })
    .from(reminders)
    .where(and(eq(reminders.userId, user.id), isNull(reminders.notifiedAt)))
  if (open.length >= 100) return { error: 'You have too many reminders waiting. Clear a few first.' }
  await db.insert(reminders).values({ userId: user.id, workspaceId: access.workspaceId, pageId, dueAt: due })
  return {}
}

export async function cancelReminder(id: string): Promise<void> {
  const user = await requireUser()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return
  await getDb().delete(reminders).where(and(eq(reminders.id, id), eq(reminders.userId, user.id)))
  await publish({ kind: 'inbox', userIds: [user.id] })
}
