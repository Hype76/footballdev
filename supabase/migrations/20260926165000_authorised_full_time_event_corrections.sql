-- Full-time score corrections and goal removals remain available until conclusion.
-- Only validated security-definer actions set this transaction-local authorisation.
create or replace function public.enforce_match_day_event_write()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  target_match_day_id uuid := coalesce(new.match_day_id, old.match_day_id);
  match_row public.match_days%rowtype;
  full_time_correction_allowed boolean;
begin
  select * into match_row from public.match_days where id = target_match_day_id;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  full_time_correction_allowed :=
    match_row.status = 'full_time'
    and match_row.concluded_at is null
    and current_user not in ('anon', 'authenticated')
    and coalesce(current_setting('app.match_day_full_time_correction_authorized', true), '') = 'true'
    and (
      (tg_op = 'INSERT' and new.event_type = 'score_correction')
      or (tg_op = 'UPDATE' and old.event_type = 'goal'
        and new.event_type = 'goal' and old.event_status <> 'voided'
        and new.event_status = 'voided')
    );

  if match_row.concluded_at is not null
    or match_row.status in ('cancelled', 'postponed')
    or (match_row.status = 'full_time' and not full_time_correction_allowed) then
    raise exception 'Completed or closed matches are read only.';
  end if;

  if coalesce(match_row.timer_status, 'not_started') = 'not_started'
    or match_row.status in ('scheduled', 'scorer_request') then
    raise exception 'Start the match before recording or changing an event.';
  end if;

  if current_user in ('anon', 'authenticated') then
    raise exception 'Use an authorised Match Day action for event changes.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_match_day_score_correction_v2(match_day_id_value uuid, parent_link_id_value uuid, home_score_value integer, away_score_value integer, notes_value text, request_id_value uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  match_row public.match_days%rowtype;
  actor_record record;
  next_home_score integer := greatest(coalesce(home_score_value, 0), 0);
  next_away_score integer := greatest(coalesce(away_score_value, 0), 0);
  event_row public.match_day_events%rowtype;
begin
  if auth.uid() is null and not private.is_guest_match_scorer(match_day_id_value) then
    raise exception 'Login is required before updating the match score.';
  end if;

  if request_id_value is null then
    raise exception 'A request id is required before updating the match score.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if match_row.concluded_at is not null
    or match_row.status not in ('live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time')
    or coalesce(match_row.timer_status, 'not_started') = 'not_started' then
    raise exception 'Start the match before correcting the score.';
  end if;

  select * into actor_record
  from public.resolve_match_day_mutation_actor(match_row.id, parent_link_id_value);

  if actor_record.actor_user_id is null and actor_record.actor_role is distinct from 'scorer_guest' then
    raise exception 'You cannot update the score for this match.';
  end if;

  select * into event_row
  from public.match_day_events
  where match_day_id = match_day_id_value
    and request_id = request_id_value;

  if event_row.id is not null then
    return to_jsonb(event_row);
  end if;

  update public.match_days
  set home_score = next_home_score,
      away_score = next_away_score,
      updated_at = now()
  where id = match_row.id;

  perform pg_catalog.set_config('app.match_day_full_time_correction_authorized', 'true', true);

  insert into public.match_day_events (
    match_day_id, club_id, team_id, event_type, team_side,
    home_score, away_score, notes, created_by,
    created_by_parent_link_id, created_by_name,
    match_phase, phase_order, request_id
  ) values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    'score_correction',
    'club',
    next_home_score,
    next_away_score,
    coalesce(nullif(trim(notes_value), ''), 'Score corrected'),
    actor_record.actor_user_id,
    actor_record.actor_parent_link_id,
    actor_record.actor_name,
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
    'Score corrected',
    jsonb_build_object('homeScore', match_row.home_score, 'awayScore', match_row.away_score),
    jsonb_build_object('homeScore', next_home_score, 'awayScore', next_away_score),
    jsonb_build_object(
      'matchEventId', event_row.id,
      'parentLinkId', actor_record.actor_parent_link_id,
      'requestId', request_id_value,
      'source', 'match_day_score_correction_v2'
    )
  );

  return to_jsonb(event_row);
end;
$function$
;

create or replace function public.void_parent_match_day_goal(
  match_day_id_value uuid,
  goal_event_id_value uuid,
  parent_link_id_value uuid,
  reason_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  goal_row public.match_day_events%rowtype;
  actor_id uuid := auth.uid();
  actor_name text;
  reason_text text := trim(coalesce(reason_value, ''));
  next_home integer;
  next_away integer;
begin
  if actor_id is null or parent_link_id_value is null then
    raise exception 'The selected Parent scorer is required.' using errcode = '42501';
  end if;
  if reason_text = '' or char_length(reason_text) > 240 then
    raise exception 'Enter a removal reason of 240 characters or fewer.';
  end if;

  select * into match_row from public.match_days
  where id = match_day_id_value for update;
  if match_row.id is null or match_row.deleted_at is not null
    or match_row.concluded_at is not null
    or match_row.status not in ('live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time') then
    raise exception 'This fixture is closed or unavailable.';
  end if;
  if not public.current_user_has_match_day_scorer_assignment(match_row.id)
    or not exists (
      select 1 from public.match_day_role_assignments assignment
      join public.parent_player_links link on link.id = assignment.parent_link_id
      where assignment.match_day_id = match_row.id and assignment.role = 'scorer'
        and assignment.parent_link_id = parent_link_id_value
        and assignment.auth_user_id = actor_id
        and assignment.club_id = match_row.club_id
        and assignment.team_id = match_row.team_id
        and link.auth_user_id = actor_id and link.status = 'active'
        and link.club_id = match_row.club_id and link.team_id = match_row.team_id
    ) then
    raise exception 'Current selected Parent scorer access is required.' using errcode = '42501';
  end if;

  select * into goal_row from public.match_day_events
  where id = goal_event_id_value and match_day_id = match_row.id
    and club_id = match_row.club_id and team_id = match_row.team_id
  for update;
  if goal_row.id is null or goal_row.event_type <> 'goal' then
    raise exception 'This goal could not be found for the fixture.';
  end if;
  if goal_row.event_status = 'voided' then
    raise exception 'This goal has already been removed.';
  end if;

  actor_name := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), 'Parent scorer');
  next_home := greatest(coalesce(match_row.home_score, 0), 0);
  next_away := greatest(coalesce(match_row.away_score, 0), 0);
  if (goal_row.team_side = 'club') = (match_row.home_away <> 'away') then
    next_home := greatest(0, next_home - 1);
  else
    next_away := greatest(0, next_away - 1);
  end if;

  perform pg_catalog.set_config('app.match_day_full_time_correction_authorized', 'true', true);

  update public.match_day_events set
    event_status = 'voided', voided_at = now(), voided_by = actor_id,
    voided_by_parent_link_id = parent_link_id_value, voided_by_name = actor_name,
    correction_reason = reason_text,
    correction_metadata = jsonb_build_object(
      'action', 'voided', 'actorRole', 'scorer_parent',
      'reasonCode', 'added_by_mistake', 'undoNote', reason_text,
      'previousEvent', to_jsonb(goal_row),
      'previousCorrectionMetadata', coalesce(goal_row.correction_metadata, '{}'::jsonb)
    )
  where id = goal_row.id;

  update public.match_days set home_score = next_home, away_score = next_away,
    updated_at = now() where id = match_row.id;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id, match_row.team_id, match_row.id, actor_id, actor_name,
    'scorer_parent', 'scorer_updated', 'Goal voided',
    jsonb_build_object('homeScore', match_row.home_score, 'awayScore', match_row.away_score, 'event', to_jsonb(goal_row)),
    jsonb_build_object('homeScore', next_home, 'awayScore', next_away, 'eventId', goal_row.id, 'eventStatus', 'voided'),
    jsonb_build_object('matchEventId', goal_row.id, 'undoAction', 'voided',
      'reasonCode', 'added_by_mistake', 'parentLinkId', parent_link_id_value,
      'source', 'parent_match_day_goal_void_rpc')
  );
  return jsonb_build_object('id', goal_row.id, 'eventStatus', 'voided',
    'homeScore', next_home, 'awayScore', next_away);
end;
$$;

revoke all on function public.void_parent_match_day_goal(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.void_parent_match_day_goal(uuid, uuid, uuid, text) to authenticated, service_role;
