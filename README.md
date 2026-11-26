# NEON Podcasts

Generate podcast episodes from Markdown briefings. Owners create
shows, upload `.md` briefings, and generate a downloadable episode (script via
Claude → audio via hosted TTS → mp3 + show notes).

See [`docs/PLAN.md`](docs/PLAN.md) for the full plan. The single-user MVP has
shipped (multiple shows, `.md` upload, script + TTS generation); the **scheduler**
is the one remaining MVP piece. `docs/PLAN.md` now also lays out the forward
**Native App & Product Roadmap** — real accounts, audio on a CDN, a token-based
JSON API, in-app publishing + players, nudges/steering, a React Native (Expo) app,
and subscriptions.

## Stack

- **Next.js 15** (App Router, TypeScript) — deploy to Vercel
- **Neon Postgres** — `@neondatabase/serverless`
- **Script LLM** — Claude via `@anthropic-ai/sdk`, **or OpenRouter** (one key for
  Claude + OpenAI + more). Pick with `LLM_PROVIDER`.
- **TTS** — OpenAI, ElevenLabs, or a **local / self-hosted** OpenAI-compatible
  engine (Kokoro, Piper via openedai-speech, LocalAI). See "Local voices" below.
- Audio is stored in Postgres for the MVP (swap to R2/S3 later)
- Auth.js email/password accounts stored in Neon; owner/member roles share all shows

## Setup

1. **Install**
   ```bash
   npm install
   ```

2. **Configure env** — copy `.env.example` to `.env.local` and fill in:
   - `DATABASE_URL` — Neon pooled connection string
   - `OWNER_EMAILS` — comma-separated owner email addresses; other accounts are read-only
   - `OWNER_SIGNUP_SECRET` — private one-time owner enrollment secret; keep it from members
   - `AUTH_SECRET` — a long random Auth.js session secret
   - Script LLM: `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`, **or**
     `LLM_PROVIDER=openrouter` + `OPENROUTER_API_KEY` (+ optional `OPENROUTER_MODEL`)
   - TTS: `TTS_PROVIDER` = `openai` (`OPENAI_API_KEY`), `elevenlabs` (`ELEVENLABS_API_KEY`), or `local` (see Local voices)

3. **Create the schema**
   ```bash
   npm run db:migrate
   ```

4. **Seed the worked examples (optional, repeatable)**
   ```bash
   npm run seed:examples
   ```
   Adds two inactive, NEON-owned example shows with a published three-minute
   sample episode each: "Sterling Reads the News" (news brief) and "Rarely Made
   History" (narrative essay). They appear first on `/browse` with an Example
   chip; re-running updates the same rows. The silent mp3 fixture and its
   ffmpeg command are documented in `scripts/fixtures/README.md`.

5. **Run**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000, create an account with an email in `OWNER_EMAILS` and the owner enrollment secret, sign in, create a show, upload a
   `.md` briefing, and click **Generate now**.

Accounts use Auth.js Credentials with scrypt password hashes in `users`; no external
auth provider keys are needed. On sign-up and sign-in, the role is set from
`OWNER_EMAILS` after the account has supplied `OWNER_SIGNUP_SECRET` once. This
prevents public sign-up from claiming an owner address. A newly added owner signs
in again to get the role; removing an email from `OWNER_EMAILS` blocks writes
immediately.
Run `npm run db:migrate` before deploying this change. The old `APP_PASSWORD`
cookie cannot authenticate to the new app. The cron endpoint still uses
`CRON_SECRET`, and RSS/listen pages and feed-token audio remain public.

### Fix one sentence in an episode (TTS re-splice)

On a show page, an owner can open **✏️ Fix a sentence** on an episode with audio,
edit one sentence in the transcript, and submit that sentence. The app re-reads
only that sentence and the ones after it in the show's voice, then uses ffmpeg to
join the untouched beginning to the new reading with a short crossfade. The
corrected text is saved back into the episode's script; the episode keeps its
published/draft status.

This needs the `ffmpeg` executable on the server (and `ffprobe` for an exact
input length; without it the length is estimated from the script). Both are
installed in the current Linux dev container (`/usr/bin/ffmpeg`,
`/usr/bin/ffprobe`). On Vercel or another serverless host, provide ffmpeg in the
runtime image or this endpoint will answer 502 — no script or audio is changed
when the splice fails.

**Accuracy limit:** the current TTS providers return audio bytes but no
per-sentence timestamps, so the join point is *stubbed*: the stored script is
split into sentences and the word count before the chosen sentence is used to
estimate where it starts in the mp3. Pauses, numbers and unusual pacing can move
the join by a fraction of a second. The API response includes
`"stubbed": true` and the page shows the same warning. Listen to the result
before publishing. A provider that returns word timings can replace the
word-count estimate without changing the splice.

Neon Auth was considered first, but its current SDK requires Next.js 16 while
this app is on Next.js 15. Auth.js works with the current stack.

### Google sign-in

Create a Google Cloud OAuth 2.0 **Web application** client. Configure the Google
Auth Platform branding and audience; if the app is in testing, add intended users
as test users. Add these exact Authorized redirect URIs:

- `https://neon-podcasts.vercel.app/api/auth/callback/google`
- `http://localhost:3000/api/auth/callback/google`

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel and in `.env.local`
for local development. Google sign-in requires a verified Google email, creates
or updates the matching user, and grants owner access only when that email is in
`OWNER_EMAILS`. It does not use `OWNER_SIGNUP_SECRET`. Signing in with Google
clears any old password hash on that email account, so the password cannot later
take over its Google-verified owner role. Password sign-in remains available to
accounts that have not switched to Google. No schema migration is needed because
`users.password_hash` is already nullable.

## API tokens

After signing in as an owner, create a token with `POST /api/tokens` using JSON
`{"label":"My client","scope":"read_only"}` or `"read_write"`. The response
contains the raw `token` once; save it securely. For example, in the browser
console while signed in:

```js
await fetch("/api/tokens", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ label: "My client", scope: "read_only" }),
}).then((response) => response.json());
```

Send the returned token with `Authorization: Bearer <token>` to existing `/api/*`
show, briefing, episode, and settings routes. `read_only` permits GET requests;
`read_write` also permits mutations and generation. A bearer header takes
precedence over a browser cookie. `GET /api/tokens` lists metadata without raw
tokens; `DELETE /api/tokens/<id>` revokes one. Token management requires an owner
browser session. Cron still uses `CRON_SECRET`; RSS, listen pages, and feed-token
audio remain separate public paths. No new environment variable is required.

```bash
curl -H "Authorization: Bearer $NEON_API_TOKEN" https://your-app.example/api/shows
```

## Generation limits

Generation is capped per user over a rolling 24 hours. Usage is the runs on shows
the user owns (`shows.user_id`, set when a show is created). An on-demand generate
checks the caller; the scheduler checks the show's owner. Approved owners are
unlimited, as are shows created before ownership was recorded. Everyone else gets
the caps from `app_settings`:

| Key | Default | Meaning |
|---|---|---|
| `gen_limit_episodes_per_day` | `5` | finished or in-flight runs per 24 h (`0` blocks generation) |
| `gen_limit_cost_cents_per_day` | `100` | summed `runs.cost_cents` per 24 h |

Over a cap, `POST /api/shows/<id>/generate` returns **429** with the reason, and
the scheduler marks that slot's run `skipped` (reason in `runs.error`) and moves
the show to its next slot. `GET /api/me/usage` returns the caller's usage and caps;
the dashboard shows it.

Owners edit both caps under **Settings → Generation limits**, which uses
`GET /api/limits` and `POST /api/limits {"episodes_per_day": 5, "cost_cents_per_day": 100}`
(non-negative integers; owner browser session only).

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

The Hobby plan dispatches scheduled episodes daily at 08:00 UTC. Per-minute
cron precision requires a Vercel Pro plan.

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
