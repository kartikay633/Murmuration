import { Mark } from '@/components/icons'

/** Starling flock drawn as scattered dots along two curves. Deterministic, so server and client match. */
function Flock() {
  const dots: { x: number; y: number; r: number }[] = []
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 140; i++) {
    const t = i / 140
    const band = rnd() < 0.5 ? 0 : 1
    const x = 20 + t * 380 + (rnd() - 0.5) * 40
    const y = 150 + Math.sin(t * Math.PI * 1.6 + band) * (60 + band * 30) + (rnd() - 0.5) * 46
    dots.push({ x, y, r: 0.8 + rnd() * 1.9 })
  }
  return (
    <svg className="flock" viewBox="0 0 420 300" aria-hidden="true">
      {dots.map((d, i) => (
        <circle key={i} cx={d.x.toFixed(1)} cy={d.y.toFixed(1)} r={d.r.toFixed(2)} fill="currentColor" />
      ))}
    </svg>
  )
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <div className="brand">
          <Mark /> Murmuration
        </div>
        <Flock />
        <blockquote>
          Thousands of birds, no leader, <em>one shape.</em> Your team&rsquo;s pages work the same way.
        </blockquote>
        <p className="foot">
          Everyone edits the same page at once. Changes merge on every device without locks, even after hours offline.
        </p>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  )
}
