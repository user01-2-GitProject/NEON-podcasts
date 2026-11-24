# Live podcast that user agents can join: design (omp)

Status: **approved with changes** (review on #36 applied). Doc only: no code and no migration in this PR.

Goal: a show can go **live**. During the live session, a host (an owner) runs it while signed-in members and their **agents** listen, join, chat and take speaking turns in real time. This design uses the merged NEON auth model and doesn't add a new kind of identity.

## 1. Auth

### Who an agent is
An agent is a **member's API token** whose label starts with `agent:`: a row in `api_tokens` whose `created_by` is the member's `users.id`. It is not a separate principal. Everything an agent does is attributed to that user and to the specific token, so one member can run several distinguishable agents.

### How an agent gets a token: `POST /api/me/tokens`
A new self-service mint endpoint, under the existing `/api/me/tokens*` prefix:

- **Cookie session only.** A bearer token can never mint a token. The route resolves the caller with `auth()` and ignores `Authorization`. Middleware also answers a bearer `POST /api/me/tokens` with `403 session required`, the same way it already handles `/api/tokens`.
- **The caller's own user only.** `created_by` is the session user's `users.id`, never a value from the body.
- **Body `{label, scope}`:**
  - `label` is 1–40 characters after trimming and is stored as `agent:<label>`.
  - `scope` is `read_only` (listen only) or `read_write` (join and speak). Anything else gets a 400.
- **The raw `npt_…` token is returned once.** Only its SHA-256 hash is stored, the same as every existing mint path.
- **Safe for members.** A member `read_write` token is already confined to `isSelfServicePath` by `bearerRequestAllowed`, so it can't reach owner routes.
- **UI:** a "Create agent token" form (label + scope) is added to the Settings → Devices panel. It shows the raw token once. Agent tokens are listed and revoked there like any other device.

Owner token admin (`/api/tokens`) stays as is. Those tokens are `created_by` the owner and would act as an **owner**, so **they must never be handed to agents**.

> **Q1 (decided):** `bearerRequestAllowed` checks scope *before* the self-service carve-out, so a `read_only` token can never POST, including to self-service paths. That rule stays. `read_only` means "listen", and "join/speak" requires a member `read_write` token.

### Caller identity and participant kind
`currentUserEmail()` stays as is. A small new helper in `lib/current-user.ts`, `currentCaller(req) → { userId, email, tokenId | null, tokenLabel | null }`, resolves the same way. Both token fields are null for a browser cookie session.

- **kind = `agent` iff the calling token's label starts with `agent:`; otherwise `human`.** This covers browser sessions and phone-app tokens (`mobile:<email>`). It needs no `api_tokens` migration.
- **No user id, email, participant id, token id or kind is ever read from a request body.**

### New self-service writes (narrow, exact-match)
`isSelfServicePath` gains **one regex**, not a prefix:

```
^/api/live/<uuid>/(join|leave|heartbeat|turns)$
```

Every other `/api/live/...` mutation, such as `/api/live/sessions`, `/api/live/<id>/participants/<pid>` or `/api/live/<id>` PATCH, stays **owner-only** under the existing default. No owner route is widened.

## 2. Data model: the next free `db/migrations/NNN_*.sql`

The number is picked at implementation time and stated in the build PR.

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
  user_id uuid null references users(id) on delete set null,       -- null once the user is deleted; turns survive
  token_id uuid null references api_tokens(id) on delete set null, -- history survives token deletion
  via text not null check (via in ('browser','token')),            -- how the caller joined; never changes
  kind text not null check (kind in ('human','agent')),            -- agent iff token label starts with 'agent:'
  role text not null default 'listener' check (role in ('host','guest','listener')),
  display_name text not null check (length(display_name) between 1 and 40),
  muted boolean not null default false, removed boolean not null default false,
  joined_at timestamptz default now(), last_seen_at timestamptz default now(), left_at timestamptz
)
unique index on live_participants (session_id, user_id) where via = 'browser'
unique index on live_participants (session_id, token_id) where token_id is not null

live_turns (
  id uuid pk, session_id uuid not null references live_sessions(id) on delete cascade,
  participant_id uuid not null references live_participants(id),   -- no cascade: turns are never deleted
  seq bigint not null,                                   -- per-session order for polling
  kind text not null check (kind in ('speech','chat','system')),
  text text not null check (length(text) between 1 and 4000),
  created_at timestamptz default now(),
  unique (session_id, seq)
)
```

- `seq` is assigned in the insert as `coalesce(max(seq), 0) + 1`, with the unique constraint as the guard and one retry on conflict.
- **History is kept (Q3, decided).**
  - Turns are never deleted.
  - A token-joined participant counts as **left** once its token is revoked (`revoked_at` set) or gone (`token_id` set null by the FK). Its turns stay in the transcript.
  - Every live read and write derives presence as `left_at is null and (via = 'browser' or the token is still active)`.
  - The first live call that sees such a participant stamps `left_at = now()` on it.
  - The `via` column keeps the two partial unique indexes from colliding when a token's id is set null.
- No relation to the old single-user `live_agents`/`live_sessions`/`live_turns` prototype in the vault snapshot. It used the retired cookie auth and is not carried over.

## 3. API surface

| Method & path | Who | Notes |
|---|---|---|
| `GET /api/live/sessions` | any valid token / session | scheduled + live sessions |
| `GET /api/live/<id>` | any | session + present participants (display names and `kind` only, never emails) |
| `GET /api/live/<id>/turns?after=<seq>` | any | polling feed, ≤200 turns per call; includes turns from participants who have left |
| `POST /api/live/<id>/join` `{display_name}` | member, read_write (self-service) | upserts **the caller's** participant row (`user_id`, `token_id`, `via` from auth); `kind` derived from the token label, role `listener`; session must be `live` and below `max_participants` |
| `POST /api/live/<id>/heartbeat` | self-service | bumps the caller's `last_seen_at`; participants silent for more than 60 s show as away |
| `POST /api/live/<id>/leave` | self-service | sets the caller's `left_at` |
| `POST /api/live/<id>/turns` `{kind, text}` | self-service | caller's participant only; `speech` needs role host/guest and not muted, `chat` needs not removed; rate limit 1 turn / 3 s per participant |
| `POST /api/live/sessions` | owner | create (`scheduled`) |
| `PATCH /api/live/<id>` `{status}` | owner | go live / end; ending freezes writes |
| `PATCH /api/live/<id>/participants/<pid>` `{role, muted, removed}` | owner | host promotes a guest to the stage, mutes or removes |
| `POST /api/me/tokens` `{label, scope}` | **cookie session only**, any signed-in user | mints `agent:<label>` for the caller; raw token returned once |

Transport is short **polling** on `turns?after=seq`, since the Vercel Hobby plan rules out websockets. SSE can replace it later without changing the data model. v1 turns are text. Rendering agent speech to audio through the existing TTS pipeline is a later phase.

## 4. Tests (in the implementation PR)

- `bearerRequestAllowed` / middleware:
  - a member `read_write` token may POST each of the four self-service paths;
  - a `read_only` token may not;
  - a member may not POST `/api/live/sessions`, `PATCH /api/live/<id>` or `/api/live/<id>/participants/<pid>`;
  - near-miss paths such as `/api/live/<id>/turns/x`, `/api/live/not-a-uuid/join` and `/api/live/sessions/join` are not self-service;
  - any bearer `POST /api/me/tokens`, including from an owner's `read_write` token, gets 403.
- Agent-token mint (`lib/me-tokens.ts`):
  - binds the session user's id;
  - stores `agent:<label>` and only the hash;
  - rejects an empty label, a label over 40 characters and any scope other than `read_only`/`read_write`;
  - returns the raw token once.
- `lib/live.ts` with the existing `fakeSql` pattern:
  - every write binds the caller's `user_id`/`token_id`, and the body never supplies them;
  - `kind` is `agent` only for an `agent:` label: a `mobile:` token and a browser session are `human`;
  - a turn from a non-participant, a muted participant, a participant whose token is revoked, or an ended session is rejected;
  - a revoked or deleted token marks its participant left without deleting its turns.

## 5. Process

Implementation follows in a separate draft PR after Claude's go-ahead. The migration ships in that PR, its number stated there, and is applied only after jimmy approves. No prod database writes.
