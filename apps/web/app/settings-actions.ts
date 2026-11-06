'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, getDb, inArray, memberships, pageRoles, pages, workspaceRole, workspaces } from '@murmuration/db'
import { can, rank } from '@murmuration/shared'
import { requireUser } from '@/lib/auth'

export async function renameWorkspace(workspaceId: string, name: string): Promise<{ error?: string }> {
  const user = await requireUser()
  if (!can(await workspaceRole(user.id, workspaceId), 'manage-members')) return { error: 'Only admins can rename the workspace.' }
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!clean) return { error: 'Give the workspace a name.' }
  await getDb().update(workspaces).set({ name: clean }).where(eq(workspaces.id, workspaceId))
  revalidatePath(`/w/${workspaceId}`, 'layout')
  return {}
}

/** Take someone out of the workspace (and any page-level access they had in it). */
export async function removeMember(workspaceId: string, userId: string): Promise<{ error?: string }> {
  const user = await requireUser()
  const mine = await workspaceRole(user.id, workspaceId)
  const theirs = await workspaceRole(userId, workspaceId)
  if (!mine || !theirs || !can(mine, 'manage-members')) return { error: 'Only admins can remove people.' }
  if (userId === user.id) return { error: 'Use “Leave workspace” to remove yourself.' }
  if (theirs === 'owner') return { error: 'The owner can’t be removed.' }
  if (rank(theirs) >= rank(mine)) return { error: 'You can only remove people below your own role.' }
  await dropMembership(workspaceId, userId)
  revalidatePath(`/w/${workspaceId}`, 'layout')
  return {}
}

/** Leave a workspace. The owner can't leave (there would be no one in charge). */
export async function leaveWorkspace(workspaceId: string): Promise<{ error?: string }> {
  const user = await requireUser()
  const mine = await workspaceRole(user.id, workspaceId)
  if (!mine) return {}
  if (mine === 'owner') return { error: 'The owner can’t leave their own workspace.' }
  await dropMembership(workspaceId, user.id)
  return {}
}

async function dropMembership(workspaceId: string, userId: string) {
  const db = getDb()
  await db.transaction(async (tx) => {
    const ids = (await tx.select({ id: pages.id }).from(pages).where(eq(pages.workspaceId, workspaceId))).map((p) => p.id)
    if (ids.length) await tx.delete(pageRoles).where(and(inArray(pageRoles.pageId, ids), eq(pageRoles.userId, userId)))
    await tx.delete(memberships).where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
  })
}
