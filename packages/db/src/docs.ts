import { and, asc, desc, eq, gt, isNull, lte } from 'drizzle-orm'
import { getDb } from './client'
import { docEvents, docSnapshots, reminders } from './schema'

/** A document's stored state: its latest snapshot followed by every event after it. */
export async function loadDocUpdates(docName: string): Promise<Uint8Array[]> {
  const db = getDb()
  const [snap] = await db
    .select({ upto: docSnapshots.uptoEventId, state: docSnapshots.state })
    .from(docSnapshots)
    .where(eq(docSnapshots.docName, docName))
    .orderBy(desc(docSnapshots.uptoEventId))
    .limit(1)
  const events = await db
    .select({ update: docEvents.update })
    .from(docEvents)
    .where(and(eq(docEvents.docName, docName), gt(docEvents.id, snap?.upto ?? 0)))
    .orderBy(asc(docEvents.id))
  return [...(snap ? [snap.state] : []), ...events.map((e) => e.update)]
}

/** Mark reminders that just came due as delivered; returns whose inboxes changed. */
export async function claimDueReminders(): Promise<string[]> {
  const rows = await getDb()
    .update(reminders)
    .set({ notifiedAt: new Date() })
    .where(and(lte(reminders.dueAt, new Date()), isNull(reminders.notifiedAt)))
    .returning({ userId: reminders.userId })
  return [...new Set(rows.map((r) => r.userId))]
}
