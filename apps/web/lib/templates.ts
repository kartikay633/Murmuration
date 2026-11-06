import type { JSONContent } from '@tiptap/core'

/** Starting structures for common kinds of pages. */
export interface Template {
  id: string
  /** Used by a feature (like the journal) rather than offered on empty pages. */
  internal?: boolean
  name: string
  hint: string
  title(): string
  content(): JSONContent
}

const text = (t: string): JSONContent => ({ type: 'text', text: t })
const p = (t = ''): JSONContent => (t ? { type: 'paragraph', content: [text(t)] } : { type: 'paragraph' })
const h = (level: 1 | 2 | 3, t: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [text(t)] })
const todo = (...items: string[]): JSONContent => ({
  type: 'taskList',
  content: items.map((t) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(t)] })),
})
const bullets = (...items: string[]): JSONContent => ({
  type: 'bulletList',
  content: items.map((t) => ({ type: 'listItem', content: [p(t)] })),
})
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const weekOf = () => {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export const TEMPLATES: Template[] = [
  {
    id: 'meeting',
    name: 'Meeting notes',
    hint: 'Agenda, notes, decisions and follow-ups',
    title: () => `Meeting notes, ${today()}`,
    content: () =>
      doc(
        h(2, 'Attendees'),
        p(),
        h(2, 'Agenda'),
        bullets('', ''),
        h(2, 'Notes'),
        p(),
        h(2, 'Decisions'),
        bullets(''),
        h(2, 'Follow-ups'),
        todo('', ''),
      ),
  },
  {
    id: 'brief',
    name: 'Project brief',
    hint: 'Problem, goals, scope and milestones',
    title: () => 'Project brief',
    content: () =>
      doc(
        h(2, 'Problem'),
        p(),
        h(2, 'Goals'),
        bullets('', ''),
        h(2, 'Out of scope'),
        bullets(''),
        h(2, 'Approach'),
        p(),
        h(2, 'Milestones'),
        todo('', '', ''),
        h(2, 'Open questions'),
        bullets(''),
      ),
  },
  {
    id: 'weekly',
    name: 'Weekly review',
    hint: 'Wins, misses and next week’s priorities',
    title: () => `Week of ${weekOf()}`,
    content: () =>
      doc(h(2, 'What went well'), bullets(''), h(2, 'What didn’t'), bullets(''), h(2, 'Next week'), todo('', '', '')),
  },
  {
    id: 'decision',
    name: 'Decision record',
    hint: 'Context, options and the call you made',
    title: () => 'Decision: ',
    content: () =>
      doc(
        h(2, 'Context'),
        p(),
        h(2, 'Options'),
        { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [p()] }, { type: 'listItem', content: [p()] }] },
        h(2, 'Decision'),
        p(),
        h(2, 'Consequences'),
        bullets(''),
      ),
  },
  {
    id: 'retro',
    name: 'Retrospective',
    hint: 'Keep, change, try',
    title: () => `Retro, ${today()}`,
    content: () => doc(h(2, 'Keep doing'), bullets(''), h(2, 'Change'), bullets(''), h(2, 'Try next'), todo('')),
  },
]

/** The daily log page the journal creates for each day. */
export const DAILY: Template = {
  id: 'daily',
  name: 'Daily log',
  hint: 'Focus, notes and what got done',
  internal: true,
  title: () => journalTitle(new Date()),
  content: () => doc(h(2, 'Focus'), todo('', ''), h(2, 'Notes'), p(), h(2, 'Done'), bullets('')),
}

/** "Friday, 6 November 2026": how journal days are named. */
export const journalTitle = (d: Date) =>
  d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export const templateById = (id: string | null | undefined) => [...TEMPLATES, DAILY].find((t) => t.id === id) ?? null
