-- Preserve the existing scorer authority and request idempotency in the new goal API.
alter table public.match_day_events add column if not exists is_own_goal boolean not null default false;

CREATE OR REPLACE FUNCTION public.get_end_season_stats(team_id_value uuid DEFAULT NULL::uuid)
 RETURNS TABLE(player_id uuid, player_name text, shirt_number text, team_id uuid, team_name text, goals integer, assists integer, motm_votes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with staff_scope as (
    select
      public.current_user_club_id() as club_id,
      public.current_user_role() as role,
      public.current_user_role_rank() as role_rank
  ),
  allowed_scope as (
    select
      scope.club_id,
      scope.role,
      scope.role_rank,
      (
        scope.role = 'admin'
        or (
          scope.role_rank >= 20
          and team_id_value is not null
          and exists (
            select 1
            from public.team_staff staff
            where staff.team_id = team_id_value
              and staff.user_id = auth.uid()
          )
        )
      ) as can_read
    from staff_scope scope
  ),
  scoped_players as (
    select
      player.id,
      player.player_name,
      coalesce(player.shirt_number, '') as shirt_number,
      player.team_id,
      coalesce(team.name, '') as team_name
    from public.players player
    join allowed_scope scope
      on scope.club_id = player.club_id
    left join public.teams team
      on team.id = player.team_id
    where auth.uid() is not null
      and scope.can_read is true
      and coalesce(player.status, 'active') <> 'archived'
      and player.section = 'Squad'
      and player.archived_at is null
      and (
        team_id_value is null
        or player.team_id = team_id_value
      )
  ),
  year_matches as (
    select match_day.*
    from public.match_days match_day
    join allowed_scope scope
      on scope.club_id = match_day.club_id
    where auth.uid() is not null
      and scope.can_read is true
      and match_day.match_date >= date_trunc('year', timezone('Europe/London', now()))::date
      and match_day.match_date < (date_trunc('year', timezone('Europe/London', now())) + interval '1 year')::date
      and match_day.deleted_at is null
      and match_day.status not in ('cancelled', 'postponed')
      and (
        team_id_value is null
        or match_day.team_id = team_id_value
      )
  ),
  goal_counts as (
    select
      player.id as player_id,
      count(*)::integer as goals
    from scoped_players player
    join year_matches match_day
      on match_day.team_id is null or match_day.team_id = player.team_id
    join public.match_day_events event
      on event.match_day_id = match_day.id
      and event.event_type = 'goal'
      and event.team_side = 'club'
      and coalesce(event.event_status, 'active') = 'active'
      and event.voided_at is null
      and coalesce(event.is_own_goal, false) = false
      and lower(trim(regexp_replace(event.scorer_name, '^Other:\s*', '', 'i'))) = lower(trim(player.player_name))
    group by player.id
  ),
  assist_counts as (
    select
      player.id as player_id,
      count(*)::integer as assists
    from scoped_players player
    join year_matches match_day
      on match_day.team_id is null or match_day.team_id = player.team_id
    join public.match_day_events event
      on event.match_day_id = match_day.id
      and event.event_type = 'goal'
      and event.team_side = 'club'
      and coalesce(event.event_status, 'active') = 'active'
      and event.voided_at is null
      and coalesce(event.is_own_goal, false) = false
      and lower(trim(regexp_replace(event.assist_name, '^Other:\s*', '', 'i'))) = lower(trim(player.player_name))
    group by player.id
  ),
  motm_counts as (
    select
      player.id as player_id,
      count(vote.id)::integer as motm_votes
    from scoped_players player
    join year_matches match_day
      on match_day.motm_poll_id is not null
      and (match_day.team_id is null or match_day.team_id = player.team_id)
    join public.poll_votes vote
      on vote.poll_id = match_day.motm_poll_id
      and vote.option_id = player.id::text
    group by player.id
  )
  select
    player.id as player_id,
    player.player_name,
    player.shirt_number,
    player.team_id,
    player.team_name,
    coalesce(goal_counts.goals, 0) as goals,
    coalesce(assist_counts.assists, 0) as assists,
    coalesce(motm_counts.motm_votes, 0) as motm_votes
  from scoped_players player
  left join goal_counts
    on goal_counts.player_id = player.id
  left join assist_counts
    on assist_counts.player_id = player.id
  left join motm_counts
    on motm_counts.player_id = player.id
  order by player.team_name, player.player_name;
$function$
;


CREATE OR REPLACE FUNCTION public.record_match_day_goal_v3(match_day_id_value uuid, parent_link_id_value uuid, team_side_value text, scorer_name_value text, scorer_shirt_number_value text, assist_name_value text, assist_shirt_number_value text, minute_value integer, notes_value text, is_penalty_goal_value boolean, request_id_value uuid, is_own_goal_value boolean, stoppage_minute_value integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  match_row public.match_days%rowtype;
  actor_record record;
  normalized_team_side text := trim(coalesce(team_side_value, 'club'));
  next_home_score integer;
  next_away_score integer;
  event_row public.match_day_events%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Login is required before adding a goal.';
  end if;

  if request_id_value is null then
    raise exception 'A request id is required before adding a goal.';
  end if;

  if normalized_team_side not in ('club', 'opponent') then
    raise exception 'Choose who scored the goal.';
  end if;

  if minute_value is not null and minute_value < 0 then
    raise exception 'Minute must be zero or greater.';
  end if;

  if coalesce(stoppage_minute_value, 0) < 0 or coalesce(stoppage_minute_value, 0) > 30 then
    raise exception 'Added time must be between 0 and 30 minutes.';
  end if;
  if coalesce(is_own_goal_value, false) and coalesce(is_penalty_goal_value, false) then
    raise exception 'An own goal cannot also be a penalty goal.';
  end if;
  if coalesce(is_own_goal_value, false) then
    assist_name_value := '';
    assist_shirt_number_value := '';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if match_row.concluded_at is not null
    or match_row.status not in ('live', 'half_time', 'second_half', 'extra_time', 'penalties')
    or coalesce(match_row.timer_status, 'not_started') in ('not_started', 'full_time') then
    raise exception 'Start or resume the match before recording a goal.';
  end if;

  select * into actor_record
  from public.resolve_match_day_mutation_actor(match_row.id, parent_link_id_value);

  if actor_record.actor_user_id is null then
    raise exception 'You cannot record goals for this match.';
  end if;

  select * into event_row
  from public.match_day_events
  where match_day_id = match_day_id_value
    and request_id = request_id_value;

  if event_row.id is not null then
    return to_jsonb(event_row);
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
    created_by_parent_link_id, created_by_name, is_penalty_goal,
    match_phase, phase_order, request_id, is_own_goal, stoppage_minute
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
    actor_record.actor_user_id,
    actor_record.actor_parent_link_id,
    actor_record.actor_name,
    coalesce(is_penalty_goal_value, false),
    match_row.current_match_phase,
    public.match_day_phase_order(match_row.current_match_phase),
    request_id_value, coalesce(is_own_goal_value, false), nullif(stoppage_minute_value, 0)
  )
  returning * into event_row;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id,
    match_row.team_id,
    match_row.id,
    actor_record.actor_user_id,
    actor_record.actor_name,
    actor_record.actor_role,
    'scorer_updated',
    'Goal added',
    jsonb_build_object('homeScore', match_row.home_score, 'awayScore', match_row.away_score),
    jsonb_build_object('homeScore', next_home_score, 'awayScore', next_away_score),
    jsonb_build_object(
      'matchEventId', event_row.id,
      'parentLinkId', actor_record.actor_parent_link_id,
      'requestId', request_id_value,
      'source', 'match_day_goal_v3', 'isOwnGoal', event_row.is_own_goal, 'stoppageMinute', event_row.stoppage_minute
    )
  );

  return to_jsonb(event_row);
end;
$function$;
revoke all on function public.record_match_day_goal_v3(uuid,uuid,text,text,text,text,text,integer,text,boolean,uuid,boolean,integer) from public, anon;
grant execute on function public.record_match_day_goal_v3(uuid,uuid,text,text,text,text,text,integer,text,boolean,uuid,boolean,integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.correct_match_day_goal_v2(match_day_id_value uuid, goal_event_id_value uuid, parent_link_id_value uuid DEFAULT NULL::uuid, team_side_value text DEFAULT NULL::text, scorer_name_value text DEFAULT NULL::text, scorer_shirt_number_value text DEFAULT ''::text, assist_name_value text DEFAULT ''::text, assist_shirt_number_value text DEFAULT ''::text, minute_value integer DEFAULT NULL::integer, notes_value text DEFAULT ''::text, correction_reason_value text DEFAULT ''::text, is_own_goal_value boolean DEFAULT NULL::boolean, stoppage_minute_value integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if minute_value is not null and minute_value < 0 then
    raise exception 'Minute must be zero or greater.';
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

  if coalesce(stoppage_minute_value, 0) < 0 or coalesce(stoppage_minute_value, 0) > 30 then
    raise exception 'Added time must be between 0 and 30 minutes.';
  end if;
  if coalesce(is_own_goal_value, event_row.is_own_goal) then
    assist_name_value := '';
    assist_shirt_number_value := '';
  end if;

  previous_event := jsonb_build_object(
    'id', event_row.id,
    'eventType', event_row.event_type,
    'teamSide', event_row.team_side,
    'minute', event_row.minute,
    'isOwnGoal', event_row.is_own_goal,
    'stoppageMinute', event_row.stoppage_minute,
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
      is_own_goal = coalesce(is_own_goal_value, event_row.is_own_goal),
      is_penalty_goal = case when coalesce(is_own_goal_value, event_row.is_own_goal) then false else event_row.is_penalty_goal end,
      stoppage_minute = nullif(stoppage_minute_value, 0),
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
    'isOwnGoal', is_own_goal,
    'stoppageMinute', stoppage_minute,
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
$function$;
revoke all on function public.correct_match_day_goal_v2(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,boolean,integer) from public, anon;
grant execute on function public.correct_match_day_goal_v2(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,boolean,integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_parent_portal_match_day_extended_state(parent_link_id_value uuid)
 RETURNS TABLE(match_day_id uuid, match_conclusion_rule text, current_match_phase text, extra_time_half_minutes integer, extra_time_period_count integer, normal_time_home_score integer, normal_time_away_score integer, extra_time_home_score integer, extra_time_away_score integer, home_shootout_score integer, away_shootout_score integer, shootout_winner text, shootout_events jsonb, event_contexts jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    visible.id,
    match_day.match_conclusion_rule,
    match_day.current_match_phase,
    match_day.extra_time_half_minutes,
    match_day.extra_time_period_count,
    match_day.normal_time_home_score,
    match_day.normal_time_away_score,
    match_day.extra_time_home_score,
    match_day.extra_time_away_score,
    match_day.home_shootout_score,
    match_day.away_shootout_score,
    match_day.shootout_winner,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', kick.id,
        'matchDayId', kick.match_day_id,
        'teamSide', kick.team_side,
        'outcome', kick.outcome,
        'kickNumber', kick.kick_number,
        'playerName', kick.player_name,
        'notes', kick.notes,
        'eventStatus', kick.event_status,
        'voidedAt', kick.voided_at,
        'voidedByName', kick.voided_by_name,
        'voidReason', kick.void_reason,
        'homeShootoutScore', kick.home_shootout_score,
        'awayShootoutScore', kick.away_shootout_score,
        'createdAt', kick.created_at
      ) order by kick.created_at, kick.id)
      from public.match_day_shootout_kicks kick
      where kick.match_day_id = match_day.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event.id,
        'isPenaltyGoal', event.is_penalty_goal,
        'isOwnGoal', event.is_own_goal,
        'minute', event.minute,
        'matchPhase', event.match_phase,
        'phaseOrder', event.phase_order,
        'stoppageMinute', event.stoppage_minute,
        'eventSequence', event.event_sequence
      ))
      from public.match_day_events event
      where event.match_day_id = match_day.id
    ), '[]'::jsonb)
  from public.get_parent_portal_match_days(parent_link_id_value) visible
  join public.match_days match_day on match_day.id = visible.id
  where match_day.deleted_at is null;
$function$;

-- A fixed second half starts at the scheduled half-time minute, excluding first-half added time.
CREATE OR REPLACE FUNCTION public.enforce_match_day_second_half_floor()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if coalesce(new.match_clock_mode, 'fixed') = 'fixed'
    and new.status = 'second_half'
    and (old.status = 'half_time' or old.timer_status = 'half_time') then
    new.timer_elapsed_seconds := (coalesce(new.match_duration_minutes, 90) / 2) * 60;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_match_day_event_extended_context()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  resolved_phase text;
  match_row public.match_days%rowtype;
  period_end integer;
begin
  if new.event_sequence is null or new.event_sequence <= 0 then
    new.event_sequence := nextval('public.match_day_event_sequence_seq');
  end if;

  select match_day.*
  into match_row
  from public.match_days match_day
  where match_day.id = new.match_day_id;

  resolved_phase := match_row.current_match_phase;
  new.match_phase := coalesce(nullif(resolved_phase, ''), 'pre_match');
  if new.match_phase = 'penalties' and new.event_type = 'goal' then
    raise exception 'Use the penalty shootout ledger instead of a normal goal during the shootout.' using errcode = '22023';
  end if;

  new.phase_order := public.match_day_phase_order(new.match_phase);
  new.stoppage_minute := case when new.stoppage_minute is null then null else greatest(new.stoppage_minute, 0) end;
  if coalesce(match_row.match_clock_mode, 'fixed') = 'fixed' and coalesce(new.stoppage_minute, 0) = 0 then
    period_end := case new.match_phase
      when 'first_half' then match_row.match_duration_minutes / 2
      when 'half_time' then match_row.match_duration_minutes / 2
      when 'second_half' then match_row.match_duration_minutes
      when 'extra_time_first_half' then match_row.match_duration_minutes + match_row.extra_time_half_minutes
      when 'extra_time_second_half' then match_row.match_duration_minutes + 2 * match_row.extra_time_half_minutes
      else null end;
    if period_end is not null and new.minute > period_end and new.minute <= period_end + 30 then
      new.stoppage_minute := new.minute - period_end;
      new.minute := period_end;
    end if;
  end if;
  return new;
end;
$function$;
