import { closeDb, EVENTS_CHANNEL, getSql } from '@murmuration/db'
import type { LiveEvent } from '@murmuration/shared'
import { pgAccess, pgStore } from './pg'
import { runPractice } from './practice'
import { createSyncServer } from './server'

const secret = process.env.SYNC_TOKEN_SECRET
if (!secret || secret.length < 32) {
  console.error('SYNC_TOKEN_SECRET must be set (32+ characters). Copy .env.example to .env.')
  process.exit(1)
}

let port = Number(process.env.SYNC_PORT ?? 4001)
const server = await createSyncServer({
  port: Number(process.env.SYNC_PORT ?? 4001),
  secret,
  store: pgStore,
  access: pgAccess,
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
