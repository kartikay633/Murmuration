import type { AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import Highlight from '@tiptap/extension-highlight'
import { Markdown } from '@tiptap/markdown'
import { Callout } from './callout'

/**
 * Every kind of block and mark a page can contain. The live editor and the
 * read-only history view both build on this list, so anything that can be
 * written can also be replayed.
 */
export function contentExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      // Collaboration brings its own history, scoped to each person's edits.
      undoRedo: false,
      heading: { levels: [1, 2, 3] },
      // Clicking a link while writing places the cursor; Ctrl/Cmd-click (or read-only) opens it.
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    // Open/closed is each reader's own choice, not part of the shared page.
    Details.configure({ persist: false, HTMLAttributes: { class: 'toggle-block' } }),
    DetailsSummary,
    DetailsContent,
    Callout,
    Highlight,
    // Lets Markdown be loaded into a page (imports).
    Markdown,
  ]
}
