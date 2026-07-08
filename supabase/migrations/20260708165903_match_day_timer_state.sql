alter table public.match_days
  add column if not exists timer_started_at timestamptz,
  add column if not exists timer_paused_at timestamptz,
  add column if not exists timer_elapsed_seconds integer not null default 0,
  add column if not exists timer_status text not null default 'not_started';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'match_days_timer_elapsed_seconds_check'
      and conrelid = 'public.match_days'::regclass
  ) then
    alter table public.match_days
      add constraint match_days_timer_elapsed_seconds_check
      check (timer_elapsed_seconds >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'match_days_timer_status_check'
      and conrelid = 'public.match_days'::regclass
  ) then
    alter table public.match_days
      add constraint match_days_timer_status_check
      check (timer_status in ('not_started', 'running', 'paused', 'half_time', 'hydration', 'full_time'));
  end if;
end;
$$;

create index if not exists match_days_timer_status_idx
on public.match_days (club_id, team_id, timer_status)
where timer_status <> 'not_started';

with timer_source as (
  select
    match_day.id,
    case
      when match_day.status in ('live', 'second_half', 'extra_time', 'penalties') then 'running'
      when match_day.status = 'half_time' then 'half_time'
      when match_day.status = 'full_time' then 'full_time'
      else 'not_started'
    end as source_timer_status,
    case
      when match_day.status in ('live', 'second_half', 'extra_time', 'penalties') then coalesce(match_day.phase_started_at, match_day.updated_at, match_day.created_at)
      else null
    end as source_timer_started_at,
    case
      when match_day.status in ('half_time', 'full_time') then coalesce(match_day.updated_at, match_day.created_at)
      else null
    end as source_timer_paused_at,
    case
      when match_day.status in ('half_time', 'full_time') and match_day.phase_started_at is not null then greatest(
        floor(extract(epoch from (coalesce(match_day.updated_at, match_day.created_at, now()) - match_day.phase_started_at)))::integer,
        0
      )
      else 0
    end as source_timer_elapsed_seconds
  from public.match_days match_day
)
update public.match_days match_day
set
  timer_status = timer_source.source_timer_status,
  timer_started_at = timer_source.source_timer_started_at,
  timer_paused_at = timer_source.source_timer_paused_at,
  timer_elapsed_seconds = timer_source.source_timer_elapsed_seconds
from timer_source
where match_day.id = timer_source.id
  and coalesce(match_day.timer_status, 'not_started') = 'not_started'
  and coalesce(match_day.timer_elapsed_seconds, 0) = 0
  and match_day.timer_started_at is null
  and match_day.timer_paused_at is null;

comment on column public.match_days.timer_started_at is
  'Server timestamp for the active running timer segment. Null while the match clock is frozen.';

comment on column public.match_days.timer_paused_at is
  'Server timestamp when the match clock was last frozen for pause, half time, hydration, or full time.';

comment on column public.match_days.timer_elapsed_seconds is
  'Frozen accumulated match-clock seconds before the current running segment, or total frozen seconds while paused.';

comment on column public.match_days.timer_status is
  'Server-authoritative match clock state independent of display-only UI state.';

create or replace function public.set_match_day_timer_state(
  match_day_id_value uuid,
  action_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.match_days%rowtype;
  updated_match_row public.match_days%rowtype;
  actor_user_id uuid := auth.uid();
  actor_name text := '';
  normalized_action text := lower(trim(coalesce(action_value, '')));
  now_value timestamptz := now();
  current_timer_status text;
  stored_elapsed_seconds integer;
  effective_elapsed_seconds integer;
  effective_started_at timestamptz;
  next_status text;
  next_phase_started_at timestamptz;
  next_timer_status text;
  next_timer_started_at timestamptz;
  next_timer_paused_at timestamptz;
  next_timer_elapsed_seconds integer;
  hydration_event_id uuid;
begin
  if actor_user_id is null then
    raise exception 'Login is required before controlling this match clock.';
  end if;

  if normalized_action = 'water_break' then
    normalized_action := 'hydration';
  end if;

  if normalized_action not in ('start', 'pause', 'half_time', 'hydration', 'resume', 'full_time') then
    raise exception 'Choose a supported match clock action.';
  end if;

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null then
    raise exception 'This match day could not be found.';
  end if;

  if not public.can_manage_match_day(match_row.team_id)
    or (
      public.current_user_role() <> 'super_admin'
      and match_row.club_id <> public.current_user_club_id()
    ) then
    raise exception 'Coach or manager access is required to control this match clock.';
  end if;

  actor_name := coalesce(nullif(auth.jwt() ->> 'email', ''), '');
  stored_elapsed_seconds := greatest(coalesce(match_row.timer_elapsed_seconds, 0), 0);
  current_timer_status := coalesce(nullif(match_row.timer_status, ''), 'not_started');

  if current_timer_status = 'not_started' and match_row.status in ('live', 'second_half', 'extra_time', 'penalties') then
    current_timer_status := 'running';
  elsif current_timer_status = 'not_started' and match_row.status = 'half_time' then
    current_timer_status := 'half_time';
  elsif current_timer_status = 'not_started' and match_row.status = 'full_time' then
    current_timer_status := 'full_time';
  end if;

  effective_elapsed_seconds := stored_elapsed_seconds;
  if current_timer_status = 'running' then
    effective_started_at := coalesce(match_row.timer_started_at, match_row.phase_started_at, match_row.updated_at, now_value);
    if effective_started_at <= now_value then
      effective_elapsed_seconds := effective_elapsed_seconds + greatest(floor(extract(epoch from (now_value - effective_started_at)))::integer, 0);
    end if;
  end if;

  next_status := match_row.status;
  next_phase_started_at := match_row.phase_started_at;
  next_timer_status := current_timer_status;
  next_timer_started_at := match_row.timer_started_at;
  next_timer_paused_at := match_row.timer_paused_at;
  next_timer_elapsed_seconds := stored_elapsed_seconds;

  if normalized_action = 'start' then
    if current_timer_status in ('paused', 'half_time', 'hydration') then
      raise exception 'Resume this match clock instead of starting it again.';
    end if;

    if current_timer_status = 'full_time' then
      raise exception 'A full time match clock cannot be restarted.';
    end if;

    next_status := case
      when match_row.status in ('scheduled', 'scorer_request') then 'live'
      else match_row.status
    end;
    next_phase_started_at := coalesce(match_row.phase_started_at, now_value);
    next_timer_status := 'running';
    next_timer_started_at := coalesce(effective_started_at, match_row.timer_started_at, match_row.phase_started_at, now_value);
    next_timer_paused_at := null;
    next_timer_elapsed_seconds := stored_elapsed_seconds;
  elsif normalized_action = 'pause' then
    if current_timer_status = 'full_time' then
      raise exception 'A full time match clock cannot be paused.';
    end if;

    if current_timer_status = 'paused' then
      next_timer_status := 'paused';
      next_timer_started_at := null;
      next_timer_paused_at := coalesce(match_row.timer_paused_at, now_value);
      next_timer_elapsed_seconds := stored_elapsed_seconds;
    elsif current_timer_status in ('half_time', 'hydration') then
      next_timer_status := current_timer_status;
      next_timer_started_at := null;
      next_timer_paused_at := coalesce(match_row.timer_paused_at, now_value);
      next_timer_elapsed_seconds := stored_elapsed_seconds;
    else
      next_timer_status := 'paused';
      next_timer_started_at := null;
      next_timer_paused_at := now_value;
      next_timer_elapsed_seconds := effective_elapsed_seconds;
    end if;
  elsif normalized_action = 'half_time' then
    if current_timer_status = 'full_time' then
      raise exception 'A full time match clock cannot return to half time.';
    end if;

    next_status := 'half_time';
    next_timer_status := 'half_time';
    next_timer_started_at := null;
    next_timer_paused_at := case
      when current_timer_status = 'half_time' then coalesce(match_row.timer_paused_at, now_value)
      else now_value
    end;
    next_timer_elapsed_seconds := case
      when current_timer_status = 'half_time' then stored_elapsed_seconds
      else effective_elapsed_seconds
    end;
  elsif normalized_action = 'hydration' then
    if current_timer_status = 'full_time' then
      raise exception 'A full time match clock cannot be paused for hydration.';
    end if;

    if current_timer_status not in ('running', 'hydration') then
      raise exception 'Hydration can only pause a running match clock.';
    end if;

    next_timer_status := 'hydration';
    next_timer_started_at := null;
    next_timer_paused_at := case
      when current_timer_status = 'hydration' then coalesce(match_row.timer_paused_at, now_value)
      else now_value
    end;
    next_timer_elapsed_seconds := case
      when current_timer_status = 'hydration' then stored_elapsed_seconds
      else effective_elapsed_seconds
    end;

    if current_timer_status <> 'hydration' then
      insert into public.match_day_events (
        match_day_id,
        club_id,
        team_id,
        event_type,
        team_side,
        minute,
        home_score,
        away_score,
        notes,
        created_by,
        created_by_name
      )
      values (
        match_row.id,
        match_row.club_id,
        match_row.team_id,
        'water_break',
        'club',
        greatest(floor(next_timer_elapsed_seconds / 60)::integer + 1, 1),
        greatest(coalesce(match_row.home_score, 0), 0),
        greatest(coalesce(match_row.away_score, 0), 0),
        'Hydration pause',
        actor_user_id,
        actor_name
      )
      returning id into hydration_event_id;
    end if;
  elsif normalized_action = 'resume' then
    if current_timer_status = 'full_time' then
      raise exception 'A full time match clock cannot be resumed.';
    end if;

    if current_timer_status = 'running' then
      next_timer_status := 'running';
      next_timer_started_at := coalesce(effective_started_at, match_row.timer_started_at, now_value);
      next_timer_paused_at := null;
      next_timer_elapsed_seconds := stored_elapsed_seconds;
    else
      next_status := case
        when match_row.status = 'half_time' or current_timer_status = 'half_time' then 'second_half'
        when match_row.status in ('scheduled', 'scorer_request') then 'live'
        else match_row.status
      end;
      next_phase_started_at := now_value;
      next_timer_status := 'running';
      next_timer_started_at := now_value;
      next_timer_paused_at := null;
      next_timer_elapsed_seconds := stored_elapsed_seconds;
    end if;
  elsif normalized_action = 'full_time' then
    next_status := 'full_time';
    next_timer_status := 'full_time';
    next_timer_started_at := null;
    next_timer_paused_at := case
      when current_timer_status = 'full_time' then coalesce(match_row.timer_paused_at, now_value)
      else now_value
    end;
    next_timer_elapsed_seconds := case
      when current_timer_status = 'full_time' then stored_elapsed_seconds
      else effective_elapsed_seconds
    end;
  end if;

  if next_timer_elapsed_seconds < 0 then
    raise exception 'Match clock elapsed time cannot be negative.';
  end if;

  update public.match_days
  set
    status = next_status,
    phase_started_at = next_phase_started_at,
    timer_started_at = next_timer_started_at,
    timer_paused_at = next_timer_paused_at,
    timer_elapsed_seconds = next_timer_elapsed_seconds,
    timer_status = next_timer_status,
    updated_at = now_value
  where id = match_row.id
  returning * into updated_match_row;

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
  )
  values (
    updated_match_row.club_id,
    updated_match_row.team_id,
    updated_match_row.id,
    actor_user_id,
    actor_name,
    coalesce(nullif(public.current_user_role(), ''), 'staff'),
    'match_day_updated',
    'Timer state updated',
    jsonb_build_object(
      'status', match_row.status,
      'phaseStartedAt', match_row.phase_started_at,
      'timerStartedAt', match_row.timer_started_at,
      'timerPausedAt', match_row.timer_paused_at,
      'timerElapsedSeconds', stored_elapsed_seconds,
      'timerStatus', current_timer_status
    ),
    jsonb_build_object(
      'status', updated_match_row.status,
      'phaseStartedAt', updated_match_row.phase_started_at,
      'timerStartedAt', updated_match_row.timer_started_at,
      'timerPausedAt', updated_match_row.timer_paused_at,
      'timerElapsedSeconds', updated_match_row.timer_elapsed_seconds,
      'timerStatus', updated_match_row.timer_status
    ),
    jsonb_build_object(
      'action', normalized_action,
      'hydrationEventId', hydration_event_id,
      'source', 'match_day_timer_rpc'
    )
  );

  return jsonb_build_object(
    'id', updated_match_row.id,
    'matchDayId', updated_match_row.id,
    'status', updated_match_row.status,
    'phaseStartedAt', updated_match_row.phase_started_at,
    'timerStartedAt', updated_match_row.timer_started_at,
    'timerPausedAt', updated_match_row.timer_paused_at,
    'timerElapsedSeconds', updated_match_row.timer_elapsed_seconds,
    'timerStatus', updated_match_row.timer_status,
    'updatedAt', updated_match_row.updated_at
  );
end;
$$;

revoke all on function public.set_match_day_timer_state(uuid, text) from public;
revoke execute on function public.set_match_day_timer_state(uuid, text) from anon;
grant execute on function public.set_match_day_timer_state(uuid, text) to authenticated;
grant execute on function public.set_match_day_timer_state(uuid, text) to service_role;

drop function if exists public.get_parent_portal_match_days(uuid);

create or replace function public.get_parent_portal_match_days(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  team_name text,
  opponent text,
  match_date date,
  kickoff_time time,
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
set search_path = public
as $$
  with parent_link as (
    select *
    from public.parent_player_links
    where id = parent_link_id_value
      and auth_user_id = auth.uid()
      and status = 'active'
    limit 1
  )
  select
    match_day.id,
    match_day.club_id,
    match_day.team_id,
    coalesce(team.name, '') as team_name,
    match_day.opponent,
    match_day.match_date,
    match_day.kickoff_time,
    match_day.arrival_time,
    match_day.home_away,
    match_day.venue_name,
    match_day.venue_address,
    match_day.notes,
    match_day.scorer_request_message,
    match_day.request_scorer,
    match_day.request_linesman,
    match_day.request_referee,
    match_day.status,
    match_day.home_score,
    match_day.away_score,
    match_day.created_at,
    match_day.updated_at,
    match_day.phase_started_at,
    match_day.timer_started_at,
    match_day.timer_paused_at,
    match_day.timer_elapsed_seconds,
    match_day.timer_status,
    coalesce(current_availability.status, availability.status) as availability_status,
    coalesce(current_availability.selected_at, availability.responded_at) as availability_responded_at,
    coalesce(availability.volunteer_scorer_response, 'no_response') as volunteer_scorer_response,
    coalesce(availability.volunteer_linesman_response, 'no_response') as volunteer_linesman_response,
    coalesce(availability.volunteer_referee_response, 'no_response') as volunteer_referee_response,
    availability.volunteer_responded_at,
    exists (
      select 1
      from public.match_day_scorer_interest interest
      where interest.match_day_id = match_day.id
        and interest.parent_link_id = parent_link_id_value
        and interest.status <> 'declined'
    ) as has_interest,
    exists (
      select 1
      from public.match_day_scorer_assignments assignment
      where assignment.match_day_id = match_day.id
        and assignment.parent_link_id = parent_link_id_value
        and assignment.auth_user_id = auth.uid()
    ) as is_scorer,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', assignment.id,
            'matchDayId', assignment.match_day_id,
            'role', assignment.role,
            'parentLinkId', assignment.parent_link_id,
            'authUserId', assignment.auth_user_id,
            'parentEmail', case when assignment.parent_link_id = parent_link_id_value then coalesce(assignment_link.email, '') else '' end,
            'playerName', case when assignment.parent_link_id = parent_link_id_value then coalesce(assignment_player.player_name, '') else '' end,
            'isCurrentParent', assignment.parent_link_id = parent_link_id_value,
            'assignedByName', assignment.assigned_by_name,
            'createdAt', assignment.created_at,
            'updatedAt', assignment.updated_at
          )
          order by assignment.role
        )
        from public.match_day_role_assignments assignment
        left join public.parent_player_links assignment_link
          on assignment_link.id = assignment.parent_link_id
        left join public.players assignment_player
          on assignment_player.id = assignment_link.player_id
        where assignment.match_day_id = match_day.id
      ),
      '[]'::jsonb
    ) as role_assignments,
    coalesce(
      (
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
            'eventStatus', event.event_status,
            'correctedAt', event.corrected_at,
            'correctedByName', event.corrected_by_name,
            'voidedAt', event.voided_at,
            'voidedByName', event.voided_by_name,
            'correctionReason', event.correction_reason,
            'createdByName', event.created_by_name,
            'createdAt', event.created_at
          )
          order by event.created_at desc
        )
        from public.match_day_events event
        where event.match_day_id = match_day.id
      ),
      '[]'::jsonb
    ) as events
  from public.match_days match_day
  join parent_link link
    on link.club_id = match_day.club_id
  left join public.teams team
    on team.id = match_day.team_id
  left join public.match_day_player_availability current_availability
    on current_availability.match_day_id = match_day.id
    and current_availability.player_id = link.player_id
  left join lateral (
    select request.*
    from public.match_day_availability_requests request
    where request.match_day_id = match_day.id
      and request.club_id = link.club_id
      and request.player_id = link.player_id
      and request.status <> 'expired'
      and (
        request.parent_link_id = link.id
        or lower(request.recipient_email) = lower(coalesce(link.email, ''))
      )
    order by request.updated_at desc, request.created_at desc
    limit 1
  ) availability on true
  where auth.uid() is not null
    and match_day.parent_visible is true
    and match_day.parent_audience <> 'none'
    and match_day.status in ('scorer_request', 'live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time', 'scheduled')
    and match_day.previous_hidden_at is null
    and (
      (
        match_day.parent_audience = 'involved_players'
        and exists (
          select 1
          from public.match_day_availability_requests request
          where request.match_day_id = match_day.id
            and request.club_id = link.club_id
            and request.player_id = link.player_id
            and request.status <> 'expired'
        )
      )
      or (
        match_day.parent_audience = 'all_team_parents'
        and match_day.team_id is not null
        and match_day.team_id = link.team_id
      )
      or (
        match_day.parent_audience = 'all_club_parents'
        and match_day.club_id = link.club_id
      )
    )
    and (
      match_day.match_date is null
      or match_day.match_date >= (timezone('Europe/London', now())::date - 365)
    )
  order by match_day.match_date asc nulls last, match_day.kickoff_time asc nulls last, match_day.created_at desc;
$$;

revoke all on function public.get_parent_portal_match_days(uuid) from public;
revoke execute on function public.get_parent_portal_match_days(uuid) from anon;

grant execute on function public.get_parent_portal_match_days(uuid) to authenticated;
grant execute on function public.get_parent_portal_match_days(uuid) to service_role;

create or replace function public.update_match_day_score_as_scorer(
  parent_link_id_value uuid,
  match_day_id_value uuid,
  home_score_value integer,
  away_score_value integer,
  status_value text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_player_links%rowtype;
  match_row public.match_days%rowtype;
  next_status text;
  event_id_value uuid;
  now_value timestamptz := now();
  current_timer_status text;
  stored_elapsed_seconds integer;
  effective_elapsed_seconds integer;
  effective_started_at timestamptz;
  next_phase_started_at timestamptz;
  next_timer_status text;
  next_timer_started_at timestamptz;
  next_timer_paused_at timestamptz;
  next_timer_elapsed_seconds integer;
begin
  if auth.uid() is null then
    raise exception 'Login is required before updating the match.';
  end if;

  select *
  into link_row
  from public.parent_player_links
  where id = parent_link_id_value
    and auth_user_id = auth.uid()
    and status = 'active'
  limit 1;

  if link_row.id is null then
    raise exception 'This parent portal link could not be opened.';
  end if;

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value
    and club_id = link_row.club_id
    and (team_id is null or team_id = link_row.team_id)
    and exists (
      select 1
      from public.match_day_scorer_assignments assignment
      where assignment.match_day_id = match_day_id_value
        and assignment.parent_link_id = parent_link_id_value
        and assignment.auth_user_id = auth.uid()
    )
  for update;

  if match_row.id is null then
    raise exception 'Only selected scorers can update this match.';
  end if;

  next_status := coalesce(nullif(status_value, ''), match_row.status);

  if next_status not in ('scheduled', 'scorer_request', 'live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time', 'postponed', 'cancelled') then
    next_status := match_row.status;
  end if;

  stored_elapsed_seconds := greatest(coalesce(match_row.timer_elapsed_seconds, 0), 0);
  current_timer_status := coalesce(nullif(match_row.timer_status, ''), 'not_started');

  if current_timer_status = 'not_started' and match_row.status in ('live', 'second_half', 'extra_time', 'penalties') then
    current_timer_status := 'running';
  elsif current_timer_status = 'not_started' and match_row.status = 'half_time' then
    current_timer_status := 'half_time';
  elsif current_timer_status = 'not_started' and match_row.status = 'full_time' then
    current_timer_status := 'full_time';
  end if;

  effective_elapsed_seconds := stored_elapsed_seconds;
  if current_timer_status = 'running' then
    effective_started_at := coalesce(match_row.timer_started_at, match_row.phase_started_at, match_row.updated_at, now_value);
    if effective_started_at <= now_value then
      effective_elapsed_seconds := effective_elapsed_seconds + greatest(floor(extract(epoch from (now_value - effective_started_at)))::integer, 0);
    end if;
  end if;

  next_phase_started_at := match_row.phase_started_at;
  next_timer_status := current_timer_status;
  next_timer_started_at := match_row.timer_started_at;
  next_timer_paused_at := match_row.timer_paused_at;
  next_timer_elapsed_seconds := stored_elapsed_seconds;

  if next_status in ('live', 'second_half', 'extra_time', 'penalties') then
    if current_timer_status <> 'running' then
      next_phase_started_at := now_value;
      next_timer_status := 'running';
      next_timer_started_at := now_value;
      next_timer_paused_at := null;
      next_timer_elapsed_seconds := stored_elapsed_seconds;
    else
      next_timer_status := 'running';
      next_timer_started_at := coalesce(effective_started_at, match_row.timer_started_at, match_row.phase_started_at, now_value);
      next_timer_paused_at := null;
      next_timer_elapsed_seconds := stored_elapsed_seconds;
      if next_phase_started_at is null then
        next_phase_started_at := next_timer_started_at;
      end if;
    end if;
  elsif next_status = 'half_time' then
    next_timer_status := 'half_time';
    next_timer_started_at := null;
    next_timer_paused_at := case
      when current_timer_status = 'half_time' then coalesce(match_row.timer_paused_at, now_value)
      else now_value
    end;
    next_timer_elapsed_seconds := case
      when current_timer_status = 'half_time' then stored_elapsed_seconds
      else effective_elapsed_seconds
    end;
  elsif next_status = 'full_time' then
    next_timer_status := 'full_time';
    next_timer_started_at := null;
    next_timer_paused_at := case
      when current_timer_status = 'full_time' then coalesce(match_row.timer_paused_at, now_value)
      else now_value
    end;
    next_timer_elapsed_seconds := case
      when current_timer_status = 'full_time' then stored_elapsed_seconds
      else effective_elapsed_seconds
    end;
  end if;

  if next_timer_elapsed_seconds < 0 then
    raise exception 'Match clock elapsed time cannot be negative.';
  end if;

  update public.match_days
  set
    home_score = greatest(coalesce(home_score_value, 0), 0),
    away_score = greatest(coalesce(away_score_value, 0), 0),
    status = next_status,
    phase_started_at = next_phase_started_at,
    timer_started_at = next_timer_started_at,
    timer_paused_at = next_timer_paused_at,
    timer_elapsed_seconds = next_timer_elapsed_seconds,
    timer_status = next_timer_status,
    updated_at = now_value
  where id = match_row.id;

  insert into public.match_day_events (
    match_day_id,
    club_id,
    team_id,
    event_type,
    team_side,
    home_score,
    away_score,
    notes,
    created_by,
    created_by_parent_link_id,
    created_by_name
  )
  values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    'score_correction',
    'club',
    greatest(coalesce(home_score_value, 0), 0),
    greatest(coalesce(away_score_value, 0), 0),
    'Score updated by parent scorer',
    auth.uid(),
    parent_link_id_value,
    coalesce(link_row.email, 'Parent scorer')
  )
  returning id into event_id_value;

  return event_id_value;
end;
$$;

revoke all on function public.update_match_day_score_as_scorer(uuid, uuid, integer, integer, text) from public;
revoke execute on function public.update_match_day_score_as_scorer(uuid, uuid, integer, integer, text) from anon;
grant execute on function public.update_match_day_score_as_scorer(uuid, uuid, integer, integer, text) to authenticated;
grant execute on function public.update_match_day_score_as_scorer(uuid, uuid, integer, integer, text) to service_role;

create or replace function public.add_match_day_goal_as_scorer(
  parent_link_id_value uuid,
  match_day_id_value uuid,
  team_side_value text,
  scorer_name_value text,
  scorer_shirt_number_value text default '',
  assist_name_value text default '',
  assist_shirt_number_value text default '',
  minute_value integer default null,
  notes_value text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_player_links%rowtype;
  match_row public.match_days%rowtype;
  event_id_value uuid;
  next_home_score integer;
  next_away_score integer;
  normalized_team_side text := trim(coalesce(team_side_value, 'club'));
  now_value timestamptz := now();
  current_timer_status text;
  next_phase_started_at timestamptz;
  next_timer_status text;
  next_timer_started_at timestamptz;
  next_timer_paused_at timestamptz;
  next_timer_elapsed_seconds integer;
begin
  if auth.uid() is null then
    raise exception 'Login is required before adding a goal.';
  end if;

  if normalized_team_side not in ('club', 'opponent') then
    raise exception 'Choose who scored the goal.';
  end if;

  if minute_value is not null and (minute_value < 0 or minute_value > 130) then
    raise exception 'Minute must be between 0 and 130.';
  end if;

  select *
  into link_row
  from public.parent_player_links
  where id = parent_link_id_value
    and auth_user_id = auth.uid()
    and status = 'active'
  limit 1;

  if link_row.id is null then
    raise exception 'This parent portal link could not be opened.';
  end if;

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value
    and club_id = link_row.club_id
    and exists (
      select 1
      from public.match_day_scorer_assignments assignment
      where assignment.match_day_id = match_day_id_value
        and assignment.parent_link_id = link_row.id
        and assignment.auth_user_id = auth.uid()
    )
  for update;

  if match_row.id is null then
    raise exception 'Only selected scorers can update this match.';
  end if;

  next_home_score := greatest(coalesce(match_row.home_score, 0), 0);
  next_away_score := greatest(coalesce(match_row.away_score, 0), 0);

  if normalized_team_side = 'club' then
    if match_row.home_away = 'away' then
      next_away_score := next_away_score + 1;
    else
      next_home_score := next_home_score + 1;
    end if;
  else
    if match_row.home_away = 'away' then
      next_home_score := next_home_score + 1;
    else
      next_away_score := next_away_score + 1;
    end if;
  end if;

  current_timer_status := coalesce(nullif(match_row.timer_status, ''), 'not_started');
  next_phase_started_at := match_row.phase_started_at;
  next_timer_status := current_timer_status;
  next_timer_started_at := match_row.timer_started_at;
  next_timer_paused_at := match_row.timer_paused_at;
  next_timer_elapsed_seconds := greatest(coalesce(match_row.timer_elapsed_seconds, 0), 0);

  if match_row.status in ('scheduled', 'scorer_request') then
    next_phase_started_at := coalesce(match_row.phase_started_at, now_value);
    next_timer_status := 'running';
    next_timer_started_at := now_value;
    next_timer_paused_at := null;
    next_timer_elapsed_seconds := 0;
  elsif match_row.status in ('live', 'second_half', 'extra_time', 'penalties')
    and current_timer_status = 'not_started' then
    next_phase_started_at := coalesce(match_row.phase_started_at, match_row.updated_at, now_value);
    next_timer_status := 'running';
    next_timer_started_at := next_phase_started_at;
    next_timer_paused_at := null;
    next_timer_elapsed_seconds := 0;
  end if;

  if next_timer_elapsed_seconds < 0 then
    raise exception 'Match clock elapsed time cannot be negative.';
  end if;

  update public.match_days
  set
    home_score = next_home_score,
    away_score = next_away_score,
    status = case when status in ('scheduled', 'scorer_request') then 'live' else status end,
    phase_started_at = next_phase_started_at,
    timer_started_at = next_timer_started_at,
    timer_paused_at = next_timer_paused_at,
    timer_elapsed_seconds = next_timer_elapsed_seconds,
    timer_status = next_timer_status,
    updated_at = now_value
  where id = match_row.id;

  insert into public.match_day_events (
    match_day_id,
    club_id,
    team_id,
    event_type,
    team_side,
    minute,
    scorer_name,
    scorer_initials,
    scorer_shirt_number,
    assist_name,
    assist_initials,
    assist_shirt_number,
    home_score,
    away_score,
    notes,
    created_by,
    created_by_parent_link_id,
    created_by_name
  )
  values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    'goal',
    normalized_team_side,
    minute_value,
    trim(coalesce(scorer_name_value, '')),
    public.get_initials_from_full_name(scorer_name_value),
    trim(coalesce(scorer_shirt_number_value, '')),
    trim(coalesce(assist_name_value, '')),
    public.get_initials_from_full_name(assist_name_value),
    trim(coalesce(assist_shirt_number_value, '')),
    next_home_score,
    next_away_score,
    trim(coalesce(notes_value, '')),
    auth.uid(),
    link_row.id,
    coalesce(nullif(auth.jwt() ->> 'email', ''), link_row.email, '')
  )
  returning id into event_id_value;

  return event_id_value;
end;
$$;

revoke all on function public.add_match_day_goal_as_scorer(uuid, uuid, text, text, text, text, text, integer, text) from public;
revoke execute on function public.add_match_day_goal_as_scorer(uuid, uuid, text, text, text, text, text, integer, text) from anon;
grant execute on function public.add_match_day_goal_as_scorer(uuid, uuid, text, text, text, text, text, integer, text) to authenticated;
grant execute on function public.add_match_day_goal_as_scorer(uuid, uuid, text, text, text, text, text, integer, text) to service_role;
