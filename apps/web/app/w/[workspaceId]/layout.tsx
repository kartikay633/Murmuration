import { notFound } from 'next/navigation'
import { WorkspaceShell } from '@/components/workspace'
import { requireUser } from '@/lib/auth'
import { listMembers, listWorkspaces } from '@/lib/data'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>
  children: React.ReactNode
}) {
  const { workspaceId } = await params
  const user = await requireUser()
  if (!UUID.test(workspaceId)) notFound()
  const workspaces = await listWorkspaces(user.id)
  const workspace = workspaces.find((w) => w.id === workspaceId)
  if (!workspace) notFound()
  const members = await listMembers(workspaceId)
  return (
    <WorkspaceShell user={user} workspace={workspace} workspaces={workspaces} members={members}>
      {children}
    </WorkspaceShell>
  )
}
