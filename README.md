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
- **TTS** — OpenAI, ElevenLabs, or a **local / self-hosted** OpenAI-compatible
  engine (Kokoro, Piper via openedai-speech, LocalAI). See "Local voices" below.
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
   - TTS: `TTS_PROVIDER` = `openai` (`OPENAI_API_KEY`), `elevenlabs` (`ELEVENLABS_API_KEY`), or `local` (see Local voices)

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

## Local voices (self-hosted TTS)

Set `TTS_PROVIDER=local` and point `LOCAL_TTS_URL` at any **OpenAI-compatible**
`/v1/audio/speech` endpoint. Tested shapes:

- **[Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI)** — fast, high-quality local voices
- **[openedai-speech](https://github.com/matatonic/openedai-speech)** — wraps Piper / Coqui / XTTS

### Quickstart with Kokoro-FastAPI (local, free)

```bash
# 1. Start the local TTS engine (Docker). CPU image shown; GPU image also exists.
docker run -it --rm -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest

# 2. In .env.local, point the app at it:
TTS_PROVIDER=local
LOCAL_TTS_URL=http://localhost:8880/v1/audio/speech
LOCAL_TTS_VOICE=af_sky        # try: af_bella, am_adam, bf_emma, bm_george ...
# LOCAL_TTS_MODEL and LOCAL_TTS_API_KEY are optional

# 3. Run the app locally and generate — it will narrate with the local voice.
npm run dev
```

Prefer Piper/Coqui/XTTS voices? Run
[openedai-speech](https://github.com/matatonic/openedai-speech) instead (same
OpenAI-compatible API) and set `LOCAL_TTS_URL` to its `/v1/audio/speech` URL.

⚠️ **Reachability:** when the app is deployed on Vercel it runs in the cloud and
**cannot reach your machine's `localhost`.** Local voices work when you (a) run the
app locally (`npm run dev`), or (b) expose the TTS engine at a URL Vercel can reach
(a tunnel like cloudflared/ngrok, or a self-hosted box). Hosted providers (OpenAI /
ElevenLabs) have no such constraint.

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
