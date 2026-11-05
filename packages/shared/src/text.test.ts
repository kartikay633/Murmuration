import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { fragmentMarkdown, fragmentText } from './text'

function el(name: string, attrs: Record<string, unknown>, children: (Y.XmlElement | Y.XmlText)[]) {
  const e = new Y.XmlElement(name)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v as string)
  e.insert(0, children)
  return e
}
function txt(parts: [string, Record<string, unknown>?][]) {
  const t = new Y.XmlText()
  let at = 0
  for (const [s, a] of parts) {
    t.insert(at, s, a ?? {})
    at += s.length
  }
  return t
}

function sample() {
  const doc = new Y.Doc()
  const f = doc.getXmlFragment('default')
  f.insert(0, [
    el('heading', { level: 2 }, [txt([['Plan']])]),
    el('paragraph', {}, [txt([['Ship '], ['offline', { bold: true }], [' mode, see '], ['docs', { link: { href: 'https://x.dev/a b' } }], ['.']])]),
    el('taskList', {}, [
      el('taskItem', { checked: true }, [el('paragraph', {}, [txt([['Write tests']])])]),
      el('taskItem', { checked: false }, [el('paragraph', {}, [txt([['Ship it']])])]),
    ]),
    el('orderedList', { start: 1 }, [
      el('listItem', {}, [el('paragraph', {}, [txt([['One']])]), el('bulletList', {}, [el('listItem', {}, [el('paragraph', {}, [txt([['Nested']])])])])]),
      el('listItem', {}, [el('paragraph', {}, [txt([['Two ', { italic: true }], ['a*b']])])]),
    ]),
    el('blockquote', {}, [el('paragraph', {}, [txt([['Quoted']])])]),
    el('codeBlock', { language: 'ts' }, [txt([['const a = 1']])]),
    el('horizontalRule', {}, []),
  ])
  return f
}

describe('page text', () => {
  it('extracts every block as a line of plain text', () => {
    expect(fragmentText(sample())).toBe('Plan\nShip offline mode, see docs.\nWrite tests\nShip it\nOne\nNested\nTwo a*b\nQuoted\nconst a = 1')
  })

  it('exports Markdown with marks, links, lists, tasks, quotes and code', () => {
    expect(fragmentMarkdown(sample(), 'Roadmap')).toBe(
      [
        '# Roadmap',
        '',
        '## Plan',
        '',
        'Ship **offline** mode, see [docs](https://x.dev/a%20b).',
        '',
        '- [x] Write tests\n- [ ] Ship it',
        '',
        '1. One\n  - Nested\n2. _Two_ a\\*b',
        '',
        '> Quoted',
        '',
        '```ts\nconst a = 1\n```',
        '',
        '---',
        '',
      ].join('\n'),
    )
  })
})

describe('markdown for richer blocks', () => {
  it('exports tables, toggles, callouts and highlights', () => {
    const doc = new Y.Doc()
    const f = doc.getXmlFragment('default')
    const cell = (name: string, t: string) => el(name, {}, [el('paragraph', {}, [txt([[t]])])])
    f.insert(0, [
      el('table', {}, [
        el('tableRow', {}, [cell('tableHeader', 'Name'), cell('tableHeader', 'Owner')]),
        el('tableRow', {}, [cell('tableCell', 'Sync'), cell('tableCell', 'a|b')]),
      ]),
      el('details', {}, [
        el('detailsSummary', {}, [txt([['More']])]),
        el('detailsContent', {}, [el('paragraph', {}, [txt([['Hidden']])])]),
      ]),
      el('callout', {}, [el('paragraph', {}, [txt([['Note '], ['this', { highlight: true }]])])]),
    ])
    expect(fragmentMarkdown(f)).toBe(
      [
        '| Name | Owner |',
        '| --- | --- |',
        '| Sync | a\\|b |',
        '',
        '<details>',
        '<summary>More</summary>',
        '',
        'Hidden',
        '',
        '</details>',
        '',
        '> Note ==this==',
        '',
      ].join('\n'),
    )
    expect(fragmentText(f)).toContain('Hidden')
  })
})
