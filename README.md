# Murmuration

A shared workspace where many people write the same page at once — and where you can see how that works.

Thousands of starlings move as one shape with no leader. Murmuration's pages work the same way: every browser keeps its own copy, edits merge without locks, and every copy ends up identical, even after hours offline.

## What works today

- **Real-time editing** on rich-text pages, with live cursors and selections in each person's colour.
- **Workspaces and nested pages.** The page tree is itself a shared document, so new pages, renames, moves and archives show up in everyone's sidebar instantly. Drag pages to reorder or nest them.
- **A tree CRDT for moves.** Concurrent drags can't corrupt the tree. Every move is appended to a shared log with a Lamport timestamp; every replica replays the log in the same order and skips any move that would put a page inside its own subtree (after Kleppmann et al., *A highly-available move operation for replicated trees*). Same log, same tree, never a cycle.
- **Presence** in the page header and in the sidebar (coloured dots show who is on which page).
- **Roles**: owner, admin, editor, commenter, viewer — per workspace, overridable per page. Enforced **on the server for every edit**, not just hidden in the UI; a role change reaches people already on the page within seconds.
- **Offline editing.** Pages are cached in IndexedDB. Edits made offline are sent when the connection returns and merge with everyone else's.
- **Exact save state.** The header says *Saved* only once the server has stored every edit you've made.
- **Per-person undo.** Ctrl+Z only undoes your own changes.
- **Comments pinned to text.** Select any passage to start a thread. The anchor is a pair of Yjs relative positions, so a comment stays on its words while other people type above, inside or around them; if the words are deleted, the thread says so and keeps the original quote.
- **@mentions and an inbox.** Mentions and replies notify people instantly, with an unread badge in the sidebar. Opening one jumps straight to the thread.
- **Time travel.** Every page has a timeline: drag it (or press play) to watch the page being written, edit by edit, and restore any earlier version as a new edit, so nothing is ever lost. Comments on restored text re-pin themselves.
- **Blame view.** Colour the text by who wrote it, at any point in the page's history. Authorship is exact to the character: it comes from the Yjs client that created each character, mapped to the person whose update introduced that client.
- **Network Lab.** A panel on every page that puts the sync engine on screen: add latency to your own connection or cut it entirely, keep typing, and reconnect. It shows round-trip time, unsaved edits, traffic, and a fingerprint of every copy of the page (the server's, yours, and everyone else's). When they all match, the page has converged.
- **Practice collaborators.** One click brings three scripted people onto the page over the real protocol (same tokens, same permission checks). They type at the top and bottom at once, read with moving cursors, select a phrase and leave a comment that @mentions you, so the whole product can be seen with one browser.

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
| `packages/shared` | Protocol, roles, the page-tree CRDT |
| `packages/db` | Drizzle schema, access checks, seed data |

## Scaling and performance

Any number of sync servers can run side by side. Each server that has a document open subscribes to that document's Redis channel and publishes every edit and presence change from its own clients; a server that opens a document late asks the others for edits they haven't stored yet. Each edit is stored once, by the server its author is connected to. Comment and inbox events reach every server through Postgres `LISTEN/NOTIFY`.

Load test on one Windows laptop (everything on localhost): **200 clients** in 5 worker processes, connected across **2 sync servers linked through Redis**, each client making an edit every ~2 s to the same document for 30 s.

| Measure | Result |
|---|---|
| Edits | 100 / s (about 20,000 deliveries / s) |
| Delivery latency, edit made → seen by a client on either server | p50 **11.9 ms**, p95 **49.8 ms**, p99 430 ms |
| All 200 copies identical after the edits stopped | yes, within **0.55 s** |
| Connect and sync 200 clients | 373 ms |

The generator records its own event-loop lag (164 ms at worst in this run), which accounts for the p99 tail. Raw results: [`docs/benchmarks`](docs/benchmarks). To reproduce:

```bash
REDIS_URL=redis://localhost:6380 SYNC_PORT=4011 npm start -w @murmuration/sync
REDIS_URL=redis://localhost:6380 SYNC_PORT=4012 npm start -w @murmuration/sync
npm run load -w @murmuration/sync -- --clients 200 --seconds 30 --servers ws://localhost:4011,ws://localhost:4012
```

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

Open http://localhost:3100 and sign in with one of the seeded accounts (see `packages/db/src/seed.ts`). Open **Lab** on any page and choose *Invite practice collaborators*, or open a second browser (or a private window) as another person. You can also run a single collaborator from the terminal:

```bash
npm run bot -w @murmuration/sync -- <pageId> rohan@murmuration.test "Hello from Rohan"
```

## Tests

```bash
npm test
```

A fuzz test runs 10,000 random concurrent moves across 5 Yjs replicas with random partial syncing (three seeds) and checks that every replica ends with the identical tree and no cycles. Unit tests also cover rebuilding any past version from the event log (with and without checkpoints) and attributing every character to its author alongside formatting.

The sync-server tests run real clients against a real server over WebSockets and check that:

- two editors converge and every edit is stored with its author
- a viewer's edits are refused even from a modified client
- edits made offline merge after reconnecting
- a document is rebuilt correctly from the event log after a restart
- a role change applies to an open connection without reconnecting
- presence updates claiming someone else's client id are refused
- out-of-band events reach everyone on a page, and inbox events reach only the right person
- edits stay in order under added latency, and the server's fingerprint matches every converged client
- closing a document stops its presence timer (no leaks as you move between pages)
- a bad token closes the socket
- people connected to different sync servers converge and see each other, each edit is stored exactly once, and a server that opens a document late receives edits nobody has stored yet

## Roadmap

- [x] Design system and prototype ([blueprint](docs/BLUEPRINT.md), [prototype](docs/prototype/index.html))
- [x] Accounts, workspaces, page tree, roles
- [x] Real-time core: sync server, persistence, presence, server-side permissions
- [x] Comments anchored to text, mentions, notifications
- [x] Page history: time travel, restore, blame view
- [x] Network Lab (latency, going offline, replica fingerprints), practice collaborators in the UI
- [x] Page-tree CRDT for concurrent moves
- [x] Multiple sync servers behind Redis, load tests
- [ ] Public deployment
