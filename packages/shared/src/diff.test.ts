import { describe, expect, it } from 'vitest'
import { diffStats, diffText, diffTokens, tokenize, type DiffOp } from './diff'

const apply = (ops: DiffOp[], side: 'before' | 'after') =>
  ops
    .filter((o) => o.type === 'eq' || o.type === (side === 'before' ? 'del' : 'ins'))
    .map((o) => o.text)
    .join('')

describe('word diff', () => {
  it('keeps words whole', () => {
    expect(tokenize("It's a test, ok?\nYes")).toEqual(["It's", ' ', 'a', ' ', 'test', ',', ' ', 'ok', '?', '\n', 'Yes'])
  })

  it('finds an inserted and a removed word', () => {
    const ops = diffText('Ship the beta on Monday', 'Ship the public beta on Friday')
    expect(ops).toEqual([
      { type: 'eq', text: 'Ship the ' },
      { type: 'ins', text: 'public ' },
      { type: 'eq', text: 'beta on ' },
      { type: 'del', text: 'Monday' },
      { type: 'ins', text: 'Friday' },
    ])
    expect(diffStats(ops)).toEqual({ added: 12, removed: 6 })
  })

  it('keeps one edit together instead of splitting it at a space', () => {
    expect(diffText('many documents', 'any number of documents')).toEqual([
      { type: 'del', text: 'many' },
      { type: 'ins', text: 'any number of' },
      { type: 'eq', text: ' documents' },
    ])
  })

  it('handles empty sides and identical texts', () => {
    expect(diffText('', 'new text')).toEqual([{ type: 'ins', text: 'new text' }])
    expect(diffText('old text', '')).toEqual([{ type: 'del', text: 'old text' }])
    expect(diffText('same', 'same')).toEqual([{ type: 'eq', text: 'same' }])
  })

  it('always reconstructs both sides on random edits', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const words = ['alpha', 'beta', 'gamma', 'delta', 'eps', '\n']
    for (let run = 0; run < 300; run++) {
      const a = Array.from({ length: Math.floor(rand() * 30) }, () => words[Math.floor(rand() * words.length)]!)
      const b = a.filter(() => rand() > 0.2)
      for (let i = 0; i < 5; i++) b.splice(Math.floor(rand() * (b.length + 1)), 0, words[Math.floor(rand() * words.length)]!)
      const ops = diffTokens(a, b)
      expect(apply(ops, 'before')).toBe(a.join(''))
      expect(apply(ops, 'after')).toBe(b.join(''))
    }
  })
})
