create table if not exists public.mobile_push_devices (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  parent_link_id uuid references public.parent_player_links (id) on delete cascade,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  user_profile_id uuid references public.users (id) on delete cascade,
  app_role text not null,
  device_token text not null,
  platform text not null default 'unknown',
  device_name text not null default '',
  status text not null default 'active',
  notification_enabled boolean not null default true,
  last_registered_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint mobile_push_devices_app_role_check check (app_role in ('coach', 'parent')),
  constraint mobile_push_devices_status_check check (status in ('active', 'revoked'))
);

create unique index if not exists mobile_push_devices_token_key
on public.mobile_push_devices (device_token);

create index if not exists mobile_push_devices_auth_user_idx
on public.mobile_push_devices (auth_user_id, app_role, status);

create index if not exists mobile_push_devices_club_team_idx
on public.mobile_push_devices (club_id, team_id, app_role, status);

create index if not exists mobile_push_devices_parent_link_idx
on public.mobile_push_devices (parent_link_id, status);

alter table public.mobile_push_devices enable row level security;

grant select, insert, update, delete on public.mobile_push_devices to authenticated;

drop policy if exists mobile_push_devices_own_select on public.mobile_push_devices;
create policy mobile_push_devices_own_select
on public.mobile_push_devices
for select
to authenticated
using (
  auth_user_id = auth.uid()
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 50
  )
);

drop policy if exists mobile_push_devices_own_insert on public.mobile_push_devices;
create policy mobile_push_devices_own_insert
on public.mobile_push_devices
for insert
to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists mobile_push_devices_own_update on public.mobile_push_devices;
create policy mobile_push_devices_own_update
on public.mobile_push_devices
for update
to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

drop policy if exists mobile_push_devices_own_delete on public.mobile_push_devices;
create policy mobile_push_devices_own_delete
on public.mobile_push_devices
for delete
to authenticated
using (auth_user_id = auth.uid());

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  parent_link_id uuid references public.parent_player_links (id) on delete cascade,
  target_auth_user_id uuid references auth.users (id) on delete cascade,
  channel text not null,
  notification_type text not null,
  title text not null,
  body text not null default '',
  data jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint notification_events_channel_check check (channel in ('web_push', 'mobile_push', 'in_app')),
  constraint notification_events_status_check check (status in ('queued', 'sent', 'failed', 'read'))
);

create index if not exists notification_events_target_idx
on public.notification_events (target_auth_user_id, status, created_at desc);

create index if not exists notification_events_club_team_idx
on public.notification_events (club_id, team_id, created_at desc);

alter table public.notification_events enable row level security;

grant select on public.notification_events to authenticated;

drop policy if exists notification_events_target_select on public.notification_events;
create policy notification_events_target_select
on public.notification_events
for select
to authenticated
using (
  target_auth_user_id = auth.uid()
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 50
  )
);
