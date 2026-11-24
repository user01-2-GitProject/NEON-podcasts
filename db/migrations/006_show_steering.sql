alter table shows add column if not exists style_guide text not null default '';

create table if not exists show_pronunciations (
  id         uuid primary key default gen_random_uuid(),
  show_id    uuid not null references shows(id) on delete cascade,
  term       text not null,
  say_as     text not null,
  match_mode text not null default 'word' check (match_mode in ('word','substring')),
  created_at timestamptz not null default now()
);
create index if not exists idx_show_pronunciations_show_id on show_pronunciations(show_id);
