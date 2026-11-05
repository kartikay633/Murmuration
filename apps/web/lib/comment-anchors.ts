import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

/**
 * Comment highlights that follow their text.
 *
 * Each thread stores its range as two Yjs relative positions. They point at
 * specific characters (by Yjs item id), not offsets, so they survive any
 * number of concurrent inserts and deletes around them. We resolve them back
 * to ProseMirror positions whenever the document changes remotely, and map
 * them through local transactions in between.
 */

export interface Anchor {
  id: string
  start: string
  end: string
}
export type Range = { from: number; to: number }

interface PluginState {
  anchors: Anchor[]
  active: string | null
  ranges: Map<string, Range>
  deco: DecorationSet
}

export const commentAnchorsKey = new PluginKey<PluginState>('commentAnchors')

const toB64 = (bytes: Uint8Array) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

type YState = { doc: Y.Doc; type: Y.XmlFragment; binding: { mapping: Map<unknown, unknown> } | null }
const ystate = (state: EditorState) => ySyncPluginKey.getState(state) as YState | undefined

/** Convert a ProseMirror range into a stored anchor. */
export function anchorFor(state: EditorState, from: number, to: number): { start: string; end: string } | null {
  const y = ystate(state)
  if (!y?.binding) return null
  const start = absolutePositionToRelativePosition(from, y.type, y.binding.mapping as never)
  const end = absolutePositionToRelativePosition(to, y.type, y.binding.mapping as never)
  return { start: toB64(Y.encodeRelativePosition(start)), end: toB64(Y.encodeRelativePosition(end)) }
}

function resolveAll(state: EditorState, anchors: Anchor[]): Map<string, Range> {
  const y = ystate(state)
  const out = new Map<string, Range>()
  if (!y?.binding) return out
  for (const a of anchors) {
    try {
      const from = relativePositionToAbsolutePosition(y.doc, y.type, Y.decodeRelativePosition(fromB64(a.start)), y.binding.mapping as never)
      const to = relativePositionToAbsolutePosition(y.doc, y.type, Y.decodeRelativePosition(fromB64(a.end)), y.binding.mapping as never)
      if (from != null && to != null && to > from && to <= state.doc.content.size) out.set(a.id, { from, to })
    } catch {
      /* anchor from an unrelated document or corrupted; treat as detached */
    }
  }
  return out
}

function decorate(state: EditorState, ranges: Map<string, Range>, active: string | null): DecorationSet {
  const decos: Decoration[] = []
  for (const [id, r] of ranges) {
    decos.push(
      Decoration.inline(r.from, r.to, { class: `comment-anchor${id === active ? ' active' : ''}${id === 'draft' ? ' draft' : ''}`, 'data-thread': id }, { id }),
    )
  }
  return DecorationSet.create(state.doc, decos)
}

function rebuild(state: EditorState, anchors: Anchor[], active: string | null): PluginState {
  const ranges = resolveAll(state, anchors)
  return { anchors, active, ranges, deco: decorate(state, ranges, active) }
}

export function setAnchors(tr: Transaction, anchors: Anchor[], active: string | null) {
  return tr.setMeta(commentAnchorsKey, { anchors, active })
}

export function anchorRanges(state: EditorState): Map<string, Range> {
  return commentAnchorsKey.getState(state)?.ranges ?? new Map()
}

export const CommentAnchors = Extension.create<{ onActivate: (id: string) => void }>({
  name: 'commentAnchors',
  addOptions() {
    return { onActivate: () => {} }
  },
  addProseMirrorPlugins() {
    const options = this.options
    return [
      new Plugin<PluginState>({
        key: commentAnchorsKey,
        state: {
          init: (_, state) => rebuild(state, [], null),
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(commentAnchorsKey) as { anchors: Anchor[]; active: string | null } | undefined
            if (meta) return rebuild(state, meta.anchors, meta.active)
            // Changes coming from Yjs (remote edits, first load): the binding's mapping is
            // already up to date, so resolve the anchors from scratch.
            if (tr.getMeta(ySyncPluginKey)) return rebuild(state, prev.anchors, prev.active)
            if (!tr.docChanged) return prev
            // Our own typing: the Yjs mapping catches up after this transaction, so map
            // the existing ranges forward instead.
            const ranges = new Map<string, Range>()
            for (const [id, r] of prev.ranges) {
              const from = tr.mapping.map(r.from, 1)
              const to = tr.mapping.map(r.to, -1)
              if (to > from) ranges.set(id, { from, to })
            }
            return { ...prev, ranges, deco: prev.deco.map(tr.mapping, tr.doc) }
          },
        },
        props: {
          decorations: (state) => commentAnchorsKey.getState(state)?.deco,
          handleClick(_view, _pos, event) {
            const el = (event.target as HTMLElement | null)?.closest?.('[data-thread]')
            const id = el?.getAttribute('data-thread')
            if (id && id !== 'draft') options.onActivate(id)
            return false
          },
        },
      }),
    ]
  },
})
