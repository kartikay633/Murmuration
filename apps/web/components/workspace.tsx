'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Role } from '@murmuration/shared'
import type { CurrentUser } from '@/lib/auth'
import type { Member, WorkspaceSummary } from '@/lib/data'
import { SyncProvider } from '@/lib/sync'
import { TreeProvider } from '@/lib/tree'
import { Sidebar } from './sidebar'

interface WorkspaceCtx {
  user: CurrentUser
  workspace: WorkspaceSummary
  workspaces: WorkspaceSummary[]
  members: Member[]
  role: Role
  navOpen: boolean
  setNavOpen(open: boolean): void
  toast(message: string): void
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
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const toast = useCallback((m: string) => {
    setMessage(m)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), 2800)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <Ctx.Provider value={{ user, workspace, workspaces, members, role: workspace.role, navOpen, setNavOpen, toast }}>
      <SyncProvider>
        <TreeProvider workspaceId={workspace.id}>
          <div className={`app${navOpen ? ' nav-open' : ''}`}>
            <Sidebar />
            <main className="main" onClick={() => navOpen && setNavOpen(false)}>
              {children}
            </main>
          </div>
        </TreeProvider>
      </SyncProvider>
      <div className={`toast${message ? ' on' : ''}`} role="status" aria-live="polite">
        {message}
      </div>
    </Ctx.Provider>
  )
}
