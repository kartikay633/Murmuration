import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { LoginForm } from './form'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await currentUser()) redirect('/')
  const { next } = await searchParams
  return <LoginForm next={next ?? ''} showDemo={process.env.NODE_ENV !== 'production' || process.env.SHOW_DEMO_LOGIN === '1'} />
}
