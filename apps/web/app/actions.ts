'use server'

import { hash, verify } from '@node-rs/argon2'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import * as Y from 'yjs'
import {
  and,
  asc,
  createGuest,
  desc,
  docEvents,
  docSnapshots,
  eq,
  gt,
  inArray,
  isNull,
  getDb,
  loadDocUpdates,
  memberships,
  pageRole,
  pageRoles,
  pages,
  users,
  workspaceRole,
  workspaces,
} from '@murmuration/db'
import { assignableRoles, can, inkFor, isRole, pageDoc, rank, type Role } from '@murmuration/shared'
import { endSession, requireUser, startSession } from '@/lib/auth'

/** `values` echoes back what was typed (never passwords) so a failed submit doesn't empty the form. */
export type FormState =
  | { error?: string; ok?: string; values?: Record<string, string>; fields?: Record<string, string> }
  | undefined

/** First message per field, so every problem shows at once next to its field. */
function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const i of issues) {
    const k = String(i.path[0] ?? '')
    if (k && !out[k]) out[k] = i.message
  }
  return out
}

const echo = (form: FormData, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, String(form.get(k) ?? '')]))

/* ---------------- accounts ---------------- */

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Tell us your name.').max(80),
  email: z.email('That email doesn’t look right.').trim().toLowerCase(),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
})

export async function signup(_: FormState, form: FormData): Promise<FormState> {
  const values = echo(form, ['name', 'email'])
  const parsed = signupSchema.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { fields: fieldErrors(parsed.error.issues), values }
  const { name, email, password } = parsed.data
  const db = getDb()
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
  if (exists) return { fields: { email: 'An account with this email already exists. Sign in instead.' }, values }

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

/** At most 10 sign-in attempts per email and address every 5 minutes. */
const attempts = new Map<string, number[]>()
function tooManyAttempts(key: string): boolean {
  const now = Date.now()
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < 5 * 60_000)
  recent.push(now)
  attempts.set(key, recent)
  if (attempts.size > 10_000) attempts.clear()
  return recent.length > 10
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const values = echo(form, ['email'])
  const parsed = loginSchema.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { fields: fieldErrors(parsed.error.issues), values }
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  if (tooManyAttempts(`${parsed.data.email}|${ip}`)) {
    return { error: 'Too many attempts. Wait a few minutes and try again.', values }
  }
  const [user] = await getDb().select().from(users).where(eq(users.email, parsed.data.email))
  // Same message either way, so the form doesn't reveal which emails have accounts.
  const valid =
    !!user && !user.isBot && user.passwordHash.startsWith('$argon2') && (await verify(user.passwordHash, parsed.data.password))
  if (!user || !valid) {
    return { error: 'That email and password don’t match.', values }
  }
  await startSession(user.id)
  const next = String(form.get('next') ?? '')
  redirect(next.startsWith('/w/') ? next : '/')
}

/** One click, no sign-up: a private sandbox account that is removed after a week. */
export async function tryDemo() {
  const { userId, workspaceId, firstPageId } = await createGuest()
  await startSession(userId)
  redirect(`/w/${workspaceId}/p/${firstPageId}`)
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

/**
 * Copy a page: a new page row whose body starts as the source's full state,
 * stored as one event. Authorship of the copied text is kept.
 */
export async function duplicatePage(pageId: string, opts: { title?: string } = {}): Promise<{ id?: string; title?: string; error?: string }> {
  const user = await requireUser()
  const access = await pageRole(user.id, pageId)
  if (!access || !can(access.role, 'view') || !can(await workspaceRole(user.id, access.workspaceId), 'manage-pages')) {
    return { error: 'You can’t duplicate this page.' }
  }
  const db = getDb()
  const [source] = await db.select({ title: pages.title }).from(pages).where(eq(pages.id, pageId))
  const updates = await loadDocUpdates(pageDoc(pageId))

  const title = (opts.title?.trim() || `${source?.title || 'Untitled'} (copy)`).slice(0, 300)
  const [row] = await db
    .insert(pages)
    .values({ workspaceId: access.workspaceId, title, createdBy: user.id })
    .returning({ id: pages.id })
  if (updates.length) {
    await db.insert(docEvents).values({ docName: pageDoc(row!.id), authorId: user.id, update: Y.mergeUpdates(updates) })
  }
  return { id: row!.id, title }
}

/** Subpage ids that really are in the same workspace (the tree is client-supplied). */
async function sameWorkspace(workspaceId: string, ids: string[]): Promise<string[]> {
  const clean = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 500)
  if (!clean.length) return []
  const rows = await getDb()
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), inArray(pages.id, clean)))
  return rows.map((r) => r.id)
}

/** Archive a page and the pages under it (they go to the trash together). */
export async function archivePage(pageId: string, subpageIds: string[] = []): Promise<{ error?: string }> {
  const user = await requireUser()
  const access = await pageRole(user.id, pageId)
  if (!access || !can(await workspaceRole(user.id, access.workspaceId), 'manage-pages')) {
    return { error: 'You can’t archive this page.' }
  }
  const ids = [pageId, ...(await sameWorkspace(access.workspaceId, subpageIds))]
  await getDb()
    .update(pages)
    .set({ archivedAt: new Date() })
    .where(and(inArray(pages.id, ids), isNull(pages.archivedAt)))
  return {}
}

export async function unarchivePage(pageId: string, subpageIds: string[] = []): Promise<{ error?: string }> {
  const user = await requireUser()
  const [page] = await getDb().select({ workspaceId: pages.workspaceId }).from(pages).where(eq(pages.id, pageId))
  if (!page || !can(await workspaceRole(user.id, page.workspaceId), 'manage-pages')) return { error: 'You can’t restore this page.' }
  const ids = [pageId, ...(await sameWorkspace(page.workspaceId, subpageIds))]
  await getDb().update(pages).set({ archivedAt: null }).where(inArray(pages.id, ids))
  return {}
}

/**
 * Delete archived pages for good: the rows (comments and access cascade) and
 * their whole edit history. `ids` is the archived page plus its subpages.
 */
export async function deletePagesForever(workspaceId: string, ids: string[]): Promise<{ error?: string }> {
  const user = await requireUser()
  if (!can(await workspaceRole(user.id, workspaceId), 'manage-pages')) return { error: 'You can’t delete pages here.' }
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 500)
  if (!unique.length) return {}
  const db = getDb()
  const rows = await db
    .select({ id: pages.id, archivedAt: pages.archivedAt })
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), inArray(pages.id, unique)))
  // The page being deleted must already be in the trash.
  if (!rows.some((r) => r.archivedAt) || rows.length !== unique.length) return { error: 'Only pages in the trash can be deleted.' }
  const docNames = unique.map(pageDoc)
  await db.transaction(async (tx) => {
    await tx.delete(docEvents).where(inArray(docEvents.docName, docNames))
    await tx.delete(docSnapshots).where(inArray(docSnapshots.docName, docNames))
    await tx.delete(pages).where(inArray(pages.id, unique))
  })
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
