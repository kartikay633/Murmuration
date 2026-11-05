import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { listWorkspaces } from '@/lib/data'

export default async function Home() {
  const user = await currentUser()
  if (!user) redirect('/login')
  const [first] = await listWorkspaces(user.id)
  if (!first) redirect('/signup')
  redirect(`/w/${first.id}`)
}
