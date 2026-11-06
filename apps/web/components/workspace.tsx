'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Role } from '@murmuration/shared'
import type { CurrentUser } from '@/lib/auth'
import type { Member, WorkspaceSummary } from '@/lib/data'
import { SyncProvider } from '@/lib/sync'
import { TreeProvider } from '@/lib/tree'
import { CommandPalette } from './command-palette'
import { ImportListener } from './import'
import { Sidebar } from './sidebar'

export interface ToastAction {
  label: string
  run(): void
}

interface WorkspaceCtx {
  user: CurrentUser
  workspace: WorkspaceSummary
  workspaces: WorkspaceSummary[]
  members: Member[]
  role: Role
  navOpen: boolean
  setNavOpen(open: boolean): void
  toast(message: string, action?: ToastAction): void
}

const Ctx = createContext<WorkspaceCtx | null>(null)

export function useWorkspace() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useWorkspace outside WorkspaceShell')
  return c
}

export function WorkspaceShell({
  user,
  workspace,
  workspaces,
  members,
  children,
}: {
  user: CurrentUser
  workspace: WorkspaceSummary
  workspaces: WorkspaceSummary[]
  members: Member[]
  children: React.ReactNode
}) {
  const [navOpen, setNavOpen] = useState(false)
  const [message, setMessage] = useState<{ text: string; action?: ToastAction } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const toast = useCallback((text: string, action?: ToastAction) => {
    setMessage({ text, action })
    clearTimeout(timer.current)
    // Give people time to reach an Undo button.
    timer.current = setTimeout(() => setMessage(null), action ? 6000 : 2800)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <Ctx.Provider value={{ user, workspace, workspaces, members, role: workspace.role, navOpen, setNavOpen, toast }}>
      <SyncProvider>
        <TreeProvider workspaceId={workspace.id}>
          <div className={`app${navOpen ? ' nav-open' : ''}`}>
            <Sidebar />
            {navOpen && <div className="nav-scrim" aria-hidden="true" onClick={() => setNavOpen(false)} />}
            <main className="main" onClick={() => navOpen && setNavOpen(false)}>
              {children}
            </main>
          </div>
          <CommandPalette />
          <ImportListener />
        </TreeProvider>
      </SyncProvider>
      <div className={`toast${message ? ' on' : ''}${message?.action ? ' has-action' : ''}`} role="status" aria-live="polite">
        <span>{message?.text}</span>
        {message?.action && (
          <button
            type="button"
            onClick={() => {
              const run = message.action!.run
              setMessage(null)
              run()
            }}
          >
            {message.action.label}
          </button>
        )}
      </div>
    </Ctx.Provider>
  )
}
