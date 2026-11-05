/**
 * Production entry point for a single-service deployment: the Next.js app and
 * the sync server share one port. Pages and API routes are served by Next;
 * WebSocket upgrades on /sync go to the sync server.
 *
 *   npm run build -w @murmuration/web && npm run start:combined -w @murmuration/sync
 */
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import next from 'next'
import { startSync } from './start'

const port = Number(process.env.PORT ?? 3000)
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web')

const app = next({ dev: false, dir, port })
const handle = app.getRequestHandler()
await app.prepare()

let health = () => '{"ok":false}'
const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(health())
    return
  }
  void handle(req, res)
})

// If the port can't be bound, exit rather than linger half-alive (still listening to Postgres events).
http.on('error', (err) => {
  console.error('[murmuration] could not start the HTTP server', err)
  process.exit(1)
})
const { server } = await startSync({ port, attach: { server: http, path: '/sync' } })
health = server.health
http.listen(port, () => console.log(`[murmuration] web and sync on http://localhost:${port} (sync at /sync)`))
