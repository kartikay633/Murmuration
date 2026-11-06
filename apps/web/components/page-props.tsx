'use client'

import { useCallback, useState } from 'react'
import { PAGE_STATUSES, STATUS_LABEL, type PageStatus } from '@murmuration/shared'
import { useTree } from '@/lib/tree'
import { Avatar } from './avatar'
import { Icon } from './icons'
import { useDismiss } from './menu'
import { useWorkspace } from './workspace'

export const dueLabel = (day: string) => {
  const d = new Date(`${day}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - today.getTime()) / 86400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
}

export const isOverdue = (day: string | null | undefined, status: PageStatus | null | undefined) => {
  if (!day || status === 'done') return false
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return day < iso
}

function Picker({ label, children, trigger, disabled }: { label: string; trigger: React.ReactNode; disabled: boolean; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useDismiss(open, close)
  return (
    <div className="prop" ref={ref}>
      <button type="button" className="prop-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div className="menu prop-menu" role="menu">
          {children(close)}
        </div>
      )}
    </div>
  )
}

/** Status, owner and due date for a page: shared with everyone, shown on the board. */
export function PageProps({ pageId, editable }: { pageId: string; editable: boolean }) {
  const { members } = useWorkspace()
  const tree = useTree()
  const node = tree.nodes.get(pageId)
  if (!node) return null
  const set = (props: Parameters<typeof tree.setProps>[1]) => tree.setProps(pageId, props)
  const owner = node.owner ? members.find((m) => m.id === node.owner) : undefined
  const empty = !node.status && !node.owner && !node.due
  if (empty && !editable) return null

  return (
    <div className={`props${empty ? ' empty' : ''}`} aria-label="Page properties">
      <Picker
        label="Status"
        disabled={!editable}
        trigger={
          node.status ? (
            <span className={`status-pill s-${node.status}`}>
              <i /> {STATUS_LABEL[node.status]}
            </span>
          ) : (
            <span className="prop-empty">
              <Icon name="check" /> Status
            </span>
          )
        }
      >
        {(close) => (
          <>
            {PAGE_STATUSES.map((s) => (
              <button key={s} type="button" role="menuitemradio" aria-checked={node.status === s} className="menu-item" onClick={() => (set({ status: s }), close())}>
                <span className={`status-pill s-${s}`}>
                  <i /> {STATUS_LABEL[s]}
                </span>
              </button>
            ))}
            {node.status && (
              <button type="button" role="menuitem" className="menu-item" onClick={() => (set({ status: null }), close())}>
                Clear status
              </button>
            )}
          </>
        )}
      </Picker>

      <Picker
        label="Owner"
        disabled={!editable}
        trigger={
          owner ? (
            <span className="prop-owner">
              <Avatar name={owner.name} ink={owner.ink} /> {owner.name}
            </span>
          ) : (
            <span className="prop-empty">
              <Icon name="user" /> Owner
            </span>
          )
        }
      >
        {(close) => (
          <>
            {members
              .filter((m) => !m.isBot)
              .map((m) => (
                <button key={m.id} type="button" role="menuitemradio" aria-checked={node.owner === m.id} className="menu-item" onClick={() => (set({ owner: m.id }), close())}>
                  <Avatar name={m.name} ink={m.ink} /> {m.name}
                </button>
              ))}
            {node.owner && (
              <button type="button" role="menuitem" className="menu-item" onClick={() => (set({ owner: null }), close())}>
                Clear owner
              </button>
            )}
          </>
        )}
      </Picker>

      <label className={`prop prop-due${isOverdue(node.due, node.status) ? ' overdue' : ''}`}>
        <span className={node.due ? 'prop-value' : 'prop-empty'}>
          <Icon name="calendar" /> {node.due ? `Due ${dueLabel(node.due)}` : 'Due date'}
        </span>
        <input
          type="date"
          value={node.due ?? ''}
          disabled={!editable}
          aria-label="Due date"
          onChange={(e) => set({ due: e.target.value || null })}
        />
      </label>
    </div>
  )
}
