'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { pageDoc } from '@murmuration/shared'
import { listThreads, unreadCount, type ThreadView } from '@/app/comment-actions'
import { useSyncClient } from './sync'

/** Threads on a page, refreshed live when anyone changes them. */
export function useThreads(pageId: string) {
  const client = useSyncClient()
  const [threads, setThreads] = useState<ThreadView[] | null>(null)
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    const mine = ++seq.current
    const res = await listThreads(pageId)
    if (mine !== seq.current) return // a newer refresh is in flight
    if (res.error === undefined) setThreads(res.threads)
  }, [pageId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!client) return
    const name = pageDoc(pageId)
    const offEvent = client.on('event', (e) => {
      if (e.docName === name && e.data.kind === 'comments') void refresh()
    })
    const offStatus = client.on('status', (s) => s === 'online' && void refresh())
    return () => {
      offEvent()
      offStatus()
    }
  }, [client, pageId, refresh])

  return { threads, refresh }
}

/** Unread mentions and replies in a workspace. */
export function useUnread(workspaceId: string, deps: unknown[] = []) {
  const client = useSyncClient()
  const [count, setCount] = useState(0)
  const refresh = useCallback(() => {
    void unreadCount(workspaceId).then(setCount)
  }, [workspaceId])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [refresh, ...deps])
  useEffect(() => {
    if (!client) return
    return client.on('event', (e) => e.data.kind === 'inbox' && refresh())
  }, [client, refresh])
  return count
}

const MENTION = /<@([0-9a-f-]{36})>/g

export interface BodyPart {
  text: string
  mention?: string
}

export function splitMentions(body: string): BodyPart[] {
  const parts: BodyPart[] = []
  let last = 0
  for (const m of body.matchAll(MENTION)) {
    if (m.index! > last) parts.push({ text: body.slice(last, m.index) })
    parts.push({ text: '', mention: m[1] })
    last = m.index! + m[0].length
  }
  if (last < body.length) parts.push({ text: body.slice(last) })
  return parts
}

export function timeAgo(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime()
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  if (s < 6 * 86400) return new Date(t).toLocaleDateString('en-GB', { weekday: 'short' })
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
