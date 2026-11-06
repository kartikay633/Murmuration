/**
 * Practice collaborators: three scripted people who join a page over the real
 * protocol (same tokens, same permission checks, same persistence as a
 * browser) so a visitor on their own can see real-time editing, presence,
 * comments and mentions.
 */
import { SignJWT } from 'jose'
import * as Y from 'yjs'
import { SyncClient, type DocHandle } from '@murmuration/client'
import { and, claimPracticeRun, commentThreads, comments, eq, getDb, inArray, memberships, notifications, publish, users } from '@murmuration/db'
import { fingerprint, pageDoc, presenceUser, type Ink } from '@murmuration/shared'
import { TOKEN_AUDIENCE } from './server'

const EMAILS = ['wren@practice.murmuration.invalid', 'otto@practice.murmuration.invalid', 'juno@practice.murmuration.invalid']
const running = new Set<string>()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jitter = (ms: number) => ms * (0.75 + Math.random() * 0.5)
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')

interface Bot {
  id: string
  name: string
  ink: Ink
  client: SyncClient
  handle: DocHandle
}

export async function runPractice(
  opts: { pageId: string; workspaceId: string; visitorId: string },
  ctx: { url: string; secret: string; log: (m: string, e?: unknown) => void },
) {
  if (running.has(opts.pageId)) return
  // Every sync server hears the request; only the one that claims it runs the session.
  if (!(await claimPracticeRun(opts.pageId).catch(() => false))) return
  running.add(opts.pageId)
  const bots: Bot[] = []
  try {
    const people = await getDb()
      .select({ id: users.id, name: users.name, ink: users.ink })
      .from(users)
      .where(inArray(users.email, EMAILS))
    if (people.length < 3) return ctx.log('practice users missing; nothing to run')
    const [visitor] = await getDb().select({ name: users.name }).from(users).where(eq(users.id, opts.visitorId))

    for (const p of people.sort((a, b) => a.name.localeCompare(b.name))) {
      const client = new SyncClient({
        url: ctx.url,
        getToken: () =>
          new SignJWT({ practice: true })
            .setProtectedHeader({ alg: 'HS256' })
            .setSubject(p.id)
            .setAudience(TOKEN_AUDIENCE)
            .setExpirationTime('5m')
            .sign(new TextEncoder().encode(ctx.secret)),
      })
      const handle = client.open(pageDoc(opts.pageId), new Y.Doc())
      bots.push({ id: p.id, name: p.name, ink: p.ink, client, handle })
    }
    await Promise.all(bots.map((b) => waitSynced(b.handle)))
    const [juno, otto, wren] = bots as [Bot, Bot, Bot] // alphabetical: Juno, Otto, Wren

    // Tidy up after any earlier visit, so repeat sessions don't pile up copies:
    // remove the notes they left last time and Otto's earlier practice thread.
    removeOwnNotes(juno)
    await getDb()
      .delete(commentThreads)
      .where(and(eq(commentThreads.pageId, opts.pageId), eq(commentThreads.createdBy, otto.id)))
      .catch((e) => ctx.log('could not clear the earlier practice thread', e))
    await publish({ kind: 'comments', pageId: opts.pageId }).catch(() => {})

    // Arrive one at a time.
    for (const b of bots) {
      b.handle.awareness.setLocalStateField('user', presenceUser(b))
      b.handle.awareness.setLocalStateField('fp', fingerprint(Y.encodeStateVector(b.handle.doc)))
      b.handle.doc.on('update', () => b.handle.awareness.setLocalStateField('fp', fingerprint(Y.encodeStateVector(b.handle.doc))))
      await sleep(jitter(900))
    }

    const first = visitor?.name.split(' ')[0] ?? 'there'
    // Comment on something the visitor's team wrote, not on the bots' own fresh text.
    const original = texts(otto.handle.doc)
    await Promise.all([
      // Wren reads, then writes a note at the end.
      (async () => {
        await wander(wren, 4)
        await typeParagraph(wren, 'end', `Hi ${first}, Wren here. Reading through this now and leaving notes as I go.`)
      })(),
      // Juno adds to the top while Wren types below, so you can watch two people edit at once.
      (async () => {
        await sleep(jitter(5000))
        await typeParagraph(juno, 'start', 'Juno: quick summary for anyone skimming. This page is being edited live by four people right now.')
        await wander(juno, 3)
      })(),
      // Otto selects a phrase and starts a thread that mentions you.
      (async () => {
        await sleep(jitter(9000))
        const target = await selectPhrase(otto, original)
        if (target) {
          await sleep(1800)
          await comment(otto, opts, target, `<@${opts.visitorId}> does this still hold after today's changes? Happy to help check.`)
        }
        await wander(otto, 3)
      })(),
    ])
    await sleep(8000)
  } catch (e) {
    ctx.log('practice session failed', e)
  } finally {
    for (const b of bots) {
      b.handle.awareness.setLocalState(null)
      await sleep(200)
      b.client.destroy()
    }
    // They were only visiting: take them back out of the workspace.
    if (bots.length) {
      await getDb()
        .delete(memberships)
        .where(and(eq(memberships.workspaceId, opts.workspaceId), inArray(memberships.userId, bots.map((b) => b.id))))
        .catch((e) => ctx.log('could not remove practice members', e))
    }
    running.delete(opts.pageId)
  }
}

function waitSynced(h: DocHandle) {
  return new Promise<void>((resolve, reject) => {
    if (h.state.synced) return resolve()
    const t = setTimeout(() => reject(new Error('practice bot could not sync')), 10_000)
    const off = h.on('change', (s) => {
      if (s.error?.code === 'forbidden') (clearTimeout(t), off(), reject(new Error(s.error.message)))
      if (s.synced) (clearTimeout(t), off(), resolve())
    })
  })
}

/** All text nodes of the page body that currently have content. */
function texts(doc: Y.Doc): Y.XmlText[] {
  const out: Y.XmlText[] = []
  const walk = (el: Y.XmlElement | Y.XmlFragment) => {
    for (const c of el.toArray()) {
      if (c instanceof Y.XmlText) {
        if (c.length > 0) out.push(c)
      } else if (c instanceof Y.XmlElement) walk(c)
    }
  }
  walk(doc.getXmlFragment('default'))
  return out
}

const rel = (t: Y.XmlText, i: number) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(t, i))

function setCursor(b: Bot, t: Y.XmlText, anchor: number, head = anchor) {
  b.handle.awareness.setLocalStateField('cursor', { anchor: rel(t, anchor), head: rel(t, head) })
}

/** Move the cursor around existing text like someone reading. */
async function wander(b: Bot, steps: number) {
  for (let s = 0; s < steps; s++) {
    const all = texts(b.handle.doc)
    if (!all.length) return
    const t = all[Math.floor(Math.random() * all.length)]!
    setCursor(b, t, Math.floor(Math.random() * t.length))
    await sleep(jitter(1600))
  }
}

/** The notes practice collaborators leave; recognised so a later visit can replace them. */
const NOTE = [/^Juno: quick summary for anyone skimming\./, /^Hi .{1,40}, Wren here\. Reading through this now/]

/** Delete paragraphs left by an earlier practice visit (top level only). */
function removeOwnNotes(b: Bot) {
  const fragment = b.handle.doc.getXmlFragment('default')
  b.handle.doc.transact(() => {
    for (let i = fragment.length - 1; i >= 0; i--) {
      const node = fragment.get(i)
      if (!(node instanceof Y.XmlElement) || node.nodeName !== 'paragraph') continue
      const text = node.toArray().map((c) => (c instanceof Y.XmlText ? c.toString() : '')).join('')
      if (NOTE.some((re) => re.test(text))) fragment.delete(i, 1)
    }
  })
}

async function typeParagraph(b: Bot, where: 'start' | 'end', text: string) {
  const fragment = b.handle.doc.getXmlFragment('default')
  const p = new Y.XmlElement('paragraph')
  const line = new Y.XmlText()
  p.insert(0, [line])
  fragment.insert(where === 'start' ? 0 : fragment.length, [p])
  setCursor(b, line, 0)
  await sleep(500)
  for (let i = 0; i < text.length; i++) {
    line.insert(i, text[i]!)
    setCursor(b, line, i + 1)
    const ch = text[i]!
    await sleep(30 + Math.random() * 55 + (ch === ' ' && Math.random() < 0.08 ? 280 : 0) + (/[,.:]/.test(ch) ? 320 : 0))
  }
}

/** Pick a phrase of a few words in someone else's text and select it. */
async function selectPhrase(b: Bot, prefer: Y.XmlText[]): Promise<{ t: Y.XmlText; from: number; to: number } | null> {
  const long = (list: Y.XmlText[]) => list.filter((t) => t.length > 0 && t.toString().split(' ').length >= 6)
  // Prefer text that was on the page before the session; on an empty page, use what the others just wrote.
  const t = long(prefer)[0] ?? long(texts(b.handle.doc))[0]
  if (!t) return null
  const s = t.toString()
  const words = [...s.matchAll(/\S+/g)]
  const start = words[Math.min(2, words.length - 4)]!
  const end = words[Math.min(5, words.length - 1)]!
  const from = start.index!
  const to = end.index! + end[0].replace(/[.,;:]$/, '').length
  setCursor(b, t, from)
  await sleep(500)
  for (let i = from; i <= to; i += 3) {
    setCursor(b, t, from, Math.min(i, to))
    await sleep(60)
  }
  setCursor(b, t, from, to)
  return { t, from, to }
}

async function comment(
  b: Bot,
  opts: { pageId: string; workspaceId: string; visitorId: string },
  target: { t: Y.XmlText; from: number; to: number },
  body: string,
) {
  const db = getDb()
  const start = b64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(target.t, target.from)))
  const end = b64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(target.t, target.to)))
  const [thread] = await db
    .insert(commentThreads)
    .values({
      pageId: opts.pageId,
      workspaceId: opts.workspaceId,
      anchorStart: start,
      anchorEnd: end,
      quote: target.t.toString().slice(target.from, target.to),
      createdBy: b.id,
    })
    .returning({ id: commentThreads.id })
  const [c] = await db.insert(comments).values({ threadId: thread!.id, authorId: b.id, body }).returning({ id: comments.id })
  await db.insert(notifications).values({
    userId: opts.visitorId,
    workspaceId: opts.workspaceId,
    pageId: opts.pageId,
    threadId: thread!.id,
    commentId: c!.id,
    actorId: b.id,
    kind: 'mention',
  })
  await publish({ kind: 'comments', pageId: opts.pageId })
  await publish({ kind: 'inbox', userIds: [opts.visitorId] })
}
