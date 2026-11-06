'use client'

import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'

interface Heading {
  pos: number
  level: number
  text: string
}

function headingsOf(editor: Editor): Heading[] {
  const out: Heading[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.textContent.trim()) {
      out.push({ pos, level: Number(node.attrs.level) || 1, text: node.textContent.trim() })
    }
    // Headings only live at the top level or inside simple containers.
    return node.type.name !== 'table' && node.type.name !== 'codeBlock'
  })
  return out
}

/**
 * "On this page": a quiet strip of marks, one per heading, that opens into a
 * clickable outline on hover or focus. Shown once a page has three headings.
 */
export function Outline({ editor, scrollEl }: { editor: Editor | null; scrollEl: React.RefObject<HTMLElement | null> }) {
  const [items, setItems] = useState<Heading[]>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (!editor) return
    const read = () => setItems(headingsOf(editor))
    // Local and remote edits both arrive as transactions.
    const onTr = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) read()
    }
    read()
    editor.on('transaction', onTr)
    return () => {
      editor.off('transaction', onTr)
    }
  }, [editor])

  // Which section you're reading.
  useEffect(() => {
    const el = scrollEl.current
    if (!el || !editor || items.length < 3) return
    const onScroll = () => {
      const top = el.getBoundingClientRect().top + 96
      let current = 0
      items.forEach((h, i) => {
        const dom = editor.view.nodeDOM(h.pos) as HTMLElement | null
        if (dom && dom.getBoundingClientRect().top <= top) current = i
      })
      // At the very bottom, the last sections can't reach the top: count the last one.
      if (el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 4) current = items.length - 1
      setActive(current)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollEl, editor, items])

  if (!editor || items.length < 3) return null

  const go = (h: Heading) => {
    const dom = editor.view.nodeDOM(h.pos) as HTMLElement | null
    const el = scrollEl.current
    if (!dom || !el) return
    el.scrollTo({ top: el.scrollTop + dom.getBoundingClientRect().top - el.getBoundingClientRect().top - 72, behavior: 'smooth' })
  }

  return (
    <nav className="outline" aria-label="On this page">
      <div className="outline-marks" aria-hidden="true">
        {items.map((h, i) => (
          <i key={h.pos} className={i === active ? 'on' : ''} style={{ width: 16 - (h.level - 1) * 4 }} />
        ))}
      </div>
      <div className="outline-panel">
        <div className="outline-title">On this page</div>
        <ul>
          {items.map((h, i) => (
            <li key={h.pos} style={{ paddingLeft: (h.level - 1) * 12 }}>
              <button type="button" className={i === active ? 'on' : ''} onClick={() => go(h)}>
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
