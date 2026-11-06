'use client'

import { Fragment, useMemo } from 'react'
import { diffStats, diffText, type DiffOp } from '@murmuration/shared'

type Span = { type: DiffOp['type']; text: string }

/** Split diff runs into paragraphs at line breaks. */
function lines(ops: DiffOp[]): Span[][] {
  const out: Span[][] = [[]]
  for (const o of ops) {
    const parts = o.text.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) out.push([])
      if (part) out[out.length - 1]!.push({ type: o.type, text: part })
    })
  }
  return out
}

/** What changed between a past version and the latest one, word by word. */
export function VersionDiff({ before, after }: { before: string; after: string }) {
  const { paragraphs, stats } = useMemo(() => {
    const ops = diffText(before, after)
    return { paragraphs: lines(ops), stats: diffStats(ops) }
  }, [before, after])

  return (
    <div className="vdiff">
      <p className="vdiff-summary">
        {stats.added === 0 && stats.removed === 0 ? (
          'No changes to the text since this version.'
        ) : (
          <>
            Since this version: <span className="vdiff-add">{stats.added.toLocaleString()} characters added</span>,{' '}
            <span className="vdiff-rem">{stats.removed.toLocaleString()} removed</span>.
          </>
        )}
      </p>
      <div className="vdiff-body">
        {paragraphs.map((spans, i) =>
          spans.length === 0 ? null : (
            <p key={i}>
              {spans.map((s, j) =>
                s.type === 'ins' ? (
                  <ins key={j}>{s.text}</ins>
                ) : s.type === 'del' ? (
                  <del key={j}>{s.text}</del>
                ) : (
                  <Fragment key={j}>{s.text}</Fragment>
                ),
              )}
            </p>
          ),
        )}
      </div>
    </div>
  )
}
