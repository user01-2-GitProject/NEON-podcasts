# NEON Podcasts — Skeleton Review

## Scope and source caveat

This review describes the source tree present in `/home/hermes/neon-podcasts-review`. The directory has no `.git` metadata, so I could not independently verify that it is `df60f02`, determine its branch, or compare local files with `origin/main`. There is also an in-tree documentation mismatch: `docs/PLAN.md:9-17, 117-134` says the scheduler is not built, while the dispatcher, generation path, and `vercel.json` already implement scheduled runs. Treat that roadmap status as stale unless checked against the intended source revision.

## 1. Database schema and migrations

`db/schema.sql` defines these tables:

- `users` (`db/schema.sql:7-11`): UUID primary key, nullable unique `email`, and `created_at`. It has no password, auth-provider subject, or account-status fields.
- `shows` (`db/schema.sql:13-29`): nullable `user_id` FK to `users` with cascade delete; title/description/voice; `narration_mode`; `cadence` (`daily|weekly|manual`); `schedule_time` (`HH:MM` local); `timezone`; `next_run_at`; `is_active`; `rss_token`; and `is_public`. Defaults are weekly at 09:00 UTC, active, and a generated RSS token. The owner relationship exists structurally but is optional.
- `show_briefings` (`db/schema.sql:31-39`): show FK, filename, Markdown content, active flag, upload timestamp; indexed by `show_id`.
- `episodes` (`db/schema.sql:41-55`): show FK, title/script/show notes, `audio_url`, duration and byte size, `draft|published|failed` status, `scheduled_for`, publication/creation times; indexed by show.
- `episode_audio` (`db/schema.sql:57-62`): one row per episode, with `content_type` and the complete audio payload in `data bytea`; cascades with the episode.
- `app_settings` (`db/schema.sql:64-71`): global key/value settings with `updated_at`; it is not keyed by user.
- `runs` (`db/schema.sql:73-92`): show and optional episode references, `queued|running|done|failed` status, briefing snapshot, model/TTS/cost/error fields, schedule slot, retry count/next attempt, and start/finish times. It has a show index and a partial unique `(show_id, scheduled_for)` index. `episodes` also has a partial unique index on `(show_id, scheduled_for)` (`db/schema.sql:90-95`).

The only migration file present is `db/migrations/002_scheduler.sql`. It adds `runs.scheduled_for`, `runs.attempt_count` (default 0), and `runs.next_attempt_at`, then creates the same partial unique slot indexes on `runs` and `episodes` (`002_scheduler.sql:1-11`). The current schema already contains those additions. `scripts/migrate.ts:19-39` applies `schema.sql` first and then sorted `.sql` files; it uses idempotent statements rather than a migration ledger.

## 2. Authentication and ownership state

The current login is a shared-password gate, not user authentication. `app/api/auth/login/route.ts:6-23` accepts a form password and calls `checkPassword`; `lib/auth.ts:70-74` compares it with the single `APP_PASSWORD` environment variable. On success, `lib/auth.ts:42-49, 76-82` issues an HMAC-signed, 30-day `np_session` cookie with `httpOnly`, `sameSite=lax`, and production `secure` settings. Its payload is only `ok:<issuedAt>`—it carries no user identity. Logout clears the cookie (`app/api/auth/logout/route.ts:6-9`); sessions are otherwise stateless.

`middleware.ts:4-36` protects the app with that cookie, except login/auth, cron, feed/listen, static paths, and GET audio requests carrying a `feed` query parameter. The `users` table and `shows.user_id` are therefore only a foothold toward multi-user accounts: no user is created or identified by login, `POST /api/shows` does not set `user_id` (`app/api/shows/route.ts:13-50`), and show reads/updates/deletes are by unscoped ID or list all shows (`app/api/shows/route.ts:8-10`, `app/api/shows/[id]/route.ts:10-79`). The skeleton must establish an authenticated user identity and enforce ownership in every show, briefing, episode, run, and settings access path—not merely add sign-up screens.

## 3. Audio storage and delivery path

For automatic narration, `lib/generate.ts:60-68, 126-164` generates a script, calls `synthesize`, then stores the resulting bytes in `episode_audio`. `lib/tts.ts:12-28, 108-125` calls the selected provider, chunks long text at 3,500 characters, concatenates returned MP3 buffers, and reports `audio/mpeg`. Scheduled generation inserts the episode and `episode_audio` row and marks the run done in one Neon transaction. Manual automatic generation writes the episode and audio in separate operations (`lib/generate.ts:167-195`). External narration instead creates a script-only draft; the user uploads the finished audio via `app/api/episodes/[id]/audio/route.ts:41-99`, which upserts the bytes and publishes the episode.

Listeners reach audio through the episode's `/api/episodes/{id}/audio` `audio_url`. The GET route (`app/api/episodes/[id]/audio/route.ts:8-39`) selects the `bytea` as base64, decodes the complete payload into a Node `Buffer`, then returns it. Despite the “Streams” comment and `Accept-Ranges` header, it materializes and returns the whole file and does not implement byte-range requests. This is not CDN-style streaming/scrubbing and makes Postgres, SQL/base64 transfer, and application memory carry the full media payload.

RSS generation (`app/feed/[token]/route.ts:23-52`) looks up a show by `rss_token` and includes only published episodes with audio rows and URLs. For local audio URLs it appends `?feed=<rss_token>`; the audio GET checks that token against the episode's show and requires a published episode (`app/api/episodes/[id]/audio/route.ts:11-19`). Middleware permits that feed-token path without a session, but the route performs the token check. The token is a per-show RSS capability, not a user or general API credential. The feed route does not consult `shows.is_public`, so the flag currently does not gate feed access.

Moving audio out of Postgres must update generation, upload, URL/metadata writes, audio delivery, and RSS enclosure generation together. Preserve the stable per-show RSS feed behavior while using storage/CDN URLs that support byte ranges; do not treat the existing local endpoint's `Accept-Ranges` header as range support.

## 4. Scheduling state

Scheduling is implemented in code, though the plan document still calls it unbuilt. `lib/schedule.ts:1-13` only validates the `HH:MM` format and IANA timezone; it does not calculate recurrence. Show create/update handlers separately compute a future local-time `next_run_at` (`app/api/shows/route.ts:21-49`, `app/api/shows/[id]/route.ts:28-68`).

`vercel.json:1-8` invokes `/api/cron/dispatch` once daily at 08:00 UTC. The dispatcher (`app/api/cron/dispatch/route.ts:16-115`) checks `CRON_SECRET`; reclaims scheduled runs left `running` for over ten minutes; initializes missing slots for active daily/weekly shows; inserts due slots into `runs` with unique-slot conflict protection; and atomically claims up to 10 eligible runs with `FOR UPDATE SKIP LOCKED`. It executes generation concurrently within that cron request via `Promise.allSettled`. `lib/generate.ts:198-223` records failures and exponential retry times, with a maximum of five scheduled attempts; successful or exhausted slots advance `next_run_at` by one local day or seven local days.

This is a Postgres-backed run queue with atomic claims, not a separate queue/worker service: generation runs inline in the Vercel invocation (`maxDuration = 300`, dispatcher lines 5-8). The 08:00 daily poll cannot guarantee each configured local schedule time; an outage or missed slot has no explicit skip/coalesce policy, and overdue slots advance only as runs complete, so backlog can catch up slowly. Stale-run recovery also waits for a later cron invocation. Recurrence and next-slot SQL is duplicated across create/update, dispatch, and generation completion/failure paths; `lib/schedule.ts` is not the shared recurrence authority. Schedule changes can leave old run rows that no longer match the show's current `next_run_at` and thus cannot be claimed by the dispatcher.

## 5. Fit constraints and risks for the skeleton

- Keep the existing serverless Neon approach: `lib/db.ts:1-19` lazily creates `@neondatabase/serverless`'s HTTP client, exports a tagged SQL helper, and uses raw parameterized SQL. There is no ORM. Scheduled generation already relies on `getSql().transaction(...)` (`lib/generate.ts:73-97, 134-163`); keep request/runtime and transaction assumptions compatible with that driver.
- Treat the current `rss_token` as a separate feed capability. A token API needs its own credential lifecycle and must coexist with cookie-authenticated web requests and unauthenticated RSS/audio delivery.
- Route configuration through `lib/settings.ts`: `SETTING_KEYS`, `getSettings`/`setSettings`, and `resolveLlmConfig` define the existing `app_settings` access and env-override behavior. The current table/settings are global and single-user; multi-user settings need explicit ownership rather than silently sharing secrets. `app/api/settings/route.ts:12-35` masks the stored key in responses.
- Preserve the `episodes.audio_url`, `byte_size`, publication state, and RSS enclosure contract while replacing database bytes with object storage. The current feed only adds `feed` auth for same-origin local endpoint URLs; external storage URLs are emitted directly.
- Reduce the duplicated schedule calculation/advancement logic to one well-defined policy before changing scheduler semantics. Also reconcile the stale scheduler status in `docs/PLAN.md` and verify the source revision when Git metadata is available.

## Verdict: get these three things right first

1. Bind every request and owned record to a real user identity; scope every data path, and keep bearer API tokens distinct from RSS feed tokens.
2. Move audio bytes to object storage/CDN end-to-end, with actual range delivery and RSS enclosure compatibility—not just a new URL column.
3. Close out scheduler semantics around durable claims/retries, configured local times, missed-run/backlog policy, and one canonical recurrence calculation within serverless execution limits.
