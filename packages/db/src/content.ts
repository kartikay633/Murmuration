import * as Y from 'yjs'
import { keyBetween, pageDoc, TREE_MOVES, TREE_PAGES, treeDoc, type MoveOp } from '@murmuration/shared'
import { getDb } from './client'
import { docEvents, memberships, pages, workspaces } from './schema'

export type Block = { p: string } | { h: string; level?: 2 | 3 } | { ul: string[] }

/** Append blocks to a page body in the shape Tiptap's Collaboration extension expects. */
export function writeBlocks(fragment: Y.XmlFragment, blocks: Block[]) {
  const paragraph = (text: string) => {
    const el = new Y.XmlElement('paragraph')
    el.insert(0, [new Y.XmlText(text)])
    return el
  }
  fragment.insert(
    fragment.length,
    blocks.map((b) => {
      if ('p' in b) return paragraph(b.p)
      if ('h' in b) {
        const el = new Y.XmlElement('heading')
        el.setAttribute('level', (b.level ?? 2) as never)
        el.insert(0, [new Y.XmlText(b.h)])
        return el
      }
      const list = new Y.XmlElement('bulletList')
      list.insert(
        0,
        b.ul.map((t) => {
          const li = new Y.XmlElement('listItem')
          li.insert(0, [paragraph(t)])
          return li
        }),
      )
      return list
    }),
  )
}

export interface PageSpec {
  key: string
  title: string
  parent?: string
  /** index into the authors list */
  author: number
  blocks: Block[]
}

/**
 * Create a workspace with pages, their bodies and the page tree, writing the
 * Yjs documents straight into the event log. Only for documents nobody has
 * open yet (seeding, new demo sandboxes).
 */
export async function createWorkspaceWithPages(opts: {
  name: string
  members: { userId: string; role: 'owner' | 'admin' | 'editor' | 'commenter' | 'viewer' }[]
  authors: string[]
  pages: PageSpec[]
}): Promise<{ workspaceId: string; pageIds: Map<string, string> }> {
  const db = getDb()
  const owner = opts.members.find((m) => m.role === 'owner')!.userId
  const [ws] = await db.insert(workspaces).values({ name: opts.name, createdBy: owner }).returning({ id: workspaces.id })
  await db.insert(memberships).values(opts.members.map((m) => ({ workspaceId: ws!.id, userId: m.userId, role: m.role })))

  const tree = new Y.Doc()
  tree.clientID = 1
  const treeMap = tree.getMap<Y.Map<unknown>>(TREE_PAGES)
  const moves = tree.getArray<MoveOp>(TREE_MOVES)
  const lastKey = new Map<string | null, string>()
  const pageIds = new Map<string, string>()
  const bodies: { docName: string; authorId: string; update: Uint8Array }[] = []

  for (const p of opts.pages) {
    const author = opts.authors[p.author] ?? owner
    const [row] = await db.insert(pages).values({ workspaceId: ws!.id, title: p.title, createdBy: author }).returning({ id: pages.id })
    pageIds.set(p.key, row!.id)
    const parentId = p.parent ? (pageIds.get(p.parent) ?? null) : null
    const position = keyBetween(lastKey.get(parentId) ?? '', '')
    lastKey.set(parentId, position)

    const node = new Y.Map<unknown>()
    treeMap.set(row!.id, node)
    for (const [k, v] of Object.entries({
      id: row!.id, title: p.title, parentId, position, icon: null, createdAt: Date.now(), createdBy: author, archived: false,
    })) node.set(k, v)
    moves.push([{ n: row!.id, p: parentId, k: position, l: moves.length + 1, c: tree.clientID }])

    const body = new Y.Doc()
    writeBlocks(body.getXmlFragment('default'), p.blocks)
    bodies.push({ docName: pageDoc(row!.id), authorId: author, update: Y.encodeStateAsUpdate(body) })
  }
  await db.insert(docEvents).values([
    ...bodies,
    { docName: treeDoc(ws!.id), authorId: owner, update: Y.encodeStateAsUpdate(tree) },
  ])
  return { workspaceId: ws!.id, pageIds }
}
