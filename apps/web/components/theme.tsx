'use client'

import { useEffect, useState } from 'react'
import { Icon } from './icons'

type Theme = 'light' | 'dark'

export const currentTheme = (): Theme =>
  typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'

/** Switch theme everywhere (the toggle and the command palette both use this). */
export function setTheme(next: Theme) {
  document.documentElement.dataset.theme = next
  try {
    localStorage.setItem('mm-theme', next)
  } catch {}
  window.dispatchEvent(new Event('mm:theme'))
}

export function ThemeToggle() {
  const [theme, setLocal] = useState<Theme | null>(null)
  useEffect(() => {
    const sync = () => setLocal(currentTheme())
    sync()
    window.addEventListener('mm:theme', sync)
    return () => window.removeEventListener('mm:theme', sync)
  }, [])
  const flip = () => setTheme(theme === 'dark' ? 'light' : 'dark')
  return (
    <button
      className="icon-btn"
      type="button"
      onClick={flip}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title="Switch theme"
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  )
}
