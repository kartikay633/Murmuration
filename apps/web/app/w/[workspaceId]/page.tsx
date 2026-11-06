import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { firstPage, listWorkspaces } from '@/lib/data'
import { EmptyWorkspace } from './empty'

export async function generateMetadata({ params }: { params: Promise<{ workspaceId: string }> }): Promise<Metadata> {
  const { workspaceId } = await params
  const user = await requireUser()
  const ws = (await listWorkspaces(user.id)).find((w) => w.id === workspaceId)
  return { title: ws?.name ?? 'Workspace' }
}

export default async function WorkspaceHome({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  await requireUser()
  // A workspace with pages opens on its home; a new, empty one invites the first page.
  if (await firstPage(workspaceId)) redirect(`/w/${workspaceId}/home`)
  return <EmptyWorkspace />
}
