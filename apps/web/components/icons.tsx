const PATHS = {
  chev: 'M6 4l4 4-4 4',
  plus: 'M8 3.5v9M3.5 8h9',
  page: 'M4.5 2.5h4.8l2.7 2.7v8.3h-7.5zM9.3 2.5v2.7H12',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.6a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.6',
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
  code: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5',
  search: 'M7 2.75a4.25 4.25 0 1 0 0 8.5 4.25 4.25 0 0 0 0-8.5zM10.1 10.1l3.4 3.4',
  download: 'M8 2.5v8M4.75 7.5 8 10.75l3.25-3.25M3 13.5h10',
  follow: 'M2.5 2.5l4 11 1.6-4.4 4.4-1.6z',
  copy: 'M5.5 5.5V3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z',
  markdown: 'M2 4.5h12v7H2zM4 9.5v-3l1.5 1.75L7 6.5v3M10.5 6.5v3M9 8.25l1.5 1.5 1.5-1.5',
  print: 'M4.5 6V2.5h7V6M4.5 11.5h-2v-5h11v5h-2M4.5 9.5h7v4h-7z',
  restore: 'M3 7.5a5 5 0 1 1 1.5 3.6M3 3.5v4h4',
  star: 'M8 2.25l1.75 3.6 3.95.55-2.87 2.76.7 3.92L8 11.2l-3.53 1.88.7-3.92L2.3 6.4l3.95-.55z',
  highlight: 'M9.5 3l3.5 3.5-5.5 5.5H4v-3.5zM2.5 14h11',
  calendar: 'M3 4h10v9.5H3zM3 7h10M5.5 2.5V5M10.5 2.5V5',
  pulse: 'M1.75 8.5h2.5l1.75-4 3 8 1.75-4h3.5',
  external: 'M9 3h4v4M13 3 7.5 8.5M11.5 9.5v3.5h-8.5v-8.5h3.5',
  bell: 'M4 11.5V7.5a4 4 0 0 1 8 0v4l1 1.5H3zM6.5 13.75a1.6 1.6 0 0 0 3 0',
  command: 'M6 6h4v4H6zM6 6V4.5A1.5 1.5 0 1 0 4.5 6H6M10 6V4.5A1.5 1.5 0 1 1 11.5 6H10M6 10v1.5A1.5 1.5 0 1 1 4.5 10H6M10 10v1.5a1.5 1.5 0 1 0 1.5-1.5H10',
  lock: 'M4.5 7.5h7v6h-7zM6 7.5V5.5a2 2 0 0 1 4 0v2',
  settings: 'M8 5.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5zM8 1.75v1.5M8 12.75v1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M1.75 8h1.5M12.75 8h1.5M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05',
  home: 'M2.75 7.25 8 2.75l5.25 4.5v6h-3.5v-3.5h-3.5v3.5h-3.5z',
  grid: 'M2.5 3.5h11v10h-11zM2.5 7h11M2.5 10.25h11M6.17 7v6.5M9.83 7v6.5',
  present: 'M2 3h12v8H2zM8 11v2.5M5.5 13.5h5M6.75 5.5v3.5L9.75 7.25z',
  user: 'M8 2.75a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3 13.25a5 5 0 0 1 10 0',
  board: 'M2.5 3h3.25v10H2.5zM6.38 3h3.25v6.5H6.38zM10.25 3h3.25v8H10.25z',
  flag: 'M3.5 14V2.5M3.5 3h8l-1.75 3 1.75 3h-8',
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

/** The Murmuration mark: a single-stroke "M". */
export function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 14.5V6l5.5 5.25L15.5 6v8.5" />
      </svg>
    </span>
  )
}
