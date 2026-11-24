create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  subscriber_email text not null,
  show_id uuid not null references shows(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (subscriber_email, show_id)
);
create index if not exists idx_subscriptions_subscriber on subscriptions(subscriber_email);
