import type { Server as HttpServer } from 'node:http'
import { claimDueReminders, cleanupGuests, closeDb, EVENTS_CHANNEL, getSql, publish } from '@murmuration/db'
import type { LiveEvent } from '@murmuration/shared'
import { redisBus } from './bus'
import { backfillSearchText, pgAccess, pgStore } from './pg'
import { runPractice } from './practice'
import { createSyncServer } from './server'

/**
 * Start the production sync server: Postgres storage and access checks,
 * LISTEN for comment/inbox/practice events, Redis if REDIS_URL is set, and
 * hourly cleanup of expired guest accounts.
 */
export async function startSync(opts: { port: number; attach?: { server: HttpServer; path: string } }) {
  const secret = process.env.SYNC_TOKEN_SECRET
  if (!secret || secret.length < 32) {
    console.error('SYNC_TOKEN_SECRET must be set (32+ characters). Copy .env.example to .env.')
    process.exit(1)
  }
  const path = opts.attach?.path ?? ''
  let port = opts.port
  const bus = process.env.REDIS_URL ? await redisBus(process.env.REDIS_URL) : undefined

  const server = await createSyncServer({
    port: opts.port,
    attach: opts.attach,
    secret,
    store: pgStore,
    access: pgAccess,
    bus,
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()),
    events(handler) {
      const listening = getSql().listen(EVENTS_CHANNEL, (payload) => {
        let event: LiveEvent
        try {
          event = JSON.parse(payload) as LiveEvent
        } catch {
          return console.error('[sync] ignored malformed event', payload)
        }
        if (event.kind === 'practice') {
          const url = `ws://127.0.0.1:${port}${path}`
          void runPractice(event, { url, secret, log: (m, e) => console.error(`[practice] ${m}`, e ?? '') })
        } else handler(event)
      })
      return () => void listening.then((l) => l.unlisten())
    },
  })
  port = server.port

  const sweep = () =>
    cleanupGuests(7)
      .then((n) => n && console.log(`[sync] removed ${n} expired guest account(s)`))
      .catch((e) => console.error('[sync] guest cleanup failed', e))
  void sweep()
  void backfillSearchText(console.log).catch((e) => console.error('[sync] search backfill failed', e))
  const sweeper = setInterval(sweep, 3600_000)

  // Reminders that came due: nudge the owners' open tabs so the inbox updates.
  // Claiming is atomic, so with several sync servers each reminder fires once.
  const remind = () =>
    claimDueReminders()
      .then((userIds) => (userIds.length ? publish({ kind: 'inbox', userIds }) : undefined))
      .catch((e) => console.error('[sync] reminder sweep failed', e))
  const reminderTimer = setInterval(remind, 30_000)

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    console.log('[sync] flushing documents and shutting down…')
    clearInterval(sweeper)
    clearInterval(reminderTimer)
    await server.close()
    await bus?.close?.()
    await closeDb()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  return { server, bus }
}
