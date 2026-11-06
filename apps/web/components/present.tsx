'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model'
import { Icon } from './icons'

/**
 * Present a page: full screen, one section per slide. A new slide starts at
 * every top-level heading of level 1 or 2; the page title opens the deck.
 */
function slidesOf(editor: Editor): PMNode[][] {
  const slides: PMNode[][] = [[]]
  editor.state.doc.forEach((node) => {
    const breaks = node.type.name === 'heading' && Number(node.attrs.level) <= 2
    if (breaks && slides[slides.length - 1]!.length) slides.push([])
    slides[slides.length - 1]!.push(node)
  })
  return slides.filter((s) => s.some((n) => n.textContent.trim() || n.type.name === 'table' || n.type.name === 'horizontalRule'))
}

export function Presenter({ editor, title, onClose }: { editor: Editor; title: string; onClose(): void }) {
  const slides = useMemo(() => slidesOf(editor), [editor])
  // Slide 0 is the title card.
  const [i, setI] = useState(0)
  const total = slides.length + 1
  const body = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)

  const go = useCallback((d: number) => setI((x) => Math.max(0, Math.min(total - 1, x + d))), [total])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) (e.preventDefault(), go(1))
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) (e.preventDefault(), go(-1))
      else if (e.key === 'Home') setI(0)
      else if (e.key === 'End') setI(total - 1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, onClose, total])

  // Try for real full screen; the overlay works without it too.
  useEffect(() => {
    const el = root.current
    void el?.requestFullscreen?.().catch(() => {})
    const onExit = () => !document.fullscreenElement && onClose()
    document.addEventListener('fullscreenchange', onExit)
    return () => {
      document.removeEventListener('fullscreenchange', onExit)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [onClose])

  // Render the slide with the editor's own schema, so it looks like the page.
  useEffect(() => {
    const el = body.current
    if (!el) return
    el.replaceChildren()
    if (i === 0) return
    const serializer = DOMSerializer.fromSchema(editor.schema)
    for (const node of slides[i - 1]!) el.append(serializer.serializeNode(node))
  }, [i, slides, editor])

  return (
    <div className="present" ref={root} role="dialog" aria-modal="true" aria-label={`Presenting ${title || 'Untitled'}`}>
      <div className="present-stage" onClick={(e) => (e.clientX > window.innerWidth / 3 ? go(1) : go(-1))}>
        {i === 0 ? (
          <div className="present-cover">
            <h1>{title || 'Untitled'}</h1>
            <p>{slides.length} {slides.length === 1 ? 'section' : 'sections'}</p>
          </div>
        ) : (
          <div className="present-slide ProseMirror" ref={body} />
        )}
      </div>
      <div className="present-bar">
        <button type="button" className="icon-btn" aria-label="Previous slide" onClick={() => go(-1)} disabled={i === 0}>
          <Icon name="chev" className="flip" />
        </button>
        <span className="present-count">
          {i + 1} / {total}
        </span>
        <button type="button" className="icon-btn" aria-label="Next slide" onClick={() => go(1)} disabled={i === total - 1}>
          <Icon name="chev" />
        </button>
        <button type="button" className="icon-btn" aria-label="Stop presenting" title="Stop presenting (Esc)" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="present-progress" style={{ width: `${((i + 1) / total) * 100}%` }} />
    </div>
  )
}
