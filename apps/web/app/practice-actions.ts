'use server'

import { randomBytes } from 'node:crypto'
import { and, eq, getDb, inArray, memberships, pageRole, publish, users } from '@murmuration/db'
import { can, type Ink } from '@murmuration/shared'
import { requireUser } from '@/lib/auth'

/** The scripted people who join a page on request. ("use server" files may only export async functions.) */
const PRACTICE_PEOPLE: { name: string; email: string; ink: Ink }[] = [
  { name: 'Wren Okafor', email: 'wren@practice.murmuration.invalid', ink: 'teal' },
  { name: 'Otto Lindqvist', email: 'otto@practice.murmuration.invalid', ink: 'cobalt' },
  { name: 'Juno Park', email: 'juno@practice.murmuration.invalid', ink: 'ochre' },
]

const lastStart = new Map<string, number>()

/**
 * Bring practice collaborators onto a page. They're real accounts (so every
 * permission check applies to them) that can't sign in, added to the
 * workspace as editors. The sync server runs their script.
 */
export async function startPracticeSession(pageId: string): Promise<{ error?: string }> {
  const user = await requireUser()
  const access = await pageRole(user.id, pageId)
  if (!access?.role || !can(access.role, 'edit')) return { error: 'You need edit access to invite collaborators here.' }
  const now = Date.now()
  if (now - (lastStart.get(pageId) ?? 0) < 75_000) return { error: 'They’re already on their way. Give them a minute.' }
  lastStart.set(pageId, now)

  const db = getDb()
  // A password hash that is not a valid argon2 hash can never match anything.
  await db
    .insert(users)
    .values(PRACTICE_PEOPLE.map((p) => ({ ...p, isBot: true, passwordHash: `!practice-${randomBytes(16).toString('hex')}` })))
    .onConflictDoNothing()
  const bots = await db.select({ id: users.id }).from(users).where(inArray(users.email, PRACTICE_PEOPLE.map((p) => p.email)))
  const existing = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, access.workspaceId), inArray(memberships.userId, bots.map((b) => b.id))))
  const missing = bots.filter((b) => !existing.some((e) => e.userId === b.id))
  if (missing.length) {
    await db.insert(memberships).values(missing.map((b) => ({ workspaceId: access.workspaceId, userId: b.id, role: 'editor' as const })))
  }
  await publish({ kind: 'practice', pageId, workspaceId: access.workspaceId, visitorId: user.id })
  return {}
}
