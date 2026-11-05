import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { eq, getDb, pageRole, pages } from '@murmuration/db'
import { PageView } from '@/components/page-view'
import { requireUser } from '@/lib/auth'
import { pageOverrides } from '@/lib/data'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type Params = Promise<{ workspaceId: string; pageId: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { pageId } = await params
  if (!UUID.test(pageId)) return {}
  const [row] = await getDb().select({ title: pages.title }).from(pages).where(eq(pages.id, pageId))
  return { title: row?.title || 'Untitled' }
}

export default async function PageRoute({
  params,
  searchParams,
}: {
  params: Params
  searchParams: Promise<{ thread?: string }>
}) {
  const { workspaceId, pageId } = await params
  const { thread } = await searchParams
  if (!UUID.test(pageId)) notFound()
  const user = await requireUser()
  const access = await pageRole(user.id, pageId)
  if (!access?.role || access.workspaceId !== workspaceId) notFound()
  return (
    <PageView
      key={pageId}
      pageId={pageId}
      initialRole={access.role}
      overrides={await pageOverrides(pageId)}
      focusThread={thread && UUID.test(thread) ? thread : null}
    />
  )
}
