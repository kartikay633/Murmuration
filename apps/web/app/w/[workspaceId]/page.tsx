import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { firstPage } from '@/lib/data'
import { EmptyWorkspace } from './empty'

export default async function WorkspaceHome({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  await requireUser()
  const page = await firstPage(workspaceId)
  if (page) redirect(`/w/${workspaceId}/p/${page}`)
  return <EmptyWorkspace />
}
