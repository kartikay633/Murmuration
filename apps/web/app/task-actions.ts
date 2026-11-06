'use server'

import { and, asc, eq, getDb, inArray, isNull, pageRole, pages, pageTasks, users, workspaceRole } from '@murmuration/db'
import { can, isInk, type Ink } from '@murmuration/shared'
import { requireUser } from '@/lib/auth'

export interface TaskRow {
  pageId: string
  position: number
  text: string
  done: boolean
  assignees: { id: string; name: string; ink: Ink }[]
}

export interface TaskPage {
  id: string
  title: string
  canEdit: boolean
  tasks: TaskRow[]
}

/** Every to-do in the workspace, grouped by page (pages in sidebar-independent title order). */
export async function workspaceTasks(workspaceId: string): Promise<TaskPage[] | null> {
  const user = await requireUser()
  if (!can(await workspaceRole(user.id, workspaceId), 'view')) return null
  const db = getDb()
  const rows = await db
    .select({
      pageId: pageTasks.pageId,
      title: pages.title,
      position: pageTasks.position,
      text: pageTasks.text,
      done: pageTasks.done,
      assignees: pageTasks.assignees,
    })
    .from(pageTasks)
    .innerJoin(pages, eq(pages.id, pageTasks.pageId))
    .where(and(eq(pages.workspaceId, workspaceId), isNull(pages.archivedAt)))
    .orderBy(asc(pages.title), asc(pageTasks.position))
    .limit(3000)

  const ids = [...new Set(rows.flatMap((r) => r.assignees))]
  const people = ids.length ? await db.select({ id: users.id, name: users.name, ink: users.ink }).from(users).where(inArray(users.id, ids)) : []
  const byId = new Map(people.map((p) => [p.id, { id: p.id, name: p.name, ink: (isInk(p.ink) ? p.ink : 'ochre') as Ink }]))

  const pagesOut = new Map<string, TaskPage>()
  for (const r of rows) {
    let p = pagesOut.get(r.pageId)
    if (!p) pagesOut.set(r.pageId, (p = { id: r.pageId, title: r.title || 'Untitled', canEdit: false, tasks: [] }))
    p.tasks.push({
      pageId: r.pageId,
      position: r.position,
      text: r.text,
      done: r.done,
      assignees: r.assignees.map((a) => byId.get(a)).filter((a): a is NonNullable<typeof a> => !!a),
    })
  }
  // Ticking a to-do edits its page, so it needs edit rights there (page overrides included).
  for (const p of pagesOut.values()) p.canEdit = can((await pageRole(user.id, p.id))?.role ?? null, 'edit')
  return [...pagesOut.values()]
}
