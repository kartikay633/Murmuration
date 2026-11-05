import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { keyBetween } from './tree'
import { isWithin, nextClock, resolveMoves, TREE_MOVES, type MoveOp } from './tree-crdt'

/** Small seeded PRNG so a failure can be reproduced from its seed. */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 0x100000000
  }
}

function replica(id: number) {
  const doc = new Y.Doc()
  doc.clientID = id
  const log = doc.getArray<MoveOp>(TREE_MOVES)
  return {
    doc,
    log,
    move(n: string, p: string | null, k: string) {
      log.push([{ n, p, k, l: nextClock(log.toArray()), c: doc.clientID }])
    },
  }
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}

function assertNoCycles(placements: ReturnType<typeof resolveMoves>['placements']) {
  for (const n of placements.keys()) {
    let cur: string | null = placements.get(n)!.parentId
    const seen = new Set([n])
    while (cur !== null) {
      expect(seen.has(cur), `cycle through ${n}`).toBe(false)
      seen.add(cur)
      cur = placements.get(cur)?.parentId ?? null
    }
  }
}

describe('tree CRDT', () => {
  it('resolves the classic A-under-B / B-under-A race without a cycle, the same way everywhere', () => {
    const x = replica(1)
    const y = replica(2)
    for (const r of [x, y]) {
      r.move('A', null, 'a')
      r.move('B', null, 'b')
    }
    sync(x.doc, y.doc)
    // Concurrently: x puts A under B, y puts B under A.
    x.move('A', 'B', 'm')
    y.move('B', 'A', 'm')
    sync(x.doc, y.doc)
    const rx = resolveMoves(x.log.toArray())
    const ry = resolveMoves(y.log.toArray())
    expect([...rx.placements]).toEqual([...ry.placements])
    expect(rx.skipped).toBe(1)
    assertNoCycles(rx.placements)
  })

  it('ignores moving a node into its own subtree', () => {
    const r = replica(1)
    r.move('A', null, 'a')
    r.move('B', 'A', 'a')
    r.move('C', 'B', 'a')
    r.move('A', 'C', 'a') // A under its own grandchild
    const { placements, skipped } = resolveMoves(r.log.toArray())
    expect(skipped).toBe(1)
    expect(placements.get('A')!.parentId).toBe(null)
    expect(isWithin(placements, 'C', 'A')).toBe(true)
  })

  it('treats malformed entries as absent', () => {
    const { placements } = resolveMoves([{ n: 'A', p: null, k: 'a', l: 1, c: 1 }, { nope: true }, null, 'x'])
    expect([...placements.keys()]).toEqual(['A'])
  })

  for (const seed of [1, 7, 42]) {
    it(`converges with 5 replicas and 10,000 random concurrent moves (seed ${seed})`, () => {
      const rand = rng(seed)
      const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!
      const nodes = Array.from({ length: 40 }, (_, i) => `n${i}`)
      const replicas = Array.from({ length: 5 }, (_, i) => replica(i + 1))

      // Everyone starts from the same flat tree.
      let key = ''
      for (const n of nodes) replicas[0]!.move(n, null, (key = keyBetween(key, '')))
      for (const r of replicas.slice(1)) sync(replicas[0]!.doc, r.doc)

      for (let i = 0; i < 10_000; i++) {
        const r = pick(replicas)
        const n = pick(nodes)
        const p = rand() < 0.2 ? null : pick(nodes)
        r.move(n, p, keyBetween('', String.fromCharCode(97 + Math.floor(rand() * 26))))
        // Partial, random gossip: replicas are out of date most of the time.
        if (rand() < 0.05) sync(pick(replicas).doc, pick(replicas).doc)
      }

      // Final anti-entropy: everyone exchanges with everyone.
      for (const a of replicas) for (const b of replicas) if (a !== b) sync(a.doc, b.doc)

      const results = replicas.map((r) => resolveMoves(r.log.toArray()))
      const first = JSON.stringify([...results[0]!.placements].sort())
      for (const res of results) expect(JSON.stringify([...res.placements].sort())).toBe(first)
      expect(results[0]!.placements.size).toBe(nodes.length)
      assertNoCycles(results[0]!.placements)
      expect(results[0]!.skipped).toBeGreaterThan(0) // the race actually happened
    })
  }
})
