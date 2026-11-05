/**
 * A workspace's page tree lives in its own Yjs document ("tree:<workspaceId>"):
 * a Y.Map named "pages" from page id to a Y.Map with these fields. Sibling
 * order uses fractional position keys, so inserting never renumbers siblings.
 *
 * Concurrent moves can still produce a cycle (A under B on one replica, B under
 * A on another). buildTree() never hides a page because of that: anything in a
 * cycle is shown at the root. Resolving moves properly is the job of the
 * tree CRDT in a later phase.
 */
export interface TreeNode {
  id: string
  title: string
  parentId: string | null
  position: string
  icon: string | null
  createdAt: number
  createdBy: string
  archived: boolean
}

export const TREE_PAGES = 'pages'

export function buildTree(nodes: TreeNode[]): Map<string | null, TreeNode[]> {
  const live = new Map(nodes.filter((n) => !n.archived).map((n) => [n.id, n]))

  const effectiveParent = (n: TreeNode): string | null => {
    if (!n.parentId || !live.has(n.parentId)) return null
    // Walk up; if we come back to n, n is part of a cycle. A cycle further up
    // doesn't involve n: its parent will itself be shown at the root.
    const seen = new Set<string>()
    let cur: string | null = n.parentId
    while (cur) {
      if (cur === n.id) return null
      if (seen.has(cur)) break
      seen.add(cur)
      const next = live.get(cur)
      if (!next) break
      cur = next.parentId
    }
    return n.parentId
  }

  const out = new Map<string | null, TreeNode[]>()
  for (const n of live.values()) {
    const p = effectiveParent(n)
    let list = out.get(p)
    if (!list) out.set(p, (list = []))
    list.push(n)
  }
  for (const list of out.values()) list.sort(byPosition)
  return out
}

export const byPosition = (a: TreeNode, b: TreeNode) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** Ancestors of a page from the root down, excluding the page itself. */
export function ancestors(nodes: Map<string, TreeNode>, id: string): TreeNode[] {
  const out: TreeNode[] = []
  const seen = new Set<string>([id])
  let cur = nodes.get(id)?.parentId ?? null
  while (cur && !seen.has(cur)) {
    const n = nodes.get(cur)
    if (!n || n.archived) break
    out.unshift(n)
    seen.add(cur)
    cur = n.parentId
  }
  return out
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

/** A key that sorts strictly between a and b. "" means open-ended on that side. */
export function keyBetween(a: string, b: string): string {
  let out = ''
  for (let i = 0; ; i++) {
    const da = i < a.length ? DIGITS.indexOf(a[i]!) : 0
    const db = i < b.length && b.slice(0, i) === out ? DIGITS.indexOf(b[i]!) : DIGITS.length
    if (db - da > 1) return out + DIGITS[Math.floor((da + db) / 2)]!
    out += DIGITS[da]!
  }
}
