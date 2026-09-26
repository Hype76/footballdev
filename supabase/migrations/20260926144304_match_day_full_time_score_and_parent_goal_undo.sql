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

create or replace function public.apply_parent_match_day_command(
  command_id_value uuid, match_day_id_value uuid, parent_link_id_value uuid,
  kind_value text, payload_value jsonb, captured_at_value timestamptz,
  expected_updated_at_value timestamptz default null, previous_command_id_value uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  m public.match_days%rowtype;
  next_match public.match_days%rowtype;
  saved private.parent_scorer_match_day_commands%rowtype;
  previous private.parent_scorer_match_day_commands%rowtype;
  action text := payload_value->>'action';
  event_type text := payload_value->>'eventType';
  event_result jsonb;
  handover jsonb;
  result_payload jsonb;
  notification_type text := '';
  saved_event_id uuid;
  target_event_id uuid;
  capture_time timestamptz := least(captured_at_value, now());
  shifted_start timestamptz;
  shift interval;
begin
  if actor is null then raise exception 'Login is required.' using errcode = '42501'; end if;
  select * into m from public.match_days where id = match_day_id_value for update;
  if m.id is null or m.deleted_at is not null or m.previous_hidden_at is not null then
    raise exception 'This fixture is unavailable. Your saved actions need review.';
  end if;
  select * into saved from private.parent_scorer_match_day_commands where id = command_id_value;
  if found then
    if saved.actor_user_id <> actor or saved.parent_link_id <> parent_link_id_value or saved.match_day_id <> m.id
      or saved.kind <> kind_value or saved.payload is distinct from payload_value or saved.captured_at is distinct from captured_at_value then
      raise exception 'This saved action identifier is already in use.';
    end if;
    return saved.result;
  end if;
  if not public.current_user_has_match_day_scorer_assignment(m.id)
    or not exists (
      select 1 from public.match_day_role_assignments assignment
      where assignment.match_day_id = m.id and assignment.role = 'scorer'
        and assignment.parent_link_id = parent_link_id_value and assignment.auth_user_id = actor
    ) then
    raise exception 'Current selected Parent scorer access is required.' using errcode = '42501';
  end if;
  if command_id_value is null or captured_at_value is null or captured_at_value > now() + interval '2 minutes'
    or captured_at_value < now() - interval '24 hours' or jsonb_typeof(payload_value) is distinct from 'object'
    or octet_length(payload_value::text) > 16000 then
    raise exception 'The saved action is invalid or over 24 hours old. Review it before continuing.';
  end if;
  if m.concluded_at is not null or m.status in ('cancelled','postponed') then
    raise exception 'This fixture has closed. Your saved actions need review.';
  end if;
  if previous_command_id_value is not null then
    select * into previous from private.parent_scorer_match_day_commands where id = previous_command_id_value;
    if previous.id is null or previous.actor_user_id <> actor or previous.parent_link_id <> parent_link_id_value
      or previous.match_day_id <> m.id or previous.result_updated_at is distinct from m.updated_at
      or captured_at_value < previous.captured_at then
      raise exception 'The match changed on another device. Your saved actions need review.' using errcode = '40001';
    end if;
  elsif expected_updated_at_value is null or expected_updated_at_value is distinct from m.updated_at then
    raise exception 'The match changed on another device. Your saved actions need review.' using errcode = '40001';
  end if;
  if kind_value in ('start','timer','extended') then
    if kind_value = 'start' then action := 'start'; end if;
    if kind_value = 'timer' and action not in ('pause','hydration','half_time','resume','full_time')
      or kind_value = 'extended' and action not in ('normal_time_complete','start_extra_time','extra_time_half_time','start_extra_time_second_half','complete_extra_time','start_penalties')
      or action is null then
      raise exception 'Unsupported saved clock action.';
    end if;
    if coalesce(m.timer_started_at,m.phase_started_at) is not null and capture_time < coalesce(m.timer_started_at,m.phase_started_at) then
      raise exception 'This saved clock action predates the current clock. Review it before continuing.';
    end if;
    shift := now() - capture_time;
    if m.timer_status = 'running' or (coalesce(m.timer_status,'not_started') = 'not_started' and m.status in ('live','second_half','extra_time','penalties')) then
      shifted_start := coalesce(m.timer_started_at,m.phase_started_at,capture_time) + shift;
      perform pg_catalog.set_config('app.match_day_lifecycle_authorized','true',true);
      update public.match_days set timer_started_at = shifted_start where id = m.id;
    end if;
    if kind_value = 'start' then
      perform public.start_match_day(m.id);
      notification_type := 'live';
    elsif kind_value = 'timer' then
      perform public.set_match_day_timer_state(m.id,action);
      notification_type := case when action in ('half_time','full_time') then action when action = 'resume' and m.status = 'half_time' then 'second_half' else '' end;
    else
      perform public.set_match_day_extended_state(m.id,action);
      notification_type := case action when 'start_extra_time' then 'extra_time' when 'start_penalties' then 'penalties' when 'complete_extra_time' then 'full_time' else '' end;
    end if;
    perform pg_catalog.set_config('app.match_day_lifecycle_authorized','true',true);
    update public.match_days set
      timer_started_at = case when timer_started_at = now() then capture_time when timer_started_at = shifted_start then m.timer_started_at else timer_started_at end,
      timer_paused_at = case when timer_paused_at = now() then capture_time else timer_paused_at end,
      phase_started_at = case when phase_started_at = now() then capture_time else phase_started_at end
    where id = m.id;
  elsif kind_value = 'score' then
    event_result := public.record_match_day_score_correction_v2(m.id,parent_link_id_value,(payload_value->>'homeScore')::integer,
      (payload_value->>'awayScore')::integer,coalesce(nullif(payload_value->>'reason',''),'Score corrected by parent scorer'),command_id_value);
    notification_type := 'score_correction';
  elsif kind_value = 'goal' then
    event_result := public.record_match_day_goal_v3(m.id,parent_link_id_value,payload_value->>'teamSide',payload_value->>'scorerName',
      payload_value->>'scorerShirtNumber',payload_value->>'assistName',payload_value->>'assistShirtNumber',
      nullif(payload_value->>'minute','')::integer,payload_value->>'notes',coalesce((payload_value->>'isPenaltyGoal')::boolean,false),
      command_id_value,coalesce((payload_value->>'isOwnGoal')::boolean,false),nullif(payload_value->>'stoppageMinute','')::integer);
    notification_type := 'goal';
  elsif kind_value = 'event' then
    if event_type not in ('yellow_card','red_card','substitution') or event_type is null then raise exception 'Unsupported saved event.'; end if;
    event_result := public.record_match_day_scorer_event_v1(m.id,event_type,payload_value->>'teamSide',
      (payload_value->>'minute')::integer,payload_value->>'playerName',payload_value->>'playerShirtNumber',
      payload_value->>'playerOnName',payload_value->>'playerOnShirtNumber',payload_value->>'notes',command_id_value,
      parent_link_id_value,nullif(payload_value->>'stoppageMinute','')::integer);
    notification_type := event_type;
  elsif kind_value = 'correct-goal' then
    target_event_id := (payload_value->>'eventId')::uuid;
    select coalesce(command.event_id,target_event_id) into target_event_id
      from private.parent_scorer_match_day_commands command
      where command.id = target_event_id and command.actor_user_id = actor and command.parent_link_id = parent_link_id_value
        and command.match_day_id = m.id and command.kind = 'goal';
    target_event_id := coalesce(target_event_id,(payload_value->>'eventId')::uuid);
    event_result := public.correct_match_day_goal_v2(m.id,target_event_id,parent_link_id_value,
      payload_value->'goal'->>'teamSide',payload_value->'goal'->>'scorerName',payload_value->'goal'->>'scorerShirtNumber',
      payload_value->'goal'->>'assistName',payload_value->'goal'->>'assistShirtNumber',
      nullif(payload_value->'goal'->>'minute','')::integer,payload_value->'goal'->>'notes',payload_value->>'reason',
      (payload_value->'goal'->>'isOwnGoal')::boolean,nullif(payload_value->'goal'->>'stoppageMinute','')::integer);
  elsif kind_value = 'void-goal' then
    target_event_id := (payload_value->>'eventId')::uuid;
    select coalesce(command.event_id,target_event_id) into target_event_id
      from private.parent_scorer_match_day_commands command
      where command.id = target_event_id and command.actor_user_id = actor and command.parent_link_id = parent_link_id_value
        and command.match_day_id = m.id and command.kind = 'goal';
    target_event_id := coalesce(target_event_id,(payload_value->>'eventId')::uuid);
    perform public.void_parent_match_day_goal(m.id,target_event_id,parent_link_id_value,payload_value->>'reason');
  elsif kind_value = 'shootout' then
    event_result := public.record_match_day_shootout_kick(m.id,payload_value->>'teamSide',payload_value->>'outcome',
      payload_value->>'playerName',payload_value->>'notes');
  elsif kind_value = 'void-shootout' then
    target_event_id := (payload_value->>'kickId')::uuid;
    select coalesce(command.event_id,target_event_id) into target_event_id
      from private.parent_scorer_match_day_commands command
      where command.id = target_event_id and command.actor_user_id = actor and command.parent_link_id = parent_link_id_value
        and command.match_day_id = m.id and command.kind = 'shootout';
    target_event_id := coalesce(target_event_id,(payload_value->>'kickId')::uuid);
    perform public.void_match_day_shootout_kick(m.id,target_event_id,payload_value->>'reason');
  elsif kind_value = 'request-review' then
    handover := public.request_parent_match_day_review(m.id,parent_link_id_value);
    notification_type := 'full_time';
  else
    raise exception 'Unsupported saved Match Day action.';
  end if;
  if kind_value in ('goal','event','score','shootout') then saved_event_id := nullif(event_result->>'id','')::uuid; end if;
  select * into next_match from public.match_days where id = m.id;
  result_payload := jsonb_build_object(
    'match',to_jsonb(next_match),'savedEvent',event_result,
    'scorerReviewRequestedAt',handover->>'scorerReviewRequestedAt',
    'shootoutEvents',(select coalesce(jsonb_agg(to_jsonb(kick) order by kick.created_at),'[]'::jsonb)
      from public.match_day_shootout_kicks kick where kick.match_day_id = m.id)
  );
  insert into private.parent_scorer_match_day_commands(id,match_day_id,parent_link_id,actor_user_id,kind,payload,captured_at,
      result,result_updated_at,notification_type,event_id)
    values(command_id_value,m.id,parent_link_id_value,actor,kind_value,payload_value,captured_at_value,
      result_payload,next_match.updated_at,notification_type,saved_event_id);
  return result_payload;
end;
$$;
revoke all on function public.apply_parent_match_day_command(uuid,uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid) from public,anon;
grant execute on function public.apply_parent_match_day_command(uuid,uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid) to authenticated;
