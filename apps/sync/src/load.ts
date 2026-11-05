/**
 * Load test: many clients editing one document across several sync servers.
 *
 *   npm run load -w @murmuration/sync -- --clients 200 --seconds 30 --servers ws://localhost:4011,ws://localhost:4012
 *
 * Clients are spread over worker processes (about 40 each) so the generator
 * itself never becomes the bottleneck; each worker reports its event-loop lag
 * so you can tell. Every edit carries the wall-clock time it was made, and
 * observer clients record how long each edit took to reach them: the full
 * path client -> its server -> Redis -> the other server -> client. At the end
 * every client's copy is fingerprinted to check they all converged.
 * Uses a temporary page that is deleted afterwards.
 */
import { fork, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SignJWT } from 'jose'
import * as Y from 'yjs'
import { SyncClient, type DocHandle } from '@murmuration/client'
import { and, closeDb, docEvents, eq, getDb, inArray, memberships, pages, users, workspaces } from '@murmuration/db'
import { fingerprint, pageDoc } from '@murmuration/shared'
import { TOKEN_AUDIENCE } from './server'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Wall-clock time with sub-millisecond precision, comparable across processes. */
const now = () => performance.timeOrigin + performance.now()
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN

interface WorkerConfig {
  docName: string
  first: number
  count: number
  servers: string[]
  userIds: string[]
  everyMs: number
  observers: number
}

type ToWorker = { type: 'go' } | { type: 'stop' } | { type: 'status' } | { type: 'report' } | { type: 'exit' }
type FromWorker =
  | { type: 'ready'; connectMs: number }
  | { type: 'status'; fingerprints: string[]; saved: boolean }
  | { type: 'report'; latencies: number[]; sent: number; maxLagMs: number }

/* ======================= worker ======================= */

async function worker(cfg: WorkerConfig) {
  const key = new TextEncoder().encode(process.env.SYNC_TOKEN_SECRET!)
  const start = now()
  const clients: { client: SyncClient; handle: DocHandle; index: number }[] = []
  for (let k = 0; k < cfg.count; k++) {
    const index = cfg.first + k
    const userId = cfg.userIds[index % cfg.userIds.length]!
    const client = new SyncClient({
      url: cfg.servers[index % cfg.servers.length]!,
      getToken: () =>
        new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setAudience(TOKEN_AUDIENCE).setExpirationTime('10m').sign(key),
    })
    clients.push({ client, handle: client.open(cfg.docName, new Y.Doc()), index })
  }
  await Promise.all(
    clients.map(
      ({ handle }) =>
        new Promise<void>((resolve) => {
          if (handle.state.synced) return resolve()
          const off = handle.on('change', (s) => s.synced && (off(), resolve()))
        }),
    ),
  )
  const send = (m: FromWorker) => process.send!(m)
  send({ type: 'ready', connectMs: now() - start })

  // A few observers per worker, spread over the servers.
  const latencies: number[] = []
  clients.slice(0, cfg.observers).forEach(({ handle, index }) => {
    handle.doc.getMap<number>('stamps').observe((ev) => {
      if (ev.transaction.local) return
      const t0 = now()
      for (const k of ev.keysChanged) {
        if (k.startsWith(`${index}:`)) continue
        const t = ev.target.get(k)
        if (typeof t === 'number') latencies.push(t0 - t)
      }
    })
  })

  // Event-loop lag: if this grows, the generator (not the server) is the bottleneck.
  let maxLagMs = 0
  let expected = now() + 50
  const lagTimer = setInterval(() => {
    maxLagMs = Math.max(maxLagMs, now() - expected)
    expected = now() + 50
  }, 50)

  let running = false
  let sent = 0
  const loops: Promise<void>[] = []
  process.on('message', async (m: ToWorker) => {
    if (m.type === 'go') {
      running = true
      for (const { handle, index } of clients) {
        loops.push(
          (async () => {
            await sleep(Math.random() * cfg.everyMs)
            let seq = 0
            while (running) {
              handle.doc.transact(() => {
                const text = handle.doc.getText('body')
                text.insert(Math.floor(Math.random() * (text.length + 1)), `[${index}]`)
                handle.doc.getMap<number>('stamps').set(`${index}:${seq++}`, now())
              })
              sent++
              await sleep(cfg.everyMs * (0.5 + Math.random()))
            }
          })(),
        )
      }
    } else if (m.type === 'stop') {
      running = false
      await Promise.all(loops)
    } else if (m.type === 'status') {
      send({
        type: 'status',
        fingerprints: [...new Set(clients.map(({ handle }) => fingerprint(Y.encodeStateVector(handle.doc))))],
        saved: clients.every(({ handle }) => handle.state.saved),
      })
    } else if (m.type === 'report') {
      clearInterval(lagTimer)
      send({ type: 'report', latencies, sent, maxLagMs: Math.round(maxLagMs) })
    } else if (m.type === 'exit') {
      clients.forEach(({ client }) => client.destroy())
      await sleep(300)
      process.exit(0)
    }
  })
}

/* ======================= coordinator ======================= */

async function coordinator() {
  const arg = (name: string, fallback: string) => {
    const i = process.argv.indexOf(`--${name}`)
    return i > 0 ? process.argv[i + 1]! : fallback
  }
  const CLIENTS = Number(arg('clients', '200'))
  const SECONDS = Number(arg('seconds', '30'))
  const SERVERS = arg('servers', 'ws://localhost:4001').split(',')
  const EVERY = Number(arg('every', '2000'))
  const PER_WORKER = Number(arg('per-worker', '40'))

  const db = getDb()
  const editors = await db
    .select({ id: users.id, ws: memberships.workspaceId })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(and(eq(workspaces.name, 'Kestrel Labs'), inArray(memberships.role, ['owner', 'admin', 'editor']), eq(users.isBot, false)))
  if (!editors.length) throw new Error('Run npm run db:seed first.')
  const [page] = await db
    .insert(pages)
    .values({ workspaceId: editors[0]!.ws, title: 'Load test (temporary)', createdBy: editors[0]!.id })
    .returning({ id: pages.id })
  const docName = pageDoc(page!.id)

  const workers = Math.ceil(CLIENTS / PER_WORKER)
  console.log(`${CLIENTS} clients in ${workers} worker processes, ${SERVERS.length} sync server(s), one edit per client every ~${EVERY} ms, ${SECONDS}s`)

  const procs: ChildProcess[] = []
  const inbox = new Map<ChildProcess, FromWorker[]>()
  for (let w = 0; w < workers; w++) {
    const cfg: WorkerConfig = {
      docName,
      first: w * PER_WORKER,
      count: Math.min(PER_WORKER, CLIENTS - w * PER_WORKER),
      servers: SERVERS,
      userIds: editors.map((e) => e.id),
      everyMs: EVERY,
      observers: 3,
    }
    const p = fork(fileURLToPath(import.meta.url), ['--worker', JSON.stringify(cfg)], { execArgv: process.execArgv })
    inbox.set(p, [])
    p.on('message', (m: FromWorker) => inbox.get(p)!.push(m))
    procs.push(p)
  }
  const next = async <T extends FromWorker['type']>(p: ChildProcess, type: T) => {
    for (;;) {
      const q = inbox.get(p)!
      const i = q.findIndex((m) => m.type === type)
      if (i >= 0) return q.splice(i, 1)[0] as Extract<FromWorker, { type: T }>
      await sleep(20)
    }
  }
  const all = <T extends FromWorker['type']>(type: T, msg?: ToWorker) => {
    if (msg) procs.forEach((p) => p.send(msg))
    return Promise.all(procs.map((p) => next(p, type)))
  }

  const ready = await all('ready')
  const connectMs = Math.max(...ready.map((r) => r.connectMs))
  console.log(`all ${CLIENTS} connected and synced in ${Math.round(connectMs)} ms`)

  procs.forEach((p) => p.send({ type: 'go' } satisfies ToWorker))
  const started = now()
  await sleep(SECONDS * 1000)
  procs.forEach((p) => p.send({ type: 'stop' } satisfies ToWorker))
  const elapsed = (now() - started) / 1000

  const settleStart = now()
  let converged = false
  let distinct = 0
  while (now() - settleStart < 30_000) {
    const status = await all('status', { type: 'status' })
    const fps = new Set(status.flatMap((s) => s.fingerprints))
    distinct = fps.size
    if (fps.size === 1 && status.every((s) => s.saved)) {
      converged = true
      break
    }
    await sleep(100)
  }
  const settleMs = now() - settleStart

  const reports = await all('report', { type: 'report' })
  const latencies = reports.flatMap((r) => r.latencies).sort((a, b) => a - b)
  const sent = reports.reduce((n, r) => n + r.sent, 0)
  const result = {
    date: new Date().toISOString(),
    clients: CLIENTS,
    syncServers: SERVERS.length,
    workerProcesses: workers,
    seconds: Math.round(elapsed),
    edits: sent,
    editsPerSecond: Math.round(sent / elapsed),
    deliveriesPerSecond: Math.round((sent * (CLIENTS - 1)) / elapsed),
    deliveriesMeasured: latencies.length,
    latencyMs: {
      p50: +pct(latencies, 50).toFixed(1),
      p95: +pct(latencies, 95).toFixed(1),
      p99: +pct(latencies, 99).toFixed(1),
      max: +(latencies[latencies.length - 1] ?? NaN).toFixed(1),
    },
    generatorMaxEventLoopLagMs: Math.max(...reports.map((r) => r.maxLagMs)),
    connectAllMs: Math.round(connectMs),
    converged,
    distinctFingerprintsAtEnd: distinct,
    settleMs: Math.round(settleMs),
  }
  console.log(JSON.stringify(result, null, 2))
  mkdirSync('../../docs/benchmarks', { recursive: true })
  writeFileSync(`../../docs/benchmarks/load-${CLIENTS}c-${SERVERS.length}s.json`, JSON.stringify(result, null, 2) + '\n')

  procs.forEach((p) => p.send({ type: 'exit' } satisfies ToWorker))
  await sleep(2000) // let the servers flush before cleaning up
  await db.delete(docEvents).where(eq(docEvents.docName, docName))
  await db.delete(pages).where(eq(pages.id, page!.id))
  await closeDb()
  process.exit(converged ? 0 : 1)
}

const w = process.argv.indexOf('--worker')
if (w > 0) {
  void worker(JSON.parse(process.argv[w + 1]!) as WorkerConfig)
} else {
  coordinator().catch(async (e) => {
    console.error(e)
    await closeDb()
    process.exit(1)
  })
}
