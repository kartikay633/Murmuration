'use server'

import {
  and,
  asc,
  commentThreads,
  comments,
  desc,
  eq,
  getDb,
  inArray,
  isNull,
  notifications,
  pageRole,
  pages,
  publish,
  sql,
  users,
  workspaceRole,
} from '@murmuration/db'
import { atLeast, can, isInk, type Ink, type Role } from '@murmuration/shared'
import { requireUser } from '@/lib/auth'

export interface CommentView {
  id: string
  authorId: string | null
  authorName: string
  authorInk: Ink
  body: string
  createdAt: string
}

export interface ThreadView {
  id: string
  anchorStart: string
  anchorEnd: string
  quote: string
  createdAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  comments: CommentView[]
}

type Result<T = object> = ({ error?: undefined } & T) | { error: string }

const MENTION = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/g
const B64 = /^[A-Za-z0-9+/=]{4,512}$/

function cleanBody(body: unknown): string | null {
  if (typeof body !== 'string') return null
  const t = body.replace(/\r\n/g, '\n').trim()
  return t.length > 0 && t.length <= 4000 ? t : null
}

async function access(pageId: string, userId: string): Promise<{ role: Role; workspaceId: string } | null> {
  const a = await pageRole(userId, pageId)
  return a?.role ? { role: a.role, workspaceId: a.workspaceId } : null
}

/** People mentioned in a body who can actually open the page. */
async function mentionedUsers(body: string, pageId: string): Promise<string[]> {
  const ids = [...new Set([...body.matchAll(MENTION)].map((m) => m[1]!))].slice(0, 20)
  const ok = await Promise.all(ids.map(async (id) => ((await pageRole(id, pageId))?.role ? id : null)))
  return ok.filter((x): x is string => x !== null)
}

async function notify(opts: {
  actorId: string
  pageId: string
  workspaceId: string
  threadId: string
  commentId: string
  body: string
}) {
  const db = getDb()
  const mentioned = new Set((await mentionedUsers(opts.body, opts.pageId)).filter((id) => id !== opts.actorId))
  // Everyone who already wrote in the thread hears about replies.
  const earlier = await db
    .selectDistinct({ id: comments.authorId })
    .from(comments)
    .where(eq(comments.threadId, opts.threadId))
  const repliedTo = earlier
    .map((r) => r.id)
    .filter((id): id is string => !!id && id !== opts.actorId && !mentioned.has(id))
  const rows = [
    ...[...mentioned].map((userId) => ({ userId, kind: 'mention' as const })),
    ...repliedTo.map((userId) => ({ userId, kind: 'reply' as const })),
  ]
  if (!rows.length) return
  await db.insert(notifications).values(
    rows.map((r) => ({
      ...r,
      workspaceId: opts.workspaceId,
      pageId: opts.pageId,
      threadId: opts.threadId,
      commentId: opts.commentId,
      actorId: opts.actorId,
    })),
  )
  await publish({ kind: 'inbox', userIds: rows.map((r) => r.userId) })
}

/* ---------------- threads ---------------- */

export async function listThreads(pageId: string): Promise<Result<{ threads: ThreadView[] }>> {
  const user = await requireUser()
  if (!(await access(pageId, user.id))) return { error: 'No access to this page.' }
  const db = getDb()
  const threads = await db
    .select()
    .from(commentThreads)
    .where(eq(commentThreads.pageId, pageId))
    .orderBy(asc(commentThreads.createdAt))
  if (!threads.length) return { threads: [] }
  const rows = await db
    .select({
      id: comments.id,
      threadId: comments.threadId,
      authorId: comments.authorId,
      authorName: users.name,
      authorInk: users.ink,
      body: comments.body,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(inArray(comments.threadId, threads.map((t) => t.id)))
    .orderBy(asc(comments.createdAt))
  const resolverIds = [...new Set(threads.map((t) => t.resolvedBy).filter((x): x is string => !!x))]
  const resolvers = new Map(
    resolverIds.length
      ? (await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, resolverIds))).map((u) => [u.id, u.name])
      : [],
  )
  const byThread = new Map<string, CommentView[]>()
  for (const r of rows) {
    const list = byThread.get(r.threadId) ?? []
    list.push({
      id: r.id,
      authorId: r.authorId,
      authorName: r.authorName ?? 'Former member',
      authorInk: isInk(r.authorInk) ? r.authorInk : 'ochre',
      body: r.body,
      createdAt: r.createdAt.toISOString(),
    })
    byThread.set(r.threadId, list)
  }
  return {
    threads: threads
      .map((t) => ({
        id: t.id,
        anchorStart: t.anchorStart,
        anchorEnd: t.anchorEnd,
        quote: t.quote,
        createdAt: t.createdAt.toISOString(),
        resolvedAt: t.resolvedAt?.toISOString() ?? null,
        resolvedBy: t.resolvedBy ? (resolvers.get(t.resolvedBy) ?? null) : null,
        comments: byThread.get(t.id) ?? [],
      }))
      .filter((t) => t.comments.length > 0),
  }
}

export async function createThread(
  pageId: string,
  anchor: { start: string; end: string; quote: string },
  body: string,
): Promise<Result<{ threadId: string }>> {
  const user = await requireUser()
  const a = await access(pageId, user.id)
  if (!a || !can(a.role, 'comment')) return { error: 'You can’t comment on this page.' }
  const text = cleanBody(body)
  if (!text) return { error: 'Write something first (up to 4,000 characters).' }
  if (!B64.test(anchor.start) || !B64.test(anchor.end)) return { error: 'That selection can’t be commented on.' }
  const db = getDb()
  const [thread] = await db
    .insert(commentThreads)
    .values({
      pageId,
      workspaceId: a.workspaceId,
      anchorStart: anchor.start,
      anchorEnd: anchor.end,
      quote: String(anchor.quote ?? '').slice(0, 500),
      createdBy: user.id,
    })
    .returning({ id: commentThreads.id })
  const [comment] = await db
    .insert(comments)
    .values({ threadId: thread!.id, authorId: user.id, body: text })
    .returning({ id: comments.id })
  await notify({ actorId: user.id, pageId, workspaceId: a.workspaceId, threadId: thread!.id, commentId: comment!.id, body: text })
  await publish({ kind: 'comments', pageId })
  return { threadId: thread!.id }
}

async function threadAccess(threadId: string, userId: string) {
  const [t] = await getDb().select().from(commentThreads).where(eq(commentThreads.id, threadId))
  if (!t) return null
  const a = await access(t.pageId, userId)
  return a ? { thread: t, ...a } : null
}

export async function replyToThread(threadId: string, body: string): Promise<Result> {
  const user = await requireUser()
  const a = await threadAccess(threadId, user.id)
  if (!a || !can(a.role, 'comment')) return { error: 'You can’t reply here.' }
  const text = cleanBody(body)
  if (!text) return { error: 'Write something first (up to 4,000 characters).' }
  const db = getDb()
  const [comment] = await db.insert(comments).values({ threadId, authorId: user.id, body: text }).returning({ id: comments.id })
  // A reply reopens a resolved thread, the way people expect.
  if (a.thread.resolvedAt) {
    await db.update(commentThreads).set({ resolvedAt: null, resolvedBy: null }).where(eq(commentThreads.id, threadId))
  }
  await notify({ actorId: user.id, pageId: a.thread.pageId, workspaceId: a.workspaceId, threadId, commentId: comment!.id, body: text })
  await publish({ kind: 'comments', pageId: a.thread.pageId })
  return {}
}

export async function setThreadResolved(threadId: string, resolved: boolean): Promise<Result> {
  const user = await requireUser()
  const a = await threadAccess(threadId, user.id)
  if (!a || !can(a.role, 'comment')) return { error: 'You can’t resolve this.' }
  await getDb()
    .update(commentThreads)
    .set(resolved ? { resolvedAt: new Date(), resolvedBy: user.id } : { resolvedAt: null, resolvedBy: null })
    .where(eq(commentThreads.id, threadId))
  await publish({ kind: 'comments', pageId: a.thread.pageId })
  return {}
}

/** Re-pin a thread whose text was replaced (e.g. by restoring an older version). */
export async function moveThreadAnchor(threadId: string, start: string, end: string): Promise<Result> {
  const user = await requireUser()
  const a = await threadAccess(threadId, user.id)
  if (!a || !can(a.role, 'edit')) return { error: 'You can’t move this comment.' }
  if (!B64.test(start) || !B64.test(end)) return { error: 'Invalid anchor.' }
  await getDb().update(commentThreads).set({ anchorStart: start, anchorEnd: end }).where(eq(commentThreads.id, threadId))
  await publish({ kind: 'comments', pageId: a.thread.pageId })
  return {}
}

/** Authors can delete their own comments; admins can delete any. Deleting the first comment removes the thread. */
export async function deleteComment(commentId: string): Promise<Result> {
  const user = await requireUser()
  const db = getDb()
  const [c] = await db.select().from(comments).where(eq(comments.id, commentId))
  if (!c) return {}
  const a = await threadAccess(c.threadId, user.id)
  if (!a) return { error: 'No access.' }
  const isAdmin = atLeast(await workspaceRole(user.id, a.workspaceId), 'admin')
  if (c.authorId !== user.id && !isAdmin) return { error: 'You can only delete your own comments.' }
  const [first] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(eq(comments.threadId, c.threadId))
    .orderBy(asc(comments.createdAt))
    .limit(1)
  if (first?.id === c.id) await db.delete(commentThreads).where(eq(commentThreads.id, c.threadId))
  else await db.delete(comments).where(eq(comments.id, c.id))
  await publish({ kind: 'comments', pageId: a.thread.pageId })
  return {}
}

/* ---------------- inbox ---------------- */

export interface InboxItem {
  id: string
  kind: 'mention' | 'reply'
  read: boolean
  createdAt: string
  actorName: string
  actorInk: Ink
  pageId: string
  pageTitle: string
  threadId: string
  quote: string
  body: string
}

export async function listInbox(workspaceId: string): Promise<InboxItem[]> {
  const user = await requireUser()
  const rows = await getDb()
    .select({
      id: notifications.id,
      kind: notifications.kind,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      actorName: users.name,
      actorInk: users.ink,
      pageId: notifications.pageId,
      pageTitle: pages.title,
      threadId: notifications.threadId,
      quote: commentThreads.quote,
      body: comments.body,
    })
    .from(notifications)
    .innerJoin(comments, eq(comments.id, notifications.commentId))
    .innerJoin(commentThreads, eq(commentThreads.id, notifications.threadId))
    .innerJoin(pages, and(eq(pages.id, notifications.pageId), isNull(pages.archivedAt)))
    .leftJoin(users, eq(users.id, notifications.actorId))
    .where(and(eq(notifications.userId, user.id), eq(notifications.workspaceId, workspaceId)))
    .orderBy(desc(notifications.createdAt))
    .limit(60)
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    read: !!r.readAt,
    createdAt: r.createdAt.toISOString(),
    actorName: r.actorName ?? 'Someone',
    actorInk: isInk(r.actorInk) ? r.actorInk : 'ochre',
    pageId: r.pageId,
    pageTitle: r.pageTitle || 'Untitled',
    threadId: r.threadId,
    quote: r.quote,
    body: r.body,
  }))
}

export async function unreadCount(workspaceId: string): Promise<number> {
  const user = await requireUser()
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.workspaceId, workspaceId), isNull(notifications.readAt)))
  return row?.n ?? 0
}

/** Mark some (or, with no ids, all) of my notifications in a workspace as read. */
export async function markRead(workspaceId: string, ids?: string[]): Promise<void> {
  const user = await requireUser()
  const where = [eq(notifications.userId, user.id), eq(notifications.workspaceId, workspaceId), isNull(notifications.readAt)]
  if (ids?.length) where.push(inArray(notifications.id, ids.slice(0, 200)))
  await getDb().update(notifications).set({ readAt: new Date() }).where(and(...where))
  await publish({ kind: 'inbox', userIds: [user.id] })
}

/** Mark everything about one thread as read (opening it from the page). */
export async function markThreadRead(threadId: string): Promise<void> {
  const user = await requireUser()
  const res = await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, user.id), eq(notifications.threadId, threadId), isNull(notifications.readAt)))
    .returning({ id: notifications.id })
  if (res.length) await publish({ kind: 'inbox', userIds: [user.id] })
}
