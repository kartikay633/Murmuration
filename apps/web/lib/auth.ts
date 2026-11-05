import { createHash, randomBytes } from 'node:crypto'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { and, eq, getDb, gt, sessions, users } from '@murmuration/db'
import type { Ink } from '@murmuration/shared'

const COOKIE = 'mm_session'
const TTL_MS = 30 * 24 * 3600 * 1000

export interface CurrentUser {
  id: string
  name: string
  email: string
  ink: Ink
  isGuest: boolean
}

const digest = (token: string) => createHash('sha256').update(token).digest('hex')

export async function startSession(userId: string) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + TTL_MS)
  await getDb().insert(sessions).values({ id: digest(token), userId, expiresAt })
  ;(await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  })
}

export async function endSession() {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (token) await getDb().delete(sessions).where(eq(sessions.id, digest(token)))
  jar.delete(COOKIE)
}

/** The signed-in user, or null. Cached for the duration of one request. */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return null
  const [row] = await getDb()
    .select({ id: users.id, name: users.name, email: users.email, ink: users.ink, isGuest: users.isGuest })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, digest(token)), gt(sessions.expiresAt, new Date())))
  return row ?? null
})

export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser()
  if (!user) redirect('/login')
  return user
}
