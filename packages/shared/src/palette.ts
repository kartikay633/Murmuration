/** Presence inks. Each user gets one at sign-up; the CSS defines a light and a dark shade of each. */
export const INKS = ['vermilion', 'cobalt', 'moss', 'ochre', 'plum', 'teal'] as const
export type Ink = (typeof INKS)[number]

export const isInk = (v: unknown): v is Ink => typeof v === 'string' && (INKS as readonly string[]).includes(v)

/** Light-theme hex of each ink, for places that need a literal colour (e.g. libraries that validate hex). */
export const INK_HEX: Record<Ink, string> = {
  vermilion: '#D9481C',
  cobalt: '#2F5BD3',
  moss: '#4E7A3A',
  ochre: '#B98419',
  plum: '#7B3F73',
  teal: '#1F7A78',
}

/** Presence payload every client publishes. `ink` is checked with isInk before it reaches any style. */
export interface PresenceUser {
  id: string
  name: string
  ink: Ink
  color: string
}

export function presenceUser(u: { id: string; name: string; ink: Ink }): PresenceUser {
  return { id: u.id, name: u.name, ink: u.ink, color: INK_HEX[u.ink] }
}

/** Read a presence user from untrusted awareness state. */
export function readPresenceUser(v: unknown): PresenceUser | null {
  if (!v || typeof v !== 'object') return null
  const u = v as Record<string, unknown>
  if (typeof u.id !== 'string' || typeof u.name !== 'string' || !isInk(u.ink)) return null
  return { id: u.id, name: u.name.slice(0, 80), ink: u.ink, color: INK_HEX[u.ink] }
}

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
