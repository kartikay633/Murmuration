/**
 * A replicated tree with a safe move operation.
 *
 * Every placement of a page (creating it, reordering it, nesting it) is an
 * operation appended to a shared log:
 *
 *   { n: node, p: new parent (or null), k: position key, l: Lamport clock, c: client id }
 *
 * Each replica computes the tree by replaying the whole log sorted by (l, c)
 * — a total order every replica agrees on — and applying each move unless it
 * would put a node inside its own subtree. That rule is what makes concurrent
 * moves safe: if one person drags A under B while another drags B under A,
 * both moves are in the log, every replica orders them the same way, applies
 * the first, and skips the second because it would now create a cycle.
 *
 * Same log, same order, same skips: every replica ends up with the same tree,
 * and no replica ever shows a cycle. This is the approach of Kleppmann et al.,
 * "A highly-available move operation for replicated trees" (2021), computed by
 * full replay rather than undo/redo, which is simple and fast enough for page
 * trees with thousands of moves.
 */

export interface MoveOp {
  /** node being placed */
  n: string
  /** new parent; null for top level */
  p: string | null
  /** fractional position key among siblings */
  k: string
  /** Lamport clock */
  l: number
  /** Yjs client id of the replica that made the move (tie-breaker) */
  c: number
}

export const TREE_MOVES = 'moves'

export function compareOps(a: MoveOp, b: MoveOp): number {
  return a.l - b.l || a.c - b.c || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0)
}

export interface Placement {
  parentId: string | null
  position: string
}

export interface Resolved {
  placements: Map<string, Placement>
  /** Moves that were ignored because applying them would have created a cycle. */
  skipped: number
}

export function isValidOp(v: unknown): v is MoveOp {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.n === 'string' &&
    (o.p === null || typeof o.p === 'string') &&
    typeof o.k === 'string' &&
    typeof o.l === 'number' &&
    Number.isFinite(o.l) &&
    typeof o.c === 'number'
  )
}

/** Replay the move log. Pure and deterministic. */
export function resolveMoves(log: readonly unknown[]): Resolved {
  const ops = log.filter(isValidOp).sort(compareOps)
  const parent = new Map<string, string | null>()
  const position = new Map<string, string>()
  let skipped = 0

  for (const op of ops) {
    if (op.p === op.n) {
      skipped++
      continue
    }
    // Would the new parent be inside op.n's own subtree? Walk up from it.
    let cur = op.p
    let cycle = false
    let steps = 0
    while (cur !== null && steps++ <= parent.size) {
      if (cur === op.n) {
        cycle = true
        break
      }
      cur = parent.get(cur) ?? null
    }
    if (cycle) {
      skipped++
      continue
    }
    parent.set(op.n, op.p)
    position.set(op.n, op.k)
  }

  const placements = new Map<string, Placement>()
  for (const [n, p] of parent) placements.set(n, { parentId: p, position: position.get(n)! })
  return { placements, skipped }
}

/** The next Lamport timestamp for a replica that has seen `log`. */
export function nextClock(log: readonly unknown[]): number {
  let max = 0
  for (const o of log) if (isValidOp(o) && o.l > max) max = o.l
  return max + 1
}

/** True if `ancestor` is `node` or one of its ancestors in the resolved tree. */
export function isWithin(placements: Map<string, Placement>, node: string | null, ancestor: string): boolean {
  let cur = node
  let steps = 0
  while (cur !== null && steps++ <= placements.size) {
    if (cur === ancestor) return true
    cur = placements.get(cur)?.parentId ?? null
  }
  return false
}
