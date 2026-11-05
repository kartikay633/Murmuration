const PATHS = {
  chev: 'M6 4l4 4-4 4',
  plus: 'M8 3.5v9M3.5 8h9',
  page: 'M4.5 2.5h4.8l2.7 2.7v8.3h-7.5zM9.3 2.5v2.7H12',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  archive: 'M2.5 4.5h11v2h-11zM3.5 6.5v6.5h9V6.5M6.5 9h3',
  menu: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11',
  x: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  link: 'M6.5 9.5l3-3M7.2 4.6l.9-.9a2.6 2.6 0 0 1 3.7 3.7l-.9.9M8.8 11.4l-.9.9a2.6 2.6 0 0 1-3.7-3.7l.9-.9',
  moon: 'M13 9.6A5.5 5.5 0 1 1 6.4 3a4.4 4.4 0 0 0 6.6 6.6z',
  sun: 'M8 5.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5zM8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1',
  logout: 'M9.5 3.5h3v9h-3M6.5 5.5 4 8l2.5 2.5M4 8h6.5',
  eye: 'M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8zM8 6.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z',
  check: 'M3.5 8.5l3 3 6-7',
  layers: 'M8 2.5l5.5 3L8 8.5l-5.5-3zM2.5 8.5 8 11.5l5.5-3',
  lab: 'M6 2.5h4M6.6 2.5v4.2L3.1 12.4a1 1 0 0 0 .9 1.6h8a1 1 0 0 0 .9-1.6L9.4 6.7V2.5M4.6 10h6.8',
  bolt: 'M9 1.75 3.75 9h4l-1 5.25L12.25 7h-4z',
  history:'M2.6 8a5.4 5.4 0 1 0 1.6-3.85M2.6 2.6v2.6h2.6M8 5.4V8l1.9 1.2',
  blame: 'M5.5 4h8M5.5 8h6M5.5 12h7.5M2.5 3v2.2M2.5 7v2M2.5 11v2',
  play: 'M5 3.5v9l7.5-4.5z',
  pause: 'M4.5 3.5h2.5v9H4.5zM9 3.5h2.5v9H9z',
  comment:'M3 3.5h10a.5.5 0 0 1 .5.5v6.5a.5.5 0 0 1-.5.5H7l-3 2.5V11H3a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z',
  inbox: 'M2.5 9.5h3l1 2h3l1-2h3M2.5 9.5 4.1 4.3a1 1 0 0 1 1-.8h5.8a1 1 0 0 1 1 .8l1.6 5.2v3a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`i ${className}`} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

/** The flock: ten dots in a loose curve. */
export function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <svg viewBox="0 0 18 18" fill="currentColor">
        <circle cx="2.8" cy="12.6" r="1" />
        <circle cx="5.2" cy="10.6" r="1.25" />
        <circle cx="7.8" cy="9.1" r="1.45" />
        <circle cx="10.5" cy="8.4" r="1.3" />
        <circle cx="12.9" cy="6.7" r="1.1" />
        <circle cx="15" cy="4.6" r=".9" />
        <circle cx="6.4" cy="13.4" r=".8" />
        <circle cx="9.3" cy="11.8" r=".95" />
        <circle cx="12" cy="10.6" r=".8" />
        <circle cx="14" cy="8.9" r=".65" />
      </svg>
    </span>
  )
}
