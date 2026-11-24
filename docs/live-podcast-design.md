# Live podcast that user agents can join: design (omp)

Status: **draft for review**. Doc only: no code and no migration in this PR.

Goal: a show can go **live**. During the live session, a host (an owner) runs it while signed-in members and their **agents** listen, join, chat and take speaking turns in real time. This design uses the merged NEON auth model and doesn't add a new kind of identity.

## 1. Auth

### Who an agent is
An agent is a **member's API token**: a row in `api_tokens` whose `created_by` is the member's `users.id`. It is not a separate principal. Everything an agent does is attributed to that user, and in addition to the specific token, so one member can run several distinguishable agents.

### How an agent gets a token (no new mint path)
- **Listen only (default):** a `read_only` token. Today members get tokens only through the phone flows (`POST /api/auth/mobile`, `/mobile-connect`), and both mint `read_write`. Owners can mint `read_only` tokens in token admin, but those are `created_by` the owner, so they would act as an **owner**. **They must never be handed to agents.**
- **Join and speak:** a member `read_write` token, minted through the existing `/mobile-connect` browser flow (label `mobile:<email>`). It can't reach owner routes because `bearerRequestAllowed` already restricts members to `isSelfServicePath`.
- Revocation is unchanged: Settings → Devices (`/api/me/tokens*`).

> **Open question 1 (review):** `bearerRequestAllowed` checks scope *before* the self-service carve-out, so a `read_only` token can never POST, including to self-service paths. I recommend keeping that rule. `read_only` means "listen", and "join/speak" requires a member `read_write` token, whose blast radius is already limited to self-service paths. The alternative is letting `read_only` tokens POST to `/api/live/*`, which would quietly change what `read_only` means everywhere. Not proposed.
>
> **Open question 2:** should members be able to mint a `read_only` "agent" token for themselves (for example `POST /api/me/tokens {label}`, own user only)? Without it, the default listen-only agent needs a phone/browser connect flow, which mints `read_write`. If we add it, it's one more self-service route under the existing `/api/me/tokens*` prefix, with its own PR and tests.

### Caller identity
`currentUserEmail()` stays as is. A small new helper in `lib/current-user.ts`, `currentCaller(req) → { userId, email, tokenId | null }` (`tokenId` null for a browser cookie session), resolves the same way and also returns the token row id. **No user id, email, participant id or token id is ever read from a request body.**

### New self-service writes (narrow, exact-match)
`isSelfServicePath` gains **one regex**, not a prefix:

```
^/api/live/<uuid>/(join|leave|heartbeat|turns)$
```

Every other `/api/live/...` mutation, such as `/api/live/sessions`, `/api/live/<id>/participants/<pid>` or `/api/live/<id>` PATCH, stays **owner-only** under the existing default. No owner route is widened.

## 2. Data model: `db/migrations/0NN_live.sql`

The migration number gets picked at implementation time. My parked community-media branch also claims `008`, and whichever merges second renumbers.

```sql
live_sessions (
  id uuid pk, show_id uuid null references shows(id) on delete set null,
  title text not null, status text not null check (status in ('scheduled','live','ended')),
  created_by uuid not null references users(id),            -- an owner
  max_participants int not null default 12,
  started_at timestamptz, ended_at timestamptz, created_at timestamptz default now()
)

live_participants (
  id uuid pk, session_id uuid not null references live_sessions(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  token_id uuid null references api_tokens(id) on delete cascade,   -- null = browser session
  kind text not null check (kind in ('human','agent')),            -- agent iff token_id is not null
  role text not null default 'listener' check (role in ('host','guest','listener')),
  display_name text not null check (length(display_name) between 1 and 40),
  muted boolean not null default false, removed boolean not null default false,
  joined_at timestamptz default now(), last_seen_at timestamptz default now(), left_at timestamptz
)
unique index on live_participants (session_id, user_id, coalesce(token_id, '00000000-0000-0000-0000-000000000000'))

live_turns (
  id uuid pk, session_id uuid not null references live_sessions(id) on delete cascade,
  participant_id uuid not null references live_participants(id) on delete cascade,
  seq bigint not null,                                   -- per-session order for polling
  kind text not null check (kind in ('speech','chat','system')),
  text text not null check (length(text) between 1 and 4000),
  created_at timestamptz default now(),
  unique (session_id, seq)
)
```

- `seq` is assigned in the insert as `coalesce(max(seq), 0) + 1`, with the unique constraint as the guard and one retry on conflict.
- Revoking a token cascades: that agent's participant row and turns are removed. This is open question 3: should we keep the history and use `set null` instead?
- No relation to the old single-user `live_agents`/`live_sessions`/`live_turns` prototype in the vault snapshot. It used the retired cookie auth and is not carried over.

## 3. API surface

| Method & path | Who | Notes |
|---|---|---|
| `GET /api/live/sessions` | any valid token / session | scheduled + live sessions |
| `GET /api/live/<id>` | any | session + active participants (display names only, never emails) |
| `GET /api/live/<id>/turns?after=<seq>` | any | polling feed, ≤200 turns per call |
| `POST /api/live/<id>/join` `{display_name}` | member, read_write (self-service) | upserts **the caller's** participant row (`user_id`, `token_id` from auth); `kind` derived, role `listener`; session must be `live` and below `max_participants` |
| `POST /api/live/<id>/heartbeat` | self-service | bumps the caller's `last_seen_at`; participants silent for more than 60 s show as away |
| `POST /api/live/<id>/leave` | self-service | sets the caller's `left_at` |
| `POST /api/live/<id>/turns` `{kind, text}` | self-service | caller's participant only; `speech` needs role host/guest and not muted, `chat` needs not removed; rate limit 1 turn / 3 s per participant |
| `POST /api/live/sessions` | owner | create (`scheduled`) |
| `PATCH /api/live/<id>` `{status}` | owner | go live / end; ending freezes writes |
| `PATCH /api/live/<id>/participants/<pid>` `{role, muted, removed}` | owner | host promotes a guest to the stage, mutes or removes |

Transport is short **polling** on `turns?after=seq`, since the Vercel Hobby plan rules out websockets. SSE can replace it later without changing the data model. v1 turns are text. Rendering agent speech to audio through the existing TTS pipeline is a later phase.

## 4. Tests (in the implementation PR)

- `bearerRequestAllowed` / middleware:
  - a member `read_write` token may POST each of the four self-service paths;
  - a `read_only` token may not;
  - a member may not POST `/api/live/sessions`, `PATCH /api/live/<id>` or `/api/live/<id>/participants/<pid>`;
  - near-miss paths such as `/api/live/<id>/turns/x`, `/api/live/not-a-uuid/join` and `/api/live/sessions/join` are not self-service.
- `lib/live.ts` with the existing `fakeSql` pattern: every write binds the caller's `user_id`/`token_id`, and the body never supplies them. A turn from a non-participant, a muted participant or an ended session is rejected.

## 5. Process

Implementation follows in a separate draft PR after review. The migration ships in that PR and is applied only after jimmy approves. No prod database writes.
