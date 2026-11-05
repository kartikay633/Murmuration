/**
 * Turning a page body (the Y.XmlFragment the editor writes to) into plain text
 * for search, and into Markdown for export. Duck-typed so this package doesn't
 * need its own copy of Yjs.
 */

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
/** A Y.XmlFragment (or anything shaped like one). */
export interface FragmentLike {
  toArray(): unknown[]
}
const kids = (n: { toArray(): unknown[] }) => n.toArray() as XmlNode[]

const isText = (n: XmlNode): n is XmlTextLike => typeof (n as XmlTextLike).toDelta === 'function'

/* ---------------- plain text ---------------- */

function inlineText(children: XmlNode[]): string {
  let out = ''
  for (const c of children) {
    if (isText(c)) {
      for (const op of c.toDelta()) if (typeof op.insert === 'string') out += op.insert
    } else if (c.nodeName === 'hardBreak') out += '\n'
    else out += blockText(c)
  }
  return out
}

function blockText(n: XmlElementLike): string {
  const children = kids(n)
  if (children.every(isText) || n.nodeName === 'paragraph' || n.nodeName === 'heading' || n.nodeName === 'codeBlock') {
    return inlineText(children)
  }
  return children
    .map((k) => (isText(k) ? inlineText([k]) : blockText(k)))
    .filter(Boolean)
    .join('\n')
}

/** Every block's text, one per line. */
export function fragmentText(fragment: FragmentLike): string {
  return kids(fragment)
    .map((n) => (isText(n) ? inlineText([n]) : blockText(n)))
    .filter((s) => s.trim())
    .join('\n')
}

/* ---------------- markdown ---------------- */

const escapeMd = (s: string) => s.replace(/([\\`*_[\]])/g, '\\$1')

function inlineMd(children: XmlNode[]): string {
  let out = ''
  for (const c of children) {
    if (!isText(c)) {
      if (c.nodeName === 'hardBreak') out += '  \n'
      continue
    }
    for (const op of c.toDelta()) {
      if (typeof op.insert !== 'string') continue
      const a = op.attributes ?? {}
      let s = a.code ? '`' + op.insert.replace(/`/g, 'ˋ') + '`' : escapeMd(op.insert)
      // Keep surrounding spaces outside the markers, or Markdown won't parse them.
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!
      let core = m[2]!
      if (core) {
        if (a.bold) core = `**${core}**`
        if (a.italic) core = `_${core}_`
        if (a.strike) core = `~~${core}~~`
        if (a.highlight) core = `==${core}==`
        const link = a.link as { href?: unknown } | undefined
        if (link && typeof link.href === 'string') core = `[${core}](${link.href.replace(/[()\s]/g, encodeURIComponent)})`
      }
      s = m[1]! + core + m[3]!
      out += s
    }
  }
  return out
}

function listMd(n: XmlElementLike, depth: number): string[] {
  const lines: string[] = []
  const pad = '  '.repeat(depth)
  let i = Number(n.getAttribute('start') ?? 1) || 1
  for (const item of kids(n)) {
    if (isText(item)) continue
    const marker =
      n.nodeName === 'orderedList'
        ? `${i++}.`
        : n.nodeName === 'taskList'
          ? `- [${item.getAttribute('checked') === true || item.getAttribute('checked') === 'true' ? 'x' : ' '}]`
          : '-'
    let first = true
    for (const child of kids(item)) {
      if (isText(child)) continue
      if (child.nodeName === 'bulletList' || child.nodeName === 'orderedList' || child.nodeName === 'taskList') {
        lines.push(...listMd(child, depth + 1))
      } else {
        const text = blockMd(child, depth + 1).join('\n')
        lines.push(first ? `${pad}${marker} ${text}` : `${pad}  ${text}`)
        first = false
      }
    }
    if (first) lines.push(`${pad}${marker}`)
  }
  return lines
}

function blockMd(n: XmlElementLike, depth = 0): string[] {
  switch (n.nodeName) {
    case 'paragraph':
      return [inlineMd(kids(n))]
    case 'heading': {
      const level = Math.min(Math.max(Number(n.getAttribute('level') ?? 1) || 1, 1), 6)
      return [`${'#'.repeat(level)} ${inlineMd(kids(n))}`]
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return [listMd(n, depth).join('\n')]
    case 'blockquote':
      return [
        kids(n)
          .flatMap((c) => (isText(c) ? [] : blockMd(c, depth)))
          .join('\n\n')
          .split('\n')
          .map((l) => (l ? `> ${l}` : '>'))
          .join('\n'),
      ]
    case 'codeBlock': {
      const lang = String(n.getAttribute('language') ?? '').replace(/[^\w+-]/g, '')
      const body = inlineText(kids(n))
      const fence = body.includes('```') ? '~~~~' : '```'
      return [`${fence}${lang}\n${body}\n${fence}`]
    }
    case 'horizontalRule':
      return ['---']
    case 'callout':
      return [
        kids(n)
          .flatMap((c) => (isText(c) ? [] : blockMd(c, depth)))
          .join('\n\n')
          .split('\n')
          .map((l) => (l ? `> ${l}` : '>'))
          .join('\n'),
      ]
    case 'details': {
      const parts = kids(n).filter((c): c is XmlElementLike => !isText(c))
      const summary = parts.find((c) => c.nodeName === 'detailsSummary')
      const content = parts.find((c) => c.nodeName === 'detailsContent')
      const body = content ? kids(content).flatMap((c) => (isText(c) ? [] : blockMd(c, depth))).join('\n\n') : ''
      return [`<details>\n<summary>${summary ? inlineMd(kids(summary)) : ''}</summary>\n\n${body}\n\n</details>`]
    }
    case 'table': {
      const rows = kids(n)
        .filter((r): r is XmlElementLike => !isText(r))
        .map((r) =>
          kids(r)
            .filter((c): c is XmlElementLike => !isText(c))
            .map((c) =>
              kids(c)
                .flatMap((b) => (isText(b) ? [] : blockMd(b, depth)))
                .join(' ')
                .replace(/\|/g, '\\|')
                .replace(/\n+/g, ' '),
            ),
        )
      if (!rows.length) return []
      const width = Math.max(...rows.map((r) => r.length))
      const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')]
      const line = (r: string[]) => `| ${pad(r).join(' | ')} |`
      return [[line(rows[0]!), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')]
    }
    default:
      return [inlineMd(kids(n))]
  }
}

/** The page as Markdown, with its title as the first heading. */
export function fragmentMarkdown(fragment: FragmentLike, title?: string): string {
  const blocks = kids(fragment).flatMap((n) => (isText(n) ? [inlineMd([n])] : blockMd(n)))
  const body = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  return (title ? `# ${title.trim() || 'Untitled'}\n\n` : '') + body + '\n'
}
