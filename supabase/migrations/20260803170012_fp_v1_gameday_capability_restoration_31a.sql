create or replace function public.record_match_day_staff_event_v2(
  match_day_id_value uuid,
  event_type_value text,
  team_side_value text,
  minute_value integer,
  player_name_value text,
  player_shirt_number_value text,
  player_on_name_value text,
  player_on_shirt_number_value text,
  notes_value text,
  request_id_value uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
$$;

revoke all on function public.record_match_day_staff_event_v2(uuid, text, text, integer, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.record_match_day_staff_event_v2(uuid, text, text, integer, text, text, text, text, text, uuid) to authenticated, service_role;
