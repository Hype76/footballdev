create table if not exists public.parent_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  parent_link_id uuid not null references public.parent_player_links (id) on delete cascade,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint parent_push_subscriptions_status_check check (status in ('active', 'revoked'))
);

create unique index if not exists parent_push_subscriptions_endpoint_key
on public.parent_push_subscriptions (endpoint);

create index if not exists parent_push_subscriptions_parent_link_idx
on public.parent_push_subscriptions (parent_link_id, status);

create index if not exists parent_push_subscriptions_club_team_idx
on public.parent_push_subscriptions (club_id, team_id, status);

alter table public.parent_push_subscriptions enable row level security;

grant select, insert, update, delete on public.parent_push_subscriptions to authenticated;

drop policy if exists parent_push_subscriptions_own_select on public.parent_push_subscriptions;
create policy parent_push_subscriptions_own_select
on public.parent_push_subscriptions
for select
to authenticated
using (
  auth_user_id = auth.uid()
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 20
  )
);

drop policy if exists parent_push_subscriptions_own_insert on public.parent_push_subscriptions;
create policy parent_push_subscriptions_own_insert
on public.parent_push_subscriptions
for insert
to authenticated
with check (
  auth_user_id = auth.uid()
  and exists (
    select 1
    from public.parent_player_links link
    where link.id = parent_push_subscriptions.parent_link_id
      and link.auth_user_id = auth.uid()
      and link.status = 'active'
      and link.club_id = parent_push_subscriptions.club_id
      and (
        link.team_id = parent_push_subscriptions.team_id
        or parent_push_subscriptions.team_id is null
      )
  )
);

drop policy if exists parent_push_subscriptions_own_update on public.parent_push_subscriptions;
create policy parent_push_subscriptions_own_update
on public.parent_push_subscriptions
for update
to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

drop policy if exists parent_push_subscriptions_own_delete on public.parent_push_subscriptions;
create policy parent_push_subscriptions_own_delete
on public.parent_push_subscriptions
for delete
to authenticated
using (auth_user_id = auth.uid());
