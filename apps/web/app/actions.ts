'use server'

import { hash, verify } from '@node-rs/argon2'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import {
  and,
  eq,
  getDb,
  memberships,
  pageRole,
  pageRoles,
  pages,
  users,
  workspaceRole,
  workspaces,
} from '@murmuration/db'
import { assignableRoles, can, inkFor, isRole, rank, type Role } from '@murmuration/shared'
import { endSession, requireUser, startSession } from '@/lib/auth'

export type FormState = { error?: string; ok?: string } | undefined

/* ---------------- accounts ---------------- */

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Tell us your name.').max(80),
  email: z.email('That email doesn’t look right.').trim().toLowerCase(),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
})

export async function signup(_: FormState, form: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const { name, email, password } = parsed.data
  const db = getDb()
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
  if (exists) return { error: 'An account with that email already exists. Sign in instead.' }

  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash: await hash(password), ink: inkFor(email) })
    .returning({ id: users.id })
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `${name.split(' ')[0]}’s workspace`, createdBy: user!.id })
    .returning({ id: workspaces.id })
  await db.insert(memberships).values({ workspaceId: ws!.id, userId: user!.id, role: 'owner' })
  await startSession(user!.id)
  redirect(`/w/${ws!.id}`)
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Enter your email.'),
  password: z.string().min(1, 'Enter your password.'),
})

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const [user] = await getDb().select().from(users).where(eq(users.email, parsed.data.email))
  // Same message either way, so the form doesn't reveal which emails have accounts.
  if (!user || !(await verify(user.passwordHash, parsed.data.password))) {
    return { error: 'That email and password don’t match.' }
  }
  await startSession(user.id)
  const next = String(form.get('next') ?? '')
  redirect(next.startsWith('/w/') ? next : '/')
}

export async function logout() {
  await endSession()
  redirect('/login')
}

/* ---------------- workspaces ---------------- */

export async function createWorkspace(name: string): Promise<{ id?: string; error?: string }> {
  const user = await requireUser()
  const clean = name.trim().slice(0, 80)
  if (!clean) return { error: 'Give the workspace a name.' }
  const db = getDb()
  const [ws] = await db.insert(workspaces).values({ name: clean, createdBy: user.id }).returning({ id: workspaces.id })
  await db.insert(memberships).values({ workspaceId: ws!.id, userId: user.id, role: 'owner' })
  return { id: ws!.id }
}

export async function addMember(workspaceId: string, email: string, role: Role): Promise<FormState> {
  const user = await requireUser()
  const mine = await workspaceRole(user.id, workspaceId)
  if (!can(mine, 'manage-members') || !mine) return { error: 'Only admins can add people.' }
  if (!isRole(role) || !assignableRoles(mine).includes(role)) return { error: 'You can’t give that role.' }
  const db = getDb()
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.trim().toLowerCase()))
  if (!target) return { error: 'No one has signed up with that email yet.' }
  const inserted = await db
    .insert(memberships)
    .values({ workspaceId, userId: target.id, role })
    .onConflictDoNothing()
    .returning({ userId: memberships.userId })
  if (!inserted.length) return { error: 'They’re already in this workspace.' }
  revalidatePath(`/w/${workspaceId}`, 'layout')
  return { ok: 'Added.' }
}

export async function setMemberRole(workspaceId: string, userId: string, role: Role): Promise<FormState> {
  const user = await requireUser()
  const mine = await workspaceRole(user.id, workspaceId)
  const theirs = await workspaceRole(userId, workspaceId)
  if (!mine || !theirs || !can(mine, 'manage-members')) return { error: 'Only admins can change roles.' }
  if (theirs === 'owner') return { error: 'The owner’s role can’t be changed.' }
  if (rank(theirs) > rank(mine) || !assignableRoles(mine).includes(role)) return { error: 'You can’t give that role.' }
  await getDb()
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
  revalidatePath(`/w/${workspaceId}`, 'layout')
  return { ok: 'Role updated.' }
}

/* ---------------- pages ---------------- */

/** Creates the page row. The client then adds it to the shared tree document. */
export async function createPage(workspaceId: string, title = ''): Promise<{ id?: string; error?: string }> {
  const user = await requireUser()
  if (!can(await workspaceRole(user.id, workspaceId), 'manage-pages')) return { error: 'You can’t add pages here.' }
  const [row] = await getDb()
    .insert(pages)
    .values({ workspaceId, title: title.slice(0, 300), createdBy: user.id })
    .returning({ id: pages.id })
  return { id: row!.id }
}

export async function archivePage(pageId: string): Promise<{ error?: string }> {
  const user = await requireUser()
  const access = await pageRole(user.id, pageId)
  if (!access || !can(await workspaceRole(user.id, access.workspaceId), 'manage-pages')) {
    return { error: 'You can’t archive this page.' }
  }
  await getDb().update(pages).set({ archivedAt: new Date() }).where(eq(pages.id, pageId))
  return {}
}

/** Override one member's role on one page. `null` returns them to their workspace role. */
export async function setPageRole(pageId: string, userId: string, role: Role | null): Promise<FormState> {
  const user = await requireUser()
  const access = await pageRole(user.id, pageId)
  if (!access || !can(await workspaceRole(user.id, access.workspaceId), 'manage-members')) {
    return { error: 'Only admins can change page access.' }
  }
  const db = getDb()
  if (role === null) {
    await db.delete(pageRoles).where(and(eq(pageRoles.pageId, pageId), eq(pageRoles.userId, userId)))
  } else {
    if (!isRole(role) || role === 'owner') return { error: 'You can’t give that role.' }
    await db
      .insert(pageRoles)
      .values({ pageId, userId, role })
      .onConflictDoUpdate({ target: [pageRoles.pageId, pageRoles.userId], set: { role } })
  }
  return { ok: 'Page access updated.' }
}
