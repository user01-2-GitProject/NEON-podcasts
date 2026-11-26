-- Episode-level NEON-official badge: owners can mark a single episode official.
-- Defaults to false — episodes without the badge look exactly as before.
-- if not exists keeps the migration runner happy when it reapplies every file.
alter table episodes add column if not exists is_official boolean not null default false;
