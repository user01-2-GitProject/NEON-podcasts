-- Cover pictures uploaded by owners. One per show; /art/[id] serves it.
create table if not exists show_artwork (
  show_id      uuid primary key references shows(id) on delete cascade,
  content_type text not null,
  data         bytea not null,
  updated_at   timestamptz not null default now()
);
