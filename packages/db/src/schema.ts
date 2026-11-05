import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
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
  /** Practice collaborators: scripted accounts that can't sign in. */
  isBot: boolean('is_bot').notNull().default(false),
  /** One-click demo accounts; removed automatically after a week. */
  isGuest: boolean('is_guest').notNull().default(false),
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

/**
 * A conversation pinned to a stretch of a page. The anchor is a pair of Yjs
 * relative positions (base64), so it follows the text through everyone's edits
 * instead of pointing at a fixed character offset.
 */
export const commentThreads = pgTable(
  'comment_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    anchorStart: text('anchor_start').notNull(),
    anchorEnd: text('anchor_end').notNull(),
    /** The text as it was when the thread started, shown if the anchor is later deleted. */
    quote: text('quote').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: created(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('comment_threads_page_idx').on(t.pageId)],
)

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id').notNull().references(() => commentThreads.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** Plain text; mentions are stored as <@user-uuid>. */
    body: text('body').notNull(),
    createdAt: created(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [index('comments_thread_idx').on(t.threadId, t.createdAt)],
)

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id').notNull().references(() => commentThreads.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').notNull().references(() => comments.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').$type<'mention' | 'reply'>().notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
)

/**
 * Which page has practice collaborators running. Every sync server hears the
 * request (Postgres NOTIFY); the one that claims this row runs the session.
 */
export const practiceRuns = pgTable('practice_runs', {
  pageId: uuid('page_id').primaryKey().references(() => pages.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
})

export type User = typeof users.$inferSelect
export type Workspace = typeof workspaces.$inferSelect
export type Page = typeof pages.$inferSelect
