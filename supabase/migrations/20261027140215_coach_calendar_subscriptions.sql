-- Calendar subscription secrets are hashed and available only to server functions.
create table public.coach_calendar_feed_tokens (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  context_id text not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (context_id = case when team_id is null then 'club:' || club_id::text else 'team:' || team_id::text end)
);
alter table public.coach_calendar_feed_tokens enable row level security;
revoke all on public.coach_calendar_feed_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.coach_calendar_feed_tokens to service_role;
comment on table public.coach_calendar_feed_tokens is
  'Revocable Coach calendar subscriptions. Every read rechecks active staff, club, team and assignment authority. No plaintext subscription secret is stored.';

-- Existing Parent clients retain their legacy one-link API and table. New native
-- clients use independent connections so adding another phone cannot revoke one.
create table public.parent_calendar_subscription_tokens (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  parent_link_id uuid not null references public.parent_player_links(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index parent_calendar_subscription_tokens_owner on public.parent_calendar_subscription_tokens(auth_user_id, parent_link_id);
create index coach_calendar_feed_tokens_owner on public.coach_calendar_feed_tokens(auth_user_id, context_id);
alter table public.parent_calendar_subscription_tokens enable row level security;
revoke all on public.parent_calendar_subscription_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.parent_calendar_subscription_tokens to service_role;
