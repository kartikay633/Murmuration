'use client'

import { useMemo } from 'react'
import * as Y from 'yjs'
import type { JSONContent } from '@tiptap/react'
import type { SyncClient } from '@murmuration/client'
import { isInTrash, pageDoc, type TreeNode } from '@murmuration/shared'
import { pageJSON } from './history'
import { useTree } from './tree'

/** Pages someone marked "Use as template", newest title first. */
export function useWorkspaceTemplates(exceptId?: string): TreeNode[] {
  const tree = useTree()
  return useMemo(
    () =>
      [...tree.nodes.values()]
        .filter((n) => n.template && n.id !== exceptId && !isInTrash(tree.nodes, n.id))
        .sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [tree.nodes, exceptId],
  )
}

/**
 * A page's content as editor JSON, read over the live connection. Reuses the
 * document if this tab already has it open; otherwise opens it just long
 * enough to read it.
 */
export async function loadPageContent(client: SyncClient, pageId: string): Promise<JSONContent | null> {
  const name = pageDoc(pageId)
  const existing = client.handle(name)
  if (existing) return pageJSON(existing.doc, null)
  const doc = new Y.Doc()
  const handle = client.open(name, doc)
  try {
    await new Promise<void>((resolve, reject) => {
      if (handle.state.synced) return resolve()
      const timer = setTimeout(() => (off(), reject(new Error('timeout'))), 8000)
      const off = handle.on('change', (s) => {
        if (s.error) (clearTimeout(timer), off(), reject(new Error(s.error.message)))
        else if (s.synced) (clearTimeout(timer), off(), resolve())
      })
    })
    return pageJSON(doc, null)
  } catch {
    return null
  } finally {
    client.close(name)
    doc.destroy()
  }
}
