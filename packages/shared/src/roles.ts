/**
 * Roles, from least to most capable. A page can override a member's workspace
 * role (up or down), except that owners and admins always keep full access.
 */
export const ROLES = ['viewer', 'commenter', 'editor', 'admin', 'owner'] as const
export type Role = (typeof ROLES)[number]

export const rank = (role: Role): number => ROLES.indexOf(role)

export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value)

export function atLeast(role: Role | null | undefined, min: Role): boolean {
  return role != null && rank(role) >= rank(min)
}

export function effectiveRole(workspaceRole: Role | null, pageOverride: Role | null): Role | null {
  if (workspaceRole == null) return pageOverride
  if (atLeast(workspaceRole, 'admin')) return workspaceRole
  return pageOverride ?? workspaceRole
}

/** On a locked page, people below admin can at most comment. */
export function lockedRole(role: Role | null): Role | null {
  if (!role || atLeast(role, 'admin')) return role
  return atLeast(role, 'commenter') ? 'commenter' : role
}

export type Action =
  | 'view'
  | 'comment'
  | 'edit'
  | 'manage-pages'
  | 'manage-members'
  | 'manage-workspace'

const MIN_ROLE: Record<Action, Role> = {
  view: 'viewer',
  comment: 'commenter',
  edit: 'editor',
  'manage-pages': 'editor',
  'manage-members': 'admin',
  'manage-workspace': 'owner',
}

export const can = (role: Role | null | undefined, action: Action): boolean =>
  atLeast(role, MIN_ROLE[action])

/** Roles an actor may hand out: never above their own, and never owner. */
export function assignableRoles(actor: Role): Role[] {
  return ROLES.filter((r) => r !== 'owner' && rank(r) <= rank(actor))
}

export const ROLE_LABEL: Record<Role, string> = {
  viewer: 'Can view',
  commenter: 'Can comment',
  editor: 'Can edit',
  admin: 'Admin',
  owner: 'Owner',
}
