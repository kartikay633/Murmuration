'use client'

import { useEffect, useState } from 'react'
import { useModKey } from './command-palette'

/** Open the shortcuts sheet from anywhere (the palette uses this). */
export const openShortcuts = () => window.dispatchEvent(new Event('mm:shortcuts'))
/** Toggle focus mode from anywhere. */
export const toggleFocus = () => window.dispatchEvent(new Event('mm:focus'))

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

/** Focus mode: hides everything but the page. Ctrl/Cmd+Shift+F toggles it; Escape leaves. */
export function useFocusMode() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const flip = () => setOn((o) => !o)
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        flip()
      } else if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        !(e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))
      ) {
        // From the page too, unless a menu in the editor already used the Escape.
        setOn(false)
      }
    }
    window.addEventListener('mm:focus', flip)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mm:focus', flip)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  return [on, setOn] as const
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <dd>
      {keys.map((k) => (
        <kbd key={k}>{k}</kbd>
      ))}
    </dd>
  )
}

/** "?" anywhere outside text shows every shortcut. */
export function ShortcutsSheet() {
  const [open, setOpen] = useState(false)
  const mod = useModKey().trim()

  useEffect(() => {
    const show = () => setOpen(true)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !typing(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mm:shortcuts', show)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mm:shortcuts', show)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  if (!open) return null
  const rows: [string, string[]][] = [
    ['Search and commands', [mod, 'K']],
    ['Focus mode', [mod, 'Shift', 'F']],
    ['Keyboard shortcuts', ['?']],
  ]
  const writing: [string, string[]][] = [
    ['Insert a block', ['/']],
    ['Link to another page', ['[', '[']],
    ['Bold, italic, underline', [mod, 'B / I / U']],
    ['Add a link to selected text', [mod, 'K']],
    ['Highlight', [mod, 'Shift', 'H']],
    ['Comment on selected text', [mod, 'Alt', 'M']],
    ['Undo your own edits', [mod, 'Z']],
  ]
  return (
    <div className="pal-scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="pal keys" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <h2>Keyboard shortcuts</h2>
        {([['Anywhere', rows], ['While writing', writing]] as const).map(([heading, list]) => (
          <section key={heading}>
            <h3>{heading}</h3>
            <dl>
              {list.map(([label, keys]) => (
                <div key={label} style={{ display: 'contents' }}>
                  <dt>{label}</dt>
                  <Keys keys={keys} />
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  )
}
