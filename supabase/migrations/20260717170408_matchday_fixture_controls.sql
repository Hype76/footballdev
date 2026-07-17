alter table public.match_days
  add column if not exists fixture_type text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users (id) on delete set null;

alter table public.match_days
  drop constraint if exists match_days_fixture_type_check;

alter table public.match_days
  add constraint match_days_fixture_type_check
  check (fixture_type is null or fixture_type in ('friendly', 'league', 'cup', 'tournament'));

create index if not exists match_days_active_club_team_date_idx
on public.match_days (club_id, team_id, match_date, kickoff_time)
where deleted_at is null;

comment on column public.match_days.fixture_type is
  'Fixture classification. Null is retained only for legacy records created before classification was introduced.';

comment on column public.match_days.deleted_at is
  'Soft-delete timestamp for previous games. Dependent operational, notification, chat, report, and audit records are retained.';

create or replace function public.prevent_deleted_match_day_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.deleted_at is not null then
    raise exception 'A deleted previous game cannot be changed.';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_deleted_match_day_update() from public;
revoke execute on function public.prevent_deleted_match_day_update() from anon, authenticated;

drop trigger if exists prevent_deleted_match_day_update on public.match_days;
create trigger prevent_deleted_match_day_update
before update on public.match_days
for each row
execute function public.prevent_deleted_match_day_update();

alter table public.match_day_event_log
  drop constraint if exists match_day_event_log_event_type_check;

alter table public.match_day_event_log
  add constraint match_day_event_log_event_type_check check (
    event_type in (
      'match_day_created',
      'match_day_updated',
      'player_selected',
      'player_deselected',
      'player_availability_changed',
      'player_squad_decision_changed',
      'player_selection_notification_queued',
      'volunteer_role_accepted',
      'match_role_assigned',
      'match_role_removed',
      'scorer_updated',
      'linesman_updated',
      'invite_prepared',
      'invite_queued',
      'note_updated',
      'yellow_card',
      'red_card',
      'substitution',
      'water_break',
      'previous_game_deleted'
    )
  );

create or replace function public.delete_previous_match_day(match_day_id_value uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  actor_name text := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), '');
  actor_email text := coalesce(nullif(auth.jwt() ->> 'email', ''), '');
  actor_role text := coalesce(public.current_user_role(), '');
  actor_role_rank integer := coalesce(public.current_user_role_rank(), 0);
  actor_club_id uuid := public.current_user_club_id();
  match_row public.match_days%rowtype;
  retained_counts jsonb;
  now_value timestamptz := timezone('utc', now());
begin
  if actor_user_id is null then
    raise exception 'Login is required before deleting a previous game.';
  end if;

  if not exists (
    select 1
    from public.users actor_profile
    where actor_profile.id = actor_user_id
      and actor_profile.status = 'active'
  ) then
    raise exception 'An active staff profile is required to delete a previous game.';
  end if;

  if match_day_id_value is null then
    raise exception 'Choose a previous game to delete.';
  end if;

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null then
    raise exception 'This previous game could not be found.';
  end if;

  if actor_role in ('admin', 'parent_portal', 'super_admin')
    or actor_role_rank < 50
    or actor_club_id is null
    or match_row.club_id <> actor_club_id
    or match_row.team_id is null
    or not exists (
      select 1
      from public.team_staff assignment
      where assignment.team_id = match_row.team_id
        and assignment.user_id = actor_user_id
    ) then
    raise exception 'Manager or Team Admin access for this assigned team is required to delete a previous game.';
  end if;

  if match_row.deleted_at is not null then
    return jsonb_build_object(
      'matchDayId', match_row.id,
      'deleted', true,
      'alreadyDeleted', true,
      'deletedAt', match_row.deleted_at
    );
  end if;

  if match_row.concluded_at is null
    and match_row.status not in ('cancelled', 'postponed')
    and (match_row.match_date is null or match_row.match_date >= timezone('Europe/London', now())::date) then
    raise exception 'Only a concluded, cancelled, postponed, or past fixture can be deleted from Previous Games.';
  end if;

  if coalesce(match_row.timer_status, 'not_started') in ('running', 'paused', 'half_time', 'hydration')
    or match_row.status in ('live', 'half_time', 'second_half', 'extra_time', 'penalties') then
    raise exception 'An active or paused match cannot be deleted from Previous Games.';
  end if;

  if exists (
    select 1
    from public.calendar_event_notification_commands command
    where command.match_day_id = match_row.id
      and command.completed_at is null
  ) or exists (
    select 1
    from public.calendar_event_notification_events event
    where event.match_day_id = match_row.id
      and event.status in ('pending', 'queued', 'processing')
  ) or exists (
    select 1
    from public.match_day_notification_events event
    where event.match_day_id = match_row.id
      and event.status in ('pending', 'queued', 'processing')
  ) then
    raise exception 'This fixture still has pending notification work. Resolve it before deleting the previous game.';
  end if;

  retained_counts := jsonb_build_object(
    'availabilityRequests', (select count(*) from public.match_day_availability_requests item where item.match_day_id = match_row.id),
    'availabilityHistory', (select count(*) from public.match_day_player_availability_history item where item.match_day_id = match_row.id),
    'calendarInvites', (select count(*) from public.calendar_event_invites item where item.match_day_id = match_row.id),
    'events', (select count(*) from public.match_day_events item where item.match_day_id = match_row.id),
    'eventLog', (select count(*) from public.match_day_event_log item where item.match_day_id = match_row.id),
    'finalReports', (select count(*) from public.match_day_final_reports item where item.match_day_id = match_row.id),
    'notificationEvents', (select count(*) from public.match_day_notification_events item where item.match_day_id = match_row.id),
    'parentChatRooms', (select count(*) from public.parent_chat_rooms item where item.match_day_id = match_row.id),
    'roleAssignments', (select count(*) from public.match_day_role_assignments item where item.match_day_id = match_row.id),
    'squadDecisions', (select count(*) from public.match_day_player_squad_decisions item where item.match_day_id = match_row.id)
  );

  update public.match_days
  set
    deleted_at = now_value,
    deleted_by = actor_user_id,
    updated_at = now_value
  where id = match_row.id;

  insert into public.match_day_event_log (
    club_id,
    team_id,
    match_day_id,
    actor_user_id,
    actor_display_name,
    actor_role,
    event_type,
    event_label,
    previous_value,
    new_value,
    metadata
  ) values (
    match_row.club_id,
    match_row.team_id,
    match_row.id,
    actor_user_id,
    actor_name,
    actor_role,
    'previous_game_deleted',
    'Previous game deleted',
    jsonb_build_object('deletedAt', null),
    jsonb_build_object('deletedAt', now_value),
    jsonb_build_object(
      'source', 'delete_previous_match_day_rpc',
      'fixtureType', match_row.fixture_type,
      'retainedRecordCounts', retained_counts
    )
  );

  insert into public.audit_logs (
    club_id,
    actor_id,
    actor_email,
    actor_name,
    actor_role_label,
    actor_role_rank,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    match_row.club_id,
    actor_user_id,
    nullif(actor_email, ''),
    nullif(actor_name, ''),
    nullif(actor_role, ''),
    actor_role_rank,
    'match_day_previous_game_deleted',
    'match_day',
    match_row.id,
    jsonb_build_object(
      'teamId', match_row.team_id,
      'opponent', match_row.opponent,
      'fixtureType', match_row.fixture_type,
      'retainedRecordCounts', retained_counts
    )
  );

  return jsonb_build_object(
    'matchDayId', match_row.id,
    'deleted', true,
    'alreadyDeleted', false,
    'deletedAt', now_value,
    'retainedRecordCounts', retained_counts
  );
end;
$$;

revoke all on function public.delete_previous_match_day(uuid) from public;
revoke execute on function public.delete_previous_match_day(uuid) from anon;
grant execute on function public.delete_previous_match_day(uuid) to authenticated;
grant execute on function public.delete_previous_match_day(uuid) to service_role;

comment on function public.delete_previous_match_day(uuid) is
  'Soft-deletes one eligible previous game for assigned Manager-level staff, preserves dependent records, fails closed across team and club boundaries, and writes immutable event and audit evidence.';

create or replace function public.start_match_day(match_day_id_value uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  actor_role text := coalesce(public.current_user_role(), '');
  actor_role_rank integer := coalesce(public.current_user_role_rank(), 0);
  actor_club_id uuid := public.current_user_club_id();
  match_row public.match_days%rowtype;
  start_result jsonb;
begin
  if actor_user_id is null then
    raise exception 'Login is required before starting this match.';
  end if;

  if not exists (
    select 1
    from public.users actor_profile
    where actor_profile.id = actor_user_id
      and actor_profile.status = 'active'
  ) then
    raise exception 'An active staff profile is required to start this match.';
  end if;

  if match_day_id_value is null then
    raise exception 'Choose a match to start.';
  end if;

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match could not be found.';
  end if;

  if actor_role in ('admin', 'parent_portal', 'super_admin')
    or actor_role_rank < 20
    or actor_club_id is null
    or match_row.club_id <> actor_club_id
    or match_row.team_id is null
    or not exists (
      select 1
      from public.team_staff assignment
      where assignment.team_id = match_row.team_id
        and assignment.user_id = actor_user_id
    ) then
    raise exception 'Assigned coach or manager access for this team is required to start the match.';
  end if;

  if match_row.concluded_at is not null
    or match_row.status = 'full_time'
    or coalesce(match_row.timer_status, 'not_started') = 'full_time' then
    raise exception 'A completed match cannot be started again.';
  end if;

  if coalesce(match_row.timer_status, 'not_started') = 'running'
    or match_row.status in ('live', 'second_half', 'extra_time', 'penalties') then
    return jsonb_build_object(
      'id', match_row.id,
      'matchDayId', match_row.id,
      'status', match_row.status,
      'phaseStartedAt', match_row.phase_started_at,
      'timerStartedAt', match_row.timer_started_at,
      'timerPausedAt', match_row.timer_paused_at,
      'timerElapsedSeconds', match_row.timer_elapsed_seconds,
      'timerStatus', match_row.timer_status,
      'fullTimeResumeStatus', match_row.full_time_resume_status,
      'concludedAt', match_row.concluded_at,
      'concludedBy', match_row.concluded_by,
      'updatedAt', match_row.updated_at,
      'alreadyStarted', true
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

revoke all on function public.start_match_day(uuid) from public;
revoke execute on function public.start_match_day(uuid) from anon;
grant execute on function public.start_match_day(uuid) to authenticated;
grant execute on function public.start_match_day(uuid) to service_role;

comment on function public.start_match_day(uuid) is
  'Starts one genuinely Ready assigned-team match through the existing timer state machine and returns the existing state for same-match retries without writing a second start event.';

drop function if exists public.get_parent_portal_match_days(uuid);

create function public.get_parent_portal_match_days(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  team_name text,
  opponent text,
  fixture_type text,
  match_date date,
  kickoff_time time,
  kickoff_time_tbc boolean,
  arrival_time time,
  home_away text,
  venue_name text,
  venue_address text,
  notes text,
  scorer_request_message text,
  request_scorer boolean,
  request_linesman boolean,
  request_referee boolean,
  status text,
  home_score integer,
  away_score integer,
  created_at timestamptz,
  updated_at timestamptz,
  phase_started_at timestamptz,
  timer_started_at timestamptz,
  timer_paused_at timestamptz,
  timer_elapsed_seconds integer,
  timer_status text,
  availability_status text,
  availability_responded_at timestamptz,
  squad_decision_state text,
  squad_decision_updated_at timestamptz,
  volunteer_scorer_response text,
  volunteer_linesman_response text,
  volunteer_referee_response text,
  volunteer_responded_at timestamptz,
  has_interest boolean,
  is_scorer boolean,
  role_assignments jsonb,
  events jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with authorised_link as (
    select link.*
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = (select auth.uid())
      and link.status = 'active'
    limit 1
  ), legacy as (
    select legacy_row.*, fixture.fixture_type
    from public.get_parent_portal_match_days_calendar_notify_hotfix_legacy(parent_link_id_value) legacy_row
    join public.match_days fixture on fixture.id = legacy_row.id
    where fixture.deleted_at is null
  )
  select
    legacy.id, legacy.club_id, legacy.team_id, legacy.team_name, legacy.opponent, legacy.fixture_type,
    legacy.match_date, legacy.kickoff_time, legacy.kickoff_time_tbc, legacy.arrival_time, legacy.home_away,
    legacy.venue_name, legacy.venue_address, legacy.notes, legacy.scorer_request_message,
    legacy.request_scorer, legacy.request_linesman, legacy.request_referee, legacy.status,
    legacy.home_score, legacy.away_score, legacy.created_at, legacy.updated_at, legacy.phase_started_at,
    legacy.timer_started_at, legacy.timer_paused_at, legacy.timer_elapsed_seconds, legacy.timer_status,
    legacy.availability_status, legacy.availability_responded_at, legacy.squad_decision_state,
    legacy.squad_decision_updated_at, legacy.volunteer_scorer_response, legacy.volunteer_linesman_response,
    legacy.volunteer_referee_response, legacy.volunteer_responded_at, legacy.has_interest,
    legacy.is_scorer, legacy.role_assignments, legacy.events
  from legacy
  union all
  select
    fixture.id, fixture.club_id, fixture.team_id, coalesce(team.name, ''), fixture.opponent, fixture.fixture_type,
    fixture.match_date, fixture.kickoff_time, fixture.kickoff_time_tbc, fixture.arrival_time, fixture.home_away,
    fixture.venue_name, fixture.venue_address, fixture.notes, fixture.scorer_request_message,
    fixture.request_scorer, fixture.request_linesman, fixture.request_referee, fixture.status,
    fixture.home_score, fixture.away_score, fixture.created_at, fixture.updated_at, fixture.phase_started_at,
    fixture.timer_started_at, fixture.timer_paused_at, fixture.timer_elapsed_seconds, fixture.timer_status,
    null::text, null::timestamptz, coalesce(decision.status, 'undecided'), decision.updated_at,
    'no_response'::text, 'no_response'::text, 'no_response'::text, null::timestamptz,
    false, false, '[]'::jsonb,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', event.id,
          'eventType', event.event_type,
          'teamSide', event.team_side,
          'minute', event.minute,
          'scorerName', event.scorer_name,
          'scorerInitials', event.scorer_initials,
          'scorerShirtNumber', event.scorer_shirt_number,
          'assistName', event.assist_name,
          'assistInitials', event.assist_initials,
          'assistShirtNumber', event.assist_shirt_number,
          'homeScore', event.home_score,
          'awayScore', event.away_score,
          'notes', event.notes,
          'createdByName', event.created_by_name,
          'createdAt', event.created_at
        ) order by event.created_at desc
      )
      from public.match_day_events event
      where event.match_day_id = fixture.id
    ), '[]'::jsonb)
  from public.match_days fixture
  join authorised_link link
    on link.club_id = fixture.club_id
    and link.team_id = fixture.team_id
  join public.teams team on team.id = fixture.team_id
  join public.calendar_event_invites invite
    on invite.match_day_id = fixture.id
    and invite.club_id = fixture.club_id
    and invite.team_id = fixture.team_id
    and invite.player_id = link.player_id
    and invite.invite_status <> 'cancelled'
    and invite.response_requirement = 'informational'
  left join public.match_day_player_squad_decisions decision
    on decision.match_day_id = fixture.id
    and decision.club_id = fixture.club_id
    and decision.team_id = fixture.team_id
    and decision.player_id = link.player_id
  where fixture.deleted_at is null
    and fixture.parent_visible is true
    and fixture.parent_audience = 'involved_players'
    and fixture.status in ('scorer_request', 'live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time', 'scheduled')
    and fixture.previous_hidden_at is null
    and (fixture.match_date is null or fixture.match_date >= (timezone('Europe/London', now())::date - 365))
    and not exists (select 1 from legacy where legacy.id = fixture.id)
  order by match_date asc nulls last, kickoff_time asc nulls last, created_at desc;
$$;

revoke all on function public.get_parent_portal_match_days(uuid) from public;
revoke execute on function public.get_parent_portal_match_days(uuid) from anon;
grant execute on function public.get_parent_portal_match_days(uuid) to authenticated;
grant execute on function public.get_parent_portal_match_days(uuid) to service_role;

comment on function public.get_parent_portal_match_days(uuid) is
  'Returns authorised, non-deleted Match Day items with fixture classification for parent-facing labels.';
