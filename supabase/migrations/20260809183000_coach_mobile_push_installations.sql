create table public.coach_mobile_push_installations (
  installation_id uuid primary key,
  auth_user_id uuid references auth.users (id) on delete cascade,
  user_profile_id uuid references public.users (id) on delete cascade,
  club_id uuid references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  context_id text not null default '',
  app_role text not null default 'coach',
  expo_push_token text,
  platform text not null,
  app_version text not null default '',
  build_number text not null default '',
  detail_level text not null default 'minimal',
  enabled boolean not null default false,
  status text not null default 'unbound',
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint coach_mobile_push_installations_app_role_check
    check (app_role = 'coach'),
  constraint coach_mobile_push_installations_platform_check
    check (platform in ('android', 'ios')),
  constraint coach_mobile_push_installations_detail_check
    check (detail_level in ('off', 'minimal', 'detailed')),
  constraint coach_mobile_push_installations_status_check
    check (status in ('active', 'unbound', 'revoked')),
  constraint coach_mobile_push_installations_context_check
    check (context_id = '' or context_id ~ '^(club|team):[0-9a-f-]{36}$'),
  constraint coach_mobile_push_installations_token_format_check
    check (
      expo_push_token is null
      or (
        length(expo_push_token) <= 512
        and expo_push_token ~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$'
      )
    ),
  constraint coach_mobile_push_installations_active_shape_check
    check (
      status <> 'active'
      or (
        auth_user_id is not null
        and user_profile_id is not null
        and club_id is not null
        and context_id <> ''
        and expo_push_token is not null
      )
    ),
  constraint coach_mobile_push_installations_inactive_shape_check
    check (
      status = 'active'
      or (enabled = false and expo_push_token is null)
    ),
  constraint coach_mobile_push_installations_preference_check
    check (detail_level <> 'off' or enabled = false)
);

create unique index coach_mobile_push_installations_token_key
on public.coach_mobile_push_installations (expo_push_token)
where expo_push_token is not null;

create index coach_mobile_push_installations_auth_status_idx
on public.coach_mobile_push_installations (auth_user_id, status)
where auth_user_id is not null;

create index coach_mobile_push_installations_profile_status_idx
on public.coach_mobile_push_installations (user_profile_id, status)
where user_profile_id is not null;

create index coach_mobile_push_installations_target_idx
on public.coach_mobile_push_installations (club_id, team_id, status)
where status = 'active' and enabled = true;

create table public.coach_mobile_notification_events (
  id bigint generated always as identity primary key,
  installation_id uuid references public.coach_mobile_push_installations (installation_id) on delete set null,
  auth_user_id uuid references auth.users (id) on delete set null,
  user_profile_id uuid references public.users (id) on delete set null,
  club_id uuid references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  intent_type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null,
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint coach_mobile_notification_events_intent_check
    check (intent_type in ('coach_update', 'scorer_volunteer')),
  constraint coach_mobile_notification_events_status_check
    check (status in ('sent', 'failed'))
);

create index coach_mobile_notification_events_auth_created_idx
on public.coach_mobile_notification_events (auth_user_id, created_at desc)
where auth_user_id is not null;

create index coach_mobile_notification_events_profile_created_idx
on public.coach_mobile_notification_events (user_profile_id, created_at desc)
where user_profile_id is not null;

alter table public.coach_mobile_push_installations enable row level security;
alter table public.coach_mobile_push_installations force row level security;
alter table public.coach_mobile_notification_events enable row level security;
alter table public.coach_mobile_notification_events force row level security;

revoke all on public.coach_mobile_push_installations from public, anon, authenticated;
revoke all on public.coach_mobile_notification_events from public, anon, authenticated;
revoke all on sequence public.coach_mobile_notification_events_id_seq from public, anon, authenticated;

grant select, insert, update, delete on public.coach_mobile_push_installations to service_role;
grant select, insert, update, delete on public.coach_mobile_notification_events to service_role;
grant usage, select on sequence public.coach_mobile_notification_events_id_seq to service_role;
