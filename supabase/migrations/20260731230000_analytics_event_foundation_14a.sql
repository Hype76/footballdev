alter table public.analytics_events
  add column if not exists received_at timestamptz not null default timezone('utc', now()),
  add column if not exists event_category text not null default 'unknown',
  add column if not exists action_family text not null default 'unknown',
  add column if not exists route_key text not null default '',
  add column if not exists source text not null default 'web',
  add column if not exists production_state text not null default 'production',
  add column if not exists actor_auth_user_id uuid,
  add column if not exists actor_profile_id uuid references public.users(id) on delete set null,
  add column if not exists actor_role_at_event text not null default 'unknown',
  add column if not exists actor_role_family text not null default 'unknown',
  add column if not exists request_id text not null default '',
  add column if not exists internal_state boolean not null default false,
  add column if not exists fp_test_state boolean not null default false,
  add column if not exists page_view boolean not null default false,
  add column if not exists idempotency_key text,
  add column if not exists schema_version smallint not null default 1,
  add column if not exists processed_at timestamptz,
  add column if not exists processor_run_id uuid;

update public.analytics_events
set
  event_category = case
    when event_name like 'auth.%' then 'authentication'
    when event_name = 'page.viewed' then 'navigation'
    else 'meaningful_action'
  end,
  action_family = coalesce(nullif(feature_key, ''), split_part(event_name, '.', 1), 'unknown'),
  route_key = canonical_route,
  source = case when source_kind = 'audit' then 'server_audit' else 'web' end,
  production_state = environment,
  actor_auth_user_id = user_id,
  actor_profile_id = user_id,
  actor_role_at_event = role,
  actor_role_family = case
    when role = 'super_admin' then 'platform_admin'
    when role in ('parent', 'parent_portal') then 'parent'
    when role = 'adult_player' then 'player'
    when role in ('club_admin', 'head_manager', 'manager', 'coach', 'assistant_coach') then 'staff'
    else 'unknown'
  end,
  internal_state = role = 'super_admin',
  fp_test_state = is_excluded and role <> 'super_admin',
  page_view = event_name = 'page.viewed',
  idempotency_key = client_event_id
where schema_version = 1;

create or replace function public.canonicalize_analytics_event_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.received_at := coalesce(new.received_at, timezone('utc', now()));
  new.actor_auth_user_id := coalesce(new.actor_auth_user_id, new.user_id);
  new.actor_profile_id := coalesce(new.actor_profile_id, new.user_id);
  new.actor_role_at_event := coalesce(nullif(new.actor_role_at_event, 'unknown'), new.role, 'unknown');
  new.actor_role_family := case
    when new.actor_role_at_event = 'super_admin' then 'platform_admin'
    when new.actor_role_at_event = 'club_admin' then 'club_admin'
    when new.actor_role_at_event in ('parent', 'parent_portal') then 'parent'
    when new.actor_role_at_event = 'adult_player' then 'player'
    when new.actor_role_at_event in ('head_manager', 'manager', 'coach', 'assistant_coach') then 'staff'
    else 'unknown'
  end;
  new.event_category := case
    when new.event_name like 'auth.%' then 'authentication'
    when new.event_name in ('page.view', 'page.viewed', 'workspace.switch', 'child.switch', 'team.switch')
      then 'navigation'
    else 'meaningful_action'
  end;
  new.action_family := coalesce(nullif(new.action_family, 'unknown'), nullif(new.feature_key, ''), split_part(new.event_name, '.', 1));
  new.route_key := coalesce(nullif(new.route_key, ''), new.canonical_route, '');
  new.production_state := coalesce(nullif(new.production_state, ''), new.environment, 'production');
  new.internal_state := coalesce(new.internal_state, false) or new.actor_role_at_event = 'super_admin';
  new.page_view := coalesce(new.page_view, false) or new.event_name in ('page.view', 'page.viewed');
  new.idempotency_key := coalesce(nullif(new.idempotency_key, ''), new.client_event_id);
  new.schema_version := greatest(coalesce(new.schema_version, 1), 2);
  return new;
end;
$$;

drop trigger if exists analytics_events_canonicalize_insert on public.analytics_events;
create trigger analytics_events_canonicalize_insert
before insert on public.analytics_events
for each row execute function public.canonicalize_analytics_event_insert();

alter table public.analytics_events
  alter column actor_auth_user_id set not null,
  alter column actor_profile_id set not null,
  alter column idempotency_key set not null;

alter table public.analytics_events
  drop constraint if exists analytics_events_name_check;

alter table public.analytics_events
  drop constraint if exists analytics_events_metadata_allowlist_check;

alter table public.analytics_events
  add constraint analytics_events_name_check check (
    event_name = any (array[
      'auth.login_success', 'auth.login_succeeded', 'auth.login_failure', 'auth.logout', 'auth.session_refresh',
      'page.view', 'page.viewed', 'workspace.switch', 'child.switch', 'team.switch',
      'calendar.event_created', 'calendar.response_submitted',
      'development.record_submitted', 'development.report_viewed',
      'chat.message_sent', 'invitation.sent', 'invitation.responded',
      'player.created', 'role.assignment_changed', 'match.selection_changed',
      'resource.viewed', 'poll.responded',
      'platform.action_completed', 'player.viewed', 'assessment.started', 'assessment.submitted',
      'feedback.created', 'feedback.viewed', 'calendar.viewed', 'matchday.viewed',
      'matchday.created', 'matchday.started', 'parent_portal.viewed',
      'parent_feedback.viewed', 'parent_availability_submitted', 'poll.voted',
      'message.viewed', 'data_transfer.started', 'data_transfer.completed', 'form.completed'
    ])
  ),
  add constraint analytics_events_metadata_allowlist_check check (
    metadata - array[
      'routeFamily',
      'uiSurface',
      'deviceCategory',
      'pwaState',
      'eventType',
      'operationResult',
      'durationBucket',
      'errorCategory'
    ]::text[] = '{}'::jsonb
    and not jsonb_path_exists(metadata, '$.* ? (@.type() != "string")')
  );

alter table public.analytics_events
  add constraint analytics_events_schema_version_check check (schema_version between 1 and 10),
  add constraint analytics_events_request_id_check check (length(request_id) <= 96),
  add constraint analytics_events_idempotency_key_check check (length(idempotency_key) between 1 and 160),
  add constraint analytics_events_safe_state_check check (
    production_state in ('production', 'preview', 'test', 'local')
    and event_category in ('authentication', 'navigation', 'meaningful_action')
    and actor_role_family in ('platform_admin', 'club_admin', 'staff', 'parent', 'player', 'unknown')
  );

create unique index if not exists analytics_events_canonical_idempotency_idx
on public.analytics_events (actor_profile_id, event_name, idempotency_key);

create index if not exists analytics_events_processing_idx
on public.analytics_events (received_at, id)
where processed_at is null;

create table if not exists public.analytics_processor_state (
  singleton boolean primary key default true check (singleton),
  watermark_received_at timestamptz,
  watermark_event_id uuid,
  audit_watermark_created_at timestamptz,
  last_successful_run_id uuid,
  last_failed_run_id uuid,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.analytics_processor_state(singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.analytics_processor_runs (
  id uuid primary key default gen_random_uuid(),
  invocation_id text not null unique,
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped_overlap')),
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  source_start_at timestamptz,
  source_end_at timestamptz,
  rows_scanned integer not null default 0,
  rows_accepted integer not null default 0,
  rows_rejected integer not null default 0,
  rows_unattributed integer not null default 0,
  rows_aggregated integer not null default 0,
  failure_category text,
  watermark_before timestamptz,
  watermark_after timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists analytics_processor_one_running_idx
on public.analytics_processor_runs ((true))
where status = 'running';

create index if not exists analytics_processor_runs_started_idx
on public.analytics_processor_runs(started_at desc);

create table if not exists public.analytics_event_quarantine (
  id uuid primary key default gen_random_uuid(),
  processor_run_id uuid references public.analytics_processor_runs(id) on delete set null,
  source_kind text not null,
  source_record_id uuid,
  received_at timestamptz not null default timezone('utc', now()),
  safe_reason text not null,
  safe_event_name text not null default '',
  safe_actor_profile_id uuid,
  safe_context jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  constraint analytics_event_quarantine_metadata_check check (
    jsonb_typeof(safe_context) = 'object'
    and octet_length(safe_context::text) <= 1024
    and not (safe_context ?| array['name','email','message','content','notes','token','password','body'])
  )
);

create unique index if not exists analytics_event_quarantine_source_idx
on public.analytics_event_quarantine(source_kind, source_record_id, safe_reason)
where source_record_id is not null;

alter table public.analytics_processor_state enable row level security;
alter table public.analytics_processor_runs enable row level security;
alter table public.analytics_event_quarantine enable row level security;

revoke all on table public.analytics_processor_state from public, anon, authenticated;
revoke all on table public.analytics_processor_runs from public, anon, authenticated;
revoke all on table public.analytics_event_quarantine from public, anon, authenticated;
grant select, insert, update on table public.analytics_processor_state to service_role;
grant select, insert, update on table public.analytics_processor_runs to service_role;
grant select, insert, update on table public.analytics_event_quarantine to service_role;

create or replace function public.get_platform_analytics_diagnostics(
  start_at_value timestamptz,
  end_at_value timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with scoped as (
    select *
    from public.analytics_events
    where occurred_at >= start_at_value and occurred_at < end_at_value
  ),
  processor as (
    select
      state.watermark_received_at,
      state.last_successful_run_id,
      state.last_failed_run_id
    from public.analytics_processor_state state
    where state.singleton
  )
  select jsonb_build_object(
    'rawEvents', count(*),
    'canonicallyClassifiedEvents', count(*) filter (where schema_version >= 2),
    'pageViews', count(*) filter (where page_view),
    'meaningfulActions', count(*) filter (where is_meaningful),
    'successfulLogins', count(*) filter (where event_name in ('auth.login_success', 'auth.login_succeeded')),
    'distinctUsers', count(distinct actor_profile_id),
    'attributedRoles', count(*) filter (where actor_role_family <> 'unknown'),
    'attributedClubs', count(*) filter (where club_id is not null),
    'unattributedUsers', count(*) filter (where actor_profile_id is null),
    'unattributedRoles', count(*) filter (where actor_role_family = 'unknown'),
    'unattributedClubs', count(*) filter (where club_id is null and actor_role_family <> 'platform_admin'),
    'internalEvents', count(*) filter (where internal_state),
    'fpTestEvents', count(*) filter (where fp_test_state),
    'processorWatermark', (select watermark_received_at from processor),
    'lastSuccessfulProcessorRun', (select last_successful_run_id from processor),
    'lastFailedProcessorRun', (select last_failed_run_id from processor),
    'rowsAwaitingProcessing', (select count(*) from public.analytics_events where processed_at is null),
    'rowsQuarantined', (select count(*) from public.analytics_event_quarantine where resolved_at is null)
  )
  from scoped;
$$;

revoke all on function public.get_platform_analytics_diagnostics(timestamptz, timestamptz)
from public, anon, authenticated;
grant execute on function public.get_platform_analytics_diagnostics(timestamptz, timestamptz)
to service_role;

alter function public.refresh_platform_analytics_aggregates(date, date)
rename to refresh_platform_analytics_aggregates_legacy_14a;

create function public.refresh_platform_analytics_aggregates(
  start_date_value date,
  end_date_value date
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform public.refresh_platform_analytics_aggregates_legacy_14a(
    start_date_value,
    end_date_value
  );

  update public.analytics_daily_user_activity target
  set page_view_count = source.page_views
  from (
    select
      timezone('Europe/London', event.occurred_at)::date as activity_date,
      event.user_id,
      event.role,
      event.club_id,
      event.platform,
      event.is_excluded,
      count(*) filter (where event.event_name in ('page.view', 'page.viewed'))::integer as page_views
    from public.analytics_events event
    where timezone('Europe/London', event.occurred_at)::date between start_date_value and end_date_value
    group by
      timezone('Europe/London', event.occurred_at)::date,
      event.user_id,
      event.role,
      event.club_id,
      event.platform,
      event.is_excluded
  ) source
  where target.activity_date = source.activity_date
    and target.user_id = source.user_id
    and target.role = source.role
    and target.platform = source.platform
    and target.is_excluded = source.is_excluded
    and target.club_id is not distinct from source.club_id;

  delete from public.analytics_daily_page_user_activity
  where activity_date between start_date_value and end_date_value;

  insert into public.analytics_daily_page_user_activity (
    activity_date, user_id, role, club_id, platform, canonical_route,
    is_excluded, page_views, session_count, meaningful_follow_on_actions
  )
  select
    timezone('Europe/London', event.occurred_at)::date,
    event.user_id,
    event.role,
    event.club_id,
    event.platform,
    event.canonical_route,
    event.is_excluded,
    count(*) filter (where event.event_name in ('page.view', 'page.viewed'))::integer,
    count(distinct nullif(event.session_id, ''))
      filter (where event.event_name in ('page.view', 'page.viewed'))::integer,
    count(*) filter (where event.is_meaningful)::integer
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
  having count(*) filter (where event.event_name in ('page.view', 'page.viewed')) > 0;

  update public.analytics_hourly_user_activity target
  set page_views = source.page_views
  from (
    select
      timezone('Europe/London', event.occurred_at)::date as activity_date,
      extract(hour from timezone('Europe/London', event.occurred_at))::smallint as hour_bucket,
      event.user_id,
      event.role,
      event.club_id,
      event.platform,
      event.is_excluded,
      count(*) filter (where event.event_name in ('page.view', 'page.viewed'))::integer as page_views
    from public.analytics_events event
    where timezone('Europe/London', event.occurred_at)::date between start_date_value and end_date_value
    group by
      timezone('Europe/London', event.occurred_at)::date,
      extract(hour from timezone('Europe/London', event.occurred_at)),
      event.user_id,
      event.role,
      event.club_id,
      event.platform,
      event.is_excluded
  ) source
  where target.activity_date = source.activity_date
    and target.hour_bucket = source.hour_bucket
    and target.user_id = source.user_id
    and target.role = source.role
    and target.platform = source.platform
    and target.is_excluded = source.is_excluded
    and target.club_id is not distinct from source.club_id;

  delete from public.analytics_hourly_page_activity
  where activity_date between start_date_value and end_date_value;

  insert into public.analytics_hourly_page_activity (
    activity_date, day_of_week, hour_bucket, role, club_id, platform,
    canonical_route, is_excluded, page_views, unique_users, sessions
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
    and event.event_name in ('page.view', 'page.viewed')
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

  update public.analytics_hourly_platform_activity target
  set page_views = source.page_views
  from (
    select
      timezone('Europe/London', event.occurred_at)::date as activity_date,
      extract(hour from timezone('Europe/London', event.occurred_at))::smallint as hour_bucket,
      event.role,
      event.club_id,
      event.platform,
      event.is_excluded,
      count(*) filter (where event.event_name in ('page.view', 'page.viewed'))::integer as page_views
    from public.analytics_events event
    where timezone('Europe/London', event.occurred_at)::date between start_date_value and end_date_value
    group by
      timezone('Europe/London', event.occurred_at)::date,
      extract(hour from timezone('Europe/London', event.occurred_at)),
      event.role,
      event.club_id,
      event.platform,
      event.is_excluded
  ) source
  where target.activity_date = source.activity_date
    and target.hour_bucket = source.hour_bucket
    and target.role = source.role
    and target.platform = source.platform
    and target.is_excluded = source.is_excluded
    and target.club_id is not distinct from source.club_id;
end;
$$;

revoke all on function public.refresh_platform_analytics_aggregates_legacy_14a(date, date)
from public, anon, authenticated;
revoke all on function public.refresh_platform_analytics_aggregates(date, date)
from public, anon, authenticated;
grant execute on function public.refresh_platform_analytics_aggregates(date, date)
to service_role;

comment on table public.analytics_processor_runs is
'Privacy-safe, append-only operational evidence for bounded analytics processing.';
comment on table public.analytics_event_quarantine is
'Privacy-safe reasons for analytics source rows that could not be canonically classified.';
comment on function public.get_platform_analytics_diagnostics(timestamptz, timestamptz) is
'Platform Admin diagnostic evidence. Execute only through the server-side service role after authorization.';
