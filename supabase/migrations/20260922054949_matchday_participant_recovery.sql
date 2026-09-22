-- Retain event authority and squad restrictions while supporting Coach match-only names.
CREATE OR REPLACE FUNCTION public.record_match_day_scorer_event_v1(match_day_id_value uuid, event_type_value text, team_side_value text, minute_value integer, player_name_value text, player_shirt_number_value text, player_on_name_value text, player_on_shirt_number_value text, notes_value text, request_id_value uuid, parent_link_id_value uuid DEFAULT NULL, stoppage_minute_value integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  match_row public.match_days%rowtype;
  actor_record record;
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
  coach_named_participant boolean := false;
  named_off boolean := false;
  named_on boolean := false;
begin
  if auth.uid() is null and not private.is_guest_match_scorer(match_day_id_value) then
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

  if minute_value is null or minute_value < 0 or minute_value > 999 then
    raise exception 'Choose a whole match minute from 0 to 999.';
  end if;

  if stoppage_minute_value is not null and (stoppage_minute_value < 0 or stoppage_minute_value > 30) then
    raise exception 'Added time must be between 0 and 30 minutes.';
  end if;
  if length(normalized_player_name)>80 or length(normalized_player_on_name)>80
    or length(normalized_player_shirt)>8 or length(normalized_player_on_shirt)>8
    or length(coalesce(notes_value,''))>500 then
    raise exception 'Match event details are too long.';
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

  select * into actor_record from public.resolve_match_day_mutation_actor(match_row.id, parent_link_id_value);
  if actor_record.actor_user_id is null and actor_record.actor_role is distinct from 'scorer_guest' then
    raise exception 'Only a coach or the selected scorer can add events for this match.';
  end if;

  select * into event_row
  from public.match_day_events
  where match_day_id = match_day_id_value
    and request_id = request_id_value;

  if event_row.id is not null then
    if event_row.event_type<>normalized_event_type or event_row.team_side<>normalized_team_side
      or event_row.minute is distinct from minute_value
      or coalesce(event_row.stoppage_minute,0)<>coalesce(stoppage_minute_value,0)
      or event_row.scorer_name<>normalized_player_name or event_row.scorer_shirt_number<>normalized_player_shirt
      or event_row.assist_name<>(case when normalized_event_type='substitution' then normalized_player_on_name else '' end)
      or event_row.assist_shirt_number<>(case when normalized_event_type='substitution' then normalized_player_on_shirt else '' end)
      or event_row.notes<>trim(coalesce(notes_value,'')) then
      raise exception 'This request has already been used for a different change.';
    end if;
    return to_jsonb(event_row);
  end if;

  -- Only an authorised Coach may use explicitly labelled match-only participants.
  -- Parent and guest scorers retain selected-squad validation.
  coach_named_participant := auth.uid() is not null
    and coalesce(public.can_manage_match_day(match_row.team_id), false)
    and actor_record.actor_parent_link_id is null
    and actor_record.actor_role is distinct from 'scorer_guest';
  named_off := coach_named_participant and normalized_player_shirt = '' and
    (normalized_player_name ~ '^Other: [^[:space:]].*' or
      (normalized_event_type in ('yellow_card', 'red_card') and normalized_player_name ~ '^Coach: [^[:space:]].*'));
  named_on := coach_named_participant and normalized_player_on_shirt = ''
    and normalized_player_on_name ~ '^Other: [^[:space:]].*';

  if normalized_team_side = 'club' and normalized_event_type <> 'water_break' then
    if normalized_player_name = '' then
      raise exception 'Choose a selected Match squad Player before recording this event.';
    end if;

    if not named_off then
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
        and player.archived_at is null and coalesce(player.status, 'active') <> 'archived'
        and lower(trim(player.player_name)) = lower(normalized_player_name)
        and (normalized_player_shirt = '' or trim(coalesce(player.shirt_number, '')) = normalized_player_shirt);

      if participant_match_count <> 1 or participant_player_id is null then
        raise exception 'Choose one selected Match squad Player from this fixture Team.' using errcode = '22023';
      end if;

    end if;

    if normalized_event_type = 'substitution' then
      if normalized_player_on_name = '' then
        raise exception 'Choose a selected Match squad Player On before recording this substitution.';
      end if;

      if not named_on then
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
              and player.archived_at is null and coalesce(player.status, 'active') <> 'archived'
          and lower(trim(player.player_name)) = lower(normalized_player_on_name)
          and (normalized_player_on_shirt = '' or trim(coalesce(player.shirt_number, '')) = normalized_player_on_shirt);

        if participant_on_match_count <> 1 or participant_player_on_id is null then
          raise exception 'Choose one selected Match squad Player On from this fixture Team.' using errcode = '22023';
        end if;

      end if;

      if participant_player_id = participant_player_on_id or lower(normalized_player_name) = lower(normalized_player_on_name) then
        raise exception 'Choose a different Player On for this substitution.' using errcode = '22023';
      end if;
    end if;
  end if;

  insert into public.match_day_events (
    match_day_id, club_id, team_id, event_type, team_side, minute,
    scorer_name, scorer_initials, scorer_shirt_number,
    assist_name, assist_initials, assist_shirt_number,
    home_score, away_score, notes, created_by, created_by_name, created_by_parent_link_id,
    match_phase, phase_order, request_id, stoppage_minute
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
    actor_record.actor_user_id,
    actor_record.actor_name,
    actor_record.actor_parent_link_id,
    match_row.current_match_phase,
    public.match_day_phase_order(match_row.current_match_phase),
    request_id_value, nullif(stoppage_minute_value,0)
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
    normalized_event_type,
    initcap(replace(normalized_event_type, '_', ' ')),
    null,
    jsonb_build_object(
      'eventType', normalized_event_type,
      'teamSide', normalized_team_side,
      'minute', minute_value,
      'stoppageMinute', stoppage_minute_value,
      'playerId', participant_player_id,
      'playerName', normalized_player_name,
      'playerOnId', participant_player_on_id,
      'playerOnName', normalized_player_on_name
    ),
    jsonb_build_object(
      'matchEventId', event_row.id,
      'requestId', request_id_value,
      'source', 'match_day_scorer_event_v1',
      'parentLinkId', actor_record.actor_parent_link_id
    )
  );

  return to_jsonb(event_row);
end;
$function$;
