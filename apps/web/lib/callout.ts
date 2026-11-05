import { Node, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the current block(s) in a callout, or unwrap if already inside one. */
      toggleCallout: () => ReturnType
    }
  }
}

/** A set-off box for notes, warnings and key points. Holds any blocks. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout', class: 'callout' }), 0]
  },

  addCommands() {
    return {
      toggleCallout:
        () =>
        ({ commands, editor }) =>
          editor.isActive('callout') ? commands.lift('callout') : commands.wrapIn('callout'),
    }
  },

  addKeyboardShortcuts() {
    return {
      // Backspace at the very start of a callout's first line unwraps it.
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty || $from.parentOffset !== 0) return false
        const d = $from.depth - 1
        return d > 0 && $from.node(d).type.name === 'callout' && $from.index(d) === 0 ? editor.commands.lift('callout') : false
      },
    }
  },
})
