import { Mark } from '@/components/icons'

const FEATURES: [string, string][] = [
  ['Edit together in real time', 'Live cursors and presence'],
  ['Comments pinned to the text', 'Mentions and an inbox'],
  ['Every version kept', 'Replay, restore, see who wrote what'],
  ['Keeps working offline', 'Changes merge when you reconnect'],
]

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <span className="brand">
          <Mark /> Murmuration
        </span>
        <div className="auth-pitch">
          <h2>Write together, in real time.</h2>
          <p>
            A shared workspace for a team&rsquo;s pages. Everyone edits the same page at once, and every copy stays in step,
            even after time offline.
          </p>
          <ul className="auth-features">
            {FEATURES.map(([title, detail]) => (
              <li key={title}>
                {title}
                <span>{detail}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="auth-foot">
          Open source on <a href="https://github.com/kartikay633/Murmuration">GitHub</a>.
        </p>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  )
}
