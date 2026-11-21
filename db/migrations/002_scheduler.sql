alter table runs add column if not exists scheduled_for timestamptz;
alter table runs add column if not exists attempt_count integer not null default 0;
alter table runs add column if not exists next_attempt_at timestamptz;

create unique index if not exists idx_runs_scheduled_slot
  on runs(show_id, scheduled_for)
  where scheduled_for is not null;

create unique index if not exists idx_episodes_scheduled_slot
  on episodes(show_id, scheduled_for)
  where scheduled_for is not null;
