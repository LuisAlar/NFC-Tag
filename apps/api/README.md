# API

Fastify + TypeScript implementation of [docs/openapi.yaml](../../docs/openapi.yaml). Postgres everywhere: Neon on Vercel, embedded PGlite locally (no install). Fake recognition providers until the real ones land.

## Run it locally

```bash
npm install
npm run seed      # creates the local DB, tenant_01, and test tags: test_unclaimed, tag_art_01, tag_art_02, tag_gift_01
npm run dev       # http://localhost:3000, restarts on save
npm test          # all three tap flows end to end on in-memory Postgres, plus the run log
```

`npm run seed -- --reset` wipes the local database and images. Local data lives in `data/` (git-ignored). Onboarding runs go to Postgres (`pipeline_runs`) and, locally, also to `runs/onboarding.jsonl` (`npm run runs -- --stats`).

To run against a real Postgres instead, set `DATABASE_URL` and run `npm run db:migrate` first.

## GiftBox

A gift tag opens a page of photos, each with a caption beside it and a note and date on its back. Everyone who taps reads it; only editor devices can change it. Routes are in `src/routes/gifts.ts`, tests in `src/routes/gifts.test.ts`.

1. **Provision a gift tag.** The tag's kind decides which setup screen the first tap shows:

   ```bash
   curl -X POST localhost:3000/api/admin/tags -H "x-admin-token: dev-admin" -H "content-type: application/json" -d '{"kind":"gift","count":1}'
   ```

2. **First tap sets it up.** `POST /api/gifts { tag_id, title }` claims the tag and returns that device's secret once.
3. **Edit.** `PATCH /api/gifts/:tag_id` (title), `POST /api/gifts/:tag_id/photos` (multipart `image`, optional `caption`, `note`, `taken_at`), `PATCH` and `DELETE /api/gifts/:tag_id/photos/:photo_id`. All need `Authorization: Bearer <secret>`.
4. **Add a second phone.** `POST /api/gifts/:tag_id/invites` returns a link (`/t/<tag_id>#invite=<code>`) that works once and expires in 7 days. Opening it calls `POST /api/gifts/:tag_id/editors`, which gives that phone its own secret.
5. **Recovery.** If every editor phone loses its secret, `POST /api/admin/tags/:tag_id/invites` (admin token) mints a new invite.

`GET /api/tags/:tag_id` returns `gift: { title, photos }` for a gift, to owners and guests alike.

Photos need image storage: with `MEDIA_DRIVER=none` (the Vercel default) adding a photo returns `503 MEDIA_STORAGE_OFF`.

## Deploy to Vercel

The API is its own Vercel project. The portfolio stays untouched until you add routing (see "Stitching into the portfolio").

1. **Create the project.** Import this repo in Vercel and set **Root Directory** to `apps/api`. Leave framework, build and output settings on auto. Vercel detects `src/server.ts` as a Fastify app and serves it as a single function with Fluid compute.
2. **Add the database.** In the project, go to Storage → Create → Neon (free). This sets `DATABASE_URL` on the project.
3. **Set env vars** (Settings → Environment Variables):
   - `ADMIN_TOKEN`: a long random string. Without it, the provisioning routes are off.
   - Optional: `PUBLIC_WEB_URL` and `CORS_ORIGINS` (both default to `https://luis-alarcon.vercel.app`), `FAKE_SCENARIO`.
4. **Migrate and seed once, from your machine.** Get the connection string with `vercel env pull .env.local` or copy it from the Neon dashboard, then:

   ```bash
   DATABASE_URL="postgres://..." npm run db:migrate
   DATABASE_URL="postgres://..." npm run seed
   ```

   Migrations never run on a cold start. Run `db:migrate` again whenever a new file lands in `src/db/migrations/`.
5. **Deploy**, then check `https://<project>.vercel.app/health`. It returns `{"status":"ok","media":"none"}` without touching the database.

### What changes on Vercel (`VERCEL` is set)

| | Local | Vercel |
| --- | --- | --- |
| Database | PGlite in `data/pglite` (auto-migrated) | `DATABASE_URL` required, migrate by hand |
| Images | Disk, served at `/media/*` | Not stored yet (`image_url: null`), see below |
| Run log | Postgres + console + JSONL | Postgres only |
| Admin token | `dev-admin` | `ADMIN_TOKEN` or off |
| `x-fake-scenario` header | Allowed | Ignored (set `ALLOW_SCENARIO_HEADER=1` to allow) |
| Max upload | 4 MB | 4 MB (Vercel rejects request bodies over 4.5 MB) |

### Image storage (not set up yet)

`src/services/mediaStore.ts` defines the interface. Adding a backend means writing one `put` / `publicUrl` / `remove` implementation and setting `MEDIA_DRIVER`. Images should then be served from the storage CDN, never through this function. The plan is for the browser to resize the photo and upload it straight to storage with a signed URL, then send only the key to `/api/items/onboard`.

### Stitching into the portfolio

Tap URLs are `https://luis-alarcon.vercel.app/t/<tag_id>`. The portfolio project forwards NFC paths to the NFC projects with rewrites in its `vercel.json`, for example:

```json
{ "rewrites": [{ "source": "/nfc-api/:path*", "destination": "https://<api-project>.vercel.app/api/:path*" }] }
```

Proxied requests are same-origin, so CORS is not involved. Write tag URLs onto chips only after this routing works.

## Endpoints

| Method | Path | Auth | Flow |
| --- | --- | --- | --- |
| GET | `/api/tags/:tag_id` | optional Bearer | Dispatch: `unclaimed` → onboard, `claimed` + `role: owner \| guest` |
| POST | `/api/items/onboard` | none (tag must be unclaimed) | A: multipart `tag_id`, `image`, optional `title_override`, `artist_override`, `kind` |
| GET | `/api/items/:item_id` | none | B2: public item |
| GET | `/api/items/:item_id/entry` | Bearer | B1: private entry |
| PATCH | `/api/entries/:entry_id` | Bearer | B1: auto-save `{ content, prompts? }` |
| POST/GET | `/api/admin/tags` | `x-admin-token` | Provision tags (not in the public contract) |
| GET | `/media/*` | none | Uploaded images (disk driver only) |
| GET | `/health` | none | No database access |

Errors are always `{ message, code }`.

### Try it with curl

```bash
curl localhost:3000/api/tags/test_unclaimed
curl -F tag_id=test_unclaimed -F "image=@painting.jpg;type=image/jpeg" localhost:3000/api/items/onboard
curl -H "Authorization: Bearer <raw_owner_secret>" localhost:3000/api/tags/test_unclaimed
curl -X POST -H "x-admin-token: dev-admin" -H "content-type: application/json" -d '{"count":3}' localhost:3000/api/admin/tags
```

Locally, send `x-fake-scenario: thrift` on the onboard request to exercise the "painting not recognized" path. The default, `famous`, recognizes The Gleaners.

## Efficiency (Hobby limits are per account)

- A tap is one function call and one SQL query: tag, item and entry come back in a single join.
- `/health` and CORS preflights (cached 24h with `max-age`) never touch the database.
- The `pg` pool holds at most 3 connections and is attached with `attachDatabasePool`, so idle connections close before Vercel suspends the instance.
- Migrations, seeding and the static-file plugin stay out of the cold-start path.

## Ownership

Onboarding mints a 256-bit secret, returns it once as `raw_owner_secret`, and stores only its SHA-256 on the tag. The device keeps the raw secret in `localStorage` and sends it as `Authorization: Bearer …`. Claiming is one transaction conditional on `status = 'unclaimed'`. In Postgres, a second concurrent claim waits on the row lock, sees the tag is taken, and rolls back.

## Item kinds

`items.kind` says which experience a tap opens. The tap, ownership and entry code is shared; each kind only adds an onboarder (`src/services/onboarding/<kind>.ts`, registered in `src/createApp.ts`) and a UI. Only `artwork` exists today.

## Layout

```text
src/
  server.ts       entrypoint (local and Vercel)
  createApp.ts    builds Fastify from deps (not app.ts: keeps Vercel's entry detection unambiguous)
  config.ts, errors.ts
  routes/         tags, items, entries, admin (+ api.test.ts)
  services/
    auth.ts         secrets, hashing, IDs
    mediaStore.ts   image storage interface (disk / none; R2 or Blob next)
    onboarding/     Flow A service, pipeline, per-kind onboarders
    providers/      fake.ts (Vision, Wikipedia, Wikidata, LLM stand-ins)
    runlog/         step-by-step pipeline logging (+ pgSink.ts)
  db/
    sql.ts          pg Pool or PGlite behind one interface
    repo.ts         all queries
    migrate.ts      applies migrations/*.sql once each
    seed.ts
  models/         types.ts
```

## Environment

| Var | Default |
| --- | --- |
| `DATABASE_URL` | unset = PGlite (required on Vercel) |
| `PGLITE_DIR` | `data/pglite` |
| `MEDIA_DRIVER` | `disk` locally, `none` on Vercel |
| `MEDIA_DIR` | `data/media` |
| `RUNLOG_PATH` | `runs/onboarding.jsonl` (local only) |
| `ADMIN_TOKEN` | `dev-admin` locally; unset in production = admin routes off |
| `PUBLIC_WEB_URL` | `http://localhost:5173` / `https://luis-alarcon.vercel.app` |
| `CORS_ORIGINS` | same as above (comma-separated) |
| `FAKE_SCENARIO` | `famous` |
| `MAX_IMAGE_BYTES` | 4 MB |
| `PORT` / `HOST` | `3000` / `0.0.0.0` |
