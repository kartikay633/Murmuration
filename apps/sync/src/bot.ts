/**
 * Practice collaborator: joins a page as a seeded user, moves a cursor and
 * types a sentence over the real protocol, like a person would.
 *
 *   npm run bot -w @murmuration/sync -- <pageId> [email] ["text to type"]
 */
import { SignJWT } from 'jose'
import * as Y from 'yjs'
import { SyncClient } from '@murmuration/client'
import { closeDb, eq, getDb, users } from '@murmuration/db'
import { pageDoc, presenceUser } from '@murmuration/shared'
import { TOKEN_AUDIENCE } from './server'

const [pageId, email = 'ana@murmuration.test', text = 'Picking this up from my phone on the train. Everything I type here should show up on your screen, letter by letter.'] =
  process.argv.slice(2)
if (!pageId) {
  console.error('usage: bot <pageId> [email] ["text"]')
  process.exit(1)
}

const [user] = await getDb().select().from(users).where(eq(users.email, email))
if (!user) throw new Error(`no user ${email}; run npm run db:seed`)

const token = () =>
  new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setAudience(TOKEN_AUDIENCE)
    .setExpirationTime('10m').sign(new TextEncoder().encode(process.env.SYNC_TOKEN_SECRET!))

const client = new SyncClient({ url: `ws://localhost:${process.env.SYNC_PORT ?? 4001}`, getToken: token })
const doc = new Y.Doc()
const handle = client.open(pageDoc(pageId), doc)
await new Promise<void>((resolve) => {
  const off = handle.on('change', (s) => s.synced && (off(), resolve()))
})
if (handle.state.role !== 'editor' && handle.state.role !== 'admin' && handle.state.role !== 'owner') {
  console.error(`${email} is "${handle.state.role}" on this page, so the server would refuse their edits. Pick an editor.`)
  client.destroy()
  await closeDb()
  process.exit(1)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const fragment = doc.getXmlFragment('default')
const paragraph = new Y.XmlElement('paragraph')
const line = new Y.XmlText()
paragraph.insert(0, [line])
// BOT_AT=start types at the top of the page instead of the bottom.
fragment.insert(process.env.BOT_AT === 'start' ? 0 : fragment.length, [paragraph])

const cursorAt = (i: number) => {
  const pos = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(line, i))
  handle.awareness.setLocalStateField('cursor', { anchor: pos, head: pos })
}
handle.awareness.setLocalStateField('user', presenceUser(user))
cursorAt(0)
await sleep(800)

for (let i = 0; i < text.length; i++) {
  line.insert(i, text[i]!)
  cursorAt(i + 1)
  const ch = text[i]!
  await sleep(35 + Math.random() * 60 + (ch === ' ' && Math.random() < 0.1 ? 300 : 0) + (/[,.]/.test(ch) ? 350 : 0))
}

console.log(`${user.name} typed ${text.length} characters; waiting for the server to store them…`)
await new Promise<void>((resolve) => {
  if (handle.state.saved) return resolve()
  const off = handle.on('change', (s) => s.saved && (off(), resolve()))
})
await sleep(4000)
client.destroy()
await closeDb()
console.log('done')
