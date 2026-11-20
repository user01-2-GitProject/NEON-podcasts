# NEON Podcasts

Generate podcast episodes from Markdown briefings. A single-user web app: create
shows, upload `.md` briefings, and generate a downloadable episode (script via
Claude → audio via hosted TTS → mp3 + show notes).

See [`docs/PLAN.md`](docs/PLAN.md) for the full plan. This is the first build slice:
**Phase 0 (foundations) + Phase 1 (shows & briefings) + a thin Phase 2
(generate one episode on demand).** Scheduler and public RSS come later.

## Stack

- **Next.js 15** (App Router, TypeScript) — deploy to Vercel
- **Neon Postgres** — `@neondatabase/serverless`
- **Claude API** — `@anthropic-ai/sdk` (script generation)
- **Hosted TTS** — OpenAI or ElevenLabs (audio)
- Audio is stored in Postgres for the MVP (swap to R2/S3 later)
- Single-user auth gate via a signed cookie (no external auth service yet)

## Setup

1. **Install**
   ```bash
   npm install
   ```

2. **Configure env** — copy `.env.example` to `.env.local` and fill in:
   - `DATABASE_URL` — Neon pooled connection string
   - `APP_PASSWORD` + `AUTH_SECRET` — the dashboard login gate
   - `ANTHROPIC_API_KEY` — for script generation
   - TTS: `TTS_PROVIDER` = `openai` (`OPENAI_API_KEY`) or `elevenlabs` (`ELEVENLABS_API_KEY`)

3. **Create the schema**
   ```bash
   npm run db:migrate
   ```

4. **Run**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000, sign in with `APP_PASSWORD`, create a show, upload a
   `.md` briefing, and click **Generate now**.

## Deploy (Vercel)

Set the same environment variables in the Vercel project settings, connect this
repo, and deploy. Run `npm run db:migrate` once against the production
`DATABASE_URL` (locally with the prod string, or via the Neon SQL editor using
`db/schema.sql`).

## Project layout

```
app/                     # App Router pages + API routes
  api/auth/              # login / logout
  api/shows/             # show CRUD, briefings, generate
  api/episodes/[id]/audio# streams / downloads the stored mp3
  shows/[id]/            # show detail (briefings, generate, episodes)
components/              # client components (forms, panels)
lib/                     # db, auth, claude, tts, generation orchestrator
db/schema.sql           # schema (run via scripts/migrate.ts)
```
