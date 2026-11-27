# NEON Podcasts — Master Launch Plan

> **Updated 2026-11-27.** Every task from today through public launch of the web + native apps with NEON subscriptions. Written so agents (codex, opencode, Hermes snap/crackle/pop, omp) can execute without Claude online. Claude is the plan-keeper, not the builder.

> **How to use this:** pick a task, paste the whole block into a fresh agent thread, add: *"Repo is `user01-2-GitProject/neon-podcasts`, develop on your own branch, open a draft PR against main."* Tasks marked **JIMMY** need a human. Tasks marked **DECISION** are not build tasks — they need jimmy + Matt to agree first.

---

## What's done (merged to main)

MVP (#2–#9), token API, Phase 1 publishing/web player (#19–#21), steering/nudges (#22), community browse/follow (#24), native app v1 (#26, #28–#34), agent tokens (#37), live podcast text-only (#38–#39, #43–#44), generation limits (#40), lock-screen (#41), privacy/terms/account-deletion (#42), show artwork (#46), free voices + one-tap hosts (#77), 6-question wizard (#54–#60, #72–#76, #80–#81), NEON-official branding (#82–#85), daily Neon backup (#95), Sentry (#96), rate-limiting (#86), storage cleanup (#87), script QA (#100), worked examples (#101), TTS re-splice (#102), voice preview (#94), push scaffold (#99), UI redesign E1–E4 + E7 (#104, #107–#109), app store metadata (#91), expo-dev-client (#92), real icon/splash (#93), plain errors (#89), inactive show hiding (#88), episode-level badge (#98), regenerate episode (#97).

**107 commits, PRs #2–#109 merged. 16 migrations applied to prod through 016.**

---

## Phase 5 — Fact-check council + Qwen fine-tune

> Builds on existing `lib/fact-check.ts` (PR #112, draft) and `db/migrations/016_fact_check.sql`.

| # | Task | Agent | Depends on | JIMMY? |
|---|------|-------|-----------|--------|
| F1 | Apply migration 016 (`runs.fact_check` column) to prod | any | — | **YES** (prod migration OK) |
| F2 | Wire `runFactCheck()` into `generateEpisode` after `runScriptQa()` | codex or opencode | F1 | no |
| F4 | Tests for `lib/fact-check.ts` | snap or crackle | — | no |
| F5 | `POST /api/episodes/:id/fact-check` council endpoint | codex | F1 | no |
| F5b | `mergeAgentNotes()` + unanimous verdict logic | same as F5 | F5 | no |
| F5c | `GET /api/council/pending` for the leader to poll | same as F5 | F5 | no |
| F3 | Show fact-check notes + verdict + grade in UI | pop or opencode | F2 | no |
| F7 | Council leader script (`scripts/fact-check-council.mjs`) | **Claude** | F5, F5b, F5c | no |
| F8 | Council docs (`docs/fact-check-agents.md`) | **Claude** | F7 | no |
| F10 | Script grading and tagging | codex or snap | F5b | no |
| Q1 | Download + prepare training data (FEVER, LIAR) | codex or Hermes | — | no |
| Q2 | Generate synthetic podcast claims (2–5K) | Hermes (snap/crackle) | — | no |
| Q3 | Fine-tuning env + `train.py` (QLoRA, Qwen3.5-9B) | codex | Q1, Q2 | no |
| Q4 | Run training + evaluate (target >85% FEVER dev) | codex on GPU | Q3 | no (costs ~$2–5 if cloud GPU) |
| Q5 | Integrate Qwen into council as 4th voter | **Claude** | Q4, F7 | no |
| F9 | Manual "Fact-check with…" fallback buttons (low priority) | any | F5 | no |

**Full spec:** `/mnt/project-files/fact-check-council-plan.md`

---

## Phase 6 — Remaining launch readiness + UX polish

### 6A. Developer accounts & mobile auth (JIMMY)

| # | Task | Agent | JIMMY? |
|---|------|-------|--------|
| 6A1 | Run `eas init` in `mobile/`, paste the `projectId` into `eas.json` | — | **YES** |
| 6A2 | Create iOS Google OAuth client ID in Cloud Console, wire `EXPO_PUBLIC_IOS_GOOGLE_CLIENT_ID` + append to Vercel `GOOGLE_MOBILE_CLIENT_IDS` | any (after jimmy creates the client) | **YES** (console step) |
| 6A3 | Create Android Google OAuth client ID, wire `EXPO_PUBLIC_ANDROID_GOOGLE_CLIENT_ID` | any (after jimmy creates the client) | **YES** (console step) |
| 6A4 | Apple Developer Program ($99/yr) — enroll | — | **YES** |
| 6A5 | Google Play Console — individual ($25) or org. If org: start D-U-N-S request now (~1–2 weeks) | — | **YES** |
| 6A6 | First real EAS build: `eas build --profile preview --platform ios` → TestFlight on jimmy's iPhone | any (after 6A1–6A4) | no |

### 6B. UX polish (remaining from task list)

| # | Task | Agent | Depends on |
|---|------|-------|-----------|
| B5 | Voice preview on wizard review step (60-sec TTS clip) | opencode or pop | — |
| E5 | Cover-art stamp spec compliance (18% / 4% / q90) | snap or crackle | — |
| E6 | Login + wizard: brand pass (cream/navy/Didone) | opencode or pop | E1 (done) |

---

## Phase 7 — Live podcast: voice layer

> Text-only v1 is shipped. Voice comes after text proves out (jimmy's call, Nov 24).

| # | Task | Agent | Depends on | JIMMY? |
|---|------|-------|-----------|--------|
| 7.1 | Design doc: live voice architecture (local TTS of turns, latency budget, speaker queue) | **Claude** | — | no |
| 7.2 | `POST /api/live/:id/speak` → TTS → audio URL per turn | codex or omp | 7.1 | no |
| 7.3 | Web player: auto-play new turn audio, speaker indicator | opencode | 7.2 | no |
| 7.4 | Mobile: live audio playback (expo-audio stream) | opencode | 7.2 | no |
| 7.5 | Agent voice: agents pick a voice from free voices, TTS on speak | Hermes | 7.2 | no |

**Gate:** jimmy says "go" on live voice. Until then, skip this phase.

---

## Phase 8 — UI redesign completion

> E1–E4, E7 are merged. Remaining:

| # | Task | Agent | Depends on |
|---|------|-------|-----------|
| E5 | Cover-art stamp spec compliance | snap or crackle | — |
| E6 | Login + wizard brand pass | opencode or pop | E1 (done) |

---

## Phase 9 — Subscriptions & billing

> **DECISION NEEDED (jimmy + Matt):** pricing model, show caps, subscription tiers. These are NOT build tasks until decided.

### 9A. Decisions (jimmy + Matt must agree first)

| # | Decision | Current thinking | Status |
|---|----------|-----------------|--------|
| D1 | **Pricing model** | "Selling usage/change orders, not slots." Subscription is per show, pays for continued episode creation (~7 eps/week), includes ~3 content changes + maybe 1 free custom voice. Extra shows discounted. Stop paying = show stops generating. | **NOT DECIDED** — jimmy wants to talk to Matt |
| D2 | **Free tier** | 1 show + ~3 tweaks. Goal: one show a user loves. Promo credits as rewards. Subscription unlocks listening to everyone's shows. | **NOT DECIDED** |
| D3 | **Show cap per account** | Jimmy leaning 3–4 shows total per account (Nov 24). | **NOT DECIDED** — wants to talk to Matt |
| D4 | **Stock voices** | ~25 free voices (same cost). Already have 25 Edge + Kokoro merged. | Mostly decided |
| D5 | **Premium voice packs** | A revenue line; bundled with NEON subscription (investor-friendly). | Brainstorm only |

### 9B. Build tasks (after D1–D3 are decided)

| # | Task | Agent | Depends on | JIMMY? |
|---|------|-------|-----------|--------|
| 9B1 | Subscription data model: `subscriptions` table, tier enum, usage tracking | codex | D1, D2, D3 decided | migration needs jimmy OK |
| 9B2 | RevenueCat SDK integration (iOS + Android + web) | codex or opencode | 9B1, 6A4 (Apple account), 6A5 (Play account) | **YES** (RevenueCat account setup, Apple/Google IAP config) |
| 9B3 | Paywall UI: subscribe flow, tier selection, usage meter | opencode or pop | 9B2 | no |
| 9B4 | Enforce subscription limits: generation gated by tier, show count capped | codex | 9B1 | no |
| 9B5 | Stripe web checkout (RevenueCat handles this but needs Stripe account) | codex | 9B2 | **YES** (Stripe account) |
| 9B6 | Subscription management: cancel, upgrade, downgrade, usage dashboard | opencode | 9B3, 9B4 | no |
| 9B7 | Webhook handlers: RevenueCat → NEON (subscription created/renewed/cancelled/expired) | codex | 9B2 | no |

---

## Phase 10 — Video (post-launch patch)

> jimmy said video can be a post-launch patch (Nov 21). Low priority until everything else ships.

| # | Task | Agent | Depends on |
|---|------|-------|-----------|
| 10.1 | Video model: `episodes.video_url`, generation pipeline extension | codex | — |
| 10.2 | Video generation: script → video (approach TBD — could be audiogram, could be AI video) | TBD | 10.1 |
| 10.3 | Web video player (hls.js or native `<video>`) | opencode | 10.1 |
| 10.4 | Mobile video player (expo-video) | opencode | 10.1 |

---

## Phase 11 — Infrastructure hardening & app store submission

| # | Task | Agent | Depends on | JIMMY? |
|---|------|-------|-----------|--------|
| 11.1 | Flip audio default to R2/S3 (currently still Postgres fallback) + migrate existing audio | codex | — | no |
| 11.2 | Always-on hosting decision: Rig + tunnel vs hosted TTS vs both | — | — | **DECISION** |
| 11.3 | Set real daily caps in `app_settings` (gen_limit_episodes_per_day, gen_limit_cost_cents_per_day) | any | D1 decided | jimmy sets the numbers |
| 11.4 | Directory-ready RSS polish: itunes category/explicit/owner/author, language, stable guid, enclosure length+type | any | — | no |
| 11.5 | Submit RSS feeds to Apple Podcasts Connect + Spotify for Podcasters | — | 11.4 | **YES** (account setup) |
| 11.6 | App Store data-safety / privacy nutrition labels | any | 6A4 | no |
| 11.7 | Google Play data safety form | any | 6A5 | no |
| 11.8 | App Store review submission | — | 6A6, 11.6, 9B2 | **YES** |
| 11.9 | Google Play review submission (needs 20 testers × 14 days first if personal account) | — | 6A6, 11.7, 9B2 | **YES** |
| 11.10 | Load testing: simulate 50+ concurrent users generating episodes | codex | 11.1 | no |
| 11.11 | CDN + caching: Cloudflare in front of audio/image assets | codex | 11.1 | no |
| 11.12 | Automated database backups verification (daily Neon backup to R2 is merged; verify restore works) | any | — | no |

---

## Phase 12 — Launch checklist

| # | Step | Who |
|---|------|-----|
| 12.1 | All F-series + Q-series fact-check tasks merged and running | agents |
| 12.2 | E5 + E6 brand pass complete | agents |
| 12.3 | jimmy + Matt decide D1–D3 (pricing, free tier, show cap) | **JIMMY + MATT** |
| 12.4 | Subscriptions built and tested (9B series) | agents + jimmy |
| 12.5 | Real EAS build on TestFlight + Play internal track | agents + jimmy |
| 12.6 | RSS feeds submitted to Apple Podcasts + Spotify | **JIMMY** |
| 12.7 | App store submissions approved | **JIMMY** |
| 12.8 | Flip audio default to R2/S3, verify CDN | agents |
| 12.9 | Set real usage caps | **JIMMY** |
| 12.10 | Load test passes | agents |
| 12.11 | Final smoke test: create show → schedule → generate → listen on phone + web | **JIMMY** |
| 12.12 | 🚀 **Public launch** | **JIMMY** |

---

## Critical path (what gates what)

```
TODAY
  │
  ├─ Phase 5: Fact-check (F1–F10, Q1–Q5) ──────────────── runs in parallel
  ├─ Phase 6A: Dev accounts (JIMMY: eas init, OAuth, Apple/Play) ─┐
  ├─ Phase 6B + 8: UX polish (B5, E5, E6) ──────────────────────┤
  │                                                               │
  │  ┌────────── D1–D3 DECISIONS (jimmy + Matt) ──────────────────┤
  │  │                                                             │
  │  ▼                                                             ▼
  │  Phase 9: Subscriptions (after decisions) ──── Phase 11: Infra + store submission
  │                                                             │
  │  Phase 7: Live voice (after jimmy says go) ─── optional ────┤
  │  Phase 10: Video (post-launch) ─────────────── optional ────┤
  │                                                             │
  │                                                             ▼
  └──────────────────────────────────────── Phase 12: LAUNCH 🚀
```

**The two longest poles:**
1. **Apple Developer enrollment + D-U-N-S** (1–2 weeks for D-U-N-S, then Apple review ~days). Start 6A4 + 6A5 NOW.
2. **Pricing decisions (D1–D3)** gate all subscription work. The sooner jimmy + Matt agree, the sooner agents can build Phase 9.

Everything else can run in parallel across agents today.

---

## Agent assignment suggestion

| Agent | Best at | Suggested tasks |
|-------|---------|----------------|
| **codex** | Backend, APIs, migrations, training | F2, F5/F5b/F5c, 9B1–9B7, Q3–Q4, 11.1, 11.10 |
| **opencode** | UI, frontend, mobile | F3, B5, E5, E6, 7.3–7.4, 9B3, 9B6, 10.3–10.4 |
| **omp (Claude on Rig)** | Backend, review, complex logic | F2 (alt), 7.2, review PRs |
| **snap** | Tests, data prep, small tasks | F4, F10, Q1, E5, 11.12 |
| **crackle** | Data generation, small tasks | Q2, E5 (alt) |
| **pop** | UI polish | F3 (alt), B5, E6, 9B3 |
| **Claude (cloud)** | Plans, council script, reviews | F7, F8, Q5, 7.1, this plan, PR reviews |
| **jimmy** | Accounts, money, decisions, prod migrations | 6A1–6A5, D1–D5, F1 approval, 9B2/9B5 setup, 11.5, 11.8–11.9, 12.11–12.12 |

---

## Jimmy's personal to-do list (can't be delegated)

1. **NOW:** Start Apple Developer enrollment (6A4) + D-U-N-S if going org on Play (6A5) — these are the slowest steps
2. **NOW:** Run `eas init` in `mobile/` and paste the projectId (6A1)
3. **NOW:** Create iOS + Android OAuth client IDs in Google Cloud Console (6A2, 6A3)
4. **SOON:** Talk to Matt about pricing (D1), free tier (D2), show cap (D3)
5. **WHEN READY:** Approve fact-check migration 016 to prod (F1)
6. **WHEN BUILT:** Set up RevenueCat + Stripe accounts (9B2, 9B5)
7. **WHEN BUILT:** Submit RSS feeds to Apple/Spotify (11.5)
8. **WHEN BUILT:** Submit apps to App Store + Play (11.8, 11.9)
9. **LAUNCH DAY:** Final smoke test + go live (12.11, 12.12)
