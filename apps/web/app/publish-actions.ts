'use server'

import { randomBytes } from 'node:crypto'
import { eq, getDb, pageRole, pages, workspaceRole } from '@murmuration/db'
import { can } from '@murmuration/shared'
import { requireUser } from '@/lib/auth'

/** The page's public token, if it is published. */
export async function publishedToken(pageId: string): Promise<string | null> {
  const user = await requireUser()
  const access = await pageRole(user.id, pageId)
  if (!access || !can(access.role, 'view')) return null
  const [row] = await getDb().select({ token: pages.publicToken }).from(pages).where(eq(pages.id, pageId))
  return row?.token ?? null
}

/**
 * Publish a page to the web (anyone with the link can read it) or take it down.
 * Admins only. Publishing again after unpublishing makes a new link, so old
 * links stop working for good.
 */
export async function setPublished(pageId: string, on: boolean): Promise<{ token?: string | null; error?: string }> {
  const user = await requireUser()
  const access = await pageRole(user.id, pageId)
  if (!access || !can(await workspaceRole(user.id, access.workspaceId), 'manage-members')) {
    return { error: 'Only admins can publish pages.' }
  }
  const token = on ? randomBytes(18).toString('base64url') : null
  await getDb().update(pages).set({ publicToken: token }).where(eq(pages.id, pageId))
  return { token }
}
