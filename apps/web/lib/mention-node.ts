import { Node, mergeAttributes } from '@tiptap/core'

/**
 * An @mention of a person inside page text. Stores who (id) and the name as
 * written, so the text still reads right if they later leave the workspace.
 */
export const PersonMention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-id'), renderHTML: (a) => ({ 'data-id': a.id }) },
      label: { default: '', parseHTML: (el) => el.getAttribute('data-label'), renderHTML: (a) => ({ 'data-label': a.label }) },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'mention', class: 'person-mention' }), `@${node.attrs.label}`]
  },

  renderText({ node }) {
    return `@${node.attrs.label}`
  },
})
