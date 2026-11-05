import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { SignupForm } from './form'

export const metadata: Metadata = { title: 'Create an account' }

export default async function SignupPage() {
  if (await currentUser()) redirect('/')
  return <SignupForm />
}
