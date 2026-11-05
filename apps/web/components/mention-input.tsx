'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from './avatar'
import { useWorkspace } from './workspace'

/**
 * A comment box with @mention autocomplete. People are typed as "@Name";
 * on submit each picked name becomes a <@user-id> token, so renames and
 * duplicate names can't send a notification to the wrong person.
 */
export function MentionInput({
  placeholder,
  autoFocus,
  submitLabel = 'Comment',
  onSubmit,
  onCancel,
}: {
  placeholder: string
  autoFocus?: boolean
  submitLabel?: string
  onSubmit(body: string): Promise<boolean>
  onCancel?(): void
}) {
  const { members, user } = useWorkspace()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState<{ q: string; start: number } | null>(null)
  const [idx, setIdx] = useState(0)
  const picked = useRef(new Map<string, string>())
  const ref = useRef<HTMLTextAreaElement>(null)
  const caretAfter = useRef<number | null>(null)

  const options = useMemo(() => {
    if (!query) return []
    const q = query.q.toLowerCase()
    return members
      .filter((m) => m.id !== user.id && (m.name.toLowerCase().split(/\s+/).some((p) => p.startsWith(q)) || m.email.startsWith(q)))
      .slice(0, 6)
  }, [query, members, user.id])

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
    // Only scroll once the box has reached its maximum height.
    el.style.overflowY = el.scrollHeight > 220 ? 'auto' : 'hidden'
    if (caretAfter.current != null) {
      el.setSelectionRange(caretAfter.current, caretAfter.current)
      caretAfter.current = null
    }
  }, [text])

  const detect = (value: string, caret: number) => {
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret))
    setQuery(m ? { q: m[2]!, start: caret - m[2]!.length - 1 } : null)
    setIdx(0)
  }

  const pick = (m: { id: string; name: string }) => {
    const el = ref.current
    if (!el || !query) return
    const caret = el.selectionStart
    const insert = `@${m.name} `
    const next = text.slice(0, query.start) + insert + text.slice(caret)
    picked.current.set(m.name, m.id)
    caretAfter.current = query.start + insert.length
    setText(next)
    setQuery(null)
  }

  const submit = async () => {
    const raw = text.trim()
    if (!raw || busy) return
    let body = raw
    for (const [name, id] of picked.current) body = body.split(`@${name}`).join(`<@${id}>`)
    setBusy(true)
    const ok = await onSubmit(body)
    setBusy(false)
    if (ok) {
      setText('')
      picked.current.clear()
    }
  }

  return (
    <div className="composer" onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        className="composer-input"
        rows={1}
        value={text}
        placeholder={placeholder}
        maxLength={4000}
        aria-label={placeholder}
        onChange={(e) => {
          setText(e.target.value)
          detect(e.target.value, e.target.selectionStart)
        }}
        onKeyDown={(e) => {
          if (query && options.length) {
            if (e.key === 'ArrowDown') return e.preventDefault(), setIdx((i) => (i + 1) % options.length)
            if (e.key === 'ArrowUp') return e.preventDefault(), setIdx((i) => (i - 1 + options.length) % options.length)
            if (e.key === 'Enter' || e.key === 'Tab') return e.preventDefault(), pick(options[idx]!)
            if (e.key === 'Escape') return e.preventDefault(), setQuery(null)
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void submit()
          } else if (e.key === 'Escape' && onCancel) {
            e.preventDefault()
            onCancel()
          }
        }}
        onBlur={() => setTimeout(() => setQuery(null), 120)}
      />
      {query && options.length > 0 && (
        <ul className="mention-menu" role="listbox" aria-label="Mention someone">
          {options.map((m, i) => (
            <li
              key={m.id}
              role="option"
              aria-selected={i === idx}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(m)
              }}
              onMouseEnter={() => setIdx(i)}
            >
              <Avatar name={m.name} ink={m.ink} />
              <span>{m.name}</span>
              <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{m.role}</span>
            </li>
          ))}
        </ul>
      )}
      {(text.trim() || onCancel) && (
        <div className="composer-actions">
          {onCancel && (
            <button className="btn ghost" type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button className="btn primary" type="button" disabled={!text.trim() || busy} onClick={() => void submit()}>
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  )
}
