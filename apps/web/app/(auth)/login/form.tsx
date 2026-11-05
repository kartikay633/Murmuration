'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { login } from '@/app/actions'
import { DemoButton } from '@/components/demo-button'
import { Mark } from '@/components/icons'

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, undefined)
  return (
    <div className="auth-card">
      <span className="brand">
        <Mark /> Murmuration
      </span>
      <h1>Welcome back</h1>
      <p className="sub">Sign in to your workspace.</p>
      <form action={action} noValidate>
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {state?.error && (
          <p className="error-text" role="alert" style={{ margin: 0 }}>
            {state.error}
          </p>
        )}
        <button className="btn primary block" type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <DemoButton />
      <p className="auth-alt">
        New to Murmuration? <Link href="/signup">Create an account</Link>
      </p>
    </div>
  )
}
