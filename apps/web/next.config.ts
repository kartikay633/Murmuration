import path from 'node:path'
import type { NextConfig } from 'next'

const root = path.join(import.meta.dirname, '../..')

// One .env at the repo root is shared by the web app, the sync server and the db scripts.
try {
  process.loadEnvFile(path.join(root, '.env'))
} catch {
  /* fine in production, where the platform provides the variables */
}

const config: NextConfig = {
  transpilePackages: ['@murmuration/shared', '@murmuration/db', '@murmuration/client'],
  // Load these from node_modules on the server instead of bundling them. Yjs in particular
  // must be a single copy per process: the web app and the sync server share one in production.
  serverExternalPackages: ['@node-rs/argon2', 'postgres', 'yjs', 'y-protocols', 'lib0'],
  turbopack: { root },
  env: {
    // Empty means "same host, /sync" (single-service deployment).
    NEXT_PUBLIC_SYNC_URL: process.env.NEXT_PUBLIC_SYNC_URL ?? '',
  },
  poweredByHeader: false,
  // The floating dev badge sits on top of the sidebar footer; errors still open the overlay.
  devIndicators: false,
  agentRules: false,
}

export default config
