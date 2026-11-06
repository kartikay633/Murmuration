import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { workspaceTasks } from '@/app/task-actions'
import { TasksView } from './view'

export const metadata: Metadata = { title: 'Tasks' }

export default async function TasksPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const pages = await workspaceTasks(workspaceId)
  if (!pages) notFound()
  return <TasksView pages={pages} />
}
