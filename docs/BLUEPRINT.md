# Murmuration — Blueprint

A real-time collaborative workspace (pages, workspaces, comments, roles) in the spirit of a simplified Notion — with one difference in attitude: **it shows its work**. Sync, conflict resolution and history are normally invisible. Here you can scrub through them, break them on purpose, and watch them recover.

> Name note: a starling murmuration is thousands of birds moving as one with no leader. That is how the sync layer works — no central lock, every replica converges.

---

## 1. Scope

### Core (the original brief)

| Feature | How we build it |
|---|---|
| Real-time collaborative editing | Tiptap/ProseMirror editor, Yjs document per page, sync over our own WebSocket protocol |
| Multiple workspaces | Workspace → page tree; users can belong to many workspaces |
| Comments and mentions | Comments anchored to Yjs *relative positions* so they survive concurrent edits; `@user` creates a notification |
| Role-based permissions | Owner / Admin / Editor / Commenter / Viewer at workspace level, overridable per page. **Checked on the server for every inbound message**, not just hidden in the UI |
| Activity history | Every update is appended to an event log (who, when, what) |
| Conflict resolution | Text: Yjs CRDT. Page tree (move/reorder/nest): **our own CRDT** with cycle prevention, fuzz-tested |
| Live presence | Cursors, selections, viewport, idle state; avatar stack per page; follow mode |

### Signature features (what makes it ours)

1. **Time travel** — a timeline under every page. Drag to replay the page being written, coloured by author. Restore any point, or start a draft from it. Built on the event log + periodic snapshots.
2. **Network Lab** — a panel that puts simulated clients side by side. Add latency, drop packets, take a client offline, keep typing, reconnect, and watch it merge. Shows queued ops and a convergence check (all replicas hash-equal).
3. **Practice collaborators** — a solo visitor (a recruiter) can summon 2–3 scripted bots that move cursors, type, comment and mention them. The live demo works with one person.

### Supporting
- Blame view (text tinted by author).
- Per-user undo (Ctrl+Z only undoes *your* changes — Yjs `UndoManager` scoped to the local origin).
- Offline editing with IndexedDB persistence, merged on reconnect.
- "While you were away" digest from the activity log.
- Command palette (⌘K), markdown shortcuts, full keyboard navigation.

### Deliberately out of scope
AI features, databases/tables-as-pages, file uploads beyond images, mobile apps.

---

## 2. Architecture

```
 Browser (Next.js + React)
 ├─ Tiptap editor ⇄ Y.Doc ⇄ IndexedDB (offline)
 ├─ Presence (awareness) · Zustand UI state
 └─ WebSocket client  ── binary frames ──┐
                                         ▼
 Sync server (Node, ws)             ┌───────────────┐
 ├─ auth on connect (JWT)           │ Redis pub/sub │  fan-out between
 ├─ permission check per message ──▶│  + presence   │  server instances
 ├─ applies update to in-memory doc └───────────────┘
 ├─ appends to event log
 └─ snapshots every N updates
                 │
                 ▼
 PostgreSQL (users, workspaces, pages, roles, comments, events, snapshots)

 API server (Next.js route handlers): auth, workspaces, pages, comments, invites
```

**Sync protocol (our own, small and documented):**
- `sync-step-1` client sends its state vector → server replies with the missing diff (`sync-step-2`).
- `update` incremental Yjs update. Server rejects if the sender's role on the page < Editor.
- `awareness` presence (cursor, selection, viewport, status). Rate-limited to 20/s.
- `ack` server confirms persistence (drives the "Saved" indicator).

**Persistence:** append-only `doc_events` (binary update + author + timestamp). A snapshot every 200 events or 5 minutes; loading a page = latest snapshot + events after it. Time travel replays from the nearest snapshot.

**Scaling:** documents are not pinned to one server. Each instance subscribes to `page:{id}` on Redis while it has clients on that page; updates are published and merged (CRDT updates are commutative, so order between instances doesn't matter).

---

## 3. Data model (first pass)

```
users            id, name, email, avatar_color, created_at
workspaces       id, name, slug, created_by
memberships      user_id, workspace_id, role            -- owner|admin|editor|commenter|viewer
pages            id, workspace_id, title, icon, created_by, archived_at
page_tree        workspace_id, ydoc (binary)            -- tree CRDT state
page_roles       page_id, user_id, role                 -- overrides
doc_events       id, page_id, author_id, update (bytea), created_at
doc_snapshots    page_id, event_id, state (bytea), created_at
comments         id, page_id, thread_id, author_id, anchor_start, anchor_end (relative pos), body, resolved_at
mentions         id, comment_id, user_id, read_at
activity         id, workspace_id, page_id, actor_id, kind, meta (jsonb), created_at
```

### Permissions matrix

| | View | Comment | Edit | Share / roles | Delete page | Workspace settings |
|---|---|---|---|---|---|---|
| Viewer | ✓ | | | | | |
| Commenter | ✓ | ✓ | | | | |
| Editor | ✓ | ✓ | ✓ | | | |
| Admin | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## 4. Design direction

**Editorial paper, not SaaS template.** It should feel like a well-kept manuscript.

- **Colour:** warm paper `#F7F4EE`, ink `#1C1A17`, hairline rules `#E2DDD2`. Dark mode is a "night desk" (`#1A1916`), never pure black.
- **Presence inks:** vermilion `#D9481C`, cobalt `#2F5BD3`, moss `#4E7A3A`, ochre `#B98419`, plum `#7B3F73` — like coloured pencils. These are the only saturated colours in the UI.
- **Type:** Newsreader (document), Instrument Sans (interface), JetBrains Mono (timestamps, IDs, counts).
- **Layout:** page tree on the left · ~720px reading column · comments in the right margin, aligned to their text · history timeline docked at the bottom.
- **Never:** gradients, glassmorphism, emoji headings, drop-shadowed cards everywhere, default shadcn look, spinners where a skeleton fits.
- **Quality bar:** no layout shift on remote edits; cursor labels fade when idle; IME and emoji input correct; everything reachable by keyboard; 60fps while three people type.

The clickable prototype in [`docs/prototype/index.html`](prototype/index.html) is the reference for this.

---

## 5. Stack

TypeScript everywhere · Next.js (App Router) · Tiptap / ProseMirror · Yjs · Zustand · Node `ws` sync server · PostgreSQL + Drizzle · Redis · Vitest + Playwright + fast-check (property tests) · k6 (load) · Vercel (web) + Fly.io (sync) + Neon (Postgres) + Upstash (Redis).

---

## 6. Phases

| # | Phase | Done when |
|---|---|---|
| 1 | Design system + clickable static prototype | Main screen approved; tokens and components defined |
| 2 | Accounts and structure: auth, workspaces, page tree, roles | Can sign up, create workspaces, invite with roles, nest pages. Page-tree CRDT passes 10k random concurrent moves across 5 replicas: always converges, never a cycle |
| 3 | Real-time core: WebSocket server, sync, persistence, presence | Two browsers edit the same page; refresh loses nothing; cursors and avatars live. A Viewer with a modified client cannot change a document (test proves it) |
| 4 | Collaboration: comments, mentions, notifications | Comment stays attached through concurrent edits; mentions notify |
| 5 | History: activity log, time travel, blame | Scrub any page from first keystroke to now; restore and branch work |
| 6 | Showcase: Network Lab, practice collaborators, offline | Partition + reconnect demo converges every time; solo visitor can summon bots |
| 7 | Production readiness: Redis scaling, load tests, metrics, deploy | 2+ sync instances behind Redis; k6 run with 200 clients; p95 numbers in README; live URL |

---

## 7. Packaging (for interviews)

- README with architecture diagram, a 90-second demo GIF/video, and real benchmark numbers.
- `docs/DESIGN.md` written like an engineering RFC: what was considered, what was chosen, why.
- Convergence fuzz tests visible in CI.
- Live demo where a single visitor can summon practice collaborators.

---

## 8. Open decisions

- **Name:** "MURMURATION" is a registered US trademark in software (Class 42, Murmuration, Inc.) and a 2026 SaaS application exists. Fine as a portfolio name; needs a change before any commercial use.
- **Text CRDT:** Yjs (chosen) vs writing our own. Revisit after Phase 7 if time allows.
