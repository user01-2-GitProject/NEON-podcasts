# NEON Podcasts — Build Plan

> **TL;DR** — A web app (just you to start) where you run **multiple shows**. Each show has one or more **`.md` briefing docs** you upload; before every episode the app **reads the current briefing(s)**, an LLM writes the script, a hosted text-to-speech (TTS) service renders audio, and you get a finished **downloadable episode file (mp3 + show notes)** to upload to each platform yourself. A public **RSS feed** per show is also generated so most apps (Apple/Spotify/Overcast) can pull episodes automatically; automated pushes to platforms that need a direct upload come later. We lean on managed services so there's almost nothing to run. Default stack: **Next.js on Vercel + Neon Postgres + Vercel Cron + Claude API + a hosted TTS provider + object storage (R2/S3)**.

---

## Scope decisions (confirmed with jimmy, 2026-11-20)
- **Single user** (just you) to start — build so multi-user is a later step, no login complexity beyond protecting your own dashboard.
- **Web only** for now.
- **Multiple shows**, each independently configured and scheduled.
- **`.md` briefing docs per show:** you upload Markdown "paperwork" to a show; the generator **reads the show's current briefing(s) before creating each episode** and uses them as the source material for the script.
- **Publishing:** **manual upload is acceptable** — the app's job is to produce a finished, downloadable episode file (mp3 + show notes) per show; you carry it to each platform. A public **RSS feed** per show is generated too (the universal way Apple/Spotify/Overcast auto-ingest), so that path is automatic where it works. **Automated direct-upload integrations are a later phase, not MVP.**
- **Billing:** default to the **Anthropic API** for script generation. *Using an existing Claude.ai subscription instead isn't viable for an automated backend — consumer subscriptions can't drive scheduled server-side generation; that needs the API.* For **TTS**, if you already pay for a provider (e.g. ElevenLabs/OpenAI), its API key can reuse that plan's quota, so an existing subscription **can** save money there. Net: Claude = API; TTS = reuse a subscription you have if it offers API access.

---

## 1. Product scope

### Core user story
> I create one or more shows. For each, I upload Markdown briefing docs and set a cadence. On schedule, the app reads the briefing, writes a script, narrates it, and gives me a finished episode file to download — and an RSS feed so apps can auto-pull it.

### MVP (v1)
- Manage **multiple shows**: title, description, voice, cadence (daily/weekly + time), length target.
- **Upload/replace `.md` briefings** per show (one or many).
- **Scheduled generation** per show: read briefing(s) → script → audio → stored.
- **Download the finished episode** (mp3 + show notes) for manual upload to any platform.
- **Public RSS feed** per show (valid for Apple/Spotify/Overcast auto-ingest).
- **Listen**: web page per show with episode list + inline player.
- **Run history/status**: queued / running / done / failed, with length + cost.

### Out of scope for MVP (v2+)
- **Automated direct-upload** to platforms (YouTube, etc.) — manual export covers v1.
- Multi-user / teams, billing, public directory.
- Multi-voice/dialogue, music beds, ad insertion.
- Native mobile app (web + RSS covers phones).
- Auto-pulling fresh web/news material into briefings (briefings are user-supplied in v1).

---

## 2. Architecture

```
                 ┌──────────────┐
   Scheduler ───▶│  Generate    │   (one run = one episode, per show)
  (managed cron) │  Episode job │
                 └──────┬───────┘
                        │ 0. read show's current .md briefing(s)
                        │ 1. LLM writes script  ── Claude API
                        │ 2. TTS renders audio  ── hosted TTS
                        │ 3. upload mp3         ── object storage (R2/S3)
                        │ 4. write episode row  ── Neon Postgres
                        ▼
   ┌─────────────┐   ┌──────────────┐   ┌─────────────┐
   │ Web app /   │──▶│ Neon Postgres│   │ RSS feed    │──▶ Apple / Spotify /
   │ dashboard   │   │ shows,       │   │ /feed/:show │    Overcast (auto-pull)
   │ upload .md  │   │ briefings,   │   └─────────────┘
   │ + download  │   │ episodes,    │   ┌─────────────┐
   │   episode   │   │ runs         │   │ Download     │──▶ you → manual
   └─────────────┘   └──────────────┘   │ mp3 + notes  │    upload anywhere
                                        └─────────────┘
```

### Components
| Component | Job | Default choice | Managed / external? |
|---|---|---|---|
| Web app + API | Dashboard, show config, `.md` upload, player, download, RSS | **Next.js on Vercel** | ✅ Hosted |
| Scheduler | Fire a job per due show | **Vercel Cron** (dispatcher finds due shows) | ✅ Managed |
| Briefing store | Hold uploaded `.md` per show | Neon (small) or object storage (large) | ✅ Managed |
| Script generation | Briefing + prompt → script | **Claude API** (`claude-sonnet-5-5`) | ✅ Managed API |
| Text-to-speech | Script → mp3 | **Hosted TTS** (ElevenLabs / OpenAI / Play.ht) | ✅ Managed; reuse your plan's API key |
| Audio storage | Store/serve/download mp3 | **Cloudflare R2** or **S3** | ✅ Managed |
| Publishing | Downloadable file + public RSS | Download route + RSS route | — (thin code) |
| Auth | Protect your dashboard | **Neon Auth** / Auth.js | ✅ Managed |

### Publishing — how it works (MVP)
- **Each episode is a downloadable file** (mp3 + generated show-notes/description) straight from the dashboard. You manually upload it to whichever platforms you like — acceptable for v1, no integrations needed.
- **A public RSS feed per show is generated in parallel.** Submit that feed URL once to each directory (Apple Podcasts Connect, Spotify for Podcasters, etc.) and they auto-pull every new episode — so the common platforms are hands-off even in MVP.
- **Automated direct-upload integrations** (e.g. YouTube, or any platform that won't ingest RSS) are a **later phase** via their APIs, tracked per episode. **[external: platform APIs]**

### Generation job flow
0. Load the show's **current `.md` briefing(s)**.
1. Build the prompt (show config + briefing) → **Claude** returns a structured script (intro, segments, outro).
2. Script → **TTS** → mp3.
3. Upload mp3; capture duration + byte size (needed for valid RSS `enclosure`); generate show notes.
4. Insert `episode` (status `published`); update show `next_run_at`. Episode is now downloadable and in the RSS feed.
5. On error: mark run `failed`, store the error, surface it, retry with backoff.

Make the job **idempotent** (one episode per show per scheduled slot) so a retry never double-publishes.

---

## 3. Data model (first cut)

```sql
users         (id, email, created_at)              -- just you for now

shows         (id, user_id, title, description, voice_id,
               cadence, schedule_time, timezone, target_minutes,
               rss_token, is_public, next_run_at, is_active, created_at)

show_briefings(id, show_id, filename, content_md,  -- or storage_url for large files
               is_active, uploaded_at)             -- multiple .md docs per show

episodes      (id, show_id, title, script, show_notes, audio_url,
               duration_seconds, byte_size, status, -- draft|published|failed
               scheduled_for, published_at, created_at)

runs          (id, show_id, episode_id, status,     -- queued|running|done|failed
               briefing_snapshot, model, tts_provider, cost_cents,
               error, started_at, finished_at)

-- Later phase, when automated platform pushes are added:
-- publications (id, episode_id, platform, status, external_url, error, published_at)
```

`runs.briefing_snapshot` records exactly which briefing text produced each episode, so output stays traceable when you edit the `.md` later.

---

## 4. Phased milestones (small, shippable tasks)

> **[external]** = handled by a managed service, not code we maintain.

### Phase 0 — Foundations
- [ ] Scaffold Next.js, deploy to Vercel **[external: Vercel]**
- [ ] Provision Neon Postgres **[external: Neon]**
- [ ] Schema + migrations (`shows`, `show_briefings`, `episodes`, `runs`)
- [ ] Single-user auth gate **[external: Neon Auth]**

### Phase 1 — Shows & briefings
- [ ] Show CRUD (prompt, voice, cadence, timezone)
- [ ] **Upload / replace `.md` briefings** per show; list + activate/deactivate
- [ ] Compute `next_run_at` from cadence + timezone

### Phase 2 — Generate one episode on demand
- [ ] "Generate now" → read active briefing(s) → script via **Claude** **[external: Claude API]**
- [ ] Script → audio via **hosted TTS** **[external: TTS]**
- [ ] Upload mp3 to storage, capture duration/size, generate show notes **[external: R2/S3]**
- [ ] Persist `episode` + `run` (with briefing snapshot); player + **download button** in UI

### Phase 3 — Schedule
- [ ] Cron dispatcher finds due shows **[external: Vercel Cron]**
- [ ] Idempotency guard + retry/backoff
- [ ] Run history view

### Phase 4 — Public RSS
- [ ] Public RSS feed per show (valid podcast XML, `enclosure`, iTunes tags)
- [ ] Submit feeds to Apple/Spotify; validate in a real app

### Phase 5 — v2 candidates
- [ ] **Automated direct-upload** integrations (YouTube, etc.) **[external: platform APIs]**
- [ ] Auto-pull fresh source material into briefings **[external: search/news API]**
- [ ] Multi-voice/dialogue, intro music; multi-user

---

## 5. First concrete step
Phase 0 + Phase 1 briefing upload + a thin Phase 2 "generate one episode on demand" is the fastest path to something real: one show, one uploaded `.md`, one downloadable playable episode — before wiring the scheduler or RSS. Everything expensive is a managed API, so running cost until you have listeners is near zero.
