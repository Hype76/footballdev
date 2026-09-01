alter table public.match_days
  add column if not exists notification_team_name text not null default '';

alter table public.match_days
  drop constraint if exists match_days_notification_team_name_length_check;

alter table public.match_days
  add constraint match_days_notification_team_name_length_check
  check (char_length(notification_team_name) <= 40);

comment on column public.match_days.notification_team_name is
  'Per-fixture Your Team name used in notifications. The Team display name remains unchanged.';

alter table public.match_days
  drop constraint if exists match_days_shirt_choice_check;

alter table public.match_days
  add constraint match_days_shirt_choice_check
  check (shirt_choice in ('home', 'away', 'tbc'));

comment on column public.match_days.shirt_choice is
  'Fixture kit selection. home means Home Kits, away means Away Kits, and tbc means TBC.';

alter table public.match_locations
  add column if not exists archived_at timestamptz;

alter table public.match_locations
  add column if not exists archived_by uuid references auth.users (id) on delete set null;

create or replace function public.upsert_match_location_for_team(
  p_team_id uuid,
  p_name text,
  p_address text,
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_team public.teams%rowtype;
  location_row public.match_locations%rowtype;
  previous_notes text;
  was_archived boolean := false;
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_address text := btrim(coalesce(p_address, ''));
  normalized_notes text := btrim(coalesce(p_notes, ''));
  operation text := 'unchanged';
begin
  if p_team_id is null
    or normalized_name = ''
    or length(normalized_name) > 160
    or length(normalized_address) > 500
    or length(normalized_notes) > 2000 then
    raise exception using errcode = '22023', message = 'match_location_invalid';
  end if;

  select team.*
  into target_team
  from public.teams team
  join public.clubs club
    on club.id = team.club_id
   and coalesce(club.status, 'active') = 'active'
  where team.id = p_team_id
    and coalesce(team.status, 'active') = 'active'
  for key share of team, club;

  if target_team.id is null
    or not app_private.actor_can_manage_team_resource(actor_id, target_team.club_id, target_team.id, 20) then
    raise exception using errcode = '42501', message = 'match_location_not_permitted';
  end if;

  insert into public.match_locations (
    club_id,
    name,
    address,
    notes,
    created_by
  )
  values (
    target_team.club_id,
    normalized_name,
    normalized_address,
    normalized_notes,
    actor_id
  )
  on conflict (club_id, (lower(name)), (lower(address))) do nothing
  returning * into location_row;

  if location_row.id is not null then
    operation := 'created';
  else
    select location.*
    into location_row
    from public.match_locations location
    where location.club_id = target_team.club_id
      and lower(location.name) = lower(normalized_name)
      and lower(location.address) = lower(normalized_address)
    for update;

    if location_row.id is null then
      raise exception using errcode = '55000', message = 'match_location_unavailable';
    end if;

    previous_notes := location_row.notes;
    was_archived := location_row.archived_at is not null;

    if was_archived
      or (normalized_notes <> '' and normalized_notes is distinct from location_row.notes) then
      update public.match_locations location
      set notes = case
            when normalized_notes <> '' then normalized_notes
            else location.notes
          end,
          archived_at = null,
          archived_by = null,
          updated_at = timezone('utc', now())
      where location.id = location_row.id
      returning * into location_row;
      operation := case when was_archived then 'restored' else 'updated' end;
    end if;
  end if;

  if operation <> 'unchanged' then
    insert into public.audit_logs (
      club_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      target_team.club_id,
      actor_id,
      'match_location_' || operation,
      'match_location',
      location_row.id,
      jsonb_build_object(
        'teamId', target_team.id,
        'previousNotesPresent', coalesce(previous_notes, '') <> '',
        'newNotesPresent', coalesce(location_row.notes, '') <> ''
      )
    );
  end if;

  return location_row.id;
end;
$$;

alter function public.upsert_match_location_for_team(uuid, text, text, text) owner to postgres;
revoke all on function public.upsert_match_location_for_team(uuid, text, text, text)
  from public, anon, service_role;
grant execute on function public.upsert_match_location_for_team(uuid, text, text, text)
  to authenticated;

create or replace function public.archive_match_location_for_team(
  p_team_id uuid,
  p_location_id uuid default null,
  p_name text default '',
  p_address text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_team public.teams%rowtype;
  location_row public.match_locations%rowtype;
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_address text := btrim(coalesce(p_address, ''));
begin
  if p_team_id is null
    or (p_location_id is null and normalized_name = '')
    or length(normalized_name) > 160
    or length(normalized_address) > 500 then
    raise exception using errcode = '22023', message = 'match_location_invalid';
  end if;

  select team.*
  into target_team
  from public.teams team
  join public.clubs club
    on club.id = team.club_id
   and coalesce(club.status, 'active') = 'active'
  where team.id = p_team_id
    and coalesce(team.status, 'active') = 'active'
  for key share of team, club;

  if target_team.id is null
    or not app_private.actor_can_manage_team_resource(actor_id, target_team.club_id, target_team.id, 20) then
    raise exception using errcode = '42501', message = 'match_location_not_permitted';
  end if;

  select location.*
  into location_row
  from public.match_locations location
  where location.club_id = target_team.club_id
    and (
      (p_location_id is not null and location.id = p_location_id)
      or (
        p_location_id is null
        and lower(location.name) = lower(normalized_name)
        and lower(location.address) = lower(normalized_address)
      )
    )
  for update;

  if location_row.id is null and normalized_name <> '' then
    insert into public.match_locations (
      club_id,
      name,
      address,
      notes,
      created_by,
      archived_at,
      archived_by
    )
    values (
      target_team.club_id,
      normalized_name,
      normalized_address,
      '',
      actor_id,
      timezone('utc', now()),
      actor_id
    )
    on conflict (club_id, (lower(name)), (lower(address))) do update
      set archived_at = excluded.archived_at,
          archived_by = excluded.archived_by,
          updated_at = timezone('utc', now())
    returning * into location_row;
  elsif location_row.id is not null and location_row.archived_at is null then
    update public.match_locations location
    set archived_at = timezone('utc', now()),
        archived_by = actor_id,
        updated_at = timezone('utc', now())
    where location.id = location_row.id
    returning * into location_row;
  end if;

  if location_row.id is null then
    raise exception using errcode = 'P0002', message = 'match_location_not_found';
  end if;

  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    target_team.club_id,
    actor_id,
    'match_location_archived',
    'match_location',
    location_row.id,
    jsonb_build_object('teamId', target_team.id)
  );

  return location_row.id;
end;
$$;

alter function public.archive_match_location_for_team(uuid, uuid, text, text) owner to postgres;
revoke all on function public.archive_match_location_for_team(uuid, uuid, text, text)
  from public, anon, service_role;
grant execute on function public.archive_match_location_for_team(uuid, uuid, text, text)
  to authenticated;

comment on function public.archive_match_location_for_team(uuid, uuid, text, text) is
  'Archives one reusable Match Day location after exact Team or Club Admin authority is revalidated.';

create or replace function public.update_match_day_fixture_for_team(
  p_match_day_id uuid,
  p_team_id uuid,
  p_fixture jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    or match_duration_minutes_value not between 20 and 140
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
$$;

alter function public.update_match_day_fixture_for_team(uuid, uuid, jsonb) owner to postgres;
revoke all on function public.update_match_day_fixture_for_team(uuid, uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.update_match_day_fixture_for_team(uuid, uuid, jsonb)
  to authenticated;

comment on function public.update_match_day_fixture_for_team(uuid, uuid, jsonb) is
  'Updates pre-match fixture details after exact Team or Club Admin authority and payload validation.';
