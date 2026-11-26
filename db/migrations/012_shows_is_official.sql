-- NEON-official shows get a spinning badge next to their title (jimmy, 2026-11-26).
-- Defaults to false — only shows the user flips are official.
alter table shows add column if not exists is_official boolean not null default false;
