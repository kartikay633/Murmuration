import * as Y from 'yjs'
import type { JSONContent } from '@tiptap/react'
import type { HistoryPayload } from '@/app/api/pages/[pageId]/history/route'

export interface HistoryEvent {
  id: number
  authorId: string | null
  at: number
  update: Uint8Array
  size: number
}

export interface Author {
  id: string
  name: string
  ink: string
}

const CHECKPOINT_EVERY = 64

/**
 * A page's full edit history, replayable to any point.
 *
 * Rebuilding version k means applying events 0..k to an empty Y.Doc. To keep
 * scrubbing smooth we keep a checkpoint (a full state) every 64 events and
 * start from the nearest one.
 */
export class PageHistory {
  readonly events: HistoryEvent[]
  readonly authors: Map<string, Author>
  readonly truncated: boolean
  /** Yjs client id -> author id, learned from which author's update introduced it. */
  readonly clientAuthor = new Map<number, string>()
  private checkpoints = new Map<number, Uint8Array>()

  constructor(payload: HistoryPayload) {
    this.truncated = payload.truncated
    this.authors = new Map(Object.entries(payload.authors).map(([id, a]) => [id, { id, ...a }]))
    this.events = payload.events.map((e) => {
      const update = Uint8Array.from(atob(e.u), (c) => c.charCodeAt(0))
      return { id: e.id, authorId: e.a, at: e.t, update, size: update.byteLength }
    })
    for (const e of this.events) {
      if (!e.authorId) continue
      for (const s of Y.decodeUpdate(e.update).structs) {
        if (!this.clientAuthor.has(s.id.client)) this.clientAuthor.set(s.id.client, e.authorId)
      }
    }
  }

  static async load(pageId: string): Promise<PageHistory> {
    const res = await fetch(`/api/pages/${pageId}/history`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`history ${res.status}`)
    return new PageHistory((await res.json()) as HistoryPayload)
  }

  get length() {
    return this.events.length
  }

  /** The page as it was right after event `index` (inclusive). */
  docAt(index: number): Y.Doc {
    const doc = new Y.Doc({ gc: false })
    const last = Math.min(index, this.events.length - 1)
    let from = 0
    for (let k = Math.floor(last / CHECKPOINT_EVERY) * CHECKPOINT_EVERY - 1; k >= 0; k -= CHECKPOINT_EVERY) {
      const cp = this.checkpoints.get(k)
      if (cp) {
        Y.applyUpdate(doc, cp)
        from = k + 1
        break
      }
    }
    for (let k = from; k <= last; k++) {
      Y.applyUpdate(doc, this.events[k]!.update)
      if ((k + 1) % CHECKPOINT_EVERY === 0 && !this.checkpoints.has(k)) this.checkpoints.set(k, Y.encodeStateAsUpdate(doc))
    }
    return doc
  }

  authorOfClient(client: number): Author | null {
    const id = this.clientAuthor.get(client)
    return id ? (this.authors.get(id) ?? null) : null
  }
}

/* ---------------- Yjs -> ProseMirror JSON, with authorship ---------------- */

type Run = { text: string; client: number }

/** The visible characters of an XmlText, grouped by the client that typed them. */
function textRuns(t: Y.XmlText): Run[] {
  const runs: Run[] = []
  // Walk Yjs's internal item list: the only place per-character authorship lives.
  let item = (t as unknown as { _start: Y.Item | null })._start
  while (item) {
    if (!item.deleted && item.content instanceof Y.ContentString) {
      const last = runs[runs.length - 1]
      if (last && last.client === item.id.client) last.text += item.content.str
      else runs.push({ text: item.content.str, client: item.id.client })
    }
    item = item.right
  }
  return runs
}

type Delta = { insert: string | object; attributes?: Record<string, unknown> }

function marksFrom(attributes: Record<string, unknown> | undefined) {
  if (!attributes) return []
  // y-prosemirror names overlapping marks of one type "type--hash"; strip the suffix.
  return Object.entries(attributes).map(([key, attrs]) => ({
    type: key.split('--')[0]!,
    ...(attrs && typeof attrs === 'object' && Object.keys(attrs).length ? { attrs: attrs as Record<string, unknown> } : {}),
  }))
}

function textNodes(t: Y.XmlText, blame: ((client: number) => Author | null) | null): JSONContent[] {
  const delta = t.toDelta() as Delta[]
  const runs = blame ? textRuns(t) : []
  const out: JSONContent[] = []
  let r = 0
  let rOffset = 0
  for (const op of delta) {
    if (typeof op.insert !== 'string') continue
    const marks = marksFrom(op.attributes)
    if (!blame) {
      out.push({ type: 'text', text: op.insert, ...(marks.length ? { marks } : {}) })
      continue
    }
    // Split this formatted span wherever the author changes.
    let rest = op.insert
    while (rest.length) {
      const run = runs[r]
      const available = run ? run.text.length - rOffset : rest.length
      const take = Math.max(1, Math.min(rest.length, available))
      const who = run ? blame(run.client) : null
      out.push({
        type: 'text',
        text: rest.slice(0, take),
        marks: [...marks, ...(who ? [{ type: 'author', attrs: { ink: who.ink, name: who.name } }] : [])],
      })
      rest = rest.slice(take)
      rOffset += take
      if (run && rOffset >= run.text.length) {
        r++
        rOffset = 0
      }
    }
  }
  return out
}

function nodeJSON(el: Y.XmlElement, blame: ((client: number) => Author | null) | null): JSONContent {
  const content: JSONContent[] = []
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) content.push(...textNodes(child, blame))
    else if (child instanceof Y.XmlElement) content.push(nodeJSON(child, blame))
  }
  const attrs = el.getAttributes()
  return {
    type: el.nodeName,
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(content.length ? { content } : {}),
  }
}

/** A ProseMirror document for a Yjs page, optionally with an `author` mark on every run of text. */
export function pageJSON(doc: Y.Doc, blame: ((client: number) => Author | null) | null): JSONContent {
  const content = doc
    .getXmlFragment('default')
    .toArray()
    .filter((c): c is Y.XmlElement => c instanceof Y.XmlElement)
    .map((c) => nodeJSON(c, blame))
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

/** Strip author marks so a past version can be written back as ordinary content. */
export function withoutAuthors(json: JSONContent): JSONContent {
  return {
    ...json,
    ...(json.marks ? { marks: json.marks.filter((m) => m.type !== 'author') } : {}),
    ...(json.content ? { content: json.content.map(withoutAuthors) } : {}),
  }
}
