import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
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

export async function closeDb() {
  await g.__mmSql?.end({ timeout: 2 })
  g.__mmSql = undefined
  g.__mmDb = undefined
}
