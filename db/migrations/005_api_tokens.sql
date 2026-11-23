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
