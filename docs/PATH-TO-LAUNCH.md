# NEON — Path to launch

A concrete checklist of what's left between "works on jimmy's phone in Expo Go" and "strangers can download it and pay for it." Grouped by area, in rough dependency order. Status reflects what's merged to `main` as of 2026-11-24.

> **TL;DR** — the product is feature-rich and testable in Expo Go today. The gaps to a public launch are mostly **accounts/paperwork, store-readiness, and always-on hosting** — not core features.

## 1. Developer accounts & identity
- [ ] **Apple Developer Program** ($99/yr) — required for TestFlight + App Store. jimmy has an iPhone but **not** the paid program yet. *Interim: Expo Go needs none.*
- [ ] **Google Play Console** — individual ($25) vs **organization**. jimmy has an **LLC**, so the org route is available but needs a **D-U-N-S number** (free from Dun & Bradstreet, ~1–2 weeks). Decide individual vs LLC; if LLC, **start the D-U-N-S request now** (it's the slow part). Only needed at Android publish time.
- [ ] **Expo account** — free tier builds fine; paid only for more build concurrency.
- Note: a new **personal** Play account also needs identity verification + a "20 testers for 14 days" closed test before production.

## 2. Google Sign-In (auth) — mostly free, needed to test on a phone
- [ ] **Google Cloud project** → OAuth consent screen + **3 OAuth client IDs** (iOS, Android, Web). Free; account type doesn't matter.
- [ ] Wire them up: `EXPO_PUBLIC_GOOGLE_*` in the mobile app (iOS/Android client IDs); the **Web** client id is the backend's `GOOGLE_CLIENT_ID`.
- [ ] Set **`GOOGLE_MOBILE_CLIENT_IDS`** (comma-separated iOS/Android ids) on the web app, or native sign-in 401s on audience mismatch. *(The `/api/auth/mobile` token exchange already accepts this set — shipped in #28.)*

## 3. Mobile build & release
- [x] **Background audio + offline downloads** — shipped.
- [x] **Lock-screen Now Playing** (title/show, play/pause/seek) via expo-audio, Expo Go compatible — shipped (#41).
- [x] **EAS build config** (`eas.json` dev/preview/production + submit) — shipped.
- [ ] **Real app icon + splash / branding** (placeholders in place; swap for final art).
- [ ] **app.json** final `name`/`slug`/`version`/bundle ids (`com.needlesslyengineeredonlinenetwork.neon`).
- [ ] First real build: `eas build --profile preview --platform ios` → **TestFlight** on jimmy's iPhone. (Needs §1 Apple account + §2 OAuth.)

## 4. Legal / store-readiness
- [x] **Privacy policy** + **Terms** pages (public) — shipped (#42).
- [x] **In-app account deletion** (web + mobile, self-service, caller-scoped) — shipped (#42). *(App stores require this.)*
- [ ] Privacy/Terms links + **About** screen in mobile Settings — in flight.
- [ ] App Store / Play **data-safety / privacy nutrition labels** (declare: Google email+name, tokens, user-generated content).

## 5. Content & distribution
- [ ] **Show artwork** end-to-end (`shows.image_url` → browse/feed/RSS `<itunes:image>`/web+mobile/lock-screen) — in flight.
- [ ] **Directory-ready RSS** (Apple Podcasts + Spotify: itunes category/explicit/owner/author, language, stable guid, enclosure length+type) — in flight. Then submit each show's `/feed/<token>` to Apple Podcasts Connect + Spotify for Podcasters.

## 6. Infrastructure (foundation still open)
- [ ] **Audio → object storage / CDN (R2/S3) as the default.** The S3/R2 backend exists and delete-cleanup is wired, but the **default** is still Postgres-stored audio. Flip the default + migrate existing audio; required for real streaming scale.
- [ ] **Always-on public hosting.** The web app runs on the Rig / Vercel; the cloned-voice server can't live on Vercel. Decide the 24/7 home (hosted TTS vs the Rig + tunnel) before taking real users.
- [ ] **Cost guardrails** — per-user generation limits shipped (#40); set the actual daily caps in `app_settings` before opening signups.

## 7. Later (post-launch)
- [ ] **Push notifications** (new episode / live session starting).
- [ ] **Live podcast voice** — live sessions are **text-first** today; add TTS of turns / live audio after the text version is proven.
- [ ] **Video** (Phase 4).
- [ ] **Subscriptions / billing** — Apple/Google in-app purchase for digital subs (15–30% cut); RevenueCat unifies Apple + Google + Stripe. Most compliance baggage; deliberately last.

---
_Shipped so far (merged to `main`): MVP (#2–#9), token API + Phase 1 publishing/web player (#19–#21), steering (#22), community browse/follow (#24), native app v1 + mobile auth (#26, #28–#34), agent tokens (#37), live podcast API/UI/mobile (#38, #39, #44), generation limits (#40), lock-screen (#41), privacy/terms/account-deletion (#42), agent join kit (#43)._
