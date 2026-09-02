-- Match clocks can continue into added time. Keep event minutes nonnegative without
-- rejecting a recorded elapsed minute after an arbitrary 130-minute cutoff.
alter table public.match_day_events drop constraint match_day_events_minute_check;
alter table public.match_day_events add constraint match_day_events_minute_check check (minute is null or minute >= 0);

CREATE OR REPLACE FUNCTION public.correct_match_day_goal(match_day_id_value uuid, goal_event_id_value uuid, parent_link_id_value uuid DEFAULT NULL::uuid, team_side_value text DEFAULT NULL::text, scorer_name_value text DEFAULT NULL::text, scorer_shirt_number_value text DEFAULT ''::text, assist_name_value text DEFAULT ''::text, assist_shirt_number_value text DEFAULT ''::text, minute_value integer DEFAULT NULL::integer, notes_value text DEFAULT ''::text, correction_reason_value text DEFAULT ''::text)
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
$function$;

CREATE OR REPLACE FUNCTION public.record_match_day_staff_event_v2(match_day_id_value uuid, event_type_value text, team_side_value text, minute_value integer, player_name_value text, player_shirt_number_value text, player_on_name_value text, player_on_shirt_number_value text, notes_value text, request_id_value uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  match_row public.match_days%rowtype;
  staff_user public.users%rowtype;
  normalized_event_type text := trim(coalesce(event_type_value, ''));
  normalized_team_side text := trim(coalesce(team_side_value, 'club'));
  normalized_player_name text := trim(coalesce(player_name_value, ''));
  normalized_player_shirt text := trim(coalesce(player_shirt_number_value, ''));
  normalized_player_on_name text := trim(coalesce(player_on_name_value, ''));
  normalized_player_on_shirt text := trim(coalesce(player_on_shirt_number_value, ''));
  participant_player_id uuid;
  participant_player_on_id uuid;
  participant_match_count integer := 0;
  participant_on_match_count integer := 0;
  event_row public.match_day_events%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Login is required before adding a match event.';
  end if;

  if request_id_value is null then
    raise exception 'A request id is required before adding a match event.';
  end if;

  if normalized_event_type not in ('yellow_card', 'red_card', 'substitution', 'water_break') then
    raise exception 'Choose a supported Match Day event type.';
  end if;

  if normalized_team_side not in ('club', 'opponent') then
    raise exception 'Choose which team the event belongs to.';
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

  if match_row.concluded_at is not null
    or match_row.status not in ('live', 'half_time', 'second_half', 'extra_time', 'penalties')
    or coalesce(match_row.timer_status, 'not_started') in ('not_started', 'full_time') then
    raise exception 'Start or resume the match before recording an event.';
  end if;

  if not public.can_manage_match_day(match_row.team_id) then
    raise exception 'You cannot add events for this match.';
  end if;

  select * into staff_user
  from public.users
  where id = auth.uid();

  select * into event_row
  from public.match_day_events
  where match_day_id = match_day_id_value
    and request_id = request_id_value;

  if event_row.id is not null then
    return to_jsonb(event_row);
  end if;

  if normalized_team_side = 'club' and normalized_event_type <> 'water_break' then
    if normalized_player_name = '' then
      raise exception 'Choose a selected Match squad Player before recording this event.';
    end if;

    select count(*), min(player.id::text)::uuid
    into participant_match_count, participant_player_id
    from public.players player
    join public.match_day_player_squad_decisions decision
      on decision.player_id = player.id
      and decision.match_day_id = match_row.id
      and decision.club_id = match_row.club_id
      and decision.team_id = match_row.team_id
      and decision.status = 'selected'
    where player.club_id = match_row.club_id
      and player.team_id = match_row.team_id
      and player.section = 'Squad'
      and coalesce(player.status, 'active') <> 'archived'
      and lower(trim(player.player_name)) = lower(normalized_player_name)
      and (normalized_player_shirt = '' or trim(coalesce(player.shirt_number, '')) = normalized_player_shirt);

    if participant_match_count <> 1 or participant_player_id is null then
      raise exception 'Choose one selected Match squad Player from this fixture Team.';
    end if;

    if normalized_event_type = 'substitution' then
      if normalized_player_on_name = '' then
        raise exception 'Choose a selected Match squad Player On before recording this substitution.';
      end if;

      select count(*), min(player.id::text)::uuid
      into participant_on_match_count, participant_player_on_id
      from public.players player
      join public.match_day_player_squad_decisions decision
        on decision.player_id = player.id
        and decision.match_day_id = match_row.id
        and decision.club_id = match_row.club_id
        and decision.team_id = match_row.team_id
        and decision.status = 'selected'
      where player.club_id = match_row.club_id
        and player.team_id = match_row.team_id
        and player.section = 'Squad'
        and coalesce(player.status, 'active') <> 'archived'
        and lower(trim(player.player_name)) = lower(normalized_player_on_name)
        and (normalized_player_on_shirt = '' or trim(coalesce(player.shirt_number, '')) = normalized_player_on_shirt);

      if participant_on_match_count <> 1 or participant_player_on_id is null then
        raise exception 'Choose one selected Match squad Player On from this fixture Team.';
      end if;

      if participant_player_id = participant_player_on_id then
        raise exception 'Choose a different Player On for this substitution.';
      end if;
    end if;
  end if;

  insert into public.match_day_events (
    match_day_id, club_id, team_id, event_type, team_side, minute,
    scorer_name, scorer_initials, scorer_shirt_number,
    assist_name, assist_initials, assist_shirt_number,
    home_score, away_score, notes, created_by, created_by_name,
    match_phase, phase_order, request_id
  ) values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    normalized_event_type,
    normalized_team_side,
    minute_value,
    normalized_player_name,
    public.get_initials_from_full_name(normalized_player_name),
    normalized_player_shirt,
    case when normalized_event_type = 'substitution' then normalized_player_on_name else '' end,
    case when normalized_event_type = 'substitution' then public.get_initials_from_full_name(normalized_player_on_name) else '' end,
    case when normalized_event_type = 'substitution' then normalized_player_on_shirt else '' end,
    greatest(coalesce(match_row.home_score, 0), 0),
    greatest(coalesce(match_row.away_score, 0), 0),
    trim(coalesce(notes_value, '')),
    staff_user.id,
    coalesce(nullif(trim(staff_user.name), ''), staff_user.email, ''),
    match_row.current_match_phase,
    public.match_day_phase_order(match_row.current_match_phase),
    request_id_value
  )
  returning * into event_row;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id,
    match_row.team_id,
    match_row.id,
    staff_user.id,
    coalesce(nullif(trim(staff_user.name), ''), staff_user.email, ''),
    coalesce(nullif(trim(staff_user.role), ''), 'staff'),
    normalized_event_type,
    initcap(replace(normalized_event_type, '_', ' ')),
    null,
    jsonb_build_object(
      'eventType', normalized_event_type,
      'teamSide', normalized_team_side,
      'minute', minute_value,
      'playerId', participant_player_id,
      'playerName', normalized_player_name,
      'playerOnId', participant_player_on_id,
      'playerOnName', normalized_player_on_name
    ),
    jsonb_build_object(
      'matchEventId', event_row.id,
      'requestId', request_id_value,
      'source', 'match_day_staff_event_v2',
      'capabilityRelease', 'FP-V1-GAMEDAY-CAPABILITY-RESTORATION-31A'
    )
  );

  return to_jsonb(event_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_match_day_goal_as_scorer(parent_link_id_value uuid, match_day_id_value uuid, team_side_value text, scorer_name_value text, scorer_shirt_number_value text DEFAULT ''::text, assist_name_value text DEFAULT ''::text, assist_shirt_number_value text DEFAULT ''::text, minute_value integer DEFAULT NULL::integer, notes_value text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.record_match_day_goal_v2(match_day_id_value uuid, parent_link_id_value uuid, team_side_value text, scorer_name_value text, scorer_shirt_number_value text, assist_name_value text, assist_shirt_number_value text, minute_value integer, notes_value text, is_penalty_goal_value boolean, request_id_value uuid)
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
    match_phase, phase_order, request_id
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
    request_id_value
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
      'source', 'match_day_goal_v2'
    )
  );

  return to_jsonb(event_row);
end;
$function$;

-- Parent identities need not have a staff profile. Retain the true actor in audit
-- metadata and use the nullable staff reference only when that profile exists.
CREATE OR REPLACE FUNCTION public.create_match_day_motm_poll(target_match_day_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  match_row public.match_days%rowtype;
  option_rows jsonb;
  poll_id_value uuid;
  audit_actor_id uuid;
begin
  if target_match_day_id is null then
    return null;
  end if;

  select match_day.*
  into match_row
  from public.match_days match_day
  where match_day.id = target_match_day_id
  for update;

  if match_row.id is null then
    return null;
  end if;

  if match_row.status <> 'full_time'
    or match_row.enable_motm_poll is false
    or match_row.motm_poll_id is not null then
    return match_row.motm_poll_id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', player.id::text,
        'label', btrim(concat(
          coalesce(nullif(player.player_name, ''), 'Player'),
          case when nullif(player.shirt_number, '') is null then '' else ' #' || player.shirt_number end
        )),
        'playerId', player.id::text
      )
      order by player.player_name
    ),
    '[]'::jsonb
  )
  into option_rows
  from public.match_day_player_squad_decisions decision
  join public.players player
    on player.id = decision.player_id
    and player.club_id = decision.club_id
    and player.team_id = decision.team_id
  where decision.match_day_id = match_row.id
    and decision.club_id = match_row.club_id
    and decision.team_id = match_row.team_id
    and decision.status = 'selected'
    and player.archived_at is null
    and coalesce(player.status, 'active') <> 'archived'
    and player.section = 'Squad';

  if jsonb_array_length(option_rows) = 0 then
    return null;
  end if;

  insert into public.polls (
    club_id,
    team_id,
    title,
    description,
    audience,
    poll_type,
    options,
    status,
    closes_at,
    allow_multiple,
    max_choices,
    allow_own_child_votes,
    allow_vote_changes,
    hide_votes,
    allow_comments,
    notify_results_on_close,
    created_by,
    created_by_name
  )
  values (
    match_row.club_id,
    match_row.team_id,
    'Player of the Match',
    'Vote for your Player of the Match: ' || coalesce(match_row.opponent, 'Match Day'),
    'parents',
    'awards',
    option_rows,
    'open',
    timezone('utc', now()) + make_interval(
      mins => greatest(round(coalesce(match_row.motm_poll_expiry_hours, 2) * 60)::integer, 1)
    ),
    false,
    1,
    true,
    false,
    false,
    false,
    match_row.motm_notify_results_on_close,
    match_row.created_by,
    coalesce(match_row.created_by_name, 'Match Day')
  )
  returning id into poll_id_value;

  update public.match_days match_day
  set motm_poll_id = poll_id_value,
      updated_at = timezone('utc', now())
  where match_day.id = match_row.id;

  audit_actor_id := coalesce((select auth.uid()), match_row.created_by);

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    match_row.club_id,
    (select profile.id from public.users profile where profile.id = audit_actor_id),
    'match_day_poll_created',
    'poll',
    poll_id_value,
    jsonb_build_object(
      'actorAuthUserId', audit_actor_id,
      'teamId', match_row.team_id,
      'matchDayId', match_row.id,
      'pollType', 'awards',
      'notifyResultsOnClose', match_row.motm_notify_results_on_close,
      'expiryMinutes', greatest(round(coalesce(match_row.motm_poll_expiry_hours, 2) * 60)::integer, 1)
    )
  );

  return poll_id_value;
end;
$function$;

-- A signed-in Parent responds through the authorised child link. Email delivery
-- tokens remain subject to their separate recipient and revocation checks.
create or replace function public.respond_parent_portal_training_invitation(
  parent_link_id_value uuid,
  request_player_id_value uuid,
  response_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_row public.parent_player_links%rowtype;
  request_player_row public.training_availability_request_players%rowtype;
  request_row public.training_availability_requests%rowtype;
  event_row public.calendar_events%rowtype;
  response_row public.training_availability_responses%rowtype;
  normalized_response text := lower(btrim(coalesce(response_value, '')));
  actor_name text;
  response_changed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Login is required before changing this response.';
  end if;
  if normalized_response not in ('available', 'unavailable', 'maybe') then
    raise exception 'Choose a valid training attendance response.';
  end if;
  select link.* into link_row
  from public.parent_player_links link
  where link.id = parent_link_id_value;
  if link_row.id is null
    or not public.current_user_can_access_parent_link(link_row.id, link_row.player_id)
    or not exists (select 1 from public.players player where player.id = link_row.player_id and player.team_id = link_row.team_id)
    or not exists (select 1 from public.clubs club where club.id = link_row.club_id and coalesce(club.status, 'active') = 'active') then
    raise exception using errcode = '42501', message = 'This parent portal link is not available.';
  end if;

  select request_player.* into request_player_row
  from public.training_availability_request_players request_player
  where request_player.id = request_player_id_value
    and request_player.club_id = link_row.club_id
    and request_player.team_id = link_row.team_id
    and request_player.player_id = link_row.player_id;
  if request_player_row.id is null then
    raise exception using errcode = '42501', message = 'This invitation is not available for this player.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat('reusable_rsvp:training:', request_player_row.request_id::text, ':', request_player_row.player_id::text), 0
  ));
  select request.* into request_row
  from public.training_availability_requests request
  where request.id = request_player_row.request_id
    and request.club_id = link_row.club_id and request.team_id = link_row.team_id
  for update;
  select event.* into event_row
  from public.calendar_events event
  where event.id = request_player_row.calendar_event_id
    and event.id = request_row.calendar_event_id
    and event.club_id = link_row.club_id and event.team_id = link_row.team_id
    and event.event_type = 'training'
  for update;
  select request_player.* into request_player_row
  from public.training_availability_request_players request_player
  where request_player.id = request_player_id_value
  for update;

  if request_row.id is null or event_row.id is null then
    raise exception 'This training invitation is not available.';
  end if;
  if request_row.status in ('cancelled', 'expired')
    or request_player_row.status in ('cancelled', 'expired')
    or event_row.cancelled_at is not null
    or request_row.occurrence_starts_at <= now()
    or coalesce(request_player_row.response_deadline_at, request_row.occurrence_starts_at) < now() then
    raise exception 'This training response window has closed.';
  end if;

  select response.* into response_row
  from public.training_availability_responses response
  where response.request_id = request_row.id and response.player_id = link_row.player_id
  for update;
  select coalesce(nullif(btrim(actor.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(actor.raw_user_meta_data ->> 'name'), ''), 'Parent') into actor_name
  from auth.users actor where actor.id = auth.uid();
  actor_name := coalesce(actor_name, 'Parent');

  if response_row.id is null then
    insert into public.training_availability_responses (
      request_player_id, request_id, club_id, team_id, calendar_event_id, player_id,
      parent_link_id, status, note, responded_by_name, responded_by_email, responded_at
    ) values (
      request_player_row.id, request_row.id, link_row.club_id, link_row.team_id,
      event_row.id, link_row.player_id, link_row.id, normalized_response, '',
      actor_name, coalesce(link_row.email, ''), timezone('utc', now())
    ) returning * into response_row;
    response_changed := true;
  elsif response_row.status is distinct from normalized_response then
    update public.training_availability_responses response
    set request_player_id = request_player_row.id, parent_link_id = link_row.id,
        status = normalized_response, note = '', responded_by_name = actor_name,
        responded_by_email = coalesce(link_row.email, ''), responded_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where response.id = response_row.id
    returning * into response_row;
    response_changed := true;
  end if;

  update public.training_availability_request_players recipient
  set status = 'responded', responded_at = response_row.responded_at, updated_at = timezone('utc', now())
  where recipient.request_id = request_row.id and recipient.player_id = link_row.player_id
    and recipient.club_id = link_row.club_id and recipient.team_id = link_row.team_id
    and recipient.calendar_event_id = event_row.id and recipient.status not in ('cancelled', 'expired');

  return jsonb_build_object('requestPlayerId', request_player_row.id,
    'responseState', response_row.status, 'respondedAt', response_row.responded_at, 'changed', response_changed);
end;
$$;
revoke all on function public.respond_parent_portal_training_invitation(uuid, uuid, text) from public, anon;
grant execute on function public.respond_parent_portal_training_invitation(uuid, uuid, text) to authenticated, service_role;
