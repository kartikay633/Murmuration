import { closeDb, EVENTS_CHANNEL, getSql } from '@murmuration/db'
import type { LiveEvent } from '@murmuration/shared'
import { redisBus } from './bus'
import { pgAccess, pgStore } from './pg'
import { runPractice } from './practice'
import { createSyncServer } from './server'

const secret = process.env.SYNC_TOKEN_SECRET
if (!secret || secret.length < 32) {
  console.error('SYNC_TOKEN_SECRET must be set (32+ characters). Copy .env.example to .env.')
  process.exit(1)
}

let port = Number(process.env.SYNC_PORT ?? 4001)
// With REDIS_URL set, any number of sync servers can run side by side.
const bus = process.env.REDIS_URL ? await redisBus(process.env.REDIS_URL) : undefined
const server = await createSyncServer({
  port: Number(process.env.SYNC_PORT ?? 4001),
  secret,
  store: pgStore,
  access: pgAccess,
  bus,
  events(handler) {
    const listening = getSql().listen(EVENTS_CHANNEL, (payload) => {
      let event: LiveEvent
      try {
        event = JSON.parse(payload) as LiveEvent
      } catch {
        return console.error('[sync] ignored malformed event', payload)
      }
      if (event.kind === 'practice') {
        void runPractice(event, { port, secret, log: (m, e) => console.error(`[practice] ${m}`, e ?? '') })
      } else handler(event)
    })
    return () => void listening.then((l) => l.unlisten())
  },
})
port = server.port
console.log(`[sync] listening on ws://localhost:${server.port}${bus ? ' (linked to other servers through Redis)' : ''}`)

let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  console.log('[sync] flushing documents and shutting down…')
  await server.close()
  await bus?.close?.()
  await closeDb()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
