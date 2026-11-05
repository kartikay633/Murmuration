import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { PageHistory, pageJSON, withoutAuthors } from './history'

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')

/** Two people editing one paragraph, recorded the way the server stores it. */
function recordSession() {
  const ana = new Y.Doc()
  ana.clientID = 1
  const rohan = new Y.Doc()
  rohan.clientID = 2
  const events: { id: number; a: string; t: number; u: string }[] = []
  let id = 0
  const record = (doc: Y.Doc, author: string, fn: () => void) => {
    const before = Y.encodeStateVector(doc)
    fn()
    const update = Y.encodeStateAsUpdate(doc, before)
    events.push({ id: ++id, a: author, t: 1_700_000_000_000 + id * 1000, u: b64(update) })
    // deliver to the other replica
    Y.applyUpdate(doc === ana ? rohan : ana, update)
  }

  const p = new Y.XmlElement('paragraph')
  const text = new Y.XmlText()
  record(ana, 'ana', () => {
    p.insert(0, [text])
    ana.getXmlFragment('default').insert(0, [p])
    text.insert(0, 'Hello world')
  })
  const rohanText = (rohan.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText
  record(rohan, 'rohan', () => rohanText.insert(5, ' there'))
  record(ana, 'ana', () => text.format(0, 5, { bold: {} }))
  record(rohan, 'rohan', () => rohanText.delete(0, 6)) // removes "Hello "

  return new PageHistory({
    authors: { ana: { name: 'Ana', ink: 'vermilion' }, rohan: { name: 'Rohan', ink: 'cobalt' } },
    events,
    truncated: false,
  })
}

const plain = (json: ReturnType<typeof pageJSON>) =>
  (json.content ?? []).map((b) => (b.content ?? []).map((t) => t.text).join('')).join('\n')

describe('PageHistory', () => {
  it('rebuilds each version in order', () => {
    const h = recordSession()
    expect(plain(pageJSON(h.docAt(0), null))).toBe('Hello world')
    expect(plain(pageJSON(h.docAt(1), null))).toBe('Hello there world')
    expect(plain(pageJSON(h.docAt(3), null))).toBe('there world')
  })

  it('learns which Yjs client belongs to which author', () => {
    const h = recordSession()
    expect(h.authorOfClient(1)?.name).toBe('Ana')
    expect(h.authorOfClient(2)?.name).toBe('Rohan')
  })

  it('attributes every character to whoever typed it, alongside formatting', () => {
    const h = recordSession()
    const json = pageJSON(h.docAt(2), (c) => h.authorOfClient(c))
    const runs = json.content![0]!.content!.map((t) => ({
      text: t.text,
      who: t.marks?.find((m) => m.type === 'author')?.attrs?.name,
      bold: !!t.marks?.some((m) => m.type === 'bold'),
    }))
    expect(runs.map((r) => r.text).join('')).toBe('Hello there world')
    expect(runs).toEqual([
      { text: 'Hello', who: 'Ana', bold: true },
      { text: ' there', who: 'Rohan', bold: false },
      { text: ' world', who: 'Ana', bold: false },
    ])
  })

  it('gives the same result whether or not a checkpoint is used', () => {
    const h = recordSession()
    const direct = JSON.stringify(pageJSON(h.docAt(3), null))
    h.docAt(1) // warm any caches
    expect(JSON.stringify(pageJSON(h.docAt(3), null))).toBe(direct)
  })

  it('strips authorship before a version is restored', () => {
    const h = recordSession()
    const json = withoutAuthors(pageJSON(h.docAt(2), (c) => h.authorOfClient(c)))
    const marks = json.content![0]!.content!.flatMap((t) => t.marks ?? [])
    expect(marks.some((m) => m.type === 'author')).toBe(false)
    expect(marks.some((m) => m.type === 'bold')).toBe(true)
  })
})
