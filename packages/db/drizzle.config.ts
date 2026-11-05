import { readFileSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

// drizzle-kit runs from this folder; read the repo-level .env if the variable isn't set.
if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync('../../.env', 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line)
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]
    }
  } catch {}
}

export default defineConfig({
  schema: './src/schema.ts',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
