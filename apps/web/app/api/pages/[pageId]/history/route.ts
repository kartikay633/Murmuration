import { asc, docEvents, eq, getDb, inArray, pageRole, users } from '@murmuration/db'
import { pageDoc } from '@murmuration/shared'
import { currentUser } from '@/lib/auth'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const LIMIT = 20_000

export interface HistoryPayload {
  authors: Record<string, { name: string; ink: string }>
  /** Oldest first. `u` is the base64 Yjs update, `a` its author id, `t` epoch ms. */
  events: { id: number; a: string | null; t: number; u: string }[]
  truncated: boolean
}

/**
 * Every stored update for a page, in order, with who made it. The client
 * replays these to rebuild the page at any moment and to colour text by author.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params
  if (!UUID.test(pageId)) return Response.json({ error: 'not found' }, { status: 404 })
  const user = await currentUser()
  if (!user) return Response.json({ error: 'signed out' }, { status: 401 })
  if (!(await pageRole(user.id, pageId))?.role) return Response.json({ error: 'not found' }, { status: 404 })

  const db = getDb()
  const rows = await db
    .select({ id: docEvents.id, authorId: docEvents.authorId, createdAt: docEvents.createdAt, update: docEvents.update })
    .from(docEvents)
    .where(eq(docEvents.docName, pageDoc(pageId)))
    .orderBy(asc(docEvents.id))
    .limit(LIMIT + 1)
  const truncated = rows.length > LIMIT
  const events = rows.slice(0, LIMIT)
  const ids = [...new Set(events.map((e) => e.authorId).filter((x): x is string => !!x))]
  const people = ids.length
    ? await db.select({ id: users.id, name: users.name, ink: users.ink }).from(users).where(inArray(users.id, ids))
    : []

  const body: HistoryPayload = {
    authors: Object.fromEntries(people.map((p) => [p.id, { name: p.name, ink: p.ink }])),
    events: events.map((e) => ({
      id: e.id,
      a: e.authorId,
      t: e.createdAt.getTime(),
      u: Buffer.from(e.update).toString('base64'),
    })),
    truncated,
  }
  return Response.json(body, { headers: { 'cache-control': 'private, no-store' } })
}
