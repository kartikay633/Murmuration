import { describe, expect, it } from 'vitest'
import { buildTree, isInTrash, lockedRole, subtree, can, effectiveRole, keyBetween, parseDocName, type TreeNode } from './index'

const node = (id: string, parentId: string | null, position = 'm'): TreeNode => ({
  id, parentId, position, title: id, icon: null, createdAt: 0, createdBy: 'u', archived: false,
})

describe('roles', () => {
  it('page overrides apply to members but never demote admins', () => {
    expect(effectiveRole('editor', 'viewer')).toBe('viewer')
    expect(effectiveRole('viewer', 'editor')).toBe('editor')
    expect(effectiveRole('admin', 'viewer')).toBe('admin')
    expect(effectiveRole(null, null)).toBe(null)
  })

  it('maps actions to minimum roles', () => {
    expect(can('commenter', 'edit')).toBe(false)
    expect(can('editor', 'edit')).toBe(true)
    expect(can('viewer', 'view')).toBe(true)
    expect(can(null, 'view')).toBe(false)
  })
})

describe('doc names', () => {
  it('accepts only page and tree names with uuids', () => {
    expect(parseDocName('page:123e4567-e89b-12d3-a456-426614174000')?.kind).toBe('page')
    expect(parseDocName('tree:123e4567-e89b-12d3-a456-426614174000')?.kind).toBe('tree')
    expect(parseDocName('page:../etc')).toBe(null)
    expect(parseDocName('blob:123e4567-e89b-12d3-a456-426614174000')).toBe(null)
  })
})

describe('fractional keys', () => {
  it('always lands strictly between its neighbours', () => {
    let lo = ''
    let hi = ''
    const keys: string[] = []
    for (let i = 0; i < 300; i++) {
      const k = keyBetween(lo, hi)
      if (lo) expect(k > lo).toBe(true)
      if (hi) expect(k < hi).toBe(true)
      keys.push(k)
      if (i % 3 === 0) hi = k
      else lo = k
    }
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('handles appending and prepending repeatedly', () => {
    let last = ''
    for (let i = 0; i < 100; i++) {
      const k = keyBetween(last, '')
      if (last) expect(k > last).toBe(true)
      last = k
    }
    let first = ''
    for (let i = 0; i < 100; i++) {
      const k = keyBetween('', first)
      if (first) expect(k < first).toBe(true)
      first = k
    }
  })
})

describe('buildTree', () => {
  it('moves nodes caught in a cycle to the root instead of hiding them', () => {
    const t = buildTree([node('a', 'b'), node('b', 'a'), node('c', 'a')])
    const roots = (t.get(null) ?? []).map((n) => n.id).sort()
    expect(roots).toEqual(['a', 'b'])
    expect(t.get('a')?.map((n) => n.id)).toEqual(['c'])
  })

  it('keeps children of archived pages in the trash with them', () => {
    const parent = { ...node('p', null), archived: true }
    const t = buildTree([parent, node('c', 'p')])
    expect(t.get(null)).toBeUndefined()
  })

  it('shows pages whose parent no longer exists at the root', () => {
    const t = buildTree([node('c', 'gone')])
    expect(t.get(null)?.map((n) => n.id)).toEqual(['c'])
  })

  it('orders siblings by position', () => {
    const t = buildTree([node('b', null, 'n'), node('a', null, 'c')])
    expect(t.get(null)?.map((n) => n.id)).toEqual(['a', 'b'])
  })
})

describe('trash', () => {
  it('archiving a page hides its whole subtree, not just the page', () => {
    const nodes = [node('a', null, 'a'), node('b', 'a'), node('c', 'b'), node('d', null, 'b')]
    nodes[0]!.archived = true
    const tree = buildTree(nodes)
    expect((tree.get(null) ?? []).map((n) => n.id)).toEqual(['d'])
    expect(tree.get('a')).toBeUndefined()
    const all = new Map(nodes.map((n) => [n.id, n]))
    expect(isInTrash(all, 'c')).toBe(true)
    expect(isInTrash(all, 'd')).toBe(false)
    expect(subtree(nodes, 'a').sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('locked pages', () => {
  it('cap everyone below admin at commenting', () => {
    expect(lockedRole('editor')).toBe('commenter')
    expect(lockedRole('commenter')).toBe('commenter')
    expect(lockedRole('viewer')).toBe('viewer')
    expect(lockedRole('admin')).toBe('admin')
    expect(lockedRole('owner')).toBe('owner')
    expect(lockedRole(null)).toBe(null)
  })
})
