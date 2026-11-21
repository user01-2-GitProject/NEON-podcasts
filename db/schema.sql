-- NEON Podcasts — schema (first cut)
-- Safe to run repeatedly: uses IF NOT EXISTS and idempotent guards.

create extension if not exists "pgcrypto";

-- Just you for now; built so multi-user is a later step.
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique,
  created_at  timestamptz not null default now()
);

create table if not exists shows (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references users(id) on delete cascade,
  title          text not null,
  description    text not null default '',
  voice_id       text,
  narration_mode text not null default 'auto',        -- auto (app renders TTS) | external (script-only, e.g. Muse)
  cadence        text not null default 'weekly',      -- daily | weekly | manual
  schedule_time  text not null default '09:00',       -- HH:MM local
  timezone       text not null default 'UTC',
  target_minutes integer not null default 5,
  rss_token      text not null default encode(gen_random_bytes(16), 'hex'),
  is_public      boolean not null default false,
  next_run_at    timestamptz,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists show_briefings (
  id          uuid primary key default gen_random_uuid(),
  show_id     uuid not null references shows(id) on delete cascade,
  filename    text not null,
  content_md  text not null,
  is_active   boolean not null default true,
  uploaded_at timestamptz not null default now()
);
create index if not exists idx_show_briefings_show_id on show_briefings(show_id);

create table if not exists episodes (
  id               uuid primary key default gen_random_uuid(),
  show_id          uuid not null references shows(id) on delete cascade,
  title            text not null,
  script           text not null default '',
  show_notes       text not null default '',
  audio_url        text,                               -- download/stream path
  duration_seconds integer,
  byte_size        integer,
  status           text not null default 'draft',      -- draft | published | failed
  scheduled_for    timestamptz,
  published_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_episodes_show_id on episodes(show_id);

-- Audio bytes live in their own table for the MVP (swap to R2/S3 later).
create table if not exists episode_audio (
  episode_id   uuid primary key references episodes(id) on delete cascade,
  content_type text not null default 'audio/mpeg',
  data         bytea not null
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
  finished_at       timestamptz
);
create index if not exists idx_runs_show_id on runs(show_id);
create unique index if not exists idx_runs_scheduled_slot
  on runs(show_id, scheduled_for)
  where scheduled_for is not null;
create unique index if not exists idx_episodes_scheduled_slot
  on episodes(show_id, scheduled_for)
  where scheduled_for is not null;
