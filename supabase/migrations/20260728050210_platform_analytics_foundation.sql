create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default timezone('utc', now()),
  event_name text not null,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null default 'unknown',
  club_id uuid references public.clubs (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,
  session_id text not null default '',
  platform text not null default 'web',
  canonical_route text not null default '',
  feature_key text not null default '',
  environment text not null default 'production',
  metadata jsonb not null default '{}'::jsonb,
  client_event_id text not null,
  source_kind text not null default 'direct',
  is_meaningful boolean not null default false,
  is_parent_activation boolean not null default false,
  is_club_activation boolean not null default false,
  is_excluded boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  constraint analytics_events_name_check check (
    event_name = any (array[
      'auth.login_succeeded',
      'page.viewed',
      'platform.action_completed',
      'player.viewed',
      'assessment.started',
      'assessment.submitted',
      'feedback.created',
      'feedback.viewed',
      'calendar.viewed',
      'calendar.event_created',
      'matchday.viewed',
      'matchday.created',
      'matchday.started',
      'parent_portal.viewed',
      'parent_feedback.viewed',
      'parent_availability_submitted',
      'poll.voted',
      'message.viewed',
      'data_transfer.started',
      'data_transfer.completed',
      'form.completed'
    ])
  ),
  constraint analytics_events_platform_check check (platform = any (array['web', 'parent_app', 'coach_app'])),
  constraint analytics_events_environment_check check (environment = any (array['production', 'preview', 'test', 'local'])),
  constraint analytics_events_source_check check (source_kind = any (array['direct', 'audit'])),
  constraint analytics_events_session_check check (length(session_id) <= 96),
  constraint analytics_events_client_event_check check (length(client_event_id) between 1 and 96),
  constraint analytics_events_route_check check (length(canonical_route) <= 160),
  constraint analytics_events_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint analytics_events_metadata_allowlist_check check (metadata = '{}'::jsonb),
  constraint analytics_events_metadata_size_check check (octet_length(metadata::text) <= 2048),
  constraint analytics_events_deduplication unique (user_id, event_name, client_event_id)
);

create index if not exists analytics_events_occurred_at_idx
on public.analytics_events (occurred_at desc);

create index if not exists analytics_events_user_occurred_idx
on public.analytics_events (user_id, occurred_at desc);

create index if not exists analytics_events_club_occurred_idx
on public.analytics_events (club_id, occurred_at desc)
where club_id is not null;

create index if not exists analytics_events_route_occurred_idx
on public.analytics_events (canonical_route, occurred_at desc)
where canonical_route <> '';

create index if not exists analytics_events_meaningful_occurred_idx
on public.analytics_events (occurred_at desc, user_id)
where is_meaningful is true;

create table if not exists public.analytics_daily_user_activity (
  id uuid primary key default gen_random_uuid(),
  activity_date date not null,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null,
  club_id uuid references public.clubs (id) on delete cascade,
  platform text not null,
  is_excluded boolean not null default false,
  login_count integer not null default 0 check (login_count >= 0),
  page_view_count integer not null default 0 check (page_view_count >= 0),
  meaningful_action_count integer not null default 0 check (meaningful_action_count >= 0),
  first_activity_at timestamptz,
  last_activity_at timestamptz,
  refreshed_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists analytics_daily_user_activity_scope_idx
on public.analytics_daily_user_activity (
  activity_date,
  user_id,
  role,
  platform,
  is_excluded,
  coalesce(club_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create index if not exists analytics_daily_user_activity_report_idx
on public.analytics_daily_user_activity (activity_date desc, role, platform, is_excluded);

create table if not exists public.analytics_daily_page_user_activity (
  id uuid primary key default gen_random_uuid(),
  activity_date date not null,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null,
  club_id uuid references public.clubs (id) on delete cascade,
  platform text not null,
  canonical_route text not null,
  is_excluded boolean not null default false,
  page_views integer not null default 0 check (page_views >= 0),
  session_count integer not null default 0 check (session_count >= 0),
  meaningful_follow_on_actions integer not null default 0 check (meaningful_follow_on_actions >= 0),
  refreshed_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists analytics_daily_page_user_activity_scope_idx
on public.analytics_daily_page_user_activity (
  activity_date,
  user_id,
  role,
  platform,
  canonical_route,
  is_excluded,
  coalesce(club_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create index if not exists analytics_daily_page_user_activity_report_idx
on public.analytics_daily_page_user_activity (activity_date desc, canonical_route, role, platform, is_excluded);

create table if not exists public.analytics_hourly_user_activity (
  id uuid primary key default gen_random_uuid(),
  activity_date date not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  hour_bucket smallint not null check (hour_bucket between 0 and 23),
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null,
  club_id uuid references public.clubs (id) on delete cascade,
  platform text not null,
  is_excluded boolean not null default false,
  login_count integer not null default 0 check (login_count >= 0),
  page_views integer not null default 0 check (page_views >= 0),
  meaningful_actions integer not null default 0 check (meaningful_actions >= 0),
  parent_actions integer not null default 0 check (parent_actions >= 0),
  staff_actions integer not null default 0 check (staff_actions >= 0),
  refreshed_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists analytics_hourly_user_activity_scope_idx
on public.analytics_hourly_user_activity (
  activity_date,
  hour_bucket,
  user_id,
  role,
  platform,
  is_excluded,
  coalesce(club_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create index if not exists analytics_hourly_user_activity_report_idx
on public.analytics_hourly_user_activity (activity_date desc, day_of_week, hour_bucket, role, platform, is_excluded);

create table if not exists public.analytics_hourly_page_activity (
  id uuid primary key default gen_random_uuid(),
  activity_date date not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  hour_bucket smallint not null check (hour_bucket between 0 and 23),
  role text not null,
  club_id uuid references public.clubs (id) on delete cascade,
  platform text not null,
  canonical_route text not null,
  is_excluded boolean not null default false,
  page_views integer not null default 0 check (page_views >= 0),
  unique_users integer not null default 0 check (unique_users >= 0),
  sessions integer not null default 0 check (sessions >= 0),
  refreshed_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists analytics_hourly_page_activity_scope_idx
on public.analytics_hourly_page_activity (
  activity_date,
  hour_bucket,
  role,
  platform,
  canonical_route,
  is_excluded,
  coalesce(club_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create index if not exists analytics_hourly_page_activity_report_idx
on public.analytics_hourly_page_activity (activity_date desc, canonical_route, hour_bucket, is_excluded);

create table if not exists public.analytics_hourly_platform_activity (
  id uuid primary key default gen_random_uuid(),
  activity_date date not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  hour_bucket smallint not null check (hour_bucket between 0 and 23),
  role text not null,
  club_id uuid references public.clubs (id) on delete cascade,
  platform text not null,
  is_excluded boolean not null default false,
  unique_active_users integer not null default 0 check (unique_active_users >= 0),
  login_count integer not null default 0 check (login_count >= 0),
  page_views integer not null default 0 check (page_views >= 0),
  meaningful_actions integer not null default 0 check (meaningful_actions >= 0),
  parent_actions integer not null default 0 check (parent_actions >= 0),
  staff_actions integer not null default 0 check (staff_actions >= 0),
  refreshed_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists analytics_hourly_platform_activity_scope_idx
on public.analytics_hourly_platform_activity (
  activity_date,
  hour_bucket,
  role,
  platform,
  is_excluded,
  coalesce(club_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create index if not exists analytics_hourly_platform_activity_report_idx
on public.analytics_hourly_platform_activity (activity_date desc, day_of_week, hour_bucket, is_excluded);

create table if not exists public.analytics_daily_club_activity (
  id uuid primary key default gen_random_uuid(),
  activity_date date not null,
  club_id uuid not null references public.clubs (id) on delete cascade,
  is_excluded boolean not null default false,
  unique_active_users integer not null default 0 check (unique_active_users >= 0),
  parent_active_users integer not null default 0 check (parent_active_users >= 0),
  staff_active_users integer not null default 0 check (staff_active_users >= 0),
  meaningful_action_count integer not null default 0 check (meaningful_action_count >= 0),
  features_used text[] not null default '{}'::text[],
  refreshed_at timestamptz not null default timezone('utc', now()),
  constraint analytics_daily_club_activity_scope unique (activity_date, club_id, is_excluded)
);

create index if not exists analytics_daily_club_activity_report_idx
on public.analytics_daily_club_activity (activity_date desc, club_id, is_excluded);

create table if not exists public.analytics_user_lifetime (
  user_id uuid primary key references public.users (id) on delete cascade,
  first_login_at timestamptz,
  first_meaningful_at timestamptz,
  first_parent_action_at timestamptz,
  last_login_at timestamptz,
  last_meaningful_at timestamptz,
  refreshed_at timestamptz not null default timezone('utc', now())
);

alter table public.analytics_events enable row level security;
alter table public.analytics_daily_user_activity enable row level security;
alter table public.analytics_daily_page_user_activity enable row level security;
alter table public.analytics_hourly_user_activity enable row level security;
alter table public.analytics_hourly_page_activity enable row level security;
alter table public.analytics_hourly_platform_activity enable row level security;
alter table public.analytics_daily_club_activity enable row level security;
alter table public.analytics_user_lifetime enable row level security;

revoke all on table public.analytics_events from public, anon, authenticated;
revoke all on table public.analytics_daily_user_activity from public, anon, authenticated;
revoke all on table public.analytics_daily_page_user_activity from public, anon, authenticated;
revoke all on table public.analytics_hourly_user_activity from public, anon, authenticated;
revoke all on table public.analytics_hourly_page_activity from public, anon, authenticated;
revoke all on table public.analytics_hourly_platform_activity from public, anon, authenticated;
revoke all on table public.analytics_daily_club_activity from public, anon, authenticated;
revoke all on table public.analytics_user_lifetime from public, anon, authenticated;

grant select, insert, update, delete on table public.analytics_events to service_role;
grant select, insert, update, delete on table public.analytics_daily_user_activity to service_role;
grant select, insert, update, delete on table public.analytics_daily_page_user_activity to service_role;
grant select, insert, update, delete on table public.analytics_hourly_user_activity to service_role;
grant select, insert, update, delete on table public.analytics_hourly_page_activity to service_role;
grant select, insert, update, delete on table public.analytics_hourly_platform_activity to service_role;
grant select, insert, update, delete on table public.analytics_daily_club_activity to service_role;
grant select, insert, update, delete on table public.analytics_user_lifetime to service_role;

create or replace function public.refresh_platform_analytics_aggregates(
  start_date_value date,
  end_date_value date
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if start_date_value is null or end_date_value is null or start_date_value > end_date_value then
    raise exception 'A valid analytics date range is required.';
  end if;

  if end_date_value - start_date_value > 120 then
    raise exception 'Analytics aggregation is limited to 121 days per run.';
  end if;

  delete from public.analytics_daily_user_activity
  where activity_date between start_date_value and end_date_value;

  insert into public.analytics_daily_user_activity (
    activity_date,
    user_id,
    role,
    club_id,
    platform,
    is_excluded,
    login_count,
    page_view_count,
    meaningful_action_count,
    first_activity_at,
    last_activity_at
  )
  select
    timezone('Europe/London', event.occurred_at)::date,
    event.user_id,
    event.role,
    event.club_id,
    event.platform,
    event.is_excluded,
    count(*) filter (where event.event_name = 'auth.login_succeeded')::integer,
    count(*) filter (where event.event_name = 'page.viewed')::integer,
    count(*) filter (where event.is_meaningful is true)::integer,
    min(event.occurred_at),
    max(event.occurred_at)
  from public.analytics_events event
  where timezone('Europe/London', event.occurred_at)::date between start_date_value and end_date_value
  group by
    timezone('Europe/London', event.occurred_at)::date,
    event.user_id,
    event.role,
    event.club_id,
    event.platform,
    event.is_excluded;

  delete from public.analytics_daily_page_user_activity
  where activity_date between start_date_value and end_date_value;

  insert into public.analytics_daily_page_user_activity (
    activity_date,
    user_id,
    role,
    club_id,
    platform,
    canonical_route,
    is_excluded,
    page_views,
    session_count,
    meaningful_follow_on_actions
  )
  select
    timezone('Europe/London', event.occurred_at)::date,
    event.user_id,
    event.role,
    event.club_id,
    event.platform,
    event.canonical_route,
    event.is_excluded,
    count(*) filter (where event.event_name = 'page.viewed')::integer,
    count(distinct nullif(event.session_id, '')) filter (where event.event_name = 'page.viewed')::integer,
    count(*) filter (where event.is_meaningful is true)::integer
  from public.analytics_events event
  where timezone('Europe/London', event.occurred_at)::date between start_date_value and end_date_value
    and event.canonical_route <> ''
  group by
    timezone('Europe/London', event.occurred_at)::date,
    event.user_id,
    event.role,
    event.club_id,
    event.platform,
    event.canonical_route,
    event.is_excluded
  having count(*) filter (where event.event_name = 'page.viewed') > 0;

  delete from public.analytics_hourly_user_activity
  where activity_date between start_date_value and end_date_value;

  insert into public.analytics_hourly_user_activity (
    activity_date,
    day_of_week,
    hour_bucket,
    user_id,
    role,
    club_id,
    platform,
    is_excluded,
    login_count,
    page_views,
    meaningful_actions,
    parent_actions,
    staff_actions
  )
  select
    timezone('Europe/London', event.occurred_at)::date,
    extract(dow from timezone('Europe/London', event.occurred_at))::smallint,
    extract(hour from timezone('Europe/London', event.occurred_at))::smallint,
    event.user_id,
    event.role,
    event.club_id,
    event.platform,
    event.is_excluded,
    count(*) filter (where event.event_name = 'auth.login_succeeded')::integer,
    count(*) filter (where event.event_name = 'page.viewed')::integer,
    count(*) filter (where event.is_meaningful is true)::integer,
    count(*) filter (where event.is_meaningful is true and event.role = 'parent_portal')::integer,
    count(*) filter (where event.is_meaningful is true and event.role not in ('parent_portal', 'super_admin'))::integer
  from public.analytics_events event
  where timezone('Europe/London', event.occurred_at)::date between start_date_value and end_date_value
  group by
    timezone('Europe/London', event.occurred_at)::date,
    extract(dow from timezone('Europe/London', event.occurred_at)),
    extract(hour from timezone('Europe/London', event.occurred_at)),
    event.user_id,
    event.role,
    event.club_id,
    event.platform,
    event.is_excluded;

  delete from public.analytics_hourly_page_activity
  where activity_date between start_date_value and end_date_value;

  insert into public.analytics_hourly_page_activity (
    activity_date,
    day_of_week,
    hour_bucket,
    role,
    club_id,
    platform,
    canonical_route,
    is_excluded,
    page_views,
    unique_users,
    sessions
  )
  select
    timezone('Europe/London', event.occurred_at)::date,
    extract(dow from timezone('Europe/London', event.occurred_at))::smallint,
    extract(hour from timezone('Europe/London', event.occurred_at))::smallint,
    event.role,
    event.club_id,
    event.platform,
    event.canonical_route,
    event.is_excluded,
    count(*)::integer,
    count(distinct event.user_id)::integer,
    count(distinct nullif(event.session_id, ''))::integer
  from public.analytics_events event
  where timezone('Europe/London', event.occurred_at)::date between start_date_value and end_date_value
    and event.event_name = 'page.viewed'
    and event.canonical_route <> ''
  group by
    timezone('Europe/London', event.occurred_at)::date,
    extract(dow from timezone('Europe/London', event.occurred_at)),
    extract(hour from timezone('Europe/London', event.occurred_at)),
    event.role,
    event.club_id,
    event.platform,
    event.canonical_route,
    event.is_excluded;

  delete from public.analytics_hourly_platform_activity
  where activity_date between start_date_value and end_date_value;

  insert into public.analytics_hourly_platform_activity (
    activity_date,
    day_of_week,
    hour_bucket,
    role,
    club_id,
    platform,
    is_excluded,
    unique_active_users,
    login_count,
    page_views,
    meaningful_actions,
    parent_actions,
    staff_actions
  )
  select
    timezone('Europe/London', event.occurred_at)::date,
    extract(dow from timezone('Europe/London', event.occurred_at))::smallint,
    extract(hour from timezone('Europe/London', event.occurred_at))::smallint,
    event.role,
    event.club_id,
    event.platform,
    event.is_excluded,
    count(distinct event.user_id) filter (where event.is_meaningful is true)::integer,
    count(*) filter (where event.event_name = 'auth.login_succeeded')::integer,
    count(*) filter (where event.event_name = 'page.viewed')::integer,
    count(*) filter (where event.is_meaningful is true)::integer,
    count(*) filter (where event.is_meaningful is true and event.role = 'parent_portal')::integer,
    count(*) filter (where event.is_meaningful is true and event.role not in ('parent_portal', 'super_admin'))::integer
  from public.analytics_events event
  where timezone('Europe/London', event.occurred_at)::date between start_date_value and end_date_value
  group by
    timezone('Europe/London', event.occurred_at)::date,
    extract(dow from timezone('Europe/London', event.occurred_at)),
    extract(hour from timezone('Europe/London', event.occurred_at)),
    event.role,
    event.club_id,
    event.platform,
    event.is_excluded;

  delete from public.analytics_daily_club_activity
  where activity_date between start_date_value and end_date_value;

  insert into public.analytics_daily_club_activity (
    activity_date,
    club_id,
    is_excluded,
    unique_active_users,
    parent_active_users,
    staff_active_users,
    meaningful_action_count,
    features_used
  )
  select
    timezone('Europe/London', event.occurred_at)::date,
    event.club_id,
    event.is_excluded,
    count(distinct event.user_id) filter (where event.is_meaningful is true)::integer,
    count(distinct event.user_id) filter (where event.is_meaningful is true and event.role = 'parent_portal')::integer,
    count(distinct event.user_id) filter (where event.is_meaningful is true and event.role not in ('parent_portal', 'super_admin'))::integer,
    count(*) filter (where event.is_meaningful is true)::integer,
    array_agg(distinct event.feature_key order by event.feature_key) filter (
      where event.is_meaningful is true and event.feature_key <> ''
    )
  from public.analytics_events event
  where timezone('Europe/London', event.occurred_at)::date between start_date_value and end_date_value
    and event.club_id is not null
  group by
    timezone('Europe/London', event.occurred_at)::date,
    event.club_id,
    event.is_excluded
  having count(*) filter (where event.is_meaningful is true) > 0;

  insert into public.analytics_user_lifetime (
    user_id,
    first_login_at,
    first_meaningful_at,
    first_parent_action_at,
    last_login_at,
    last_meaningful_at,
    refreshed_at
  )
  select
    event.user_id,
    min(event.occurred_at) filter (where event.event_name = 'auth.login_succeeded'),
    min(event.occurred_at) filter (where event.is_meaningful is true),
    min(event.occurred_at) filter (where event.is_parent_activation is true and event.is_meaningful is true),
    max(event.occurred_at) filter (where event.event_name = 'auth.login_succeeded'),
    max(event.occurred_at) filter (where event.is_meaningful is true),
    timezone('utc', now())
  from public.analytics_events event
  where timezone('Europe/London', event.occurred_at)::date between start_date_value and end_date_value
  group by event.user_id
  on conflict (user_id) do update
  set
    first_login_at = case
      when public.analytics_user_lifetime.first_login_at is null then excluded.first_login_at
      when excluded.first_login_at is null then public.analytics_user_lifetime.first_login_at
      else least(public.analytics_user_lifetime.first_login_at, excluded.first_login_at)
    end,
    first_meaningful_at = case
      when public.analytics_user_lifetime.first_meaningful_at is null then excluded.first_meaningful_at
      when excluded.first_meaningful_at is null then public.analytics_user_lifetime.first_meaningful_at
      else least(public.analytics_user_lifetime.first_meaningful_at, excluded.first_meaningful_at)
    end,
    first_parent_action_at = case
      when public.analytics_user_lifetime.first_parent_action_at is null then excluded.first_parent_action_at
      when excluded.first_parent_action_at is null then public.analytics_user_lifetime.first_parent_action_at
      else least(public.analytics_user_lifetime.first_parent_action_at, excluded.first_parent_action_at)
    end,
    last_login_at = case
      when public.analytics_user_lifetime.last_login_at is null then excluded.last_login_at
      when excluded.last_login_at is null then public.analytics_user_lifetime.last_login_at
      else greatest(public.analytics_user_lifetime.last_login_at, excluded.last_login_at)
    end,
    last_meaningful_at = case
      when public.analytics_user_lifetime.last_meaningful_at is null then excluded.last_meaningful_at
      when excluded.last_meaningful_at is null then public.analytics_user_lifetime.last_meaningful_at
      else greatest(public.analytics_user_lifetime.last_meaningful_at, excluded.last_meaningful_at)
    end,
    refreshed_at = timezone('utc', now());
end;
$$;

revoke all on function public.refresh_platform_analytics_aggregates(date, date) from public, anon, authenticated;
grant execute on function public.refresh_platform_analytics_aggregates(date, date) to service_role;

create or replace function public.cleanup_platform_analytics(
  raw_retention_days_value integer default 90,
  aggregate_retention_days_value integer default 760
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  raw_days integer := greatest(30, least(coalesce(raw_retention_days_value, 90), 365));
  aggregate_days integer := greatest(180, least(coalesce(aggregate_retention_days_value, 760), 1825));
begin
  delete from public.analytics_events
  where occurred_at < timezone('utc', now()) - make_interval(days => raw_days);

  delete from public.analytics_daily_user_activity
  where activity_date < current_date - aggregate_days;

  delete from public.analytics_daily_page_user_activity
  where activity_date < current_date - aggregate_days;

  delete from public.analytics_hourly_user_activity
  where activity_date < current_date - aggregate_days;

  delete from public.analytics_hourly_page_activity
  where activity_date < current_date - aggregate_days;

  delete from public.analytics_hourly_platform_activity
  where activity_date < current_date - aggregate_days;

  delete from public.analytics_daily_club_activity
  where activity_date < current_date - aggregate_days;
end;
$$;

revoke all on function public.cleanup_platform_analytics(integer, integer) from public, anon, authenticated;
grant execute on function public.cleanup_platform_analytics(integer, integer) to service_role;

comment on table public.analytics_events is
'Privacy-safe internal analytics events. No names, contact details, form values, feedback text, messages, notes, tokens, fingerprints, or click coordinates are permitted.';

comment on function public.refresh_platform_analytics_aggregates(date, date) is
'Idempotently rebuilds bounded UK-local daily and hourly analytics aggregates from UTC events.';

comment on function public.cleanup_platform_analytics(integer, integer) is
'Applies configurable retention with a 90-day raw default and a 760-day aggregate default.';
