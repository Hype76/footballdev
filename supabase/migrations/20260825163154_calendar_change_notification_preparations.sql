create table public.calendar_change_notification_preparations (
  id uuid primary key default gen_random_uuid(),
  request_token uuid not null,
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  change_action text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  parent_link_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'prepared',
  delivery_result jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (timezone('utc', now()) + interval '30 minutes'),
  committed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint calendar_change_notification_source_check check (
    source_type in ('calendar', 'match-day', 'session', 'assessment-reminder')
  ),
  constraint calendar_change_notification_action_check check (
    change_action in ('rescheduled', 'cancelled', 'deleted')
  ),
  constraint calendar_change_notification_status_check check (
    status in ('prepared', 'committing', 'committed', 'failed', 'expired')
  ),
  unique (actor_user_id, request_token)
);

create index calendar_change_notification_preparations_source_idx
on public.calendar_change_notification_preparations (club_id, source_type, source_id, created_at desc);

create index calendar_change_notification_preparations_expiry_idx
on public.calendar_change_notification_preparations (status, expires_at);

alter table public.calendar_change_notification_preparations enable row level security;
alter table public.calendar_change_notification_preparations force row level security;

revoke all on table public.calendar_change_notification_preparations from public, anon, authenticated;
grant select, insert, update, delete on table public.calendar_change_notification_preparations to service_role;

alter table public.parent_mobile_notification_events
  drop constraint if exists parent_mobile_notification_events_intent_check;
alter table public.parent_mobile_notification_events
  add constraint parent_mobile_notification_events_intent_check
  check (intent_type in (
    'parent_message',
    'parent_poll',
    'matchday_update',
    'training_update',
    'parent_chat',
    'resource_shared',
    'poll_results',
    'calendar_update'
  ));

comment on table public.calendar_change_notification_preparations is
  'Service-only two-step notification authority. Recipient scope is captured before a Calendar change and delivery is committed only after the mutation is verified.';
