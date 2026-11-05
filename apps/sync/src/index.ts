import { closeDb, EVENTS_CHANNEL, getSql } from '@murmuration/db'
import type { LiveEvent } from '@murmuration/shared'
import { pgAccess, pgStore } from './pg'
import { createSyncServer } from './server'

const secret = process.env.SYNC_TOKEN_SECRET
if (!secret || secret.length < 32) {
  console.error('SYNC_TOKEN_SECRET must be set (32+ characters). Copy .env.example to .env.')
  process.exit(1)
}

const server = await createSyncServer({
  port: Number(process.env.SYNC_PORT ?? 4001),
  secret,
  store: pgStore,
  access: pgAccess,
  events(handler) {
    const listening = getSql().listen(EVENTS_CHANNEL, (payload) => {
      try {
        handler(JSON.parse(payload) as LiveEvent)
      } catch {
        console.error('[sync] ignored malformed event', payload)
      }
    })
    return () => void listening.then((l) => l.unlisten())
  },
})
console.log(`[sync] listening on ws://localhost:${server.port}`)

let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  console.log('[sync] flushing documents and shutting down…')
  await server.close()
  await closeDb()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
