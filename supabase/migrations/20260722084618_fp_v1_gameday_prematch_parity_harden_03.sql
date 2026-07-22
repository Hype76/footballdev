-- FP-V1-GAMEDAY-PREMATCH-PARITY-HARDEN-03
-- Keep parent scorer identity, score changes, event changes, and lifecycle
-- transitions separate. Every exposed mutation fails closed against the
-- current accepted scorer assignment and the exact fixture scope.

create or replace function public.current_user_has_match_day_scorer_assignment(
  target_match_day_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_user_has_active_authority()
    and public.current_user_role() = 'parent_portal'
    and exists (
      select 1
      from public.match_days match_day
      join public.match_day_role_assignments role_assignment
        on role_assignment.match_day_id = match_day.id
       and role_assignment.club_id = match_day.club_id
       and role_assignment.team_id = match_day.team_id
       and role_assignment.role = 'scorer'
      join public.match_day_scorer_assignments legacy_assignment
        on legacy_assignment.match_day_id = match_day.id
       and legacy_assignment.club_id = match_day.club_id
       and legacy_assignment.team_id = match_day.team_id
       and legacy_assignment.parent_link_id = role_assignment.parent_link_id
       and legacy_assignment.auth_user_id = role_assignment.auth_user_id
      join public.parent_player_links parent_link
        on parent_link.id = role_assignment.parent_link_id
       and parent_link.auth_user_id = role_assignment.auth_user_id
       and parent_link.club_id = match_day.club_id
       and parent_link.team_id = match_day.team_id
       and parent_link.status = 'active'
      join public.players player
        on player.id = parent_link.player_id
       and player.club_id = match_day.club_id
       and player.team_id = match_day.team_id
       and coalesce(player.status, 'active') <> 'archived'
      where match_day.id = target_match_day_id
        and match_day.team_id is not null
        and match_day.deleted_at is null
        and role_assignment.auth_user_id = (select auth.uid())
    );
$$;

create or replace function public.current_user_is_match_day_scorer(
  target_match_day_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_user_has_match_day_scorer_assignment(target_match_day_id)
    and exists (
      select 1
      from public.match_days match_day
      where match_day.id = target_match_day_id
        and match_day.deleted_at is null
        and match_day.concluded_at is null
        and match_day.status not in ('cancelled', 'postponed')
    );
$$;

revoke all on function public.current_user_has_match_day_scorer_assignment(uuid) from public, anon, authenticated;
grant execute on function public.current_user_has_match_day_scorer_assignment(uuid) to service_role;
revoke all on function public.current_user_is_match_day_scorer(uuid) from public, anon;
grant execute on function public.current_user_is_match_day_scorer(uuid) to authenticated, service_role;

comment on function public.current_user_has_match_day_scorer_assignment(uuid) is
  'Internal exact-scope scorer assignment check. Requires active parent authority, matching role and legacy scorer records, active accepted link, active player, and exact club and team.';

comment on function public.current_user_is_match_day_scorer(uuid) is
  'Canonical mutable parent scorer authority check. Authority ends for deleted, concluded, cancelled, or postponed fixtures.';

create or replace function public.apply_match_day_timer_action(
  match_day_id_value uuid,
  action_value text,
  actor_user_id_value uuid,
  actor_name_value text,
  actor_role_value text,
  actor_parent_link_id_value uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  updated_match_row public.match_days%rowtype;
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
  next_full_time_resume_status text;
  next_concluded_at timestamptz;
  next_concluded_by uuid;
  hydration_event_id uuid;
begin
  if normalized_action = 'water_break' then
    normalized_action := 'hydration';
  end if;

  if normalized_action not in ('start', 'pause', 'half_time', 'hydration', 'resume', 'full_time', 'conclude') then
    raise exception 'Choose a supported match clock action.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if match_row.concluded_at is not null then
    raise exception 'A concluded match cannot be resumed or changed through Match Day controls.';
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
      effective_elapsed_seconds := effective_elapsed_seconds
        + greatest(floor(extract(epoch from (now_value - effective_started_at)))::integer, 0);
    end if;
  end if;

  next_status := match_row.status;
  next_phase_started_at := match_row.phase_started_at;
  next_timer_status := current_timer_status;
  next_timer_started_at := match_row.timer_started_at;
  next_timer_paused_at := match_row.timer_paused_at;
  next_timer_elapsed_seconds := stored_elapsed_seconds;
  next_full_time_resume_status := match_row.full_time_resume_status;
  next_concluded_at := match_row.concluded_at;
  next_concluded_by := match_row.concluded_by;

  if normalized_action = 'start' then
    if current_timer_status <> 'not_started'
      or match_row.status not in ('scheduled', 'scorer_request')
      or stored_elapsed_seconds <> 0
      or match_row.timer_started_at is not null
      or match_row.phase_started_at is not null then
      raise exception 'This match is not in the Ready state. Use the existing clock controls.';
    end if;

    next_status := 'live';
    next_phase_started_at := now_value;
    next_timer_status := 'running';
    next_timer_started_at := now_value;
    next_timer_paused_at := null;
    next_timer_elapsed_seconds := 0;
  elsif normalized_action = 'pause' then
    if current_timer_status = 'full_time' then
      raise exception 'Use Resume Match to continue from Full Time.';
    elsif current_timer_status = 'paused' then
      next_timer_started_at := null;
      next_timer_paused_at := coalesce(match_row.timer_paused_at, now_value);
    elsif current_timer_status in ('half_time', 'hydration') then
      next_timer_started_at := null;
      next_timer_paused_at := coalesce(match_row.timer_paused_at, now_value);
    elsif current_timer_status = 'running' then
      next_timer_status := 'paused';
      next_timer_started_at := null;
      next_timer_paused_at := now_value;
      next_timer_elapsed_seconds := effective_elapsed_seconds;
    else
      raise exception 'Only a running match clock can be paused.';
    end if;
  elsif normalized_action = 'half_time' then
    if current_timer_status = 'full_time' then
      raise exception 'Use Resume Match to continue from Full Time.';
    elsif current_timer_status not in ('running', 'half_time') then
      raise exception 'Half Time can only stop a running match clock.';
    end if;

    next_status := 'half_time';
    next_timer_status := 'half_time';
    next_timer_started_at := null;
    next_timer_paused_at := case when current_timer_status = 'half_time' then coalesce(match_row.timer_paused_at, now_value) else now_value end;
    next_timer_elapsed_seconds := case when current_timer_status = 'half_time' then stored_elapsed_seconds else effective_elapsed_seconds end;
  elsif normalized_action = 'hydration' then
    if current_timer_status not in ('running', 'hydration') then
      raise exception 'Hydration can only pause a running match clock.';
    end if;

    next_timer_status := 'hydration';
    next_timer_started_at := null;
    next_timer_paused_at := case when current_timer_status = 'hydration' then coalesce(match_row.timer_paused_at, now_value) else now_value end;
    next_timer_elapsed_seconds := case when current_timer_status = 'hydration' then stored_elapsed_seconds else effective_elapsed_seconds end;

    if current_timer_status <> 'hydration' then
      insert into public.match_day_events (
        match_day_id, club_id, team_id, event_type, team_side, minute,
        home_score, away_score, notes, created_by, created_by_parent_link_id, created_by_name
      ) values (
        match_row.id, match_row.club_id, match_row.team_id, 'water_break', 'club',
        greatest(floor(next_timer_elapsed_seconds / 60)::integer + 1, 1),
        greatest(coalesce(match_row.home_score, 0), 0),
        greatest(coalesce(match_row.away_score, 0), 0),
        'Hydration pause', actor_user_id_value, actor_parent_link_id_value, actor_name_value
      ) returning id into hydration_event_id;
    end if;
  elsif normalized_action = 'resume' then
    if current_timer_status = 'running' then
      next_timer_started_at := coalesce(effective_started_at, match_row.timer_started_at, now_value);
      next_timer_paused_at := null;
    elsif current_timer_status = 'full_time' then
      next_status := case
        when match_row.full_time_resume_status in ('live', 'second_half', 'extra_time', 'penalties') then match_row.full_time_resume_status
        when match_row.match_clock_mode = 'fixed'
          and stored_elapsed_seconds >= (coalesce(match_row.match_duration_minutes, 90) / 2) * 60 then 'second_half'
        else 'live'
      end;
      next_phase_started_at := now_value;
      next_timer_status := 'running';
      next_timer_started_at := now_value;
      next_timer_paused_at := null;
      next_full_time_resume_status := null;
    elsif current_timer_status in ('paused', 'half_time', 'hydration') then
      next_status := case when match_row.status = 'half_time' or current_timer_status = 'half_time' then 'second_half' else match_row.status end;
      next_phase_started_at := now_value;
      next_timer_status := 'running';
      next_timer_started_at := now_value;
      next_timer_paused_at := null;
    else
      raise exception 'Only a paused or Full Time match clock can be resumed.';
    end if;
  elsif normalized_action = 'full_time' then
    if current_timer_status = 'not_started' then
      raise exception 'Start the match clock before choosing Full Time.';
    end if;

    if current_timer_status <> 'full_time' then
      next_full_time_resume_status := case
        when match_row.status in ('live', 'second_half', 'extra_time', 'penalties') then match_row.status
        when match_row.status = 'half_time' then 'second_half'
        else 'live'
      end;
    end if;

    next_status := 'full_time';
    next_timer_status := 'full_time';
    next_timer_started_at := null;
    next_timer_paused_at := case when current_timer_status = 'full_time' then coalesce(match_row.timer_paused_at, now_value) else now_value end;
    next_timer_elapsed_seconds := case when current_timer_status = 'full_time' then stored_elapsed_seconds else effective_elapsed_seconds end;
  elsif normalized_action = 'conclude' then
    if match_row.status <> 'full_time' or current_timer_status <> 'full_time' then
      raise exception 'Choose Full Time before concluding this match.';
    end if;
    next_concluded_at := now_value;
    next_concluded_by := actor_user_id_value;
  end if;

  if next_timer_elapsed_seconds < 0 then
    raise exception 'Match clock elapsed time cannot be negative.';
  end if;

  perform pg_catalog.set_config('app.match_day_lifecycle_authorized', 'true', true);

  update public.match_days
  set status = next_status,
      phase_started_at = next_phase_started_at,
      timer_started_at = next_timer_started_at,
      timer_paused_at = next_timer_paused_at,
      timer_elapsed_seconds = next_timer_elapsed_seconds,
      timer_status = next_timer_status,
      full_time_resume_status = next_full_time_resume_status,
      concluded_at = next_concluded_at,
      concluded_by = next_concluded_by,
      updated_at = now_value
  where id = match_row.id
  returning * into updated_match_row;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    updated_match_row.club_id,
    updated_match_row.team_id,
    updated_match_row.id,
    actor_user_id_value,
    actor_name_value,
    actor_role_value,
    'match_day_updated',
    case when normalized_action = 'conclude' then 'Match concluded' else 'Timer state updated' end,
    jsonb_build_object(
      'status', match_row.status,
      'phaseStartedAt', match_row.phase_started_at,
      'timerStartedAt', match_row.timer_started_at,
      'timerPausedAt', match_row.timer_paused_at,
      'timerElapsedSeconds', stored_elapsed_seconds,
      'timerStatus', current_timer_status,
      'fullTimeResumeStatus', match_row.full_time_resume_status,
      'concludedAt', match_row.concluded_at
    ),
    jsonb_build_object(
      'status', updated_match_row.status,
      'phaseStartedAt', updated_match_row.phase_started_at,
      'timerStartedAt', updated_match_row.timer_started_at,
      'timerPausedAt', updated_match_row.timer_paused_at,
      'timerElapsedSeconds', updated_match_row.timer_elapsed_seconds,
      'timerStatus', updated_match_row.timer_status,
      'fullTimeResumeStatus', updated_match_row.full_time_resume_status,
      'concludedAt', updated_match_row.concluded_at
    ),
    jsonb_build_object(
      'action', normalized_action,
      'hydrationEventId', hydration_event_id,
      'clockMode', updated_match_row.match_clock_mode,
      'parentLinkId', actor_parent_link_id_value,
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
    'fullTimeResumeStatus', updated_match_row.full_time_resume_status,
    'concludedAt', updated_match_row.concluded_at,
    'concludedBy', updated_match_row.concluded_by,
    'updatedAt', updated_match_row.updated_at
  );
end;
$$;

revoke all on function public.apply_match_day_timer_action(uuid, text, uuid, text, text, uuid) from public, anon, authenticated, service_role;

create or replace function public.set_match_day_timer_state(
  match_day_id_value uuid,
  action_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  actor_user_id uuid := auth.uid();
  actor_name text := '';
  actor_role text := '';
  scorer_parent_link_id uuid;
  normalized_action text := lower(trim(coalesce(action_value, '')));
  is_staff_actor boolean := false;
  is_scorer_actor boolean := false;
begin
  if actor_user_id is null then
    raise exception 'Login is required before controlling this match clock.';
  end if;

  if normalized_action = 'water_break' then
    normalized_action := 'hydration';
  end if;

  if normalized_action not in ('start', 'pause', 'half_time', 'hydration', 'resume', 'full_time', 'conclude') then
    raise exception 'Choose a supported match clock action.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  is_staff_actor := public.can_manage_match_day(match_row.team_id)
    and (public.current_user_role() = 'super_admin' or match_row.club_id = public.current_user_club_id());
  is_scorer_actor := public.current_user_is_match_day_scorer(match_row.id);

  if not is_staff_actor and not is_scorer_actor then
    if match_row.concluded_at is not null
      and normalized_action = 'conclude'
      and public.current_user_has_match_day_scorer_assignment(match_row.id) then
      is_scorer_actor := true;
    else
      raise exception 'Current coach, manager, or selected scorer access is required to control this match clock.';
    end if;
  end if;

  if is_scorer_actor then
    select role_assignment.parent_link_id
    into scorer_parent_link_id
    from public.match_day_role_assignments role_assignment
    where role_assignment.match_day_id = match_row.id
      and role_assignment.role = 'scorer'
      and role_assignment.auth_user_id = actor_user_id
      and role_assignment.club_id = match_row.club_id
      and role_assignment.team_id = match_row.team_id
    limit 1;
    actor_role := 'scorer_parent';
  else
    actor_role := coalesce(nullif(public.current_user_role(), ''), 'staff');
  end if;

  actor_name := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), '');

  if match_row.concluded_at is not null and normalized_action = 'conclude' then
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
      'alreadyConcluded', true
    );
  end if;

  if normalized_action = 'start'
    and (
      coalesce(match_row.timer_status, 'not_started') = 'running'
      or match_row.status in ('live', 'second_half', 'extra_time', 'penalties')
    ) then
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

  return public.apply_match_day_timer_action(
    match_row.id,
    normalized_action,
    actor_user_id,
    actor_name,
    actor_role,
    scorer_parent_link_id
  );
end;
$$;

revoke all on function public.set_match_day_timer_state(uuid, text) from public, anon;
grant execute on function public.set_match_day_timer_state(uuid, text) to authenticated, service_role;

comment on function public.set_match_day_timer_state(uuid, text) is
  'The shared authoritative Match Day timer state machine for assigned staff and the current accepted parent scorer. Start and conclude retries are safe no-ops.';

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
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  parent_link_row public.parent_player_links%rowtype;
  event_id_value uuid;
  next_home_score integer := greatest(coalesce(home_score_value, 0), 0);
  next_away_score integer := greatest(coalesce(away_score_value, 0), 0);
  requested_status text := nullif(trim(coalesce(status_value, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Login is required before updating the match score.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if not public.current_user_is_match_day_scorer(match_row.id) then
    raise exception 'Only the current selected scorer can update this match.';
  end if;

  select parent_link.* into parent_link_row
  from public.match_day_role_assignments role_assignment
  join public.parent_player_links parent_link
    on parent_link.id = role_assignment.parent_link_id
   and parent_link.auth_user_id = role_assignment.auth_user_id
   and parent_link.club_id = role_assignment.club_id
   and parent_link.team_id = role_assignment.team_id
   and parent_link.status = 'active'
  where role_assignment.match_day_id = match_row.id
    and role_assignment.role = 'scorer'
    and role_assignment.parent_link_id = parent_link_id_value
    and role_assignment.auth_user_id = auth.uid()
    and role_assignment.club_id = match_row.club_id
    and role_assignment.team_id = match_row.team_id
  limit 1;

  if parent_link_row.id is null then
    raise exception 'The selected scorer link does not match this fixture.';
  end if;

  if requested_status is not null and requested_status <> match_row.status then
    raise exception 'Lifecycle changes require an explicit Match Day clock action.';
  end if;

  update public.match_days
  set home_score = next_home_score,
      away_score = next_away_score,
      updated_at = now()
  where id = match_row.id;

  insert into public.match_day_events (
    match_day_id, club_id, team_id, event_type, team_side,
    home_score, away_score, notes, created_by,
    created_by_parent_link_id, created_by_name
  ) values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    'score_correction',
    'club',
    next_home_score,
    next_away_score,
    'Score updated by parent scorer',
    auth.uid(),
    parent_link_row.id,
    coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), parent_link_row.email, '')
  ) returning id into event_id_value;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id,
    match_row.team_id,
    match_row.id,
    auth.uid(),
    coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), parent_link_row.email, ''),
    'scorer_parent',
    'scorer_updated',
    'Score corrected',
    jsonb_build_object('homeScore', match_row.home_score, 'awayScore', match_row.away_score),
    jsonb_build_object('homeScore', next_home_score, 'awayScore', next_away_score),
    jsonb_build_object(
      'matchEventId', event_id_value,
      'parentLinkId', parent_link_row.id,
      'source', 'parent_scorer_score_rpc'
    )
  );

  return event_id_value;
end;
$$;

revoke all on function public.update_match_day_score_as_scorer(uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.update_match_day_score_as_scorer(uuid, uuid, integer, integer, text) to authenticated, service_role;

comment on function public.update_match_day_score_as_scorer(uuid, uuid, integer, integer, text) is
  'Updates score fields only for the current exact-scope parent scorer. Caller-supplied lifecycle changes are rejected.';

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
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  parent_link_row public.parent_player_links%rowtype;
  event_id_value uuid;
  next_home_score integer;
  next_away_score integer;
  normalized_team_side text := trim(coalesce(team_side_value, 'club'));
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

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if not public.current_user_is_match_day_scorer(match_row.id) then
    raise exception 'Only the current selected scorer can update this match.';
  end if;

  if coalesce(match_row.timer_status, 'not_started') = 'not_started'
    or match_row.status in ('scheduled', 'scorer_request') then
    raise exception 'Start the match before recording a goal.';
  end if;

  select parent_link.* into parent_link_row
  from public.match_day_role_assignments role_assignment
  join public.parent_player_links parent_link
    on parent_link.id = role_assignment.parent_link_id
   and parent_link.auth_user_id = role_assignment.auth_user_id
   and parent_link.club_id = role_assignment.club_id
   and parent_link.team_id = role_assignment.team_id
   and parent_link.status = 'active'
  where role_assignment.match_day_id = match_row.id
    and role_assignment.role = 'scorer'
    and role_assignment.parent_link_id = parent_link_id_value
    and role_assignment.auth_user_id = auth.uid()
    and role_assignment.club_id = match_row.club_id
    and role_assignment.team_id = match_row.team_id
  limit 1;

  if parent_link_row.id is null then
    raise exception 'The selected scorer link does not match this fixture.';
  end if;

  next_home_score := greatest(coalesce(match_row.home_score, 0), 0);
  next_away_score := greatest(coalesce(match_row.away_score, 0), 0);

  if normalized_team_side = 'club' then
    if match_row.home_away = 'away' then
      next_away_score := next_away_score + 1;
    else
      next_home_score := next_home_score + 1;
    end if;
  elsif match_row.home_away = 'away' then
    next_home_score := next_home_score + 1;
  else
    next_away_score := next_away_score + 1;
  end if;

  update public.match_days
  set home_score = next_home_score,
      away_score = next_away_score,
      updated_at = now()
  where id = match_row.id;

  insert into public.match_day_events (
    match_day_id, club_id, team_id, event_type, team_side, minute,
    scorer_name, scorer_initials, scorer_shirt_number,
    assist_name, assist_initials, assist_shirt_number,
    home_score, away_score, notes, created_by,
    created_by_parent_link_id, created_by_name
  ) values (
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
    parent_link_row.id,
    coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), parent_link_row.email, '')
  ) returning id into event_id_value;

  return event_id_value;
end;
$$;

revoke all on function public.add_match_day_goal_as_scorer(uuid, uuid, text, text, text, text, text, integer, text) from public, anon;
grant execute on function public.add_match_day_goal_as_scorer(uuid, uuid, text, text, text, text, text, integer, text) to authenticated, service_role;

comment on function public.add_match_day_goal_as_scorer(uuid, uuid, text, text, text, text, text, integer, text) is
  'Adds one goal and its canonical score effect for the current exact-scope parent scorer. It never starts or changes the match lifecycle.';

create or replace function public.correct_match_day_goal(
  match_day_id_value uuid,
  goal_event_id_value uuid,
  parent_link_id_value uuid default null,
  team_side_value text default null,
  scorer_name_value text default null,
  scorer_shirt_number_value text default '',
  assist_name_value text default '',
  assist_shirt_number_value text default '',
  minute_value integer default null,
  notes_value text default '',
  correction_reason_value text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  event_row public.match_day_events%rowtype;
  parent_link_row public.parent_player_links%rowtype;
  actor_user_id uuid := auth.uid();
  actor_name text := '';
  actor_role text := '';
  normalized_team_side text;
  next_home_score integer;
  next_away_score integer;
  previous_event jsonb;
  next_event jsonb;
begin
  if actor_user_id is null then
    raise exception 'Login is required before correcting a goal.';
  end if;

  if minute_value is not null and (minute_value < 0 or minute_value > 130) then
    raise exception 'Minute must be between 0 and 130.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if parent_link_id_value is null then
    if not public.can_manage_match_day(match_row.team_id)
      or (public.current_user_role() <> 'super_admin' and match_row.club_id <> public.current_user_club_id()) then
      raise exception 'Coach or manager access is required to correct this goal.';
    end if;

    actor_name := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), '');
    actor_role := coalesce(nullif(public.current_user_role(), ''), 'staff');
  else
    if not public.current_user_is_match_day_scorer(match_row.id) then
      raise exception 'Only the current selected scorer can correct this match.';
    end if;

    select parent_link.* into parent_link_row
    from public.match_day_role_assignments role_assignment
    join public.parent_player_links parent_link
      on parent_link.id = role_assignment.parent_link_id
     and parent_link.auth_user_id = role_assignment.auth_user_id
     and parent_link.club_id = role_assignment.club_id
     and parent_link.team_id = role_assignment.team_id
     and parent_link.status = 'active'
    where role_assignment.match_day_id = match_row.id
      and role_assignment.role = 'scorer'
      and role_assignment.parent_link_id = parent_link_id_value
      and role_assignment.auth_user_id = actor_user_id
      and role_assignment.club_id = match_row.club_id
      and role_assignment.team_id = match_row.team_id
    limit 1;

    if parent_link_row.id is null then
      raise exception 'The selected scorer link does not match this fixture.';
    end if;

    actor_name := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), parent_link_row.email, '');
    actor_role := 'scorer_parent';
  end if;

  select * into event_row
  from public.match_day_events
  where id = goal_event_id_value
    and match_day_id = match_row.id
    and club_id = match_row.club_id
    and team_id = match_row.team_id
  for update;

  if event_row.id is null then
    raise exception 'This goal event could not be found for this match.';
  end if;

  if event_row.event_type <> 'goal' then
    raise exception 'Only goal events can be corrected.';
  end if;

  if event_row.event_status = 'voided' then
    raise exception 'This goal has already been removed.';
  end if;

  normalized_team_side := coalesce(nullif(trim(team_side_value), ''), event_row.team_side);
  if normalized_team_side not in ('club', 'opponent') then
    raise exception 'Choose who scored the goal.';
  end if;

  next_home_score := greatest(coalesce(match_row.home_score, 0), 0);
  next_away_score := greatest(coalesce(match_row.away_score, 0), 0);

  if event_row.team_side = 'club' then
    if match_row.home_away = 'away' then
      next_away_score := next_away_score - 1;
    else
      next_home_score := next_home_score - 1;
    end if;
  elsif match_row.home_away = 'away' then
    next_home_score := next_home_score - 1;
  else
    next_away_score := next_away_score - 1;
  end if;

  if normalized_team_side = 'club' then
    if match_row.home_away = 'away' then
      next_away_score := next_away_score + 1;
    else
      next_home_score := next_home_score + 1;
    end if;
  elsif match_row.home_away = 'away' then
    next_home_score := next_home_score + 1;
  else
    next_away_score := next_away_score + 1;
  end if;

  if next_home_score < 0 or next_away_score < 0 then
    raise exception 'Goal correction would make the score negative.';
  end if;

  previous_event := jsonb_build_object(
    'id', event_row.id,
    'eventType', event_row.event_type,
    'teamSide', event_row.team_side,
    'minute', event_row.minute,
    'scorerName', event_row.scorer_name,
    'scorerInitials', event_row.scorer_initials,
    'scorerShirtNumber', event_row.scorer_shirt_number,
    'assistName', event_row.assist_name,
    'assistInitials', event_row.assist_initials,
    'assistShirtNumber', event_row.assist_shirt_number,
    'homeScore', event_row.home_score,
    'awayScore', event_row.away_score,
    'notes', event_row.notes,
    'eventStatus', event_row.event_status,
    'createdByName', event_row.created_by_name,
    'createdAt', event_row.created_at
  );

  update public.match_days
  set home_score = next_home_score,
      away_score = next_away_score,
      updated_at = now()
  where id = match_row.id;

  update public.match_day_events
  set team_side = normalized_team_side,
      minute = minute_value,
      scorer_name = trim(coalesce(scorer_name_value, '')),
      scorer_initials = public.get_initials_from_full_name(scorer_name_value),
      scorer_shirt_number = trim(coalesce(scorer_shirt_number_value, '')),
      assist_name = trim(coalesce(assist_name_value, '')),
      assist_initials = public.get_initials_from_full_name(assist_name_value),
      assist_shirt_number = trim(coalesce(assist_shirt_number_value, '')),
      home_score = next_home_score,
      away_score = next_away_score,
      notes = trim(coalesce(notes_value, '')),
      event_status = 'corrected',
      corrected_at = now(),
      corrected_by = actor_user_id,
      corrected_by_parent_link_id = parent_link_row.id,
      corrected_by_name = actor_name,
      correction_reason = trim(coalesce(correction_reason_value, '')),
      correction_metadata = jsonb_build_object(
        'action', 'corrected',
        'actorRole', actor_role,
        'previousEvent', previous_event
      )
  where id = event_row.id
  returning jsonb_build_object(
    'id', id,
    'matchDayId', match_day_id,
    'eventType', event_type,
    'teamSide', team_side,
    'minute', minute,
    'scorerName', scorer_name,
    'scorerInitials', scorer_initials,
    'scorerShirtNumber', scorer_shirt_number,
    'assistName', assist_name,
    'assistInitials', assist_initials,
    'assistShirtNumber', assist_shirt_number,
    'homeScore', home_score,
    'awayScore', away_score,
    'notes', notes,
    'eventStatus', event_status,
    'correctedAt', corrected_at,
    'correctedByName', corrected_by_name,
    'correctionReason', correction_reason,
    'createdByName', created_by_name,
    'createdAt', created_at
  ) into next_event;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id,
    match_row.team_id,
    match_row.id,
    actor_user_id,
    actor_name,
    actor_role,
    'scorer_updated',
    'Goal corrected',
    jsonb_build_object('homeScore', match_row.home_score, 'awayScore', match_row.away_score, 'event', previous_event),
    jsonb_build_object('homeScore', next_home_score, 'awayScore', next_away_score, 'event', next_event),
    jsonb_build_object(
      'goalEventId', event_row.id,
      'correctionAction', 'corrected',
      'actorType', actor_role,
      'parentLinkId', parent_link_row.id,
      'source', 'match_day_goal_correction_rpc'
    )
  );

  return jsonb_build_object(
    'matchDayId', match_row.id,
    'homeScore', next_home_score,
    'awayScore', next_away_score,
    'status', match_row.status,
    'event', next_event
  );
end;
$$;

revoke all on function public.correct_match_day_goal(uuid, uuid, uuid, text, text, text, text, text, integer, text, text) from public, anon;
grant execute on function public.correct_match_day_goal(uuid, uuid, uuid, text, text, text, text, text, integer, text, text) to authenticated, service_role;

comment on function public.correct_match_day_goal(uuid, uuid, uuid, text, text, text, text, text, integer, text, text) is
  'Corrects one goal with its canonical score effect. Parent callers must be the current exact-scope scorer and cannot mutate a concluded fixture.';

create or replace function public.void_match_day_goal(
  match_day_id_value uuid,
  goal_event_id_value uuid,
  parent_link_id_value uuid default null,
  reason_value text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if parent_link_id_value is not null then
    raise exception 'Parent views are read-only for event undo.';
  end if;

  return public.void_match_day_event(
    match_day_id_value,
    goal_event_id_value,
    'added_by_mistake',
    left(trim(coalesce(reason_value, '')), 240)
  );
end;
$$;

revoke all on function public.void_match_day_goal(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.void_match_day_goal(uuid, uuid, uuid, text) to authenticated, service_role;

comment on function public.void_match_day_goal(uuid, uuid, uuid, text) is
  'Legacy staff-only goal undo wrapper. Parent scorer event removal remains denied.';

do $$
declare
  function_row record;
  allowed_signature text;
begin
  for function_row in
    select procedure.oid,
           procedure.proname,
           pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_arguments
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'update_match_day_score_as_scorer',
        'add_match_day_goal_as_scorer',
        'correct_match_day_goal',
        'void_match_day_goal'
      )
  loop
    allowed_signature := case function_row.proname
      when 'update_match_day_score_as_scorer' then 'parent_link_id_value uuid, match_day_id_value uuid, home_score_value integer, away_score_value integer, status_value text'
      when 'add_match_day_goal_as_scorer' then 'parent_link_id_value uuid, match_day_id_value uuid, team_side_value text, scorer_name_value text, scorer_shirt_number_value text, assist_name_value text, assist_shirt_number_value text, minute_value integer, notes_value text'
      when 'correct_match_day_goal' then 'match_day_id_value uuid, goal_event_id_value uuid, parent_link_id_value uuid, team_side_value text, scorer_name_value text, scorer_shirt_number_value text, assist_name_value text, assist_shirt_number_value text, minute_value integer, notes_value text, correction_reason_value text'
      when 'void_match_day_goal' then 'match_day_id_value uuid, goal_event_id_value uuid, parent_link_id_value uuid, reason_value text'
    end;

    if function_row.identity_arguments <> allowed_signature then
      execute format(
        'revoke all on function %I.%I(%s) from public, anon, authenticated, service_role',
        'public',
        function_row.proname,
        function_row.identity_arguments
      );
    end if;
  end loop;
end;
$$;
