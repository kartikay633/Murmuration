'use client'

import { useFormStatus } from 'react-dom'
import { tryDemo } from '@/app/actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button className="btn block" type="submit" disabled={pending}>
      {pending ? 'Setting up your sandbox…' : 'Try the demo, no sign-up'}
    </button>
  )
}

/** One click into a private sandbox workspace with sample pages. */
export function DemoButton() {
  return (
    <form action={tryDemo} className="demo-form">
      <div className="or" aria-hidden="true">
        <span>or</span>
      </div>
      <Submit />
      <p className="muted" style={{ fontSize: 12, margin: '8px 0 0', textAlign: 'center' }}>
        A private sandbox with sample pages. It’s removed after a week.
      </p>
    </form>
  )
}
