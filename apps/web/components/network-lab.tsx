'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import type { DocHandle, SyncClient } from '@murmuration/client'
import { fingerprint, readPresenceUser, type PresenceUser } from '@murmuration/shared'
import { startPracticeSession } from '@/app/practice-actions'
import { useConnectionStatus, useSyncClient } from '@/lib/sync'
import { Avatar } from './avatar'
import { Icon } from './icons'
import { useWorkspace } from './workspace'

/** Publishes this replica's fingerprint in presence so everyone can compare copies. */
export function useFingerprintPresence(handle: DocHandle | null) {
  useEffect(() => {
    if (!handle) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const publish = () => {
      timer = null
      handle.awareness.setLocalStateField('fp', fingerprint(Y.encodeStateVector(handle.doc)))
    }
    const onUpdate = () => {
      if (!timer) timer = setTimeout(publish, 300)
    }
    publish()
    handle.doc.on('update', onUpdate)
    return () => {
      handle.doc.off('update', onUpdate)
      if (timer) clearTimeout(timer)
    }
  }, [handle])
}

function useTick(ms: number, on: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(id)
  }, [ms, on])
}

function useServerFingerprint(client: SyncClient | null, handle: DocHandle | null, on: boolean) {
  const [fp, setFp] = useState<string | null>(null)
  useEffect(() => {
    if (!client || !handle || !on) return
    const off = client.on('event', (e) => {
      if (e.docName === handle.name && e.data.kind === 'probe') setFp(String(e.data.fp))
    })
    const ask = () => client.probe(handle.name)
    ask()
    const id = setInterval(ask, 1000)
    return () => {
      off()
      clearInterval(id)
    }
  }, [client, handle, on])
  return fp
}

type Replica = { key: string; user: PresenceUser | null; label: string; fp: string | null; kind: 'server' | 'you' | 'peer' }

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`)

export function NetworkLab({
  open,
  onClose,
  handle,
  pageId,
  canEdit,
}: {
  open: boolean
  onClose(): void
  handle: DocHandle | null
  pageId: string
  canEdit: boolean
}) {
  const client = useSyncClient()
  const status = useConnectionStatus()
  const { user, toast } = useWorkspace()
  const [latency, setLatency] = useState(0)
  const [inviting, setInviting] = useState(false)
  useTick(300, open)
  const serverFp = useServerFingerprint(client, handle, open && status === 'online')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Everyone's copy, from presence.
  const awarenessStore = useMemo(() => {
    const read = () => new Map(handle?.awareness.getStates() as Map<number, Record<string, unknown>> | undefined)
    let snap = read()
    if (!handle) return { sub: () => () => {}, get: () => snap }
    const a = handle.awareness
    return {
      sub: (cb: () => void) => {
        const h = () => ((snap = read()), cb())
        a.on('change', h)
        a.on('update', h)
        return () => (a.off('change', h), a.off('update', h))
      },
      get: () => snap,
    }
  }, [handle])
  const states = useSyncExternalStore(awarenessStore.sub, awarenessStore.get, awarenessStore.get)

  if (!handle || !client) return null
  const mine = fingerprint(Y.encodeStateVector(handle.doc))
  const offline = client.isOffline || status !== 'online'

  const replicas: Replica[] = [
    { key: 'server', user: null, label: 'Sync server', fp: offline ? null : serverFp, kind: 'server' },
    { key: 'you', user: { id: user.id, name: user.name, ink: user.ink, color: '' }, label: 'You (this tab)', fp: mine, kind: 'you' },
  ]
  states.forEach((s, clientId) => {
    if (clientId === handle.awareness.clientID) return
    const u = readPresenceUser(s.user)
    if (!u) return
    replicas.push({ key: String(clientId), user: u, label: u.id === user.id ? `${u.name} (another tab)` : u.name, fp: typeof s.fp === 'string' ? s.fp : null, kind: 'peer' })
  })
  const reference = offline ? mine : (serverFp ?? mine)
  const known = replicas.filter((r) => r.fp)
  const allMatch = known.every((r) => r.fp === reference)
  const pending = handle.pending

  let verdict: { tone: 'ok' | 'busy' | 'warn'; text: React.ReactNode }
  if (offline) {
    verdict = {
      tone: 'warn',
      text: (
        <>
          <b>Offline.</b> Your edits stay on this device{handle.state.saved ? '' : ' and are waiting to be sent'}. Others keep
          editing their own copies. Reconnect and every copy merges into the same page.
        </>
      ),
    }
  } else if (allMatch && handle.state.saved) {
    verdict = { tone: 'ok', text: <><b>Converged.</b> All {known.length} copies of this page are identical.</> }
  } else {
    verdict = { tone: 'busy', text: <><b>Syncing.</b> Edits are in flight; the copies will match in a moment.</> }
  }

  const invite = async () => {
    setInviting(true)
    try {
      const res = await startPracticeSession(pageId)
      toast(res.error ?? 'Practice collaborators are joining. They’ll type, comment and mention you for about a minute.')
    } catch {
      toast('Couldn’t reach the server to invite them. Try again in a moment.')
    } finally {
      setInviting(false)
    }
  }

  return (
    <aside className={`lab${open ? ' open' : ''}`} aria-label="Network Lab" aria-hidden={!open} inert={!open}>
      <div className="lab-head">
        <div className="row">
          <h3>Network Lab</h3>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close Network Lab">
            <Icon name="x" />
          </button>
        </div>
        <p>Slow your own connection down or cut it, keep typing, then bring it back and watch the copies merge.</p>
      </div>
      <div className="lab-body">
        <h4>Your connection</h4>
        <div className="lab-row">
          <span>
            <b>{offline ? 'Offline' : 'Online'}</b>
            <span className="muted"> · {client.isOffline ? 'cut by you' : status}</span>
          </span>
          <button
            className="switch"
            type="button"
            role="switch"
            aria-checked={!client.isOffline}
            aria-label="Connected"
            onClick={() => (client.isOffline ? client.reconnect() : client.disconnect())}
          />
        </div>
        <label className="lab-ctl">
          <span>Added latency</span>
          <input
            type="range"
            min={0}
            max={2000}
            step={50}
            value={latency}
            onChange={(e) => {
              const v = Number(e.target.value)
              setLatency(v)
              client.setLatency(v)
            }}
            aria-label="Added latency in milliseconds"
          />
          <output className="mono">{latency} ms</output>
        </label>
        <dl className="lab-stats">
          <div><dt>Round trip</dt><dd className="mono">{client.stats.lastRttMs == null ? '—' : `${client.stats.lastRttMs} ms`}</dd></div>
          <div><dt>Unsaved edits</dt><dd className="mono">{offline && !handle.state.saved ? 'queued' : pending}</dd></div>
          <div><dt>Sent</dt><dd className="mono">{client.stats.framesOut} · {kb(client.stats.bytesOut)}</dd></div>
          <div><dt>Received</dt><dd className="mono">{client.stats.framesIn} · {kb(client.stats.bytesIn)}</dd></div>
        </dl>

        <h4>Copies of this page</h4>
        {replicas.map((r) => (
          <div className="fp" key={r.key}>
            {r.kind === 'server' ? (
              <span className="av" style={{ '--c': 'var(--ink-3)' } as React.CSSProperties}><Icon name="bolt" size={12} /></span>
            ) : (
              <Avatar name={r.user!.name} ink={r.user!.ink} />
            )}
            <span className="fp-name">{r.label}</span>
            <code className={r.fp && r.fp !== reference ? 'off' : ''}>{r.fp ?? (r.kind === 'server' ? 'unreachable' : '…')}</code>
          </div>
        ))}
        <div className={`verdict ${verdict.tone}`} role="status">
          <i />
          <span>{verdict.text}</span>
        </div>
        <p className="lab-note">
          A fingerprint is a hash of which edits a copy has applied. Matching fingerprints mean identical documents: the CRDT
          guarantees that copies with the same edits converge, whatever order the edits arrived in.
        </p>

        {canEdit && (
          <>
            <h4>No one else here?</h4>
            <p className="lab-note" style={{ marginTop: 0 }}>
              Invite three practice collaborators. They join this page over the real protocol, type, select text and leave a comment
              that mentions you.
            </p>
            <button className="btn" type="button" onClick={invite} disabled={inviting || offline}>
              <Icon name="plus" /> {inviting ? 'Inviting…' : 'Invite practice collaborators'}
            </button>
          </>
        )}

        <h4>Try this</h4>
        <ol className="lab-steps">
          <li>Turn the connection off and write a sentence.</li>
          <li>Have someone else (or the practice collaborators) edit the same paragraph.</li>
          <li>Turn it back on. Both edits survive, and every fingerprint matches again.</li>
        </ol>
      </div>
    </aside>
  )
}
