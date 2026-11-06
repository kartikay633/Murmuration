import * as Y from 'yjs'
import { getDb, loadDocUpdates, pages, workspaceRole, workspaces, eq } from '@murmuration/db'
import {
  buildTree,
  can,
  fragmentMarkdown,
  pageDoc,
  resolveMoves,
  TREE_MOVES,
  TREE_PAGES,
  treeDoc,
  type TreeNode,
} from '@murmuration/shared'
import { currentUser } from '@/lib/auth'
import { zip } from '@/lib/zip'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A file or folder name that works on every system. */
const safe = (s: string) =>
  (s.trim() || 'Untitled')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80) || 'Untitled'

/** The page tree, from the shared tree document (same rules as the sidebar). */
async function readTree(workspaceId: string): Promise<Map<string | null, TreeNode[]>> {
  const doc = new Y.Doc()
  for (const u of await loadDocUpdates(treeDoc(workspaceId))) Y.applyUpdate(doc, u)
  const { placements } = resolveMoves(doc.getArray(TREE_MOVES).toArray())
  const nodes: TreeNode[] = []
  doc.getMap<Y.Map<unknown>>(TREE_PAGES).forEach((m, id) => {
    if (!(m instanceof Y.Map)) return
    const placed = placements.get(id)
    nodes.push({
      id,
      title: String(m.get('title') ?? ''),
      parentId: placed ? placed.parentId : ((m.get('parentId') as string | null) ?? null),
      position: placed ? placed.position : String(m.get('position') ?? ''),
      icon: null,
      createdAt: Number(m.get('createdAt') ?? 0),
      createdBy: String(m.get('createdBy') ?? ''),
      archived: Boolean(m.get('archived')),
    })
  })
  doc.destroy()
  return buildTree(nodes)
}

/**
 * Everything in a workspace as a .zip of Markdown files, in folders that
 * mirror the page tree. Archived pages are left out.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  if (!UUID.test(workspaceId)) return new Response('Not found', { status: 404 })
  const user = await currentUser()
  if (!user) return new Response('Signed out', { status: 401 })
  if (!can(await workspaceRole(user.id, workspaceId), 'view')) return new Response('Not found', { status: 404 })

  const [ws] = await getDb().select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId))
  const live = new Set(
    (await getDb().select({ id: pages.id, archivedAt: pages.archivedAt }).from(pages).where(eq(pages.workspaceId, workspaceId)))
      .filter((p) => !p.archivedAt)
      .map((p) => p.id),
  )
  const tree = await readTree(workspaceId)
  const enc = new TextEncoder()
  const files: { path: string; data: Uint8Array }[] = []

  const walk = async (parentId: string | null, folder: string) => {
    const used = new Set<string>()
    for (const n of tree.get(parentId) ?? []) {
      if (!live.has(n.id) || files.length >= 2000) continue
      let name = safe(n.title)
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${safe(n.title)} (${i})`
      used.add(name.toLowerCase())
      const doc = new Y.Doc()
      for (const u of await loadDocUpdates(pageDoc(n.id))) Y.applyUpdate(doc, u)
      files.push({ path: `${folder}${name}.md`, data: enc.encode(fragmentMarkdown(doc.getXmlFragment('default'), n.title)) })
      doc.destroy()
      if (tree.get(n.id)?.length) await walk(n.id, `${folder}${name}/`)
    }
  }
  await walk(null, '')

  const archive = zip(files)
  const fileName = `${safe(ws?.name ?? 'Workspace')}.zip`
  return new Response(archive as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'no-store',
    },
  })
}
