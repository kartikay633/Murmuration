import { randomBytes } from 'node:crypto'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { INKS } from '@murmuration/shared'
import { getDb } from './client'
import { createWorkspaceWithPages, type PageSpec } from './content'
import { docEvents, pages, users, workspaces } from './schema'

const NAMES = ['Ash', 'Bay', 'Cove', 'Fern', 'Lark', 'Moss', 'Reed', 'Sage', 'Tide', 'Vale', 'Wren', 'Yew']

const DEMO_PAGES: PageSpec[] = [
  {
    key: 'start',
    title: 'Start here',
    author: 0,
    blocks: [
      { p: 'This is your own private sandbox. Everything you see is a real, working copy of Murmuration: type anywhere and it saves as you go.' },
      { h: 'Three things to try' },
      {
        ul: [
          'Open the ⋯ menu at the top right, choose Network Lab, and invite the practice collaborators. Three people join, type alongside you and mention you in a comment.',
          'In the Network Lab, switch your connection off, write a sentence, then switch it back on. Watch the copies merge and the fingerprints match.',
          'Use the clock button at the top right to replay this page, or ⋯ → Show who wrote what to colour every character by its author.',
        ],
      },
      { h: 'Even better with two browsers' },
      { p: 'Copy this page’s address into a private window. You’ll be the same person in both, with two cursors, and every edit appears in the other window as you type.' },
    ],
  },
  {
    key: 'notes',
    title: 'Design notes',
    author: 0,
    blocks: [
      { p: 'Every browser keeps a full copy of each page. Edits apply locally first, then travel to the sync server, which stores them in an append-only log and forwards them to everyone else.' },
      { p: 'Copies merge without locks because the page is a CRDT: whatever order edits arrive in, every copy ends up identical. Select a sentence here and leave a comment to see anchors that follow the text.' },
    ],
  },
  {
    key: 'tree',
    title: 'A nested page',
    parent: 'notes',
    author: 0,
    blocks: [{ p: 'Drag pages in the sidebar to reorder or nest them. Moves go through their own CRDT, so two people dragging at once can never create a loop.' }],
  },
]

/** A fresh guest account with its own sandbox workspace. Returns the user id and the page to open. */
export async function createGuest(): Promise<{ userId: string; workspaceId: string; firstPageId: string }> {
  const db = getDb()
  const name = `${NAMES[Math.floor(Math.random() * NAMES.length)]} (guest)`
  const [user] = await db
    .insert(users)
    .values({
      name,
      email: `guest-${randomBytes(8).toString('hex')}@guest.murmuration.invalid`,
      // Not an argon2 hash, so no password can ever match it.
      passwordHash: `!guest-${randomBytes(16).toString('hex')}`,
      ink: INKS[Math.floor(Math.random() * INKS.length)]!,
      isGuest: true,
    })
    .returning({ id: users.id })
  const { workspaceId, pageIds } = await createWorkspaceWithPages({
    name: 'Demo workspace',
    members: [{ userId: user!.id, role: 'owner' }],
    authors: [user!.id],
    pages: DEMO_PAGES,
  })
  return { userId: user!.id, workspaceId, firstPageId: pageIds.get('start')! }
}

/**
 * Atomically claim the right to run practice collaborators on a page. Exactly
 * one caller gets `true` per page per `seconds`, however many sync servers ask.
 */
export async function claimPracticeRun(pageId: string, seconds = 75): Promise<boolean> {
  const rows = await getDb().execute(sql`
    insert into practice_runs (page_id, started_at) values (${pageId}, now())
    on conflict (page_id) do update set started_at = now()
      where practice_runs.started_at < now() - make_interval(secs => ${seconds})
    returning page_id`)
  return rows.length > 0
}

/** Delete guest accounts (and their sandboxes) older than `days`. Returns how many were removed. */
export async function cleanupGuests(days: number): Promise<number> {
  const db = getDb()
  const cutoff = new Date(Date.now() - days * 86400_000)
  const old = await db.select({ id: users.id }).from(users).where(and(eq(users.isGuest, true), lt(users.createdAt, cutoff)))
  if (!old.length) return 0
  const ids = old.map((u) => u.id)
  const owned = await db.select({ id: workspaces.id }).from(workspaces).where(inArray(workspaces.createdBy, ids))
  if (owned.length) {
    const wsIds = owned.map((w) => w.id)
    const pageRows = await db.select({ id: pages.id }).from(pages).where(inArray(pages.workspaceId, wsIds))
    const docNames = [...pageRows.map((p) => `page:${p.id}`), ...wsIds.map((id) => `tree:${id}`)]
    if (docNames.length) await db.delete(docEvents).where(inArray(docEvents.docName, docNames))
    await db.delete(workspaces).where(inArray(workspaces.id, wsIds))
  }
  await db.delete(users).where(inArray(users.id, ids))
  return ids.length
}
