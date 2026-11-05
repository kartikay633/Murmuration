/** Presence inks. Each user gets one at sign-up; the CSS defines a light and a dark shade of each. */
export const INKS = ['vermilion', 'cobalt', 'moss', 'ochre', 'plum', 'teal'] as const
export type Ink = (typeof INKS)[number]

export const isInk = (v: unknown): v is Ink => typeof v === 'string' && (INKS as readonly string[]).includes(v)

export function inkFor(seed: string): Ink {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return INKS[h % INKS.length]!
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}
