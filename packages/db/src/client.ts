import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { LiveEvent } from '@murmuration/shared'
import * as schema from './schema'

type Db = ReturnType<typeof drizzle<typeof schema>>

// Reuse one pool per process (Next.js dev reloads modules; keep it on globalThis).
const g = globalThis as unknown as { __mmSql?: postgres.Sql; __mmDb?: Db }

export function getDb(): Db {
  if (!g.__mmDb) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.')
    g.__mmSql = postgres(url, { max: 10, onnotice: () => {} })
    g.__mmDb = drizzle(g.__mmSql, { schema })
  }
  return g.__mmDb
}

/** The raw postgres.js client, for LISTEN/NOTIFY. */
export function getSql(): postgres.Sql {
  getDb()
  return g.__mmSql!
}

/** Channel the web app uses to tell sync servers that something changed. */
export const EVENTS_CHANNEL = 'mm_events'

export async function publish(event: LiveEvent) {
  await getSql().notify(EVENTS_CHANNEL, JSON.stringify(event))
}

export async function closeDb() {
  await g.__mmSql?.end({ timeout: 2 })
  g.__mmSql = undefined
  g.__mmDb = undefined
}
