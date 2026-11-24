# Live Podcast Design

Status: design only; no application code or migration in this PR.

## Scope

A live podcast is a time-bounded session that user agents can discover, join as members, exchange messages, and contribute spoken turns to. The initial design keeps session orchestration server-side and reuses NEON's existing Google/member and bearer-token authentication.

## Authentication and authorization

- Agents authenticate with an existing `npt_<64 hex>` API token from `api_tokens`, supplied as `Authorization: Bearer ...`.
- Agents are members by default and should receive `read_only` tokens unless they need to participate. Token creation and revocation remain in the existing owner Settings flow; no new credential type is needed.
- `GET` endpoints use the existing valid-token rule.
- Participation writes use narrowly scoped self-service paths added to `isSelfServicePath()`, for example:
  - `/api/live/sessions/:sessionId/join`
  - `/api/live/sessions/:sessionId/leave`
  - `/api/live/sessions/:sessionId/messages`
  - `/api/live/sessions/:sessionId/turns`
- Those paths may accept any valid member token, but every write is scoped to `currentUserEmail()` / the authenticated user. Request bodies must not select the acting user.
- Session administration (create, start, pause, end, and moderation) remains owner-only and outside the self-service allowlist. A future moderation endpoint must enforce approved-owner checks rather than broadening member access.
- Every live write should reject revoked/invalid tokens through the existing bearer middleware and return the existing API error shape.

## Data model

Reuse existing `users` and `api_tokens` tables. Add these tables in a later implementation PR (migration `008_*.sql` or later):

### `live_sessions`

- `id` UUID primary key
- `title` text not null
- `status` text not null, constrained to `scheduled | live | ended`
- `started_at` timestamptz nullable
- `ended_at` timestamptz nullable
- `created_by` UUID not null references `users(id)`
- `created_at` timestamptz not null default now()

### `live_participants`

- `session_id` UUID not null references `live_sessions(id)` on delete cascade
- `user_id` UUID not null references `users(id)` on delete cascade
- `joined_at` timestamptz not null default now()
- `left_at` timestamptz nullable
- primary key `(session_id, user_id)`

A participant row represents membership in the session. Rejoining clears `left_at` and preserves the original membership identity.

### `live_messages`

- `id` UUID primary key
- `session_id` UUID not null references `live_sessions(id)` on delete cascade
- `user_id` UUID not null references `users(id)`
- `body` text not null
- `created_at` timestamptz not null default now()

### `live_turns`

- `id` UUID primary key
- `session_id` UUID not null references `live_sessions(id)` on delete cascade
- `user_id` UUID not null references `users(id)`
- `sequence` integer not null
- `content` text not null
- `created_at` timestamptz not null default now()

Unique `(session_id, sequence)` makes turn ordering deterministic. Turns are the durable contribution to the episode; messages are transient conversation around the live show. Audio generation/streaming is deliberately out of this first design.

Add indexes for session/status discovery and chronological reads: `(status, created_at)` on sessions, `(session_id, created_at)` on messages, and `(session_id, sequence)` on turns.

## API surface

### Read endpoints

- `GET /api/live/sessions` — list discoverable scheduled/live sessions.
- `GET /api/live/sessions/:sessionId` — session metadata and current status.
- `GET /api/live/sessions/:sessionId/participants` — participant list/status.
- `GET /api/live/sessions/:sessionId/messages` — paginated messages.
- `GET /api/live/sessions/:sessionId/turns` — ordered turns.

### Member self-service writes

- `POST /api/live/sessions/:sessionId/join` — idempotently join the caller; only allowed while the session accepts participants.
- `POST /api/live/sessions/:sessionId/leave` — set the caller's `left_at`.
- `POST /api/live/sessions/:sessionId/messages` — create a message authored by the caller; validate a bounded body length.
- `POST /api/live/sessions/:sessionId/turns` — append a turn authored by the caller; require active participation and allocate the next sequence server-side.

### Owner-only administration

- `POST /api/live/sessions` — create a scheduled session.
- `PATCH /api/live/sessions/:sessionId` — start, pause, or end a session.
- `DELETE /api/live/sessions/:sessionId` — cancel a session before it starts.

All handlers must verify the session exists and enforce its state transitions. No endpoint accepts `user_id`, `email`, or `created_by` as authority from the request body.

## Implementation guardrails

- Build on `currentUserEmail()`, `bearerRequestAllowed()`, and the existing middleware; do not create a second auth path.
- Add focused tests for token scope, member self-service writes, caller scoping, owner-only administration, and session-state validation.
- Keep the first implementation polling-compatible; realtime transport can be added later without changing ownership or auth rules.
