'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { deleteVersion, listVersions, saveVersion, type NamedVersion } from '@/app/version-actions'
import { Icon } from './icons'
import { useWorkspace } from './workspace'

export function useVersions(pageId: string) {
  const [versions, setVersions] = useState<NamedVersion[]>([])
  const refresh = useCallback(() => void listVersions(pageId).then(setVersions).catch(() => {}), [pageId])
  useEffect(refresh, [refresh])
  return { versions, refresh }
}

/** "Name this version" inside the history pill. */
export function NameVersion({ pageId, eventId, onSaved }: { pageId: string; eventId: number | undefined; onSaved(): void }) {
  const { toast } = useWorkspace()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [pending, start] = useTransition()
  if (!eventId) return null
  if (!naming) {
    return (
      <button type="button" onClick={() => setNaming(true)}>
        Name this version
      </button>
    )
  }
  return (
    <form
      className="name-version"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const res = await saveVersion(pageId, eventId, name)
          if (res.error) return toast(res.error)
          toast(`Saved “${name.trim()}”.`)
          setName('')
          setNaming(false)
          onSaved()
        })
      }}
    >
      <input
        autoFocus
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Sent for review"
        aria-label="Version name"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setNaming(false)
          }
        }}
      />
      <button type="submit" disabled={pending || !name.trim()}>
        Save
      </button>
    </form>
  )
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Named versions: jump to one, or remove a name you gave. */
export function VersionList({
  versions,
  activeEventId,
  onPick,
  onRemoved,
  compact,
}: {
  versions: NamedVersion[]
  activeEventId: number | undefined
  onPick(eventId: number): void
  onRemoved(): void
  compact: boolean
}) {
  const { toast } = useWorkspace()
  const [, start] = useTransition()
  if (!versions.length) return null
  const remove = (v: NamedVersion) =>
    start(async () => {
      const res = await deleteVersion(v.id)
      if (res.error) return toast(res.error)
      onRemoved()
    })
  return (
    <section className={`versions${compact ? ' compact' : ''}`} aria-label="Named versions">
      <h2 className="versions-title">Named versions</h2>
      <ul>
        {[...versions].reverse().map((v) => (
          <li key={v.id} className={activeEventId === v.eventId ? 'on' : ''}>
            <button type="button" className="version-pick" onClick={() => onPick(v.eventId)}>
              <span className="version-name">{v.name}</span>
              {!compact && (
                <span className="version-meta">
                  {v.by} · {when(v.at)}
                </span>
              )}
            </button>
            {v.mine && !compact && (
              <button type="button" className="icon-btn sm" aria-label={`Remove the name “${v.name}”`} title="Remove name" onClick={() => remove(v)}>
                <Icon name="x" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
