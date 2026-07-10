-- Universal event voiding reuses the durable correction fields introduced by
-- 20260708064812_matchday_goal_correction_rpc.sql. No new audit columns are needed.
create or replace function public.void_match_day_event(
  match_day_id_value uuid,
  event_id_value uuid,
  reason_code_value text,
  note_value text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  event_row public.match_day_events%rowtype;
  timeline_event public.match_day_events%rowtype;
  actor_user_id uuid := auth.uid();
  actor_name text := '';
  actor_role text := '';
  normalized_reason_code text := lower(trim(coalesce(reason_code_value, '')));
  normalized_note text := trim(coalesce(note_value, ''));
  reason_label text := '';
  next_home_score integer := 0;
  next_away_score integer := 0;
  previous_event jsonb;
  next_event jsonb;
  updated_events jsonb;
  audit_event_type text;
  audit_event_label text;
begin
  if actor_user_id is null then
    raise exception 'Login is required before voiding an event.';
  end if;

  if char_length(normalized_note) > 240 then
    raise exception 'Keep the undo note to 240 characters or fewer.';
  end if;

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null then
    raise exception 'This match day could not be found.';
  end if;

  if not public.can_manage_match_day(match_row.team_id)
    or (
      public.current_user_role() <> 'super_admin'
      and match_row.club_id <> public.current_user_club_id()
    ) then
    raise exception 'Coach or manager access is required to void this event.';
  end if;

  select *
  into event_row
  from public.match_day_events
  where id = event_id_value
    and match_day_id = match_row.id
    and club_id = match_row.club_id
    and (
      match_row.team_id is null
      or team_id = match_row.team_id
    )
  for update;

  if event_row.id is null then
    raise exception 'This timeline event could not be found for this match.';
  end if;

  if event_row.event_type not in ('goal', 'yellow_card', 'red_card', 'substitution', 'water_break') then
    raise exception 'This timeline event cannot be voided.';
  end if;

  if event_row.event_status = 'voided' then
    raise exception 'This timeline event is already voided.';
  end if;

  if event_row.event_type = 'goal' then
    if normalized_reason_code not in (
      'goal_disallowed',
      'wrong_scorer',
      'wrong_assist',
      'wrong_team',
      'wrong_minute',
      'duplicate_goal',
      'added_by_mistake',
      'other'
    ) then
      raise exception 'Choose a valid goal undo reason.';
    end if;
  elsif event_row.event_type in ('yellow_card', 'red_card') then
    if normalized_reason_code not in (
      'wrong_player',
      'wrong_card_type',
      'wrong_minute',
      'referee_decision_changed',
      'duplicate_card',
      'added_by_mistake',
      'other'
    ) then
      raise exception 'Choose a valid card undo reason.';
    end if;
  elsif event_row.event_type = 'substitution' then
    if normalized_reason_code not in (
      'wrong_player_off',
      'wrong_player_on',
      'wrong_minute',
      'duplicate_substitution',
      'added_by_mistake',
      'other'
    ) then
      raise exception 'Choose a valid substitution undo reason.';
    end if;
  elsif event_row.event_type = 'water_break' then
    if normalized_reason_code not in (
      'wrong_minute',
      'duplicate_event',
      'break_not_taken',
      'added_by_mistake',
      'other'
    ) then
      raise exception 'Choose a valid water break undo reason.';
    end if;
  end if;

  if normalized_reason_code = 'other' and normalized_note = '' then
    raise exception 'Add a short note when Other is selected.';
  end if;

  reason_label := case normalized_reason_code
    when 'goal_disallowed' then 'Goal disallowed'
    when 'wrong_scorer' then 'Wrong scorer'
    when 'wrong_assist' then 'Wrong assist'
    when 'wrong_team' then 'Wrong team'
    when 'wrong_minute' then 'Wrong minute'
    when 'duplicate_goal' then 'Duplicate goal'
    when 'wrong_player' then 'Wrong player'
    when 'wrong_card_type' then 'Wrong card type'
    when 'referee_decision_changed' then 'Referee decision changed'
    when 'duplicate_card' then 'Duplicate card'
    when 'wrong_player_off' then 'Wrong player off'
    when 'wrong_player_on' then 'Wrong player on'
    when 'duplicate_substitution' then 'Duplicate substitution'
    when 'duplicate_event' then 'Duplicate event'
    when 'break_not_taken' then 'Break not taken'
    when 'added_by_mistake' then 'Added by mistake'
    when 'other' then 'Other'
    else ''
  end;

  if reason_label = '' then
    raise exception 'Choose a reason for undo before confirming.';
  end if;

  actor_name := coalesce(nullif(auth.jwt() ->> 'email', ''), '');
  actor_role := coalesce(nullif(public.current_user_role(), ''), 'staff');

  previous_event := jsonb_build_object(
    'id', event_row.id,
    'eventType', event_row.event_type,
    'teamSide', event_row.team_side,
    'minute', event_row.minute,
    'scorerName', event_row.scorer_name,
    'assistName', event_row.assist_name,
    'homeScore', event_row.home_score,
    'awayScore', event_row.away_score,
    'notes', event_row.notes,
    'eventStatus', event_row.event_status,
    'correctionReason', event_row.correction_reason,
    'createdByName', event_row.created_by_name,
    'createdAt', event_row.created_at
  );

  update public.match_day_events
  set
    event_status = 'voided',
    voided_at = timezone('utc', now()),
    voided_by = actor_user_id,
    voided_by_parent_link_id = null,
    voided_by_name = actor_name,
    correction_reason = reason_label,
    correction_metadata = jsonb_build_object(
      'action', 'voided',
      'actorRole', actor_role,
      'reasonCode', normalized_reason_code,
      'undoNote', normalized_note,
      'previousEvent', previous_event,
      'previousCorrectionMetadata', coalesce(event_row.correction_metadata, '{}'::jsonb)
    )
  where id = event_row.id;

  if event_row.event_type = 'goal' then
    next_home_score := 0;
    next_away_score := 0;

    for timeline_event in
      select *
      from public.match_day_events
      where match_day_id = match_row.id
      order by created_at asc, id asc
      for update
    loop
      if timeline_event.event_type = 'goal' and coalesce(timeline_event.event_status, 'active') <> 'voided' then
        if timeline_event.team_side = 'club' then
          if match_row.home_away = 'away' then
            next_away_score := next_away_score + 1;
          else
            next_home_score := next_home_score + 1;
          end if;
        else
          if match_row.home_away = 'away' then
            next_home_score := next_home_score + 1;
          else
            next_away_score := next_away_score + 1;
          end if;
        end if;
      end if;

      update public.match_day_events
      set
        home_score = greatest(next_home_score, 0),
        away_score = greatest(next_away_score, 0)
      where id = timeline_event.id;
    end loop;

    update public.match_days
    set
      home_score = greatest(next_home_score, 0),
      away_score = greatest(next_away_score, 0),
      updated_at = timezone('utc', now())
    where id = match_row.id;
  else
    next_home_score := greatest(coalesce(match_row.home_score, 0), 0);
    next_away_score := greatest(coalesce(match_row.away_score, 0), 0);

    update public.match_days
    set updated_at = timezone('utc', now())
    where id = match_row.id;
  end if;

  select jsonb_build_object(
    'id', event.id,
    'matchDayId', event.match_day_id,
    'eventType', event.event_type,
    'teamSide', event.team_side,
    'minute', event.minute,
    'scorerName', event.scorer_name,
    'scorerInitials', event.scorer_initials,
    'scorerShirtNumber', event.scorer_shirt_number,
    'assistName', event.assist_name,
    'assistInitials', event.assist_initials,
    'assistShirtNumber', event.assist_shirt_number,
    'homeScore', event.home_score,
    'awayScore', event.away_score,
    'notes', event.notes,
    'eventStatus', event.event_status,
    'correctedAt', event.corrected_at,
    'correctedByName', event.corrected_by_name,
    'voidedAt', event.voided_at,
    'voidedByName', event.voided_by_name,
    'correctionReason', event.correction_reason,
    'correctionMetadata', event.correction_metadata,
    'createdByName', event.created_by_name,
    'createdAt', event.created_at
  )
  into next_event
  from public.match_day_events event
  where event.id = event_row.id;

  audit_event_type := case
    when event_row.event_type = 'goal' then 'scorer_updated'
    else event_row.event_type
  end;
  audit_event_label := case event_row.event_type
    when 'goal' then 'Goal voided'
    when 'yellow_card' then 'Yellow card voided'
    when 'red_card' then 'Red card voided'
    when 'substitution' then 'Substitution voided'
    when 'water_break' then 'Water break voided'
    else 'Event voided'
  end;

  insert into public.match_day_event_log (
    club_id,
    team_id,
    match_day_id,
    actor_user_id,
    actor_display_name,
    actor_role,
    event_type,
    event_label,
    previous_value,
    new_value,
    metadata
  )
  values (
    match_row.club_id,
    match_row.team_id,
    match_row.id,
    actor_user_id,
    actor_name,
    actor_role,
    audit_event_type,
    audit_event_label,
    jsonb_build_object(
      'homeScore', match_row.home_score,
      'awayScore', match_row.away_score,
      'event', previous_event
    ),
    jsonb_build_object(
      'homeScore', next_home_score,
      'awayScore', next_away_score,
      'event', next_event
    ),
    jsonb_build_object(
      'matchEventId', event_row.id,
      'undoAction', 'voided',
      'reasonCode', normalized_reason_code,
      'source', 'match_day_event_void_rpc'
    )
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', event.id,
        'matchDayId', event.match_day_id,
        'eventType', event.event_type,
        'teamSide', event.team_side,
        'minute', event.minute,
        'scorerName', event.scorer_name,
        'scorerInitials', event.scorer_initials,
        'scorerShirtNumber', event.scorer_shirt_number,
        'assistName', event.assist_name,
        'assistInitials', event.assist_initials,
        'assistShirtNumber', event.assist_shirt_number,
        'homeScore', event.home_score,
        'awayScore', event.away_score,
        'notes', event.notes,
        'eventStatus', event.event_status,
        'correctedAt', event.corrected_at,
        'correctedByName', event.corrected_by_name,
        'voidedAt', event.voided_at,
        'voidedByName', event.voided_by_name,
        'correctionReason', event.correction_reason,
        'correctionMetadata', event.correction_metadata,
        'createdByName', event.created_by_name,
        'createdAt', event.created_at
      )
      order by event.created_at desc, event.id desc
    ),
    '[]'::jsonb
  )
  into updated_events
  from public.match_day_events event
  where event.match_day_id = match_row.id;

  return jsonb_build_object(
    'matchDayId', match_row.id,
    'homeScore', greatest(next_home_score, 0),
    'awayScore', greatest(next_away_score, 0),
    'status', match_row.status,
    'event', next_event,
    'events', updated_events
  );
end;
$$;

revoke all on function public.void_match_day_event(uuid, uuid, text, text) from public;
revoke execute on function public.void_match_day_event(uuid, uuid, text, text) from anon;
grant execute on function public.void_match_day_event(uuid, uuid, text, text) to authenticated;
grant execute on function public.void_match_day_event(uuid, uuid, text, text) to service_role;

-- Keep the previous staff goal endpoint compatible while closing parent portal
-- undo access. New clients use void_match_day_event with a validated reason code.
create or replace function public.void_match_day_goal(
  match_day_id_value uuid,
  goal_event_id_value uuid,
  parent_link_id_value uuid default null,
  reason_value text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if parent_link_id_value is not null then
    raise exception 'Parent views are read-only for event undo.';
  end if;

  return public.void_match_day_event(
    match_day_id_value,
    goal_event_id_value,
    'added_by_mistake',
    left(trim(coalesce(reason_value, '')), 240)
  );
end;
$$;

revoke all on function public.void_match_day_goal(uuid, uuid, uuid, text) from public;
revoke execute on function public.void_match_day_goal(uuid, uuid, uuid, text) from anon;
grant execute on function public.void_match_day_goal(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.void_match_day_goal(uuid, uuid, uuid, text) to service_role;

-- The V1 clock has no configurable half length. Keep second-half restarts at
-- the approved 45-minute floor while preserving any later elapsed value.
create or replace function public.enforce_match_day_second_half_floor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'second_half'
    and (old.status = 'half_time' or old.timer_status = 'half_time') then
    new.timer_elapsed_seconds := greatest(coalesce(new.timer_elapsed_seconds, 0), 2700);
  end if;

  return new;
end;
$$;

drop trigger if exists match_days_second_half_timer_floor on public.match_days;

create trigger match_days_second_half_timer_floor
before update of status, timer_status, timer_elapsed_seconds on public.match_days
for each row
execute function public.enforce_match_day_second_half_floor();

revoke all on function public.enforce_match_day_second_half_floor() from public;
revoke execute on function public.enforce_match_day_second_half_floor() from anon, authenticated;

-- Rollback drops the trigger and both functions. Existing voided event rows
-- remain part of the audit history and must not be silently reactivated.
