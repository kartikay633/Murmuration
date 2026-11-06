'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useTransition } from 'react'
import { markRead, type InboxItem } from '@/app/comment-actions'
import { Avatar } from '@/components/avatar'
import { Icon } from '@/components/icons'
import { useWorkspace } from '@/components/workspace'
import { splitMentions, timeAgo } from '@/lib/comments'
import { useSyncClient } from '@/lib/sync'

export function InboxView({ items }: { items: InboxItem[] }) {
  const { workspace, members, user, setNavOpen } = useWorkspace()
  const router = useRouter()
  const client = useSyncClient()
  const [pending, startTransition] = useTransition()
  const names = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members])
  const unread = items.filter((i) => !i.read).length

  // New mentions arrive while you're looking at the inbox.
  useEffect(() => client?.on('event', (e) => e.data.kind === 'inbox' && router.refresh()), [client, router])

  const open = (item: InboxItem) =>
    startTransition(async () => {
      if (!item.read) await markRead(workspace.id, [item.id])
      router.push(`/w/${workspace.id}/p/${item.pageId}${item.threadId ? `?thread=${item.threadId}` : ''}`)
    })

  return (
    <>
      <header className="topbar">
        <button className="icon-btn menu-btn" type="button" aria-label="Open navigation" onClick={(e) => (e.stopPropagation(), setNavOpen(true))}>
          <Icon name="menu" />
        </button>
        <nav className="crumbs">
          <span className="hide-sm">{workspace.name}</span>
          <span className="sep hide-sm">/</span>
          <b>Inbox</b>
        </nav>
      </header>
      <div className="scroll">
        <div className="inbox">
          <div className="inbox-head">
            <div>
              <h1>Inbox</h1>
              {unread > 0 && <span className="eyebrow">{unread} unread</span>}
            </div>
            {unread > 0 && (
              <button
                className="btn"
                type="button"
                disabled={pending}
                onClick={() => startTransition(async () => (await markRead(workspace.id), router.refresh()))}
              >
                <Icon name="check" /> Mark all read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div className="inbox-empty">
              <Icon name="inbox" size={20} />
              <p>
                <b>You’re all caught up.</b>
                <br />
                Mentions, replies to your comments and your reminders will appear here.
              </p>
            </div>
          ) : (
            items.map((item) =>
              item.kind === 'reminder' ? (
                <button key={item.id} type="button" className={`note reminder${item.read ? '' : ' unread'}`} onClick={() => open(item)}>
                  <span className="note-icon" aria-hidden="true">
                    <Icon name="bell" />
                  </span>
                  <span className="what">
                    Reminder: <b>{item.pageTitle}</b>
                  </span>
                  <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
                </button>
              ) : (
              <button key={item.id} type="button" className={`note${item.read ? '' : ' unread'}`} onClick={() => open(item)}>
                <Avatar name={item.actorName} ink={item.actorInk} size="md" />
                <span className="what">
                  <b>{item.actorName}</b> {item.kind === 'reply' ? 'replied in' : 'mentioned you in'} <b>{item.pageTitle}</b>
                </span>
                <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
                {item.quote && <span className="quote">“{item.quote}”</span>}
                <span className="c-body">
                  {splitMentions(item.body).map((p, i) =>
                    p.mention ? (
                      <span key={i} className={`mention${p.mention === user.id ? ' me' : ''}`}>
                        @{names.get(p.mention)?.split(' ')[0] ?? 'someone'}
                      </span>
                    ) : (
                      <span key={i}>{p.text}</span>
                    ),
                  )}
                </span>
              </button>
              ),
            )
          )}
        </div>
      </div>
    </>
  )
}
