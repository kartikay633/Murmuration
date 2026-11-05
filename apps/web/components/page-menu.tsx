'use client'

import { useCallback, useState } from 'react'
import { Icon } from './icons'
import { useDismiss } from './menu'

/** The page's "⋯" menu: less frequent tools stay out of the header. */
export function PageMenu({ onBlame, onLab, onCopyLink }: { onBlame(): void; onLab(): void; onCopyLink(): void }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useDismiss(open, close)
  const run = (fn: () => void) => () => {
    close()
    fn()
  }
  return (
    <div className="share-wrap" ref={ref}>
      <button
        className="icon-btn"
        type="button"
        aria-label="More page options"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu" role="menu" style={{ top: 38, right: 0, width: 260 }}>
          <button className="menu-item" role="menuitem" type="button" onClick={run(onCopyLink)}>
            <Icon name="link" /> Copy link
          </button>
          <button className="menu-item" role="menuitem" type="button" onClick={run(onBlame)}>
            <Icon name="blame" /> Show who wrote what
          </button>
          <div className="menu-sep" />
          <button className="menu-item" role="menuitem" type="button" onClick={run(onLab)}>
            <Icon name="lab" />
            <span>
              Network Lab
              <span className="menu-hint">Simulate latency and going offline</span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
