-- Preserve the saved surface for older clients that omit pitchType.
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
  pitch_type_value text := lower(btrim(coalesce(p_fixture ->> 'pitchType', '')));
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
    or pitch_type_value not in ('', 'grass', '3g', '4g', 'indoor', 'other')
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
      pitch_type = case when p_fixture ? 'pitchType' then pitch_type_value else match_day.pitch_type end,
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


