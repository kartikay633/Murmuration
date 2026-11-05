import { and, asc, eq, getDb, isNull, memberships, pageRoles, pages, users, workspaces } from '@murmuration/db'
import type { Ink, Role } from '@murmuration/shared'

export interface WorkspaceSummary {
  id: string
  name: string
  role: Role
}

export interface Member {
  id: string
  name: string
  email: string
  ink: Ink
  role: Role
  isBot: boolean
}

export async function listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  return getDb()
    .select({ id: workspaces.id, name: workspaces.name, role: memberships.role })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(workspaces.createdAt))
}

export async function listMembers(workspaceId: string): Promise<Member[]> {
  return getDb()
    .select({ id: users.id, name: users.name, email: users.email, ink: users.ink, role: memberships.role, isBot: users.isBot })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspaceId))
    .orderBy(asc(memberships.createdAt))
}

export async function firstPage(workspaceId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), isNull(pages.archivedAt)))
    .orderBy(asc(pages.createdAt))
    .limit(1)
  return row?.id ?? null
}

export async function pageOverrides(pageId: string): Promise<Record<string, Role>> {
  const rows = await getDb().select().from(pageRoles).where(eq(pageRoles.pageId, pageId))
  return Object.fromEntries(rows.map((r) => [r.userId, r.role]))
}
