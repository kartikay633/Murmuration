# Murmuration

A shared workspace where many people write the same page at once — and where you can see how that works.

Thousands of starlings move as one shape with no leader. Murmuration's pages work the same way: every browser keeps its own copy, edits merge without locks, and every copy ends up identical, even after hours offline.

## What works today

- **Real-time editing** on rich-text pages, with live cursors and selections in each person's colour.
- **Workspaces and nested pages.** The page tree is itself a shared document, so new pages, renames and archives show up in everyone's sidebar instantly.
- **Presence** in the page header and in the sidebar (coloured dots show who is on which page).
- **Roles**: owner, admin, editor, commenter, viewer — per workspace, overridable per page. Enforced **on the server for every edit**, not just hidden in the UI; a role change reaches people already on the page within seconds.
- **Offline editing.** Pages are cached in IndexedDB. Edits made offline are sent when the connection returns and merge with everyone else's.
- **Exact save state.** The header says *Saved* only once the server has stored every edit you've made.
- **Per-person undo.** Ctrl+Z only undoes your own changes.
- **Comments pinned to text.** Select any passage to start a thread. The anchor is a pair of Yjs relative positions, so a comment stays on its words while other people type above, inside or around them; if the words are deleted, the thread says so and keeps the original quote.
- **@mentions and an inbox.** Mentions and replies notify people instantly, with an unread badge in the sidebar. Opening one jumps straight to the thread.
- **Time travel.** Every page has a timeline: drag it (or press play) to watch the page being written, edit by edit, and restore any earlier version as a new edit, so nothing is ever lost. Comments on restored text re-pin themselves.
- **Blame view.** Colour the text by who wrote it, at any point in the page's history. Authorship is exact to the character: it comes from the Yjs client that created each character, mapped to the person whose update introduced that client.
- **Practice collaborators**: a script that joins a page as a seeded user and types, so you can see real-time editing with one browser.

## Architecture

```
Browser (Next.js, React, Tiptap)          Sync server (Node, ws)                 PostgreSQL
 Y.Doc per open page ──┐                   ┌─ token check on first frame
 Y.Doc for page tree ──┼── one WebSocket ──┼─ role check on every edit      ──▶  doc_events (append-only, per author)
 IndexedDB cache ──────┘   many documents  ├─ presence ownership check            doc_snapshots (every 200 events)
                                           └─ batched writes, SAVED acks          users, workspaces, pages, roles
```

- **Text merging** uses [Yjs](https://github.com/yjs/yjs), a CRDT. The server, protocol, persistence, permissions and client connection are written for this project.
- **One socket per tab** carries any number of documents. Each frame is `[type][document name][payload]`; see [`packages/shared/src/protocol.ts`](packages/shared/src/protocol.ts).
- **Event log, not overwrites.** Every update is appended with its author. A document loads as *latest snapshot + events after it*. This log is the base for page history and time travel.
- **Precise acknowledgements.** Client and server both count the edit frames a client sends for a document; `SAVED(n)` means frames 1..n are stored.
- **Presence can't be spoofed.** A connection may only update awareness entries for client ids it introduced.
- **Postgres changes reach browsers live.** Comments and notifications live in Postgres. The web app publishes a `NOTIFY` after each change; sync servers `LISTEN` and forward it to the sockets that care (everyone on that page, or one person's tabs). No polling.

| Package | What it is |
|---|---|
| `apps/web` | Next.js app: auth, workspace shell, editor, sharing |
| `apps/sync` | WebSocket sync server and the practice-collaborator script |
| `packages/client` | Browser/Node client for the sync protocol (reconnects, offline queue, save state) |
| `packages/shared` | Protocol, roles, page-tree helpers |
| `packages/db` | Drizzle schema, access checks, seed data |

## Running it locally

Requires Node 20+ and Docker.

```bash
npm install
cp .env.example .env          # then set SYNC_TOKEN_SECRET to a long random string
npm run db:up                 # Postgres + Redis in Docker
npm run db:push               # create tables
npm run db:seed               # demo workspace and people
npm run dev                   # web on :3100, sync on :4001
```

Open http://localhost:3100 and sign in with one of the seeded accounts (see `packages/db/src/seed.ts`). Open a second browser (or a private window) as another person to edit together, or let a practice collaborator join the page you're on:

```bash
npm run bot -w @murmuration/sync -- <pageId> rohan@murmuration.test "Hello from Rohan"
```

## Tests

```bash
npm test
```

Unit tests also cover rebuilding any past version from the event log (with and without checkpoints) and attributing every character to its author alongside formatting.

The sync-server tests run real clients against a real server over WebSockets and check that:

- two editors converge and every edit is stored with its author
- a viewer's edits are refused even from a modified client
- edits made offline merge after reconnecting
- a document is rebuilt correctly from the event log after a restart
- a role change applies to an open connection without reconnecting
- presence updates claiming someone else's client id are refused
- out-of-band events reach everyone on a page, and inbox events reach only the right person
- closing a document stops its presence timer (no leaks as you move between pages)
- a bad token closes the socket

## Roadmap

- [x] Design system and prototype ([blueprint](docs/BLUEPRINT.md), [prototype](docs/prototype/index.html))
- [x] Accounts, workspaces, page tree, roles
- [x] Real-time core: sync server, persistence, presence, server-side permissions
- [x] Comments anchored to text, mentions, notifications
- [x] Page history: time travel, restore, blame view
- [ ] Network Lab (latency, packet loss, partitions), practice collaborators in the UI
- [ ] Page-tree CRDT for concurrent moves
- [ ] Multiple sync servers behind Redis, load tests, deployment
