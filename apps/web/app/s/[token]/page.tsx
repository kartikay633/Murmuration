import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import * as Y from 'yjs'
import { and, eq, getDb, isNull, loadDocUpdates, pages, workspaces } from '@murmuration/db'
import { fragmentHtml, pageDoc } from '@murmuration/shared'
import { Mark } from '@/components/icons'

/** Read fresh on every request: a published page shows its latest version. */
export const dynamic = 'force-dynamic'

type Params = Promise<{ token: string }>

async function published(token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null
  const [row] = await getDb()
    .select({ id: pages.id, title: pages.title, updatedAt: pages.updatedAt, workspace: workspaces.name })
    .from(pages)
    .innerJoin(workspaces, eq(workspaces.id, pages.workspaceId))
    .where(and(eq(pages.publicToken, token), isNull(pages.archivedAt)))
  return row ?? null
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const page = await published((await params).token)
  if (!page) return { title: 'Page not found', robots: { index: false } }
  // Published means "anyone with the link", not "listed on search engines".
  return { title: page.title || 'Untitled', robots: { index: false, follow: false } }
}

export default async function PublicPage({ params }: { params: Params }) {
  const page = await published((await params).token)
  if (!page) notFound()

  const doc = new Y.Doc()
  for (const u of await loadDocUpdates(pageDoc(page.id))) Y.applyUpdate(doc, u)
  const html = fragmentHtml(doc.getXmlFragment('default'))
  doc.destroy()

  return (
    <div className="public">
      <header className="public-bar">
        <span className="public-brand">
          <Mark />
          <span>{page.workspace}</span>
        </span>
        <span className="public-meta">
          Updated {page.updatedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
        </span>
      </header>
      <article className="public-page">
        <h1 className="public-title">{page.title || 'Untitled'}</h1>
        {/* fragmentHtml escapes all text and emits only a fixed set of tags with safe links. */}
        <div className="public-body ProseMirror" dangerouslySetInnerHTML={{ __html: html }} />
      </article>
      <footer className="public-foot">
        Published with <a href="/">Murmuration</a>
      </footer>
    </div>
  )
}
