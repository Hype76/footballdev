create table if not exists public.match_day_scorer_reminder_operations (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null references public.match_days (id) on delete cascade,
  role_assignment_id uuid not null references public.match_day_role_assignments (id) on delete cascade,
  parent_link_id uuid not null references public.parent_player_links (id) on delete cascade,
  auth_user_id uuid references auth.users (id) on delete set null,
  email_queue_id uuid references public.scheduled_email_queue (id) on delete set null,
  operation_key text not null,
  purpose text not null default 'match_day_scorer_0600',
  scheduled_for timestamptz not null,
  status text not null default 'queued',
  cancellation_reason text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  cancelled_at timestamptz,
  sent_at timestamptz,
  constraint match_day_scorer_reminder_operations_status_check
    check (status in ('queued', 'sent', 'cancelled', 'failed')),
  constraint match_day_scorer_reminder_operations_purpose_check
    check (purpose = 'match_day_scorer_0600')
);

create unique index if not exists match_day_scorer_reminder_operations_key_key
on public.match_day_scorer_reminder_operations (operation_key);

create index if not exists match_day_scorer_reminder_operations_match_status_idx
on public.match_day_scorer_reminder_operations (match_day_id, status, scheduled_for);

alter table public.match_day_scorer_reminder_operations enable row level security;
alter table public.match_day_scorer_reminder_operations force row level security;
revoke all on public.match_day_scorer_reminder_operations from public, anon, authenticated;
grant all on public.match_day_scorer_reminder_operations to service_role;

create or replace function public.cancel_match_day_scorer_reminders(
  match_day_id_value uuid,
  reason_value text default 'superseded'
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  cancelled_count integer := 0;
begin
  with cancelled_operations as (
    update public.match_day_scorer_reminder_operations operation
    set status = 'cancelled',
        cancellation_reason = left(coalesce(nullif(trim(reason_value), ''), 'superseded'), 200),
        cancelled_at = statement_timestamp(),
        updated_at = statement_timestamp()
    where operation.match_day_id = match_day_id_value
      and operation.status = 'queued'
    returning operation.email_queue_id
  )
  update public.scheduled_email_queue queue
  set status = 'failed',
      delivery_state = 'cancelled',
      retry_enabled = false,
      next_retry_at = null,
      last_error = 'Match Day scorer reminder cancelled before send.',
      failure_category = 'non_retryable_cancelled',
      safe_error_code = 'match_day_scorer_reminder_cancelled',
      terminal_at = statement_timestamp(),
      lease_owner = null,
      leased_at = null,
      lease_expires_at = null
  where queue.id in (select email_queue_id from cancelled_operations where email_queue_id is not null)
    and queue.status in ('scheduled', 'failed');

  get diagnostics cancelled_count = row_count;
  return cancelled_count;
end;
$$;

revoke all on function public.cancel_match_day_scorer_reminders(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_match_day_scorer_reminders(uuid, text) to service_role;

create or replace function public.schedule_match_day_scorer_reminder(
  match_day_id_value uuid,
  role_assignment_id_value uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  match_row public.match_days%rowtype;
  assignment_row public.match_day_role_assignments%rowtype;
  parent_link_row public.parent_player_links%rowtype;
  club_row public.clubs%rowtype;
  team_name_value text := '';
  timezone_value text := 'Europe/London';
  local_today date;
  reminder_at timestamptz;
  operation_key_value text;
  queue_id_value uuid;
  operation_id_value uuid;
  existing_operation public.match_day_scorer_reminder_operations%rowtype;
  deep_link_value text;
  fixture_name_value text;
  email_html_value text;
begin
  select * into match_row
  from public.match_days
  where id = match_day_id_value;

  select * into assignment_row
  from public.match_day_role_assignments
  where id = role_assignment_id_value
    and match_day_id = match_day_id_value
    and role = 'scorer';

  if match_row.id is null or assignment_row.id is null then
    return jsonb_build_object('scheduled', false, 'reason', 'missing_scope');
  end if;

  if match_row.deleted_at is not null
    or match_row.concluded_at is not null
    or match_row.status in ('cancelled', 'postponed', 'full_time')
    or match_row.match_date is null then
    return jsonb_build_object('scheduled', false, 'reason', 'closed_fixture');
  end if;

  select * into parent_link_row
  from public.parent_player_links
  where id = assignment_row.parent_link_id
    and auth_user_id = assignment_row.auth_user_id
    and club_id = assignment_row.club_id
    and team_id = assignment_row.team_id
    and status = 'active'
    and nullif(trim(email), '') is not null;

  if parent_link_row.id is null then
    return jsonb_build_object('scheduled', false, 'reason', 'inactive_recipient');
  end if;

  select * into club_row from public.clubs where id = match_row.club_id;
  select coalesce(team.name, '') into team_name_value from public.teams team where team.id = match_row.team_id;
  timezone_value := coalesce(nullif(trim(club_row.timezone_name), ''), 'Europe/London');
  local_today := timezone(timezone_value, statement_timestamp())::date;

  if match_row.match_date < local_today then
    return jsonb_build_object('scheduled', false, 'reason', 'historical_fixture');
  end if;

  reminder_at := (match_row.match_date + time '06:00')::timestamp at time zone timezone_value;
  if match_row.match_date = local_today and reminder_at <= statement_timestamp() then
    reminder_at := statement_timestamp();
  end if;

  operation_key_value := concat(
    'match-day-scorer-reminder:', match_row.id, ':', assignment_row.id, ':',
    assignment_row.parent_link_id, ':', match_row.match_date::text, ':0600'
  );

  select * into existing_operation
  from public.match_day_scorer_reminder_operations
  where operation_key = operation_key_value;

  if existing_operation.id is not null and existing_operation.status in ('queued', 'sent') then
    return jsonb_build_object(
      'scheduled', true,
      'idempotent', true,
      'operationId', existing_operation.id,
      'operationKey', existing_operation.operation_key,
      'emailQueueId', existing_operation.email_queue_id,
      'scheduledFor', existing_operation.scheduled_for
    );
  end if;

  perform public.cancel_match_day_scorer_reminders(match_row.id, 'scorer_or_fixture_changed');

  deep_link_value := concat(
    'https://parent.footballplayer.online/parent-portal?section=matches&parentLinkId=',
    parent_link_row.id, '&matchDayId=', match_row.id
  );
  fixture_name_value := concat(
    coalesce(nullif(team_name_value, ''), 'Your team'), ' vs ',
    coalesce(nullif(trim(match_row.opponent), ''), 'Opponent')
  );
  email_html_value := concat(
    '<p>You are scoring today''s match.</p>',
    '<p><strong>', public.calendar_event_notification_escape_html(fixture_name_value), '</strong></p>',
    '<p>Open Footballplayer.online to view the fixture and access Game Mode.</p>',
    '<p><a href="', public.calendar_event_notification_escape_html(deep_link_value), '">Open today''s match</a></p>'
  );

  insert into public.scheduled_email_queue (
    club_id, team_id, created_by, created_by_email, to_email, subject,
    status, scheduled_at, payload
  ) values (
    match_row.club_id,
    match_row.team_id,
    assignment_row.assigned_by,
    '',
    parent_link_row.email,
    concat('You are scoring today: ', fixture_name_value),
    'scheduled',
    reminder_at,
    jsonb_build_object(
      'displayName', 'Football Player',
      'teamName', team_name_value,
      'clubName', coalesce(club_row.name, ''),
      'resendPayload', jsonb_build_object(
        'to', jsonb_build_array(parent_link_row.email),
        'subject', concat('You are scoring today: ', fixture_name_value),
        'html', email_html_value
      ),
      'matchDayScorerReminder', jsonb_build_object(
        'operationKey', operation_key_value,
        'matchDayId', match_row.id,
        'roleAssignmentId', assignment_row.id,
        'parentLinkId', parent_link_row.id,
        'purpose', 'match_day_scorer_0600',
        'deepLink', deep_link_value
      ),
      'deliveryTelemetry', jsonb_build_object(
        'source', 'match_day_scorer_reminder',
        'originActionAt', statement_timestamp(),
        'eligibleAt', reminder_at,
        'enqueuedAt', statement_timestamp()
      )
    )
  ) returning id into queue_id_value;

  insert into public.match_day_scorer_reminder_operations (
    match_day_id, role_assignment_id, parent_link_id, auth_user_id,
    email_queue_id, operation_key, scheduled_for, status
  ) values (
    match_row.id, assignment_row.id, assignment_row.parent_link_id, assignment_row.auth_user_id,
    queue_id_value, operation_key_value, reminder_at, 'queued'
  )
  on conflict (operation_key) do update
  set email_queue_id = excluded.email_queue_id,
      scheduled_for = excluded.scheduled_for,
      status = 'queued',
      cancellation_reason = '',
      cancelled_at = null,
      updated_at = statement_timestamp()
  returning id into operation_id_value;

  return jsonb_build_object(
    'scheduled', true,
    'operationId', operation_id_value,
    'operationKey', operation_key_value,
    'emailQueueId', queue_id_value,
    'scheduledFor', reminder_at
  );
exception when others then
  raise warning 'Match Day scorer reminder scheduling failed for match %: %', match_day_id_value, sqlerrm;
  return jsonb_build_object('scheduled', false, 'reason', 'queue_failure');
end;
$$;

revoke all on function public.schedule_match_day_scorer_reminder(uuid, uuid) from public, anon, authenticated;
grant execute on function public.schedule_match_day_scorer_reminder(uuid, uuid) to service_role;

create or replace function public.sync_match_day_scorer_reminder_from_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.role = 'scorer' then
    perform public.schedule_match_day_scorer_reminder(new.match_day_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists match_day_role_assignment_scorer_reminder on public.match_day_role_assignments;
create trigger match_day_role_assignment_scorer_reminder
after insert or update of parent_link_id, auth_user_id, updated_at
on public.match_day_role_assignments
for each row execute function public.sync_match_day_scorer_reminder_from_assignment();

create or replace function public.sync_match_day_scorer_reminder_from_fixture()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  assignment_id_value uuid;
begin
  if new.deleted_at is not null
    or new.concluded_at is not null
    or new.status in ('cancelled', 'postponed', 'full_time') then
    perform public.cancel_match_day_scorer_reminders(new.id, 'fixture_closed');
    return new;
  end if;

  if old.match_date is not distinct from new.match_date
    and old.kickoff_time is not distinct from new.kickoff_time then
    return new;
  end if;

  select assignment.id into assignment_id_value
  from public.match_day_role_assignments assignment
  where assignment.match_day_id = new.id
    and assignment.role = 'scorer';

  if assignment_id_value is null then
    perform public.cancel_match_day_scorer_reminders(new.id, 'scorer_not_selected');
  else
    perform public.schedule_match_day_scorer_reminder(new.id, assignment_id_value);
  end if;
  return new;
end;
$$;

drop trigger if exists match_day_fixture_scorer_reminder on public.match_days;
create trigger match_day_fixture_scorer_reminder
after update of match_date, kickoff_time, status, concluded_at, deleted_at
on public.match_days
for each row
when (
  old.match_date is distinct from new.match_date
  or old.kickoff_time is distinct from new.kickoff_time
  or old.status is distinct from new.status
  or old.concluded_at is distinct from new.concluded_at
  or old.deleted_at is distinct from new.deleted_at
)
execute function public.sync_match_day_scorer_reminder_from_fixture();

create or replace function public.validate_match_day_scorer_reminder(operation_key_value text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  operation_row public.match_day_scorer_reminder_operations%rowtype;
  is_valid boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required to validate scorer reminders.';
  end if;

  select * into operation_row
  from public.match_day_scorer_reminder_operations
  where operation_key = operation_key_value;

  if operation_row.id is null or operation_row.status <> 'queued' then
    return jsonb_build_object('valid', false, 'reason', 'inactive_operation');
  end if;

  select exists (
    select 1
    from public.match_day_role_assignments assignment
    join public.match_days fixture on fixture.id = assignment.match_day_id
    join public.parent_player_links parent_link on parent_link.id = assignment.parent_link_id
    join public.players player on player.id = parent_link.player_id
    join public.clubs club on club.id = fixture.club_id
    where assignment.id = operation_row.role_assignment_id
      and assignment.match_day_id = operation_row.match_day_id
      and assignment.role = 'scorer'
      and assignment.parent_link_id = operation_row.parent_link_id
      and assignment.auth_user_id = operation_row.auth_user_id
      and parent_link.auth_user_id = assignment.auth_user_id
      and parent_link.club_id = assignment.club_id
      and parent_link.team_id = assignment.team_id
      and parent_link.status = 'active'
      and player.club_id = assignment.club_id
      and player.team_id = assignment.team_id
      and coalesce(player.status, 'active') <> 'archived'
      and fixture.club_id = assignment.club_id
      and fixture.team_id = assignment.team_id
      and fixture.deleted_at is null
      and fixture.concluded_at is null
      and fixture.status not in ('cancelled', 'postponed', 'full_time')
      and fixture.match_date = timezone(
        coalesce(nullif(trim(club.timezone_name), ''), 'Europe/London'),
        statement_timestamp()
      )::date
  ) into is_valid;

  if not is_valid then
    update public.match_day_scorer_reminder_operations
    set status = 'cancelled', cancellation_reason = 'send_time_revalidation_failed',
        cancelled_at = statement_timestamp(), updated_at = statement_timestamp()
    where id = operation_row.id and status = 'queued';
  end if;

  return jsonb_build_object('valid', is_valid, 'reason', case when is_valid then 'current' else 'stale_scope' end);
end;
$$;

revoke all on function public.validate_match_day_scorer_reminder(text) from public, anon, authenticated;
grant execute on function public.validate_match_day_scorer_reminder(text) to service_role;

create or replace function public.mark_match_day_scorer_reminder_sent(operation_key_value text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required to complete scorer reminders.';
  end if;

  update public.match_day_scorer_reminder_operations
  set status = 'sent', sent_at = statement_timestamp(), updated_at = statement_timestamp()
  where operation_key = operation_key_value and status = 'queued';
end;
$$;

revoke all on function public.mark_match_day_scorer_reminder_sent(text) from public, anon, authenticated;
grant execute on function public.mark_match_day_scorer_reminder_sent(text) to service_role;

create or replace function public.get_match_day_presentation_states(match_day_ids_value uuid[])
returns table (
  match_day_id uuid,
  is_today boolean,
  presentation_priority integer,
  scheduled_kickoff_at timestamptz,
  is_before_kickoff boolean,
  server_local_date date,
  server_local_time time
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    fixture.id,
    fixture.match_date = timezone(
      coalesce(nullif(trim(club.timezone_name), ''), 'Europe/London'), statement_timestamp()
    )::date as is_today,
    case
      when fixture.status in ('live', 'half_time', 'second_half', 'extra_time', 'penalties') then 0
      when fixture.status in ('scheduled', 'scorer_request')
        and (fixture.kickoff_time is null or
          (fixture.match_date + fixture.kickoff_time)::timestamp at time zone
            coalesce(nullif(trim(club.timezone_name), ''), 'Europe/London') >= statement_timestamp()) then 1
      when fixture.status in ('scheduled', 'scorer_request') then 2
      when fixture.status = 'full_time' or fixture.concluded_at is not null then 3
      else 4
    end as presentation_priority,
    case when fixture.match_date is null or fixture.kickoff_time is null then null
      else (fixture.match_date + fixture.kickoff_time)::timestamp at time zone
        coalesce(nullif(trim(club.timezone_name), ''), 'Europe/London') end,
    case when fixture.match_date is null or fixture.kickoff_time is null then false
      else (fixture.match_date + fixture.kickoff_time)::timestamp at time zone
        coalesce(nullif(trim(club.timezone_name), ''), 'Europe/London') > statement_timestamp() end,
    timezone(coalesce(nullif(trim(club.timezone_name), ''), 'Europe/London'), statement_timestamp())::date,
    timezone(coalesce(nullif(trim(club.timezone_name), ''), 'Europe/London'), statement_timestamp())::time
  from public.match_days fixture
  join public.clubs club on club.id = fixture.club_id
  where fixture.id = any(coalesce(match_day_ids_value, '{}'::uuid[]))
    and fixture.deleted_at is null
    and (
      exists (
        select 1 from public.users actor
        where actor.id = auth.uid()
          and actor.status = 'active'
          and public.current_user_has_active_authority()
          and actor.role <> 'parent_portal'
          and (
            actor.role = 'super_admin'
            or (
              actor.club_id = fixture.club_id
              and coalesce(actor.role_rank, 0) >= 20
              and (
                coalesce(actor.role_rank, 0) >= 50
                or exists (
                  select 1 from public.team_staff staff
                  where staff.user_id = actor.id and staff.team_id = fixture.team_id
                )
              )
            )
          )
      )
      or exists (
        select 1
        from public.parent_player_links parent_link
        join public.players player on player.id = parent_link.player_id
        where parent_link.auth_user_id = auth.uid()
          and public.current_user_has_active_authority()
          and public.current_user_role() = 'parent_portal'
          and parent_link.status = 'active'
          and parent_link.club_id = fixture.club_id
          and parent_link.team_id = fixture.team_id
          and player.club_id = fixture.club_id
          and player.team_id = fixture.team_id
          and coalesce(player.status, 'active') <> 'archived'
      )
    );
$$;

revoke all on function public.get_match_day_presentation_states(uuid[]) from public, anon;
grant execute on function public.get_match_day_presentation_states(uuid[]) to authenticated, service_role;

create or replace function public.start_match_day(match_day_id_value uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_user_id uuid := auth.uid();
  match_row public.match_days%rowtype;
  start_result jsonb;
  is_staff_actor boolean := false;
  is_scorer_actor boolean := false;
begin
  if actor_user_id is null then
    raise exception 'Login is required before starting this match.';
  end if;
  if match_day_id_value is null then
    raise exception 'Choose a match to start.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match could not be found.';
  end if;

  is_staff_actor := public.can_manage_match_day(match_row.team_id)
    and (public.current_user_role() = 'super_admin' or match_row.club_id = public.current_user_club_id());
  is_scorer_actor := public.current_user_is_match_day_scorer(match_row.id);

  if not is_staff_actor and not is_scorer_actor then
    raise exception 'Assigned staff or selected scorer access is required to start this match.';
  end if;

  if match_row.concluded_at is not null
    or match_row.status in ('full_time', 'cancelled', 'postponed')
    or coalesce(match_row.timer_status, 'not_started') = 'full_time' then
    raise exception 'A completed, cancelled, or postponed match cannot be started.';
  end if;

  if not public.match_day_local_date_is_today(match_row.id) then
    raise exception 'This match can only be started on the fixture date.';
  end if;

  if coalesce(match_row.timer_status, 'not_started') = 'running'
    or match_row.status in ('live', 'second_half', 'extra_time', 'penalties') then
    return jsonb_build_object(
      'id', match_row.id, 'matchDayId', match_row.id, 'status', match_row.status,
      'phaseStartedAt', match_row.phase_started_at, 'timerStartedAt', match_row.timer_started_at,
      'timerPausedAt', match_row.timer_paused_at, 'timerElapsedSeconds', match_row.timer_elapsed_seconds,
      'timerStatus', match_row.timer_status, 'fullTimeResumeStatus', match_row.full_time_resume_status,
      'concludedAt', match_row.concluded_at, 'concludedBy', match_row.concluded_by,
      'updatedAt', match_row.updated_at, 'alreadyStarted', true
    );
  end if;

  if match_row.status not in ('scheduled', 'scorer_request')
    or coalesce(match_row.timer_status, 'not_started') <> 'not_started'
    or coalesce(match_row.timer_elapsed_seconds, 0) <> 0
    or match_row.timer_started_at is not null
    or match_row.phase_started_at is not null then
    raise exception 'This match is not in the Ready state. Use the existing clock controls.';
  end if;

  start_result := public.set_match_day_timer_state(match_row.id, 'start');
  return start_result || jsonb_build_object('alreadyStarted', false);
end;
$$;

revoke all on function public.start_match_day(uuid) from public, anon;
grant execute on function public.start_match_day(uuid) to authenticated, service_role;

comment on table public.match_day_scorer_reminder_operations is
  'Prospective, durable 06:00 local-time scorer reminder operations. Trigger creation means deployment does not backfill existing assignments.';
comment on function public.start_match_day(uuid) is
  'Shared, date-bound and idempotent Start Game transition for authorised staff and the canonical selected parent scorer.';
