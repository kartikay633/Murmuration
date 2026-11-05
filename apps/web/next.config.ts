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
  serverExternalPackages: ['@node-rs/argon2', 'postgres'],
  turbopack: { root },
  env: {
    NEXT_PUBLIC_SYNC_URL: process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:4001',
  },
  poweredByHeader: false,
  agentRules: false,
}

export default config
