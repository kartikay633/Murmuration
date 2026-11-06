'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mark } from '@tiptap/core'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { fragmentText, isInk } from '@murmuration/shared'
import { contentExtensions } from '@/lib/content-schema'
import { PageHistory, pageJSON, withoutAuthors, type Author } from '@/lib/history'
import { Icon } from './icons'
import { NameVersion, useVersions, VersionList } from './versions'
import { VersionDiff } from './version-diff'
import { useWorkspace } from './workspace'

/** Colours a run of text by the person who wrote it. Only used in the read-only history view. */
const AuthorMark = Mark.create({
  name: 'author',
  addAttributes() {
    return { ink: { default: null, renderHTML: () => ({}) }, name: { default: null, renderHTML: () => ({}) } }
  },
  renderHTML({ mark }) {
    const ink = isInk(mark.attrs.ink) ? mark.attrs.ink : 'ochre'
    return ['span', { class: 'blame', style: `--a: var(--ink-${ink})`, title: String(mark.attrs.name ?? '') }, 0]
  },
})

const when = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function HistoryView({
  pageId,
  title,
  liveEditor,
  canRestore,
  canName = false,
  initialBlame,
  onClose,
  onRestored,
  stacked,
}: {
  stacked: boolean
  onRestored?(): void
  pageId: string
  title: string
  liveEditor: Editor | null
  canRestore: boolean
  /** Can give names to versions (anyone who can comment). */
  canName?: boolean
  initialBlame: boolean
  onClose(): void
}) {
  const { toast } = useWorkspace()
  const [history, setHistory] = useState<PageHistory | null>(null)
  const [failed, setFailed] = useState(false)
  const [index, setIndex] = useState(0)
  const [blame, setBlame] = useState(initialBlame)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    let alive = true
    PageHistory.load(pageId)
      .then((h) => {
        if (!alive) return
        setHistory(h)
        setIndex(h.length - 1)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [pageId])

  const last = (history?.length ?? 1) - 1
  const atNow = index >= last

  const json = useMemo(() => {
    if (!history || history.length === 0) return null
    const doc = history.docAt(index)
    const out = pageJSON(doc, blame ? (c) => history.authorOfClient(c) : null)
    doc.destroy()
    return out
  }, [history, index, blame])

  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [...contentExtensions(), AuthorMark],
    editorProps: { attributes: { 'aria-label': 'Page as it was at this point in its history' } },
  })
  useEffect(() => {
    if (editor && json) editor.commands.setContent(json, { emitUpdate: false })
  }, [editor, json])

  /* ---------- playback ---------- */
  useEffect(() => {
    if (!playing || !history) return
    const total = Math.min(10_000, Math.max(3000, history.length * 40))
    const start = performance.now()
    const from = index >= last ? 0 : index
    let raf = 0
    const tick = (now: number) => {
      const k = Math.min(last, from + Math.floor(((now - start) / total) * (last - from + 1)))
      setIndex(k)
      if (k >= last) return setPlaying(false)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, history])

  /* ---------- people in this version ---------- */
  const people = useMemo(() => {
    if (!history) return [] as Author[]
    const ids = new Set(history.events.slice(0, index + 1).map((e) => e.authorId).filter((x): x is string => !!x))
    return [...ids].map((id) => history.authors.get(id)).filter((a): a is Author => !!a)
  }, [history, index])

  const restore = () => {
    if (!liveEditor || !json) return
    liveEditor.commands.setContent(withoutAuthors(json))
    onRestored?.()
    toast(`Restored the version from ${when(history!.events[index]!.at)}. It’s saved as a new edit, so nothing is lost.`)
    onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const current = history?.events[index]
  const { versions, refresh: refreshVersions } = useVersions(pageId)
  // Jump to the last edit at or before a named version's event.
  const pick = (eventId: number) => {
    if (!history) return
    let k = -1
    history.events.forEach((e, i) => {
      if (e.id <= eventId) k = i
    })
    if (k >= 0) {
      setPlaying(false)
      setIndex(k)
    }
  }
  const namedHere = versions.find((v) => v.eventId === current?.id)

  // "Compare with latest": the text of this version against the newest one.
  const [compare, setCompare] = useState(false)
  const texts = useMemo(() => {
    if (!compare || !history || atNow) return null
    const then = history.docAt(index)
    const now = history.docAt(last)
    const out = { before: fragmentText(then.getXmlFragment('default')), after: fragmentText(now.getXmlFragment('default')) }
    then.destroy()
    now.destroy()
    return out
  }, [compare, history, index, last, atNow])

  return (
    <>
      <div className="scroll history-scroll">
        <div className="history-pill" role="status">
          <span>
            {namedHere ? namedHere.name : atNow ? 'Latest version' : current ? when(current.at) : 'Loading…'}
            {current && !atNow && <span className="t"> · version {index + 1} of {last + 1}</span>}
          </span>
          {canName && !namedHere && <NameVersion pageId={pageId} eventId={current?.id} onSaved={refreshVersions} />}
          {!atNow && (
            <button type="button" aria-pressed={compare} onClick={() => setCompare((c) => !c)}>
              {compare ? 'Show this version' : 'Compare with latest'}
            </button>
          )}
          {!atNow && canRestore && (
            <button type="button" onClick={restore} disabled={!liveEditor}>
              Restore this version
            </button>
          )}
          <button type="button" onClick={onClose}>
            Back to live
          </button>
        </div>
        <div className={`page-wrap${stacked ? ' stacked' : ''}`}>
          <article className="page">
            {stacked && (
              <VersionList versions={versions} activeEventId={namedHere?.eventId} onPick={pick} onRemoved={refreshVersions} compact />
            )}
            <h1 className="title-input" style={{ marginBottom: 18 }}>{title || 'Untitled'}</h1>
            {blame && people.length > 0 && (
              <div className="legend" aria-label="Who wrote what">
                {people.map((p) => (
                  <span key={p.id} className="legend-item" style={{ '--a': `var(--ink-${isInk(p.ink) ? p.ink : 'ochre'})` } as React.CSSProperties}>
                    <i /> {p.name}
                  </span>
                ))}
              </div>
            )}
            <hr className="page-rule" />
            {failed ? (
              <p className="readonly-note">History couldn’t be loaded. Check your connection and try again.</p>
            ) : history && history.length === 0 ? (
              <p className="readonly-note">This page has no recorded edits yet.</p>
            ) : texts ? (
              <VersionDiff before={texts.before} after={texts.after} />
            ) : json ? (
              <EditorContent editor={editor} />
            ) : (
              <div className="skeleton"><i /> <i /> <i /> <i /></div>
            )}
            {history?.truncated && <p className="muted" style={{ fontSize: 12.5 }}>Showing the first 20,000 edits.</p>}
          </article>
          {/* Same columns as the live page, so switching views doesn't shift the text. */}
          {!stacked && (
            <aside className="rail">
              <VersionList versions={versions} activeEventId={namedHere?.eventId} onPick={pick} onRemoved={refreshVersions} compact={false} />
            </aside>
          )}
        </div>
      </div>
      <Timeline
        history={history}
        index={index}
        setIndex={(k) => {
          setPlaying(false)
          setIndex(k)
        }}
        playing={playing}
        togglePlay={() => setPlaying((p) => !p)}
        blame={blame}
        toggleBlame={() => setBlame((b) => !b)}
      />
    </>
  )
}

function Timeline({
  history,
  index,
  setIndex,
  playing,
  togglePlay,
  blame,
  toggleBlame,
}: {
  history: PageHistory | null
  index: number
  setIndex(k: number): void
  playing: boolean
  togglePlay(): void
  blame: boolean
  toggleBlame(): void
}) {
  const track = useRef<HTMLDivElement>(null)
  const n = history?.length ?? 0
  const last = Math.max(0, n - 1)
  const frac = n > 1 ? index / last : 1

  const bars = useMemo(() => {
    if (!history || !n) return []
    const count = Math.min(120, n)
    const out: { h: number; ink: string; from: number }[] = []
    let max = 1
    const raw = Array.from({ length: count }, (_, b) => {
      const from = Math.floor((b * n) / count)
      const to = Math.floor(((b + 1) * n) / count)
      const bySize = new Map<string, number>()
      let size = 0
      for (let k = from; k < to; k++) {
        const e = history.events[k]!
        size += e.size
        const who = e.authorId ?? ''
        bySize.set(who, (bySize.get(who) ?? 0) + e.size)
      }
      const top = [...bySize].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
      max = Math.max(max, size)
      return { size, ink: history.authors.get(top)?.ink ?? 'ochre', from }
    })
    for (const r of raw) out.push({ h: 10 + 90 * Math.sqrt(r.size / max), ink: isInk(r.ink) ? r.ink : 'ochre', from: r.from })
    return out
  }, [history, n])

  const fromPointer = useCallback(
    (clientX: number) => {
      const r = track.current?.getBoundingClientRect()
      if (!r || !n) return
      setIndex(Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * last))
    },
    [n, last, setIndex],
  )

  const current = history?.events[index]
  const who = current?.authorId ? history?.authors.get(current.authorId) : null
  const first = history?.events[0]
  const lastEv = history?.events[last]

  return (
    <footer className="timeline" aria-label="Page history">
      <div className="tl-left">
        <button className="play" type="button" onClick={togglePlay} disabled={!n} aria-label={playing ? 'Pause' : 'Replay this page from the start'}>
          <Icon name={playing ? 'pause' : 'play'} size={12} />
        </button>
        <div className="tl-label">
          <b>History</b>
          <span>{n === 1 ? '1 edit' : `${n.toLocaleString('en-US')} edits`}</span>
        </div>
      </div>
      <div
        className="track"
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Scrub through the page’s history"
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={index + 1}
        aria-valuetext={current ? `${when(current.at)}${who ? `, ${who.name}` : ''}` : undefined}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          e.currentTarget.classList.add('drag')
          fromPointer(e.clientX)
        }}
        onPointerMove={(e) => e.currentTarget.classList.contains('drag') && fromPointer(e.clientX)}
        onPointerUp={(e) => e.currentTarget.classList.remove('drag')}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 1
          if (e.key === 'ArrowLeft') (e.preventDefault(), setIndex(Math.max(0, index - step)))
          if (e.key === 'ArrowRight') (e.preventDefault(), setIndex(Math.min(last, index + step)))
          if (e.key === 'Home') (e.preventDefault(), setIndex(0))
          if (e.key === 'End') (e.preventDefault(), setIndex(last))
        }}
      >
        <div className={`bars${bars.length < 3 ? ' few' : ''}`}>
          {bars.map((b, i) => (
            <i
              key={i}
              className={b.from > index ? 'after' : ''}
              style={{ height: `${b.h}%`, '--c': `var(--ink-${b.ink})` } as React.CSSProperties}
            />
          ))}
        </div>
        <div className="days">
          {first && <span style={{ left: 0, transform: 'none' }}>{when(first.at)}</span>}
          {lastEv && n > 1 && <span style={{ left: '100%', transform: 'translateX(-100%)' }}>{when(lastEv.at)}</span>}
        </div>
        <div className="head" style={{ left: `${frac * 100}%` }}>
          <div className="tip">
            {current ? `${when(current.at)}${who ? ` · ${who.name.split(' ')[0]}` : ''}` : ''}
          </div>
        </div>
      </div>
      <button className="btn ghost" type="button" aria-pressed={blame} onClick={toggleBlame} title="Colour text by who wrote it">
        <Icon name="blame" /> <span className="txt">Blame</span>
      </button>
    </footer>
  )
}
