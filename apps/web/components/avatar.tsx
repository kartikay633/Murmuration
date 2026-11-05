import { initials, type Ink } from '@murmuration/shared'

export function Avatar({
  name,
  ink,
  size = '',
  title,
}: {
  name: string
  ink: Ink | string
  size?: '' | 'md' | 'lg'
  title?: string
}) {
  return (
    <span className={`av ${size}`} style={{ '--c': `var(--ink-${ink})` } as React.CSSProperties} title={title}>
      {initials(name)}
    </span>
  )
}
