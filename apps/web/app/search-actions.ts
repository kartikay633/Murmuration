'use server'

import { and, desc, eq, getDb, isNull, pages, sql, workspaceRole } from '@murmuration/db'
import { can } from '@murmuration/shared'
import { requireUser } from '@/lib/auth'

export interface SearchHit {
  id: string
  title: string
  /** A short excerpt; matched words are wrapped in \u0001 … \u0002. */
  snippet: string
  updatedAt: string
}

/** Words from the query, safe to splice into a tsquery. */
function terms(q: string): string[] {
  return (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map((t) => t.slice(0, 40))
}

/**
 * Full-text search over page titles and bodies in one workspace. Each word
 * matches as a prefix, so results appear while you're still typing. With no
 * query, returns the most recently edited pages.
 */
export async function searchPages(workspaceId: string, query: string): Promise<SearchHit[]> {
  const user = await requireUser()
  if (!can(await workspaceRole(user.id, workspaceId), 'view')) return []
  const db = getDb()
  const words = terms(query)

  if (!words.length) {
    const recent = await db
      .select({ id: pages.id, title: pages.title, updatedAt: pages.updatedAt })
      .from(pages)
      .where(and(eq(pages.workspaceId, workspaceId), isNull(pages.archivedAt)))
      .orderBy(desc(pages.updatedAt))
      .limit(8)
    return recent.map((r) => ({ id: r.id, title: r.title, snippet: '', updatedAt: r.updatedAt.toISOString() }))
  }

  const tsq = words.map((w) => `${w}:*`).join(' & ')
  const doc = sql`to_tsvector('simple', ${pages.title} || ' ' || ${pages.bodyText})`
  const query_ = sql`to_tsquery('simple', ${tsq})`
  const rows = await db
    .select({
      id: pages.id,
      title: pages.title,
      updatedAt: pages.updatedAt,
      snippet: sql<string>`ts_headline('simple', ${pages.bodyText}, ${query_},
        'StartSel=' || chr(1) || ', StopSel=' || chr(2) || ', MaxWords=22, MinWords=10, MaxFragments=1, FragmentDelimiter=" … "')`,
    })
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), isNull(pages.archivedAt), sql`${doc} @@ ${query_}`))
    .orderBy(
      // Title matches first, then by relevance, then the freshest.
      sql`(to_tsvector('simple', ${pages.title}) @@ ${query_}) desc`,
      sql`ts_rank(${doc}, ${query_}) desc`,
      desc(pages.updatedAt),
    )
    .limit(20)

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    // Only show an excerpt when the body actually matched.
    snippet: r.snippet.includes('\u0001') ? r.snippet.replace(/\s+/g, ' ').trim() : '',
    updatedAt: r.updatedAt.toISOString(),
  }))
}
