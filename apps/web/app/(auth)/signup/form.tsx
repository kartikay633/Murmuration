'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { signup } from '@/app/actions'

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, undefined)
  return (
    <div className="auth-card">
      <h1>Start a workspace</h1>
      <p className="sub">You&rsquo;ll get a workspace of your own. Invite people once you&rsquo;re in.</p>
      <form action={action} noValidate>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input className="input" id="name" name="name" autoComplete="name" required autoFocus maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        {state?.error && (
          <p className="error-text" role="alert" style={{ margin: 0 }}>
            {state.error}
          </p>
        )}
        <button className="btn primary block" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className="switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </div>
  )
}
