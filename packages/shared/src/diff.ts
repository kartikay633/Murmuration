/**
 * Word-level diff (Myers, "An O(ND) Difference Algorithm and Its Variations").
 * Used to show what changed between two versions of a page.
 */

export type DiffOp = { type: 'eq' | 'ins' | 'del'; text: string }

/** Words, runs of spaces, and line breaks, so a diff never splits a word. */
export function tokenize(s: string): string[] {
  return s.match(/\n|[^\S\n]+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}_'’-]/gu) ?? []
}

/**
 * The shortest edit script turning `a` into `b`, as runs of equal, inserted
 * and deleted tokens. O((N+M)·D) time, where D is the number of differences.
 */
export function diffTokens(a: string[], b: string[]): DiffOp[] {
  // Trim the common prefix and suffix first: most edits are local.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const A = a.slice(start, endA)
  const B = b.slice(start, endB)
  const N = A.length
  const M = B.length
  const max = N + M
  const ops: { type: DiffOp['type']; token: string }[] = []

  if (N === 0 || M === 0) {
    for (const t of A) ops.push({ type: 'del', token: t })
    for (const t of B) ops.push({ type: 'ins', token: t })
  } else {
    // v[k] = furthest x on diagonal k; keep each round's v to walk back the path.
    const offset = max
    let v = new Int32Array(2 * max + 2)
    const trace: Int32Array[] = []
    let found = -1
    for (let d = 0; d <= max && found < 0; d++) {
      trace.push(v.slice())
      const next = v.slice()
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1
        let y = x - k
        while (x < N && y < M && A[x] === B[y]) {
          x++
          y++
        }
        next[offset + k] = x
        if (x >= N && y >= M) {
          found = d
          break
        }
      }
      v = next
    }
    trace.push(v)
    // Walk back from (N, M) to (0, 0).
    let x = N
    let y = M
    const back: { type: DiffOp['type']; token: string }[] = []
    for (let d = found; d > 0; d--) {
      const vd = trace[d]!
      const k = x - y
      const prevK = k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!) ? k + 1 : k - 1
      const prevX = vd[offset + prevK]!
      const prevY = prevX - prevK
      while (x > prevX && y > prevY) {
        back.push({ type: 'eq', token: A[--x]! })
        y--
      }
      if (x === prevX) back.push({ type: 'ins', token: B[--y]! })
      else back.push({ type: 'del', token: A[--x]! })
    }
    while (x > 0 && y > 0) {
      back.push({ type: 'eq', token: A[--x]! })
      y--
    }
    ops.push(...back.reverse())
  }

  const all = [
    ...a.slice(0, start).map((token) => ({ type: 'eq' as const, token })),
    ...ops,
    ...a.slice(endA).map((token) => ({ type: 'eq' as const, token })),
  ]
  // Merge runs of the same kind.
  const out: DiffOp[] = []
  for (const o of all) {
    const last = out[out.length - 1]
    if (last && last.type === o.type) last.text += o.token
    else out.push({ type: o.type, text: o.token })
  }
  return out
}

/** Diff two texts word by word. Very large inputs fall back to comparing whole lines. */
export function diffText(before: string, after: string): DiffOp[] {
  const a = tokenize(before)
  const b = tokenize(after)
  if (a.length + b.length <= 40_000) return diffTokens(a, b)
  const lines = (s: string) => s.split(/(?<=\n)/)
  return diffTokens(lines(before), lines(after))
}

/** Characters added and removed, for a one-line summary. */
export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const o of ops) {
    if (o.type === 'ins') added += o.text.trim().length
    if (o.type === 'del') removed += o.text.trim().length
  }
  return { added, removed }
}
