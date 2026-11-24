# NEON Podcasts — Native App & Product Roadmap

> **TL;DR** — The MVP web app works: create multiple shows, upload `.md` briefings, and generate a well-crafted script (and, with a voice server running, a cloned-voice mp3) through OpenRouter, running on the Rig against Neon. The MVP is **done**: scheduled unattended generation, RSS feeds, a public listen page + web player, CI, and an installable PWA are all shipped and merged to main (PRs #5–#9). This plan is the product layer on top of that: it turns NEON from a personal generator into a product (native app, publishing, subscriptions). **Current phase: foundation** — real accounts with owner/member roles over shared data, and audio → object storage. **The order matters** — two foundations (always-on hosting + real user accounts) unlock publishing, subscriptions and the native app, while the in-app players and "nudge" controls can land earlier as self-contained wins.

> **Roadmap source:** [NEON Podcasts — Native App & Product Roadmap](https://claude.ai/artifact/E88xUEPnJFzXFxFnvehpcC) (Claude Doc). This file mirrors it. The original single-user MVP build plan is preserved below under [§9 MVP build plan (shipped)](#9-mvp-build-plan-shipped).

---

## Status (2026-11-24, late)
- **MVP shipped** — PR #2 (merged): multiple shows, `.md` briefing upload, OpenRouter script generation, `local`/`external` narration modes, in-app Settings for the OpenRouter key. PR #3 (globals.css, cost-log bug fix, delete-show) also merged.
- **Also shipped and merged to main** — PRs #5–#9: scheduler (cron dispatcher, retries, run history), per-show RSS feeds, public listen page + web player, CI, and the installable PWA. The scheduler is live; generation is no longer manual-only.
- **Foundation + Phase 1 shipped ✅** — the token-based API, plus Phase 1 publishing + web player: an HTTP Range streaming audio player (#19), owner-only draft/Publish/Unpublish controls (#20), and the Apple/Spotify feed hint (#21), all merged to main.
- **Phase 2 — Steering shipped ✅** — a per-show style guide injected into the script prompt, and a per-show pronunciation lexicon applied right before TTS, surfaced in a Steering panel on the show page (PR #22, migration 006). Still open in this area: the learn-from-your-edits loop and ElevenLabs-grade pronunciation control.
- **In-app community shipped ✅** — signed-in users can **Browse** shows with published episodes, **Follow** them, and read a **Following** feed of their latest episodes (PR #24, migration 007).
- **Phase 3 — Native app: v1 built ✅ (#26, #28–#32).** Scope doc: [Native App (Phase 3) Scope](https://claude.ai/artifact/LJH9PkypBj5nFL4iJ1v1eA). Expo app in `mobile/` with Google sign-in → per-user NEON token ✅, Following / Browse / show pages + follow ✅, background audio ✅, offline downloads ✅, EAS build config ✅. Web side: Devices & tokens page + Google-only login ✅; deleting shows/episodes now removes object-storage audio ✅. **Left before TestFlight:** Google iOS/Android OAuth client IDs, an Apple Developer account (jimmy has an iPhone but not the $99 program yet — **Expo Go is the interim test path**), real icon art, and push.
- **Live podcast v1 shipped ✅ (#37–#39, #43–#44).** Live sessions with participants + turns: the API (#38), a web `/live` UI (#39), a mobile Live tab (#44), self-service **agent tokens** so outside user-agents can join as members (#37), and an **agent join kit** — `docs/live-agents.md` + `scripts/live-agent-example.mjs` (#43). Text-first; **voice is a deliberate follow-on** once the text version is proven. Migration 008 applied to prod.
- **Launch-list items shipped ✅ (#40–#42).** Per-user **generation limits** / cost guardrails (owners unlimited, members/agents capped per day, 429 + dashboard usage meter) (#40); **mobile lock-screen Now Playing** controls via expo-audio — title/show + play/pause/seek, works in Expo Go, no react-native-track-player needed (#41); **privacy + terms pages** and self-service **account deletion** (web + mobile, agent tokens blocked, owner-safe) (#42).
- **In review / in flight:** show artwork end-to-end, directory-ready RSS (Apple/Spotify), and mobile store-readiness polish.
- 👉 **See [Path to launch](./PATH-TO-LAUNCH.md)** for the full pre-launch checklist (accounts, OAuth, EAS/branding, legal, infra).

---

## 1. Where you are today
A working web app: create multiple shows, upload `.md` briefings, and generate a well-crafted script — and, with a voice server running, a cloned-voice mp3 — through OpenRouter. It runs on the Rig against a Neon database. The original MVP goal is complete, including the **scheduler** (set a time and it generates unattended), per-show RSS feeds, and a public listen page with web player. Everything below is the product layer that sits on top of that.

---

## 2. Build the foundation first
Three unglamorous changes underpin almost everything on the wishlist. Publishing, subscriptions, the players and the native app all sit on these, so they come before the flashy work.

1. **Real accounts.** Replace the shared password with email identity and owner/member roles. All shows and data remain shared; members can read, owners can manage them. The existing `shows.user_id` is not used for tenant scoping.
2. **Move audio out of Postgres.** Audio is stored as rows in the database today — fine for a demo, wrong for real playback. Move files to object storage + CDN (Cloudflare R2 or S3) and store a URL. This is what makes streaming, scrubbing and video possible at all: they need HTTP range requests, which a CDN gives you for free.
3. **A token-based API. ✅** The existing JSON route handlers accept revocable bearer tokens with read-only or read+write scope. Owners mint and revoke tokens through session-authenticated `/api/tokens` routes. Native clients can use these without browser cookies.

---

## 3. The 7 features, mapped

| Feature | What it means | Effort | Depends on | Phase |
|---|---|---|---|---|
| **Publish in the app** | A listener surface: browse/subscribe to shows, episode lists, published vs draft. Keep RSS too (`rss_token` already exists) so external podcast apps work. | Medium | Accounts, media on CDN | 1 ✅ (web publish + community browse/follow shipped) |
| **Audio player** | Real play/pause/scrub/speed/queue, streaming from the CDN. | Low–Medium | Media on CDN | 1 ✅ |
| **Nudges / pronunciation** | Per-show lexicon ("zero"→"oh") applied before TTS, plus an editable show style guide injected into every prompt and a learn-from-your-edits loop. | Medium–High | Generation pipeline (have it); ElevenLabs for real pronunciation control | 2 ✅ (style guide + lexicon shipped; learn-from-edits still to do) |
| **Native app** | One iOS + Android codebase (React Native / Expo) reusing your API and types. | High | Token API | 3 |
| **Video player** | Extend the media model to video (mp4 / HLS on CDN); player via expo-video (native) / hls.js (web). | Medium–High | Media on CDN, native app | 4 |
| **Take users** | Sign-up, per-user shows, usage limits before you open the doors. | Medium | Accounts | 1–2 |
| **Subscriptions** | Paid tiers. Apple/Google require their in-app purchase for digital subs (15–30% cut) — not raw Stripe in-app. RevenueCat unifies Apple + Google + Stripe (web). | High | Accounts, native app, billing | 4 |

---

## 4. A suggested sequence
The order is driven by dependencies, not by what's most fun.

1. **MVP ✅** — scheduler, RSS feeds, listen page/web player, CI and PWA shipped in PRs #5–#9.
2. **Foundation (current phase)** — real accounts with shared-data roles, audio → object storage, plus the token API ✅. The single biggest lift, but everything rides on it.
3. **Phase 1 — Publishing + web audio player. ✅** Shipped (#19–#21): streaming web player, owner publish controls, feed hint.
4. **Phase 2 — Steering / nudges. ✅** Style guide + per-show pronunciation lexicon shipped (#22). Can run in parallel with native work once the API is stable.
5. **Phase 3 — Native app (Expo). ✅ v1 built** (auth, browse/follow, playback, downloads, EAS config); store submission pending accounts + OAuth client IDs. Real native audio: background playback + lock-screen controls — a genuine reason to go native rather than wrap the web app.
6. **Phase 4 — Video + subscriptions.** Billing comes last; it carries the most compliance baggage.

Foundation + Phase 1 is the heavy lift; Phases 2 and 3 can overlap afterward.

---

## 5. Native app: the path
Your current Next.js + Neon app becomes the **backend/API and the web client**; the native app is a second client on the same API.

- **Interim: PWA (shipped, PR #9).** The web app is installable on the home screen — a bridge while the real native app is built.
- **Real native: React Native (Expo).** One codebase for iOS and Android, reusing your TypeScript types and the same JSON API. The payoff over a web wrapper is native audio: `react-native-track-player` gives background playback and lock-screen controls.
- **What carries over:** the whole backend — Neon, the generation pipeline, the API routes, your types. You're adding a client, not rebuilding the engine.

---

## 6. Open decisions (you + Matt)
A few calls shape everything downstream:

- **Who subscribes to what?** Users subscribing to *NEON* (simpler — start here) vs. listeners subscribing to *creators* (a marketplace — much more complex).
- **Voice engine for real control.** Serious pronunciation and "nudge" control points toward **ElevenLabs** (pronunciation dictionaries); your local cloned voices are cheaper but harder to steer. You may end up offering both.
- **Auth provider.** Clerk vs. Neon Auth (both do web + React Native) — pick once, since it touches every screen.
- **Hosting home.** Your cloned-voice server can't live on Vercel's cloud; decide whether the product runs on your always-on box (with a tunnel) or you move voice to a hosted engine.
- **Cost guardrails.** Every generation costs LLM + TTS tokens — add per-user usage limits before you take users.

---

## 7. Decisions so far (Nov 21)
- **Subscribe to NEON**, not a creator marketplace — start simple.
- **Nudges = editorial first** (steer the show's direction); voice-nudge is a welcome bonus.
- **Premium voices / voice packs = a revenue line**, bundled with the NEON subscription (investor-friendly).
- **Auth leaning Neon Auth** (keep user rows in your own Neon DB); confirm its React Native SDK before committing.
- **Video = post-launch patch** (already Phase 4) — safe to defer if it's too big at launch.

---

## 8. Data model
The MVP schema already carries most of the product's needs; the foundation work adds auth scoping and swaps audio bytes for storage URLs.

```sql
users         (id, email, created_at)              -- real multi-user: foundation step 1

shows         (id, user_id, title, description, voice_id,
               cadence, schedule_time, timezone, target_minutes,
               narration_mode,                      -- auto (app renders TTS) | external (script only, upload mp3)
               style_guide,                         -- Phase 2: free-text steering injected into the script prompt
               rss_token, is_public, next_run_at, is_active, created_at)

show_briefings(id, show_id, filename, content_md,  -- or storage_url for large files
               is_active, uploaded_at)             -- multiple .md docs per show

show_pronunciations(id, show_id, term, say_as,      -- Phase 2: lexicon applied to narration before TTS
               match_mode)                          -- word | substring

subscriptions (id, subscriber_email, show_id,       -- community: a signed-in user follows a show
               created_at)                          -- unique (subscriber_email, show_id)

episodes      (id, show_id, title, script, show_notes, audio_url,
               duration_seconds, byte_size, status, -- draft|published|failed
               scheduled_for, published_at, created_at)

runs          (id, show_id, episode_id, status,     -- queued|running|done|failed
               briefing_snapshot, model, tts_provider, cost_cents,
               error, started_at, finished_at)

-- Foundation step 2 moves audio bytes to object storage + CDN; episodes.audio_url holds the URL.
-- Later: publications (id, episode_id, platform, status, external_url, error, published_at)
```

`runs.briefing_snapshot` records exactly which briefing text produced each episode, so output stays traceable when you edit the `.md` later.

---

## 9. MVP build plan (shipped)
> Kept for reference — this was the original single-user MVP, now shipped: PR #2 built the core, and PRs #5 and #6 added the scheduler (Phase 3) and public RSS (Phase 4). The MVP is done.

### Confirmed scope (jimmy, 2026-11-20)
- **Single user** to start; built so multi-user is a later step (now the foundation above).
- **Web only** for the MVP.
- **Multiple shows**, each independently configured and scheduled.
- **`.md` briefing docs per show:** the generator reads the show's current briefing(s) before creating each episode.
- **Publishing:** manual export is acceptable for the MVP — a downloadable mp3 + show notes; plus a public RSS feed per show. Automated direct-upload integrations are a later phase.
- **Billing:** script generation via API (Anthropic or OpenRouter — a consumer Claude.ai subscription can't drive an automated backend). TTS can reuse an existing provider subscription with API access; the user is leaning on **local cloned voices** almost exclusively.

### Phases (MVP)
- **Phase 0 — Foundations:** scaffold Next.js on Vercel, provision Neon, schema + migrations, single-user auth gate. ✅
- **Phase 1 — Shows & briefings:** show CRUD, `.md` upload/replace, compute `next_run_at`. ✅
- **Phase 2 — Generate one episode on demand:** read briefing → script (Claude/OpenRouter) → audio (hosted or local TTS) → store + download; `auto` / `external` (Muse script-only) narration modes. ✅
- **Phase 3 — Schedule:** cron dispatcher finds due shows, idempotency guard + retry/backoff, run history. ✅ (PR #5)
- **Phase 4 — Public RSS:** valid podcast XML per show ✅ (PR #6); submitting feeds to Apple/Spotify is an external step.

The product roadmap in §1–§7 picks up from the end of this MVP.
