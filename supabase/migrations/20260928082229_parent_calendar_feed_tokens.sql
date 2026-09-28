create table public.parent_calendar_feed_tokens (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  parent_link_id uuid not null references public.parent_player_links(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (auth_user_id, parent_link_id)
);

create index parent_calendar_feed_tokens_active_hash
  on public.parent_calendar_feed_tokens (token_hash) where revoked_at is null;

alter table public.parent_calendar_feed_tokens enable row level security;
revoke all on public.parent_calendar_feed_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.parent_calendar_feed_tokens to service_role;
