/**
 * Who is mentioned in a page, and its to-dos (with who each is assigned to),
 * read from the editor's Y.XmlFragment. Duck-typed like text.ts.
 */

import type { FragmentLike } from './text'

interface DeltaOp {
  insert?: unknown
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface TaskInfo {
  /** The to-do's own line, with mentions written as @Name. */
  text: string
  done: boolean
  /** People @mentioned on that line: whom it's assigned to. */
  assignees: string[]
}

function mentionId(n: XmlElementLike): string | null {
  const id = n.getAttribute('id')
  return typeof id === 'string' && UUID.test(id) ? id : null
}

/** Everyone @mentioned anywhere on the page. */
export function fragmentMentions(fragment: FragmentLike): string[] {
  const out = new Set<string>()
  const walk = (nodes: XmlNode[]) => {
    for (const n of nodes) {
      if (isText(n)) continue
      if (n.nodeName === 'mention') {
        const id = mentionId(n)
        if (id) out.add(id)
      } else walk(kids(n))
    }
  }
  walk(kids(fragment))
  return [...out]
}

/** A line of text and the people mentioned in it (not looking into nested blocks). */
function line(n: XmlElementLike): { text: string; people: string[] } {
  let text = ''
  const people: string[] = []
  for (const c of kids(n)) {
    if (isText(c)) {
      for (const op of c.toDelta()) if (typeof op.insert === 'string') text += op.insert
    } else if (c.nodeName === 'mention') {
      text += `@${String(c.getAttribute('label') ?? '')}`
      const id = mentionId(c)
      if (id) people.push(id)
    } else if (c.nodeName === 'hardBreak') text += ' '
  }
  return { text, people }
}

/**
 * The to-do elements behind fragmentTasks(), in the same order: position N in
 * the task list is element N here. Used to tick a to-do off from outside the page.
 */
export function taskElements<E extends XmlElementLike>(fragment: FragmentLike): { el: E; info: TaskInfo }[] {
  const out: { el: E; info: TaskInfo }[] = []
  const walk = (nodes: XmlNode[]) => {
    for (const n of nodes) {
      if (isText(n)) continue
      if (n.nodeName === 'taskItem') {
        const first = kids(n).find((c): c is XmlElementLike => !isText(c) && c.nodeName === 'paragraph')
        const { text, people } = first ? line(first) : { text: '', people: [] }
        const checked = n.getAttribute('checked')
        if (text.trim()) {
          out.push({
            el: n as E,
            info: { text: text.trim().slice(0, 500), done: checked === true || checked === 'true', assignees: [...new Set(people)] },
          })
        }
      }
      walk(kids(n))
    }
  }
  walk(kids(fragment))
  return out
}

/** Every to-do on the page, in order, nested ones included. Empty ones are skipped. */
export function fragmentTasks(fragment: FragmentLike): TaskInfo[] {
  return taskElements(fragment).map((t) => t.info)
}
