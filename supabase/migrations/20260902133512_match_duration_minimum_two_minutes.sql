begin;

alter table public.match_days
  drop constraint match_days_match_duration_minutes_check,
  add constraint match_days_match_duration_minutes_check
    check (match_duration_minutes between 2 and 140 and mod(match_duration_minutes, 2) = 0);

alter table app_private.user_team_fixture_preferences
  drop constraint user_team_fixture_preferences_duration_check,
  add constraint user_team_fixture_preferences_duration_check
    check (duration_minutes between 2 and 140 and mod(duration_minutes, 2) = 0);

CREATE OR REPLACE FUNCTION public.update_match_day_fixture_for_team(p_match_day_id uuid, p_team_id uuid, p_fixture jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  match_row public.match_days%rowtype;
  updated_row public.match_days%rowtype;
  location_id_value uuid;
  opponent_value text := btrim(coalesce(p_fixture ->> 'opponent', ''));
  notification_team_name_value text := btrim(coalesce(p_fixture ->> 'notificationTeamName', ''));
  fixture_type_value text := btrim(coalesce(p_fixture ->> 'fixtureType', ''));
  home_away_value text := btrim(coalesce(p_fixture ->> 'homeAway', ''));
  shirt_choice_value text := btrim(coalesce(p_fixture ->> 'shirtChoice', ''));
  conclusion_rule_value text := btrim(coalesce(p_fixture ->> 'conclusionRule', ''));
  venue_name_value text := btrim(coalesce(p_fixture ->> 'venueName', ''));
  venue_address_value text := btrim(coalesce(p_fixture ->> 'venueAddress', ''));
  notes_value text := btrim(coalesce(p_fixture ->> 'notes', ''));
  match_date_value date;
  kickoff_time_value time;
  arrival_time_value time;
  kickoff_time_tbc_value boolean;
  match_duration_minutes_value integer;
  extra_time_half_minutes_value integer;
  extra_time_period_count_value integer;
begin
  if p_match_day_id is null
    or p_team_id is null
    or p_fixture is null
    or jsonb_typeof(p_fixture) <> 'object' then
    raise exception using errcode = '22023', message = 'match_day_fixture_invalid';
  end if;

  select match_day.*
  into match_row
  from public.match_days match_day
  join public.teams team
    on team.id = match_day.team_id
   and team.id = p_team_id
   and coalesce(team.status, 'active') = 'active'
  join public.clubs club
    on club.id = match_day.club_id
   and club.id = team.club_id
   and coalesce(club.status, 'active') = 'active'
  where match_day.id = p_match_day_id
    and match_day.deleted_at is null
    and match_day.status in ('scheduled', 'scorer_request', 'postponed')
  for update of match_day;

  if match_row.id is null
    or not app_private.actor_can_manage_team_resource(actor_id, match_row.club_id, p_team_id, 20) then
    raise exception using errcode = '42501', message = 'match_day_fixture_not_permitted';
  end if;

  begin
    location_id_value := nullif(btrim(coalesce(p_fixture ->> 'locationId', '')), '')::uuid;
    match_date_value := nullif(btrim(coalesce(p_fixture ->> 'matchDate', '')), '')::date;
    kickoff_time_tbc_value := coalesce((p_fixture ->> 'kickoffTimeTbc')::boolean, false);
    kickoff_time_value := case
      when kickoff_time_tbc_value then null
      else nullif(btrim(coalesce(p_fixture ->> 'kickoffTime', '')), '')::time
    end;
    arrival_time_value := case
      when kickoff_time_tbc_value then null
      else nullif(btrim(coalesce(p_fixture ->> 'arrivalTime', '')), '')::time
    end;
    match_duration_minutes_value := (p_fixture ->> 'matchDurationMinutes')::integer;
    extra_time_half_minutes_value := (p_fixture ->> 'extraTimeHalfMinutes')::integer;
    extra_time_period_count_value := (p_fixture ->> 'extraTimePeriodCount')::integer;
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'match_day_fixture_invalid';
  end;

  if opponent_value = ''
    or length(opponent_value) > 160
    or length(notification_team_name_value) > 40
    or fixture_type_value not in ('friendly', 'league', 'cup', 'tournament')
    or home_away_value not in ('home', 'away')
    or shirt_choice_value not in ('home', 'away', 'tbc')
    or conclusion_rule_value not in ('normal_time', 'extra_time', 'extra_time_then_penalties', 'straight_to_penalties')
    or match_date_value is null
    or (not kickoff_time_tbc_value and kickoff_time_value is null)
    or match_duration_minutes_value not between 2 and 140
    or mod(match_duration_minutes_value, 2) <> 0
    or extra_time_half_minutes_value not between 5 and 30
    or extra_time_period_count_value not in (1, 2)
    or length(venue_name_value) > 160
    or length(venue_address_value) > 500
    or length(notes_value) > 2000 then
    raise exception using errcode = '22023', message = 'match_day_fixture_invalid';
  end if;

  if location_id_value is not null
    and not exists (
      select 1
      from public.match_locations location
      where location.id = location_id_value
        and location.club_id = match_row.club_id
        and location.archived_at is null
    ) then
    raise exception using errcode = '22023', message = 'match_day_location_invalid';
  end if;

  update public.match_days match_day
  set arrival_time = arrival_time_value,
      extra_time_half_minutes = extra_time_half_minutes_value,
      extra_time_period_count = extra_time_period_count_value,
      fixture_type = fixture_type_value,
      home_away = home_away_value,
      kickoff_time = kickoff_time_value,
      kickoff_time_tbc = kickoff_time_tbc_value,
      location_id = location_id_value,
      match_conclusion_rule = conclusion_rule_value,
      match_date = match_date_value,
      match_duration_minutes = match_duration_minutes_value,
      notes = notes_value,
      notification_team_name = notification_team_name_value,
      opponent = opponent_value,
      shirt_choice = shirt_choice_value,
      updated_at = timezone('utc', now()),
      venue_address = venue_address_value,
      venue_name = venue_name_value
  where match_day.id = match_row.id
  returning match_day.* into updated_row;

  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    match_row.club_id,
    actor_id,
    'match_day_fixture_updated',
    'match_day',
    match_row.id,
    jsonb_build_object(
      'teamId', p_team_id,
      'conclusionRule', conclusion_rule_value,
      'matchDurationMinutes', match_duration_minutes_value
    )
  );

  return to_jsonb(updated_row);
end;
$function$;


CREATE OR REPLACE FUNCTION public.set_own_team_fixture_preferences(team_id_value uuid, save_arrival_value boolean, arrival_preset_value text, arrival_time_value time without time zone, save_duration_value boolean, duration_minutes_value integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  target_team public.teams%rowtype;
  normalized_arrival_preset text := btrim(coalesce(arrival_preset_value, ''));
  saved app_private.user_team_fixture_preferences%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  select team.* into target_team
  from public.teams team
  where team.id = team_id_value
    and team.archived_at is null
  for update;

  if target_team.id is null
    or not app_private.actor_can_manage_team_resource(
      actor_id,
      target_team.club_id,
      target_team.id,
      20
    ) then
    raise exception using errcode = '42501', message = 'Coach or manager access is required for this Team.';
  end if;

  if coalesce(save_arrival_value, false) = false
    and coalesce(save_duration_value, false) = false then
    raise exception using errcode = '22023', message = 'Choose at least one fixture default to save.';
  end if;

  if coalesce(save_arrival_value, false) then
    if normalized_arrival_preset not in ('15', '30', '45', '60', 'custom') then
      raise exception using errcode = '22023', message = 'Choose a supported arrival default.';
    end if;

    if normalized_arrival_preset = 'custom' and arrival_time_value is null then
      raise exception using errcode = '22023', message = 'Add the custom arrival time.';
    end if;
  end if;

  if coalesce(save_duration_value, false)
    and (
      duration_minutes_value is null
      or duration_minutes_value < 2
      or duration_minutes_value > 140
      or mod(duration_minutes_value, 2) <> 0
    ) then
    raise exception using errcode = '22023', message = 'Match duration must be an even number from 2 to 140 minutes.';
  end if;

  insert into app_private.user_team_fixture_preferences as preferences (
    user_id,
    club_id,
    team_id,
    arrival_preset,
    arrival_time,
    duration_minutes,
    updated_at
  )
  values (
    actor_id,
    target_team.club_id,
    target_team.id,
    case when coalesce(save_arrival_value, false) then normalized_arrival_preset else '30' end,
    case
      when coalesce(save_arrival_value, false) and normalized_arrival_preset = 'custom'
        then arrival_time_value
      else null
    end,
    case when coalesce(save_duration_value, false) then duration_minutes_value else 90 end,
    timezone('utc', now())
  )
  on conflict (user_id, team_id) do update
  set arrival_preset = case
        when coalesce(save_arrival_value, false) then excluded.arrival_preset
        else preferences.arrival_preset
      end,
      arrival_time = case
        when coalesce(save_arrival_value, false) then excluded.arrival_time
        else preferences.arrival_time
      end,
      duration_minutes = case
        when coalesce(save_duration_value, false) then excluded.duration_minutes
        else preferences.duration_minutes
      end,
      club_id = excluded.club_id,
      updated_at = timezone('utc', now())
  returning * into saved;

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_team.club_id,
    actor_id,
    'own_team_fixture_preferences_updated',
    'team',
    target_team.id,
    jsonb_build_object(
      'arrivalSaved', coalesce(save_arrival_value, false),
      'arrivalPreset', saved.arrival_preset,
      'durationSaved', coalesce(save_duration_value, false),
      'durationMinutes', saved.duration_minutes
    )
  );

  return jsonb_build_object(
    'found', true,
    'arrivalPreset', saved.arrival_preset,
    'arrivalTime', case
      when saved.arrival_time is null then ''
      else to_char(saved.arrival_time, 'HH24:MI')
    end,
    'duration', saved.duration_minutes,
    'updatedAt', saved.updated_at
  );
end;
$function$;


notify pgrst, 'reload schema';
commit;
