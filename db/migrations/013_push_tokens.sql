-- Registration-only scaffold (A6): stores Expo push tokens for native devices.
-- REQUIRES JIMMY'S APPROVAL before applying to production.
create table if not exists push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  device_id text not null,
  expo_push_token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A rotated token is retired rather than deleted, so an old row can't be
  -- mistaken for the device's current token.
  revoked_at timestamptz
);

create index if not exists push_tokens_user_device_idx on push_tokens (user_id, device_id);
