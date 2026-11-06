/**
 * Render a page body (the editor's Y.XmlFragment) as static HTML for public,
 * read-only pages. Everything is escaped; only a fixed set of tags comes out,
 * and links keep only safe addresses. Links to pages inside the workspace are
 * private, so they render as plain text.
 */

import type { FragmentLike } from './text'

interface DeltaOp {
  insert?: unknown
  attributes?: Record<string, unknown>
}
interface XmlTextLike {
  toDelta(): DeltaOp[]
}
interface XmlElementLike {
  nodeName: string
  getAttribute(name: string): unknown
  toArray(): unknown[]
}
type XmlNode = XmlTextLike | XmlElementLike
const kids = (n: { toArray(): unknown[] }) => n.toArray() as XmlNode[]
const isText = (n: XmlNode): n is XmlTextLike => typeof (n as XmlTextLike).toDelta === 'function'

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Outside links only: http(s) and mailto. Everything else (javascript:, data:, in-app paths) is dropped. */
function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null
  const h = href.trim()
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : null
}

function inline(children: XmlNode[]): string {
  let out = ''
  for (const c of children) {
    if (!isText(c)) {
      if (c.nodeName === 'hardBreak') out += '<br>'
      continue
    }
    for (const op of c.toDelta()) {
      if (typeof op.insert !== 'string') continue
      const a = op.attributes ?? {}
      let s = escapeHtml(op.insert)
      if (a.code) s = `<code>${s}</code>`
      if (a.bold) s = `<strong>${s}</strong>`
      if (a.italic) s = `<em>${s}</em>`
      if (a.underline) s = `<u>${s}</u>`
      if (a.strike) s = `<s>${s}</s>`
      if (a.highlight) s = `<mark>${s}</mark>`
      const href = safeHref((a.link as { href?: unknown } | undefined)?.href)
      if (href) s = `<a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">${s}</a>`
      out += s
    }
  }
  return out
}

const blocks = (n: { toArray(): unknown[] }) => kids(n).map((c) => (isText(c) ? inline([c]) : block(c))).join('')

function block(n: XmlElementLike): string {
  switch (n.nodeName) {
    case 'paragraph':
      return `<p>${inline(kids(n)) || '<br>'}</p>`
    case 'heading': {
      const l = Math.min(Math.max(Number(n.getAttribute('level') ?? 1) || 1, 1), 3)
      return `<h${l}>${inline(kids(n))}</h${l}>`
    }
    case 'bulletList':
      return `<ul>${blocks(n)}</ul>`
    case 'orderedList': {
      const start = Number(n.getAttribute('start') ?? 1) || 1
      return `<ol${start !== 1 ? ` start="${start}"` : ''}>${blocks(n)}</ol>`
    }
    case 'listItem':
      return `<li>${blocks(n)}</li>`
    case 'taskList':
      return `<ul data-type="taskList">${blocks(n)}</ul>`
    case 'taskItem': {
      const done = n.getAttribute('checked') === true || n.getAttribute('checked') === 'true'
      return `<li data-checked="${done}"><label><input type="checkbox" disabled${done ? ' checked' : ''}></label><div>${blocks(n)}</div></li>`
    }
    case 'blockquote':
      return `<blockquote>${blocks(n)}</blockquote>`
    case 'callout':
      return `<div class="callout">${blocks(n)}</div>`
    case 'codeBlock':
      return `<pre><code>${escapeHtml(kids(n).map((c) => (isText(c) ? c.toDelta().map((o) => (typeof o.insert === 'string' ? o.insert : '')).join('') : '')).join(''))}</code></pre>`
    case 'horizontalRule':
      return '<hr>'
    case 'table':
      return `<div class="tableWrapper"><table>${blocks(n)}</table></div>`
    case 'tableRow':
      return `<tr>${blocks(n)}</tr>`
    case 'tableHeader':
      return `<th>${blocks(n)}</th>`
    case 'tableCell':
      return `<td>${blocks(n)}</td>`
    case 'details':
      return `<details>${blocks(n)}</details>`
    case 'detailsSummary':
      return `<summary>${inline(kids(n))}</summary>`
    case 'detailsContent':
      return `<div>${blocks(n)}</div>`
    default:
      return blocks(n)
  }
}

export function fragmentHtml(fragment: FragmentLike): string {
  return blocks(fragment)
}
