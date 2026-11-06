'use server'

import * as Y from 'yjs'
import { and, desc, docEvents, eq, getDb, gt, isNull, pages, sql, users, workspaceRole } from '@murmuration/db'
import { can, isInk, type Ink } from '@murmuration/shared'
import { requireUser } from '@/lib/auth'

export interface Session {
  pageId: string
  pageTitle: string
  authorId: string
  authorName: string
  authorInk: Ink
  start: string
  end: string
  /** Characters of text they typed (still counted if later deleted). */
  added: number
  edits: number
}

export interface Activity {
  sessions: Session[]
  people: number
  pages: number
}

/** Edits by the same person on the same page this close together are one session. */
const GAP_MS = 15 * 60_000
const WINDOW_DAYS = 7

/** Characters inserted by an update (ignoring formatting and structure). */
function insertedChars(update: Uint8Array): number {
  let n = 0
  try {
    for (const s of Y.decodeUpdate(update).structs) {
      if (s instanceof Y.Item && s.content instanceof Y.ContentString) n += s.length
    }
  } catch {
    /* not a decodable update; count nothing */
  }
  return n
}

/** Who worked on what in this workspace over the last week. */
export async function workspaceActivity(workspaceId: string): Promise<Activity | null> {
  const user = await requireUser()
  if (!can(await workspaceRole(user.id, workspaceId), 'view')) return null
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000)

  const rows = await getDb()
    .select({
      pageId: pages.id,
      pageTitle: pages.title,
      authorId: docEvents.authorId,
      authorName: users.name,
      authorInk: users.ink,
      update: docEvents.update,
      at: docEvents.createdAt,
    })
    .from(docEvents)
    .innerJoin(pages, sql`${docEvents.docName} = 'page:' || ${pages.id}`)
    .innerJoin(users, eq(users.id, docEvents.authorId))
    .where(and(eq(pages.workspaceId, workspaceId), isNull(pages.archivedAt), gt(docEvents.createdAt, since)))
    .orderBy(desc(docEvents.id))
    .limit(4000)

  // Newest first; extend a session while the same person keeps editing the same page.
  const sessions: Session[] = []
  const open = new Map<string, Session>()
  for (const r of rows) {
    const key = `${r.authorId}:${r.pageId}`
    const at = r.at.getTime()
    const s = open.get(key)
    const chars = insertedChars(r.update)
    if (s && new Date(s.start).getTime() - at <= GAP_MS) {
      s.start = r.at.toISOString()
      s.added += chars
      s.edits++
      continue
    }
    const next: Session = {
      pageId: r.pageId,
      pageTitle: r.pageTitle,
      authorId: r.authorId!,
      authorName: r.authorName,
      authorInk: isInk(r.authorInk) ? r.authorInk : 'ochre',
      start: r.at.toISOString(),
      end: r.at.toISOString(),
      added: chars,
      edits: 1,
    }
    open.set(key, next)
    sessions.push(next)
  }
  sessions.sort((a, b) => b.end.localeCompare(a.end))

  return {
    sessions: sessions.slice(0, 200),
    people: new Set(sessions.map((s) => s.authorId)).size,
    pages: new Set(sessions.map((s) => s.pageId)).size,
  }
}
