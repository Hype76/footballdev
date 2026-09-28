create or replace function public.enforce_match_day_event_write()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  target_match_day_id uuid := coalesce(new.match_day_id, old.match_day_id);
  match_row public.match_days%rowtype;
  full_time_correction_allowed boolean;
  coach_correction_allowed boolean;
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

  coach_correction_allowed :=
    match_row.status = 'full_time'
    and match_row.concluded_at is null
    and current_user not in ('anon', 'authenticated')
    and coalesce(current_setting('app.match_day_coach_correction_authorized', true), '') = 'true'
    and tg_op = 'UPDATE'
    and (
      (old.event_type = 'goal' and new.event_type = 'goal'
        and old.event_status <> 'voided'
        and new.event_status in ('corrected', 'voided'))
      or (old.event_type = new.event_type
        and old.event_status = new.event_status
        and (to_jsonb(new) - 'home_score' - 'away_score')
          = (to_jsonb(old) - 'home_score' - 'away_score'))
    );

  if match_row.concluded_at is not null
    or match_row.status in ('cancelled', 'postponed')
    or (match_row.status = 'full_time'
      and not full_time_correction_allowed and not coach_correction_allowed) then
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

create or replace function public.correct_coach_match_day_goal_v1(
  match_day_id_value uuid,
  goal_event_id_value uuid,
  team_side_value text,
  scorer_name_value text,
  scorer_shirt_number_value text,
  assist_name_value text,
  assist_shirt_number_value text,
  minute_value integer,
  notes_value text,
  correction_reason_value text,
  is_own_goal_value boolean,
  is_penalty_goal_value boolean,
  stoppage_minute_value integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  match_row public.match_days%rowtype;
  goal_before public.match_day_events%rowtype;
  goal_after public.match_day_events%rowtype;
  actor_name text;
  corrected_goal jsonb;
  next_penalty boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in before correcting a goal.' using errcode = '42501';
  end if;

  select * into match_row from public.match_days
  where id = match_day_id_value for update;
  if match_row.id is null or match_row.deleted_at is not null
    or match_row.concluded_at is not null then
    raise exception 'This fixture is closed or unavailable.';
  end if;
  if not public.can_manage_match_day(match_row.team_id)
    or (public.current_user_role() <> 'super_admin'
      and match_row.club_id <> public.current_user_club_id()) then
    raise exception 'Coach or manager access is required to correct this goal.' using errcode = '42501';
  end if;
  if is_penalty_goal_value is null then
    raise exception 'Choose whether this goal was a penalty.';
  end if;

  select * into goal_before from public.match_day_events
  where id = goal_event_id_value and match_day_id = match_row.id
    and club_id = match_row.club_id and team_id = match_row.team_id
  for update;
  if goal_before.id is null or goal_before.event_type <> 'goal'
    or goal_before.event_status = 'voided' then
    raise exception 'This goal could not be corrected.';
  end if;

  next_penalty := is_penalty_goal_value and not coalesce(is_own_goal_value, false);
  perform pg_catalog.set_config('app.match_day_coach_correction_authorized', 'true', true);
  corrected_goal := public.correct_match_day_goal_v2(
    match_day_id_value, goal_event_id_value, null, team_side_value,
    scorer_name_value, scorer_shirt_number_value, assist_name_value,
    assist_shirt_number_value, minute_value, notes_value,
    correction_reason_value, is_own_goal_value, stoppage_minute_value
  );

  update public.match_day_events
  set is_penalty_goal = next_penalty,
      correction_metadata = coalesce(correction_metadata, '{}'::jsonb)
        || jsonb_build_object('previousPenaltyGoal', goal_before.is_penalty_goal,
                              'correctedPenaltyGoal', next_penalty)
  where id = goal_event_id_value and match_day_id = match_day_id_value
  returning * into goal_after;

  if goal_before.is_penalty_goal is distinct from next_penalty then
    actor_name := coalesce(nullif(auth.jwt() ->> 'name', ''),
      nullif(auth.jwt() ->> 'email', ''), 'Coach');
    insert into public.match_day_event_log (
      club_id, team_id, match_day_id, actor_user_id, actor_display_name,
      actor_role, event_type, event_label, previous_value, new_value, metadata
    ) values (
      match_row.club_id, match_row.team_id, match_row.id, auth.uid(), actor_name,
      coalesce(nullif(public.current_user_role(), ''), 'staff'),
      'scorer_updated', 'Goal penalty detail corrected',
      jsonb_build_object('eventId', goal_event_id_value,
        'isPenaltyGoal', goal_before.is_penalty_goal),
      jsonb_build_object('eventId', goal_event_id_value,
        'isPenaltyGoal', next_penalty),
      jsonb_build_object('source', 'coach_goal_penalty_correction_rpc',
        'correctionReason', trim(coalesce(correction_reason_value, '')))
    );
  end if;

  return corrected_goal || jsonb_build_object('isPenaltyGoal', goal_after.is_penalty_goal);
end;
$function$;

revoke all on function public.correct_coach_match_day_goal_v1(
  uuid,uuid,text,text,text,text,text,integer,text,text,boolean,boolean,integer
) from public, anon;
grant execute on function public.correct_coach_match_day_goal_v1(
  uuid,uuid,text,text,text,text,text,integer,text,text,boolean,boolean,integer
) to authenticated, service_role;

create or replace function public.void_coach_match_day_event_v1(
  match_day_id_value uuid,
  event_id_value uuid,
  reason_code_value text,
  note_value text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  match_row public.match_days%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in before undoing an event.' using errcode = '42501';
  end if;

  select * into match_row from public.match_days
  where id = match_day_id_value for update;
  if match_row.id is null or match_row.deleted_at is not null
    or match_row.concluded_at is not null then
    raise exception 'This fixture is closed or unavailable.';
  end if;
  if not public.can_manage_match_day(match_row.team_id)
    or (public.current_user_role() <> 'super_admin'
      and match_row.club_id <> public.current_user_club_id()) then
    raise exception 'Coach or manager access is required to undo this event.' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.match_day_coach_correction_authorized', 'true', true);
  return public.void_match_day_event(
    match_day_id_value, event_id_value, reason_code_value, note_value
  );
end;
$function$;

revoke all on function public.void_coach_match_day_event_v1(uuid,uuid,text,text)
  from public, anon;
grant execute on function public.void_coach_match_day_event_v1(uuid,uuid,text,text)
  to authenticated, service_role;
