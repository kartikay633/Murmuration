'use client'

import { useFormStatus } from 'react-dom'
import { tryDemo } from '@/app/actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button className="btn block" type="submit" disabled={pending}>
      {pending ? 'Setting up your sandbox…' : 'Try the live demo'}
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
      <p className="demo-note">A private sandbox with sample pages, no sign-up needed.</p>
    </form>
  )
}
