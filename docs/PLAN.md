# NEON Podcasts — Build Plan

> **TL;DR** — A web app where a user defines a "show" (topics/prompt + voice + schedule), and the system automatically generates episodes on that schedule: an LLM writes the script, a hosted text-to-speech (TTS) service turns it into audio, the file lands in object storage, and an RSS feed + web player serve it. We lean on managed services (hosted TTS, managed Postgres, a managed cron) so there's very little infrastructure to run. Recommended default stack: **Next.js on Vercel + Neon Postgres + Vercel Cron + Claude API + a hosted TTS provider + object storage (R2/S3)**.

---

## 1. Product scope

### Core user story
> As a user, I give the app a topic or prompt and a cadence (e.g. "AI news, every weekday at 7am"), and it produces a fresh audio episode on that schedule that I can listen to and subscribe to in any podcast app.

### MVP (v1) — ship this first
- Create/edit a **Show**: title, description, prompt/topics, voice, cadence (daily/weekly + time), length target.
- **Scheduled generation**: on cadence, generate one episode = script → audio → stored → published.
- **Listen**: web page listing episodes with an inline audio player.
- **Subscribe**: a valid podcast **RSS feed** per show (works in Apple/Spotify/Overcast).
- **Run history/status**: see each generation run (queued / running / done / failed) and basic cost/length.
- Single user (the owner) to start; auth-gated.

### Explicitly out of scope for MVP (v2+)
- Multi-voice / dialogue between hosts, music beds, ad insertion.
- Pulling fresh source material (news/RSS/web search) into the prompt — v2.
- Multi-tenant SaaS, billing, public directory.
- Mobile app (the web player + standard RSS already covers phones).

### Open questions that change scope (please confirm)
1. **Single-user (just you) or multi-user from the start?** Default assumption: single-user MVP, built so multi-user is a later step.
2. **Web only, or do you want a native mobile app?** Default assumption: web app; subscribing via RSS covers mobile listening without a separate app.
3. **Should episodes stay private (login to listen) or be publicly subscribable via RSS?** Default assumption: unlisted RSS (hard-to-guess URL), toggle to public later.

---

## 2. Architecture

```
                 ┌──────────────┐
   Scheduler ───▶│  Generate    │   (one run = one episode)
  (managed cron) │  Episode job │
                 └──────┬───────┘
                        │ 1. LLM writes script  ── Claude API
                        │ 2. TTS renders audio  ── hosted TTS
                        │ 3. upload mp3         ── object storage (R2/S3)
                        │ 4. write row          ── Neon Postgres
                        ▼
   ┌─────────────┐   ┌──────────────┐   ┌─────────────┐
   │ Web app /   │──▶│ Neon Postgres│   │ RSS feed    │──▶ podcast apps
   │ dashboard   │   │ (shows,      │   │ /feed/:show │
   │ (Next.js)   │   │  episodes,   │   └─────────────┘
   └─────────────┘   │  runs)       │
                     └──────────────┘
```

### Components
| Component | Job | Default choice | Could be handed to an external service? |
|---|---|---|---|
| Web app + API | Dashboard, show config, player, RSS endpoint | **Next.js on Vercel** | Hosted (Vercel) |
| Scheduler | Fire a job per show on its cadence | **Vercel Cron** (1 cron hits a dispatcher that finds due shows) | ✅ Fully managed (Vercel Cron, or Neon scheduled triggers, or GitHub Actions `schedule`) |
| Script generation | Turn prompt → episode script | **Claude API** (`claude-sonnet-5-5` for drafts) | ✅ Managed API |
| Text-to-speech | Script → narrated mp3 | **Hosted TTS** (ElevenLabs / OpenAI TTS / Play.ht / Google) | ✅ Fully managed API — no model hosting |
| Audio storage | Store/serve mp3 files | **Cloudflare R2** or **S3** (Neon storage buckets also an option) | ✅ Managed object storage |
| Database | Shows, episodes, run log | **Neon Postgres** (serverless) | ✅ Managed |
| Auth | Protect the dashboard | **Neon Auth** or Clerk/Auth.js | ✅ Managed |
| RSS feed | Standards-compliant podcast XML | App route that renders from DB | — (thin code) |

### Why these defaults
- **Cheap + simple:** every heavy piece (LLM, TTS, DB, cron, storage, auth) is a managed service with a free/low tier, so there are no servers or GPUs to run — matches the "delegate outside where possible" goal.
- **Neon Postgres** fits the repo name and gives serverless Postgres with scheduled triggers and storage buckets if we want to consolidate.
- **Standard RSS** means no custom mobile app is needed for listening.

### Generation job flow (the core of the app)
1. Dispatcher (cron) queries shows whose `next_run_at <= now()`, enqueues a run per show.
2. For each run: build prompt from the show config → **Claude** returns a structured script (intro, segments, outro).
3. Send script to **TTS** → receive audio; stitch segments if needed.
4. Upload mp3 to object storage; capture duration + byte size (needed for valid RSS `enclosure`).
5. Insert `episode` row (status `published`), update show `next_run_at`.
6. On error: mark run `failed`, store the error, surface in dashboard; retry with backoff.

Make the job **idempotent** (one episode per show per scheduled slot) so a retry or double-fire never double-publishes.

---

## 3. Data model (first cut)

```sql
users        (id, email, created_at)

shows        (id, user_id, title, description, prompt, voice_id,
              cadence,            -- e.g. 'daily' | 'weekly'
              schedule_time,      -- local time-of-day
              timezone,
              target_minutes,
              rss_token,          -- unlisted feed URL
              next_run_at, is_active, created_at)

episodes     (id, show_id, title, script, audio_url,
              duration_seconds, byte_size, status,  -- draft|published|failed
              scheduled_for, published_at, created_at)

runs         (id, show_id, episode_id, status,      -- queued|running|done|failed
              model, tts_provider, cost_cents, error, started_at, finished_at)
```

---

## 4. Phased milestones (small, shippable tasks)

> Tasks marked **[external]** are handled by a managed service / another tool rather than custom code we maintain.

### Phase 0 — Foundations
- [ ] Scaffold Next.js app, lint/format, deploy to Vercel **[external: Vercel]**
- [ ] Provision Neon Postgres + connection string **[external: Neon]**
- [ ] Add schema + migrations (`shows`, `episodes`, `runs`, `users`)
- [ ] Add auth **[external: Neon Auth / Clerk]**

### Phase 1 — Create & store a show
- [ ] Show CRUD UI + API (prompt, voice, cadence, timezone)
- [ ] Compute and persist `next_run_at` from cadence + timezone

### Phase 2 — Generate one episode on demand
- [ ] "Generate now" button → script via **Claude** **[external: Claude API]**
- [ ] Script → audio via **hosted TTS** **[external: TTS provider]**
- [ ] Upload mp3 to **object storage**, capture duration/size **[external: R2/S3]**
- [ ] Persist `episode` + `run`; show status + player in UI

### Phase 3 — Put it on a schedule
- [ ] Cron dispatcher that finds due shows **[external: Vercel Cron / Neon triggers]**
- [ ] Idempotency guard (one episode per scheduled slot) + retry/backoff
- [ ] Run history view

### Phase 4 — Subscribe
- [ ] RSS feed endpoint per show (valid podcast XML, `enclosure`, iTunes tags)
- [ ] Validate in a real podcast app (Apple/Spotify)

### Phase 5 — Polish (v2 candidates)
- [ ] Fresh source material into prompts (web search / news) **[external: search API]**
- [ ] Multi-voice / dialogue, intro music
- [ ] Multi-user, billing, public directory

---

## 5. First concrete step
Phase 0 + a thin Phase 2 "generate one episode on demand" is the fastest path to something real: one show, one button, one playable episode — before wiring the scheduler. Everything expensive is a managed API, so the running cost until there are real listeners is near zero.
