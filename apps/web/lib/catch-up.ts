import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

/**
 * Catch-up highlights: text other people inserted since your last visit,
 * tinted in their ink.
 *
 * Every Yjs insert has an id (client, clock). Decoding the updates you missed
 * gives the id ranges they inserted; walking the page's text items tells us
 * which of those characters still exist and where they are now. Deleted text
 * simply drops out, and the highlights stay on the right characters while
 * anyone keeps typing around them.
 */

export interface NewText {
  client: number
  from: number
  to: number
  ink: string
}

interface State {
  ranges: NewText[]
  deco: DecorationSet
}

export const catchUpKey = new PluginKey<State>('catchUp')

/** Id ranges inserted by a set of (author, update) pairs. */
export function insertedRanges(updates: { update: Uint8Array; ink: string }[]): NewText[] {
  const out: NewText[] = []
  for (const { update, ink } of updates) {
    for (const s of Y.decodeUpdate(update).structs) {
      // Items carry content; GC and Skip structs don't.
      if (!(s instanceof Y.Item)) continue
      out.push({ client: s.id.client, from: s.id.clock, to: s.id.clock + s.length, ink })
    }
  }
  return out
}

type YState = { doc: Y.Doc; type: Y.XmlFragment; binding: { mapping: Map<unknown, unknown> } | null }

function texts(node: Y.XmlFragment | Y.XmlElement, out: Y.XmlText[] = []): Y.XmlText[] {
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) out.push(child)
    else if (child instanceof Y.XmlElement) texts(child, out)
  }
  return out
}

function build(state: EditorState, ranges: NewText[]): DecorationSet {
  const y = ySyncPluginKey.getState(state) as YState | undefined
  if (!ranges.length || !y?.binding) return DecorationSet.empty
  const byClient = new Map<number, NewText[]>()
  for (const r of ranges) byClient.set(r.client, [...(byClient.get(r.client) ?? []), r])

  const found: { from: number; to: number; ink: string }[] = []
  for (const t of texts(y.type)) {
    let index = 0
    for (let item = t._start; item; item = item.right) {
      if (item.deleted || !item.countable) continue
      const len = item.length
      for (const r of byClient.get(item.id.client) ?? []) {
        const s = Math.max(r.from, item.id.clock)
        const e = Math.min(r.to, item.id.clock + len)
        if (e <= s) continue
        const a = index + (s - item.id.clock)
        const b = index + (e - item.id.clock)
        const from = relativePositionToAbsolutePosition(y.doc, y.type, Y.createRelativePositionFromTypeIndex(t, a), y.binding.mapping as never)
        const to = relativePositionToAbsolutePosition(y.doc, y.type, Y.createRelativePositionFromTypeIndex(t, b), y.binding.mapping as never)
        if (from != null && to != null && to > from && to <= state.doc.content.size) found.push({ from, to, ink: r.ink })
      }
      index += len
    }
  }
  // Typing arrives a keystroke at a time; join touching runs by the same person.
  found.sort((a, b) => a.from - b.from)
  const merged: typeof found = []
  for (const f of found) {
    const last = merged[merged.length - 1]
    if (last && last.ink === f.ink && f.from <= last.to) last.to = Math.max(last.to, f.to)
    else merged.push({ ...f })
  }
  return DecorationSet.create(
    state.doc,
    merged.map((m) => Decoration.inline(m.from, m.to, { class: 'catchup', style: `--c: var(--ink-${m.ink})` })),
  )
}

export const CatchUp = Extension.create({
  name: 'catchUp',
  addProseMirrorPlugins() {
    return [
      new Plugin<State>({
        key: catchUpKey,
        state: {
          init: () => ({ ranges: [], deco: DecorationSet.empty }),
          apply(tr, prev, _old, state) {
            const next = tr.getMeta(catchUpKey) as NewText[] | undefined
            if (next) return { ranges: next, deco: build(state, next) }
            if (!prev.ranges.length || !tr.docChanged) return prev
            // Remote changes can move text anywhere; rebuild. Local typing just maps.
            if (tr.getMeta(ySyncPluginKey)) return { ranges: prev.ranges, deco: build(state, prev.ranges) }
            return { ranges: prev.ranges, deco: prev.deco.map(tr.mapping, tr.doc) }
          },
        },
        props: {
          decorations: (state) => catchUpKey.getState(state)?.deco,
        },
      }),
    ]
  },
})
