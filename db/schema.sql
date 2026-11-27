-- NEON Podcasts — schema (first cut)
-- Safe to run repeatedly: uses IF NOT EXISTS and idempotent guards.

create extension if not exists "pgcrypto";

create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique,
  password_hash text,
  role        text not null default 'member' check (role in ('owner', 'member')),
  owner_approved boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  label text not null,
  scope text not null check (scope in ('read_only', 'read_write')),
  created_by uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists shows (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references users(id) on delete cascade,
  title          text not null,
  description    text not null default '',
  voice_id       text,
  narration_mode text not null default 'auto',        -- auto (app renders TTS) | external (script-only, e.g. Muse)
  cadence        text not null default 'weekly',      -- twice_daily | daily | weekdays | twice_weekly | weekly | days | manual
  schedule_time  text not null default '09:00',       -- HH:MM local
  timezone       text not null default 'UTC',
  target_minutes integer not null default 5,
  rss_token      text not null default encode(gen_random_bytes(16), 'hex'),
  is_public      boolean not null default false,
  image_url      text,                                -- show artwork (http(s) URL)
  next_run_at    timestamptz,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

alter table shows add column if not exists style_guide text not null default '';
alter table shows add column if not exists image_url text;
alter table shows add column if not exists air_days smallint[];   -- ISO weekdays (1 = Mon … 7 = Sun) for cadence 'days'

create table if not exists show_briefings (
  id          uuid primary key default gen_random_uuid(),
  show_id     uuid not null references shows(id) on delete cascade,
  filename    text not null,
  content_md  text not null,
  is_active   boolean not null default true,
  uploaded_at timestamptz not null default now()
);
create index if not exists idx_show_briefings_show_id on show_briefings(show_id);

create table if not exists show_pronunciations (
  id         uuid primary key default gen_random_uuid(),
  show_id    uuid not null references shows(id) on delete cascade,
  term       text not null,
  say_as     text not null,
  match_mode text not null default 'word' check (match_mode in ('word','substring')),
  created_at timestamptz not null default now()
);
create index if not exists idx_show_pronunciations_show_id on show_pronunciations(show_id);

create table if not exists episodes (
  id               uuid primary key default gen_random_uuid(),
  show_id          uuid not null references shows(id) on delete cascade,
  title            text not null,
  script           text not null default '',
  show_notes       text not null default '',
  audio_url        text,                               -- download/stream path
  duration_seconds integer,
  byte_size        integer,
  audio_content_type text not null default 'audio/mpeg',
  status           text not null default 'draft',      -- draft | published | failed
  scheduled_for    timestamptz,
  published_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_episodes_show_id on episodes(show_id);

-- The default storage provider keeps audio bytes here; S3-compatible storage is optional.
create table if not exists episode_audio (
  episode_id   uuid primary key references episodes(id) on delete cascade,
  content_type text not null default 'audio/mpeg',
  data         bytea not null
);
alter table episodes add column if not exists audio_content_type text not null default 'audio/mpeg';
update episodes e set audio_content_type = ea.content_type
from episode_audio ea where ea.episode_id = e.id and e.audio_content_type = 'audio/mpeg';

-- Cover pictures uploaded by owners. One per show; /art/[id] serves it.
create table if not exists show_artwork (
  show_id      uuid primary key references shows(id) on delete cascade,
  content_type text not null,
  data         bytea not null,
  updated_at   timestamptz not null default now()
);

-- App-wide settings (single-user). Key/value so it's easy to extend.
-- Holds the in-app LLM config (provider, OpenRouter key + model) that overrides
-- the matching env vars when present.
create table if not exists app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

create table if not exists runs (
  id                uuid primary key default gen_random_uuid(),
  show_id           uuid not null references shows(id) on delete cascade,
  episode_id        uuid references episodes(id) on delete set null,
  status            text not null default 'queued',    -- queued | running | done | failed
  briefing_snapshot text,
  model             text,
  tts_provider      text,
  cost_cents        integer,
  error             text,
  scheduled_for     timestamptz,
  attempt_count     integer not null default 0,
  next_attempt_at   timestamptz,
  started_at        timestamptz not null default now(),
  heartbeat_at      timestamptz,
  finished_at       timestamptz
);
create index if not exists idx_runs_show_id on runs(show_id);

-- Scheduler indexes live in 002_scheduler.sql, after its idempotent ALTERs.

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  subscriber_email text not null,
  show_id uuid not null references shows(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (subscriber_email, show_id)
);
create index if not exists idx_subscriptions_subscriber on subscriptions(subscriber_email);

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
