# Deploying Murmuration

The simplest setup runs everything as **one web service plus Postgres**. A small
entry point (`apps/sync/src/combined.ts`) serves the Next.js app and accepts
WebSocket connections on `/sync` on the same port, so there's no second service
and no cross-origin configuration.

## Render (free to start)

1. Sign in at [render.com](https://render.com) with GitHub and give Render access to this repository.
2. **New → Blueprint**, choose this repository, and click **Apply**. Render reads `render.yaml` and creates:
   - `murmuration`: the web service (build: install and `next build`; start: update the schema, then serve web and sync)
   - `murmuration-db`: Postgres
   - a random `SYNC_TOKEN_SECRET`
3. When the first deploy finishes, open the service, copy its address (for example `https://murmuration.onrender.com`) and set **`ALLOWED_ORIGINS`** to it under *Environment*. This makes the sync server refuse sockets opened from other websites.
4. Visit the site and click **Try the live demo**.

If pushes to `main` don't start a new deploy, Render can't see the repository's commits: under *Settings → Build & Deploy*, reconnect the repository through Render's GitHub app (or use **Manual Deploy → Deploy latest commit**). Schema changes are applied by `npm run db:push` when the service starts, so keep migrations non-interactive (no new unique constraints on tables that already have rows).

Things to know about the free plan:

- The service sleeps after about 15 minutes without visitors; the first visit after that takes up to a minute while it wakes. Clients reconnect on their own. The *Starter* plan keeps it awake.
- Free Postgres databases on Render expire after 30 days. For something longer-lived, create a free database on [Neon](https://neon.tech) and paste its connection string into `DATABASE_URL`.
- Guest demo accounts are removed automatically after 7 days.

## Running the production build locally

```bash
npm run build -w @murmuration/web
PORT=3200 NEXT_PUBLIC_SYNC_URL= npm run start:combined -w @murmuration/sync
```

## Scaling out

The sync server can also run as its own service (`npm start -w @murmuration/sync`),
any number of times, linked through Redis with `REDIS_URL`. Point the web app at
it with `NEXT_PUBLIC_SYNC_URL=wss://your-sync-host` at build time. See the
README's *Scaling and performance* section for the load test.
