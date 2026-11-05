'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { signup } from '@/app/actions'
import { DemoButton } from '@/components/demo-button'
import { Mark } from '@/components/icons'

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, undefined)
  return (
    <div className="auth-card">
      <span className="brand">
        <Mark /> Murmuration
      </span>
      <h1>Create your account</h1>
      <p className="sub">You’ll get a workspace of your own. Invite your team once you’re in.</p>
      <form action={action} noValidate>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input className="input" id="name" name="name" autoComplete="name" required autoFocus maxLength={80} defaultValue={state?.values?.name} key={`n${state?.values?.name ?? ''}`} aria-invalid={!!state?.fields?.name} aria-describedby="name-err" />
          {state?.fields?.name && <span className="field-error" id="name-err">{state.fields.name}</span>}
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.values?.email} key={`e${state?.values?.email ?? ''}`} aria-invalid={!!state?.fields?.email} aria-describedby="email-err" />
          {state?.fields?.email && <span className="field-error" id="email-err">{state.fields.email}</span>}
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
            aria-invalid={!!state?.fields?.password}
            aria-describedby="password-hint"
          />
          <span className={state?.fields?.password ? 'field-error' : 'field-hint'} id="password-hint">
            {state?.fields?.password ?? 'At least 8 characters.'}
          </span>
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
      <DemoButton />
      <p className="auth-alt">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </div>
  )
}
