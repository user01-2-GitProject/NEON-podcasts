-- Live podcast sessions that members and their agents can join (docs/live-podcast-design.md).
-- History is kept: turns are never deleted, and a participant whose token is
-- revoked or deleted is marked left (left_at) rather than removed.
create table if not exists live_sessions (
  id uuid primary key default gen_random_uuid(),
  show_id uuid references shows(id) on delete set null,
  title text not null check (length(title) between 1 and 200),
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'ended')),
  created_by uuid references users(id) on delete set null,
  max_participants integer not null default 12 check (max_participants between 1 and 100),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_live_sessions_status on live_sessions(status, created_at desc);

create table if not exists live_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references live_sessions(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  token_id uuid references api_tokens(id) on delete set null,
  via text not null check (via in ('browser', 'token')),
  kind text not null check (kind in ('human', 'agent')),
  role text not null default 'listener' check (role in ('host', 'guest', 'listener')),
  display_name text not null check (length(display_name) between 1 and 40),
  muted boolean not null default false,
  removed boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz
);
create unique index if not exists uq_live_participants_browser on live_participants(session_id, user_id) where via = 'browser';
create unique index if not exists uq_live_participants_token on live_participants(session_id, token_id) where token_id is not null;

create table if not exists live_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references live_sessions(id) on delete cascade,
  participant_id uuid not null references live_participants(id),
  seq bigint not null,
  kind text not null check (kind in ('speech', 'chat', 'system')),
  text text not null check (length(text) between 1 and 4000),
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);
create index if not exists idx_live_turns_participant on live_turns(participant_id, created_at desc);
