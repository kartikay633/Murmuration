'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Editor } from '@tiptap/react'
import { can } from '@murmuration/shared'
import { createPage } from '@/app/actions'
import { useTree } from '@/lib/tree'
import { useWorkspace } from './workspace'

const KEY = (pageId: string) => `mm-import:${pageId}`
const MAX_BYTES = 2 * 1024 * 1024

/** Ask for Markdown files to import (from the command palette). */
export const openImport = () => window.dispatchEvent(new Event('mm:import'))

/** Title from the first "# Heading" (removed from the body), else the file name. */
export function splitTitle(md: string, fileName: string): { title: string; body: string } {
  const text = md.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const m = /^\s*#\s+(.+?)\s*#*\s*\n/.exec(text + '\n')
  if (m) return { title: m[1]!.trim().slice(0, 300), body: text.slice(m[0].length) }
  return { title: fileName.replace(/\.(md|markdown|txt)$/i, '').trim().slice(0, 300) || 'Imported page', body: text }
}

/**
 * Turns Markdown files into pages. Listens for the palette's request, and for
 * files dropped anywhere on the sidebar. Each file becomes a page whose body
 * fills in as soon as it opens.
 */
export function ImportListener() {
  const { workspace, user, role, toast } = useWorkspace()
  const tree = useTree()
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const treeRef = useRef(tree)
  treeRef.current = tree

  useEffect(() => {
    const ask = () => input.current?.click()
    window.addEventListener('mm:import', ask)
    return () => window.removeEventListener('mm:import', ask)
  }, [])

  const importFiles = async (files: File[]) => {
    if (!can(role, 'manage-pages')) return toast('You can’t add pages here.')
    const md = files.filter((f) => /\.(md|markdown|txt)$/i.test(f.name) || f.type === 'text/markdown')
    if (!md.length) return toast('Choose Markdown files (.md).')
    let first: string | null = null
    for (const file of md.slice(0, 20)) {
      if (file.size > MAX_BYTES) {
        toast(`${file.name} is larger than 2 MB, so it was skipped.`)
        continue
      }
      const { title, body } = splitTitle(await file.text(), file.name)
      const res = await createPage(workspace.id, title)
      if (!res.id) {
        toast(res.error ?? `Could not import ${file.name}.`)
        continue
      }
      treeRef.current.add({ id: res.id, title, parentId: null, createdBy: user.id })
      try {
        sessionStorage.setItem(KEY(res.id), body)
      } catch {
        /* storage full or blocked: the page is created, just empty */
      }
      first ??= res.id
    }
    if (!first) return
    if (md.length > 1) toast(`Imported ${md.length} pages.`)
    router.push(`/w/${workspace.id}/p/${first}`)
  }

  // Files dropped onto the sidebar.
  useEffect(() => {
    const side = document.querySelector('.sidebar')
    if (!side) return
    const over = (e: Event) => {
      const d = (e as DragEvent).dataTransfer
      if (d?.types.includes('Files')) {
        e.preventDefault()
        side.classList.add('drop-files')
      }
    }
    const leave = (e: Event) => {
      if (!side.contains((e as DragEvent).relatedTarget as Node | null)) side.classList.remove('drop-files')
    }
    const drop = (e: Event) => {
      const files = [...((e as DragEvent).dataTransfer?.files ?? [])]
      side.classList.remove('drop-files')
      if (!files.length) return
      e.preventDefault()
      void importFiles(files)
    }
    side.addEventListener('dragover', over)
    side.addEventListener('dragleave', leave)
    side.addEventListener('drop', drop)
    return () => {
      side.removeEventListener('dragover', over)
      side.removeEventListener('dragleave', leave)
      side.removeEventListener('drop', drop)
    }
  })

  return (
    <input
      ref={input}
      type="file"
      accept=".md,.markdown,.txt,text/markdown"
      multiple
      hidden
      onChange={(e) => {
        const files = [...(e.target.files ?? [])]
        e.target.value = ''
        if (files.length) void importFiles(files)
      }}
    />
  )
}

/** Fill a freshly imported page from the Markdown it was created from. */
export function useImportedContent(pageId: string, editor: Editor | null, ready: boolean) {
  useEffect(() => {
    if (!editor || !ready || editor.isDestroyed) return
    let body: string | null = null
    try {
      body = sessionStorage.getItem(KEY(pageId))
      sessionStorage.removeItem(KEY(pageId))
    } catch {
      return
    }
    if (body === null || !editor.isEmpty) return
    editor.commands.setContent(body, { contentType: 'markdown' })
  }, [pageId, editor, ready])
}
