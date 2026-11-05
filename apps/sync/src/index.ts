import { startSync } from './start'

// Standalone sync server (local development, or several instances behind Redis).
const { server, bus } = await startSync({ port: Number(process.env.SYNC_PORT ?? process.env.PORT ?? 4001) })
console.log(`[sync] listening on ws://localhost:${server.port}${bus ? ' (linked to other servers through Redis)' : ''}`)
