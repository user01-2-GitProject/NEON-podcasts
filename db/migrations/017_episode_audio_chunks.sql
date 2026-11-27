create table if not exists episode_audio_chunks (
  run_id uuid not null references runs(id) on delete cascade,
  episode_id uuid not null references episodes(id) on delete cascade,
  chunk_index integer not null,
  content_type text not null,
  provider text not null,
  data bytea not null,
  primary key (run_id, chunk_index)
);
