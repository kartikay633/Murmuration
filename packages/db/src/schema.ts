import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  customType,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import type { Ink, Role } from '@murmuration/shared'

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength),
  fromDriver: (v) => new Uint8Array(v),
})

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  ink: text('ink').$type<Ink>().notNull(),
  createdAt: created(),
})

export const sessions = pgTable(
  'sessions',
  {
    /** sha-256 of the cookie value; the raw token never touches the database */
    id: text('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: created(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: created(),
})

export const memberships = pgTable(
  'memberships',
  {
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<Role>().notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index('memberships_user_idx').on(t.userId)],
)

export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Mirrors the tree document; kept for listing and search. */
    title: text('title').notNull().default(''),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: created(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [index('pages_workspace_idx').on(t.workspaceId)],
)

/** Per-page role overrides. */
export const pageRoles = pgTable(
  'page_roles',
  {
    pageId: uuid('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<Role>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.userId] })],
)

/**
 * Append-only log of every Yjs update, with who sent it. Loading a document is
 * "latest snapshot + events after it"; history and time travel replay from here.
 */
export const docEvents = pgTable(
  'doc_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    docName: text('doc_name').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    update: bytea('update').notNull(),
    createdAt: created(),
  },
  (t) => [index('doc_events_doc_idx').on(t.docName, t.id)],
)

export const docSnapshots = pgTable(
  'doc_snapshots',
  {
    docName: text('doc_name').notNull(),
    /** The snapshot contains every event with id <= this. */
    uptoEventId: bigint('upto_event_id', { mode: 'number' }).notNull(),
    state: bytea('state').notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.docName, t.uptoEventId] })],
)

export const activity = pgTable(
  'activity',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
    createdAt: created(),
  },
  (t) => [index('activity_workspace_idx').on(t.workspaceId, t.id)],
)

export type User = typeof users.$inferSelect
export type Workspace = typeof workspaces.$inferSelect
export type Page = typeof pages.$inferSelect
