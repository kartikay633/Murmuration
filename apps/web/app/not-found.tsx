import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="empty" style={{ marginTop: '22vh' }}>
      <span className="eyebrow">404</span>
      <h2>This page isn&rsquo;t here.</h2>
      <p>It may have been archived, or you may not have access to it. Ask whoever shared the link to check your role.</p>
      <Link className="btn" href="/">Back to your workspace</Link>
    </div>
  )
}
