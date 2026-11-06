import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { fragmentHtml } from './html'

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

describe('public page html', () => {
  it('escapes text and drops unsafe or private links', () => {
    const doc = new Y.Doc()
    const f = doc.getXmlFragment('default')
    f.insert(0, [
      el('heading', { level: 1 }, [txt([['<script>alert(1)</script>']])]),
      el('paragraph', {}, [
        txt([
          ['safe', { link: { href: 'https://example.com/?a=1&b="2"' } }],
          [' '],
          ['evil', { link: { href: 'javascript:alert(1)' } }],
          [' '],
          ['private', { link: { href: '/w/x/p/123e4567-e89b-12d3-a456-426614174000' } }],
          [' '],
          ['bold', { bold: true }],
        ]),
      ]),
    ])
    const html = fragmentHtml(f)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('href="https://example.com/?a=1&amp;b=&quot;2&quot;"')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('/w/x/p/')
    expect(html).toContain('evil')
    expect(html).toContain('private')
    expect(html).toContain('<strong>bold</strong>')
  })

  it('renders lists, tasks, tables and toggles', () => {
    const doc = new Y.Doc()
    const f = doc.getXmlFragment('default')
    f.insert(0, [
      el('taskList', {}, [el('taskItem', { checked: true }, [el('paragraph', {}, [txt([['Done']])])])]),
      el('table', {}, [el('tableRow', {}, [el('tableHeader', {}, [el('paragraph', {}, [txt([['H']])])])])]),
      el('details', {}, [el('detailsSummary', {}, [txt([['More']])]), el('detailsContent', {}, [el('paragraph', {}, [txt([['x']])])])]),
    ])
    const html = fragmentHtml(f)
    expect(html).toContain('<li data-checked="true"><label><input type="checkbox" disabled checked></label>')
    expect(html).toContain('<th><p>H</p></th>')
    expect(html).toContain('<details><summary>More</summary><div><p>x</p></div></details>')
  })
})
