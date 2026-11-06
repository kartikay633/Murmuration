import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { workspaceActivity } from '@/app/activity-actions'
import { ActivityView } from './view'

export const metadata: Metadata = { title: 'Activity' }

export default async function ActivityPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const data = await workspaceActivity(workspaceId)
  if (!data) notFound()
  return <ActivityView data={data} />
}
