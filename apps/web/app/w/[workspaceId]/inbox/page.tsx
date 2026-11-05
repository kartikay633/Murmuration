import type { Metadata } from 'next'
import { listInbox } from '@/app/comment-actions'
import { InboxView } from './view'

export const metadata: Metadata = { title: 'Inbox' }

export default async function InboxPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  return <InboxView items={await listInbox(workspaceId)} />
}
