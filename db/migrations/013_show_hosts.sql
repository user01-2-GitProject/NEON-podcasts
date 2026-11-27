-- Preserve every host's name and voice. voice_id remains host 1 for back-compat.
alter table shows add column if not exists hosts jsonb not null default '[]'::jsonb;