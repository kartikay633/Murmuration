import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { homeData } from '@/app/home-actions'
import { HomeView } from './view'

export const metadata: Metadata = { title: 'Home' }

export default async function HomePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const data = await homeData(workspaceId)
  if (!data) notFound()
  return <HomeView data={data} />
}
