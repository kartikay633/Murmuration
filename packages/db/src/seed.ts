/**
 * Local demo data: four people in one workspace with a few pages.
 * Every account uses the password below. These are test values for local
 * development only.
 */
import { hash } from '@node-rs/argon2'
import * as Y from 'yjs'
import { keyBetween, pageDoc, TREE_PAGES, treeDoc, type Ink, type Role } from '@murmuration/shared'
import { closeDb, getDb } from './client'
import { writeBlocks, type Block } from './content'
import { activity, docEvents, docSnapshots, memberships, pageRoles, pages, sessions, users, workspaces } from './schema'

export const DEMO_PASSWORD = 'murmuration-demo'

const PEOPLE: { name: string; email: string; ink: Ink; role: Role }[] = [
  { name: 'Demo User', email: 'demo@murmuration.test', ink: 'plum', role: 'owner' },
  { name: 'Ana Ferreira', email: 'ana@murmuration.test', ink: 'vermilion', role: 'admin' },
  { name: 'Rohan Mehta', email: 'rohan@murmuration.test', ink: 'cobalt', role: 'editor' },
  { name: 'Mei Tanaka', email: 'mei@murmuration.test', ink: 'moss', role: 'commenter' },
]

const PAGES: { key: string; title: string; parent?: string; author: number; blocks: Block[] }[] = [
  {
    key: 'eng',
    title: 'Engineering',
    author: 0,
    blocks: [{ p: 'Design reviews, protocol notes and incident write-ups live under this page.' }],
  },
  {
    key: 'offline',
    title: 'Offline mode — design review',
    parent: 'eng',
    author: 2,
    blocks: [
      { p: "We want editing to keep working when the connection doesn't. Someone on a train should be able to write for twenty minutes, reconnect, and lose nothing — including whatever their teammates changed in the meantime." },
      { h: "What we're proposing" },
      { p: "Every client keeps a full replica of the page in IndexedDB. Edits apply locally first and queue as updates. When the socket comes back, the client sends its state vector and receives only the part it's missing — usually a few hundred bytes." },
      { ul: [
        'No locks, and no “someone else is editing this” banners.',
        'Merges are deterministic: every replica ends up byte-identical, whatever order the updates arrive in.',
        'Comments stay attached to the sentence they were left on.',
      ] },
      { h: 'Open questions' },
      { p: "How long can a client stay offline before we force a full resync? Snapshots every 200 events keep catch-up cheap, but a replica that's been away for a month still has a lot to replay." },
    ],
  },
  {
    key: 'protocol',
    title: 'Sync protocol v2',
    parent: 'eng',
    author: 1,
    blocks: [
      { p: 'One socket per tab, many documents. Every frame starts with a type and a document name, so a tab can follow the page tree and an open page over the same connection.' },
      { h: 'Messages' },
      { ul: ['SYNC — Yjs step 1, step 2 and updates', 'AWARENESS — cursors and selections', 'SUBSCRIBE / UNSUBSCRIBE', 'ROLE, SAVED and ERROR from the server'] },
    ],
  },
  {
    key: 'roadmap',
    title: 'Q4 roadmap',
    author: 0,
    blocks: [
      { p: 'Three things ship this quarter: offline editing, page history, and comments that survive edits.' },
      { h: 'Not this quarter' },
      { p: 'Databases inside pages, public sharing, mobile apps.' },
    ],
  },
  {
    key: 'welcome',
    title: 'Welcome to Kestrel Labs',
    author: 0,
    blocks: [
      { p: 'This workspace is where the team writes things down. Open a page in two windows and type in both to see how it works.' },
    ],
  },
]

async function main() {
  const db = getDb()
  console.log('Clearing old data…')
  await db.delete(activity)
  await db.delete(docSnapshots)
  await db.delete(docEvents)
  await db.delete(pageRoles)
  await db.delete(pages)
  await db.delete(memberships)
  await db.delete(workspaces)
  await db.delete(sessions)
  await db.delete(users)

  const passwordHash = await hash(DEMO_PASSWORD)
  const people = await db
    .insert(users)
    .values(PEOPLE.map((p) => ({ name: p.name, email: p.email, ink: p.ink, passwordHash })))
    .returning()
  const byEmail = new Map(people.map((u) => [u.email, u]))
  const ids = PEOPLE.map((p) => byEmail.get(p.email)!.id)

  const [ws] = await db.insert(workspaces).values({ name: 'Kestrel Labs', createdBy: ids[0]! }).returning()
  await db.insert(memberships).values(PEOPLE.map((p, i) => ({ workspaceId: ws!.id, userId: ids[i]!, role: p.role })))

  const [personal] = await db.insert(workspaces).values({ name: 'Personal', createdBy: ids[0]! }).returning()
  await db.insert(memberships).values({ workspaceId: personal!.id, userId: ids[0]!, role: 'owner' })

  // Pages + their bodies
  const pageIds = new Map<string, string>()
  const tree = new Y.Doc()
  const treeMap = tree.getMap<Y.Map<unknown>>(TREE_PAGES)
  const lastKey = new Map<string | null, string>()
  for (const p of PAGES) {
    const author = ids[p.author]!
    const [row] = await db
      .insert(pages)
      .values({ workspaceId: ws!.id, title: p.title, createdBy: author })
      .returning()
    pageIds.set(p.key, row!.id)

    const parentId = p.parent ? pageIds.get(p.parent)! : null
    const position = keyBetween(lastKey.get(parentId) ?? '', '')
    lastKey.set(parentId, position)
    const node = new Y.Map<unknown>()
    for (const [k, v] of Object.entries({
      id: row!.id, title: p.title, parentId, position, icon: null,
      createdAt: Date.now(), createdBy: author, archived: false,
    })) node.set(k, v)
    treeMap.set(row!.id, node)

    const body = new Y.Doc()
    writeBlocks(body.getXmlFragment('default'), p.blocks)
    await db.insert(docEvents).values({ docName: pageDoc(row!.id), authorId: author, update: Y.encodeStateAsUpdate(body) })
  }
  await db.insert(docEvents).values({ docName: treeDoc(ws!.id), authorId: ids[0]!, update: Y.encodeStateAsUpdate(tree) })

  const personalTree = new Y.Doc()
  const [note] = await db.insert(pages).values({ workspaceId: personal!.id, title: 'Reading list', createdBy: ids[0]! }).returning()
  const n = new Y.Map<unknown>()
  for (const [k, v] of Object.entries({
    id: note!.id, title: 'Reading list', parentId: null, position: keyBetween('', ''), icon: null,
    createdAt: Date.now(), createdBy: ids[0]!, archived: false,
  })) n.set(k, v)
  personalTree.getMap(TREE_PAGES).set(note!.id, n)
  const noteBody = new Y.Doc()
  writeBlocks(noteBody.getXmlFragment('default'), [{ p: 'Designing Data-Intensive Applications, chapter 5. Then the Yjs internals write-up.' }])
  await db.insert(docEvents).values([
    { docName: treeDoc(personal!.id), authorId: ids[0]!, update: Y.encodeStateAsUpdate(personalTree) },
    { docName: pageDoc(note!.id), authorId: ids[0]!, update: Y.encodeStateAsUpdate(noteBody) },
  ])

  console.log(`Seeded ${PEOPLE.length} people, 2 workspaces, ${PAGES.length + 1} pages.`)
  console.log(`Sign in as demo@murmuration.test (or ana@, rohan@, mei@) with password "${DEMO_PASSWORD}".`)
  await closeDb()
}

main().catch(async (e) => {
  console.error(e)
  await closeDb()
  process.exit(1)
})
