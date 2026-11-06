import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { fragmentMentions, fragmentTasks } from './tasks'
import { fragmentMarkdown, fragmentText } from './text'

const ANA = '123e4567-e89b-12d3-a456-426614174001'
const RO = '123e4567-e89b-12d3-a456-426614174002'

function el(name: string, attrs: Record<string, unknown>, children: (Y.XmlElement | Y.XmlText)[]) {
  const e = new Y.XmlElement(name)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v as string)
  e.insert(0, children)
  return e
}
const t = (s: string) => {
  const x = new Y.XmlText()
  x.insert(0, s)
  return x
}
const mention = (id: string, label: string) => el('mention', { id, label }, [])

function page() {
  const doc = new Y.Doc()
  const f = doc.getXmlFragment('default')
  f.insert(0, [
    el('paragraph', {}, [t('Hi '), mention(RO, 'Rohan'), t(', see below')]),
    el('taskList', {}, [
      el('taskItem', { checked: false }, [
        el('paragraph', {}, [t('Write the release notes '), mention(ANA, 'Ana')]),
        el('taskList', {}, [el('taskItem', { checked: true }, [el('paragraph', {}, [t('Draft intro')])])]),
      ]),
      el('taskItem', { checked: false }, [el('paragraph', {}, [])]),
    ]),
  ])
  return f
}

describe('mentions and tasks', () => {
  it('finds everyone mentioned, once each', () => {
    expect(fragmentMentions(page()).sort()).toEqual([ANA, RO].sort())
  })

  it('lists to-dos with their state and whom they mention, skipping empty ones', () => {
    expect(fragmentTasks(page())).toEqual([
      { text: 'Write the release notes @Ana', done: false, assignees: [ANA] },
      { text: 'Draft intro', done: true, assignees: [] },
    ])
  })

  it('writes mentions as @Name in text and Markdown', () => {
    expect(fragmentText(page())).toContain('Hi @Rohan, see below')
    expect(fragmentMarkdown(page())).toContain('Hi @Rohan, see below')
  })
})
