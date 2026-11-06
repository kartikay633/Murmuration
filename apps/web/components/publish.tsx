'use client'

import { useEffect, useState, useTransition } from 'react'
import { publishedToken, setPublished } from '@/app/publish-actions'
import { Icon } from './icons'
import { useWorkspace } from './workspace'

/** "Publish to web": a read-only public link to this page, for admins to switch on and off. */
export function PublishSection({ pageId, isAdmin }: { pageId: string; isAdmin: boolean }) {
  const { toast } = useWorkspace()
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const [pending, start] = useTransition()

  useEffect(() => {
    let live = true
    void publishedToken(pageId).then((t) => live && setToken(t))
    return () => {
      live = false
    }
  }, [pageId])

  if (token === undefined) return null
  const url = token ? `${window.location.origin}/s/${token}` : ''

  const toggle = (on: boolean) =>
    start(async () => {
      const res = await setPublished(pageId, on)
      if (res.error) return toast(res.error)
      setToken(res.token ?? null)
      toast(on ? 'Published. Anyone with the link can read this page.' : 'Unpublished. The old link no longer works.')
    })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast('Public link copied.')
    } catch {
      toast('Your browser blocked the clipboard.')
    }
  }

  if (!isAdmin && !token) return null
  return (
    <div className="publish">
      <div className="publish-row">
        <span className="grow">
          <span className="n">Publish to web</span>
          <span className="e">{token ? 'Anyone with the link can read this page.' : 'Make a read-only public link. Comments stay private.'}</span>
        </span>
        {isAdmin && (
          <button
            type="button"
            className="toggle"
            role="switch"
            aria-checked={!!token}
            aria-label="Publish to web"
            disabled={pending}
            onClick={() => toggle(!token)}
          />
        )}
      </div>
      {token && (
        <div className="publish-link">
          <input className="input sm" readOnly value={url} aria-label="Public link" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn" onClick={() => void copy()}>
            Copy
          </button>
          <a className="icon-btn" href={url} target="_blank" rel="noopener noreferrer" aria-label="Open the public page" title="Open">
            <Icon name="external" />
          </a>
        </div>
      )}
    </div>
  )
}
