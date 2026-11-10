-- Keep the old fixture endpoint safe for installed apps.
do $migration$
declare
  definition text := pg_get_functiondef('public.update_match_day_fixture_for_team(uuid,uuid,jsonb)'::regprocedure);
  marker text := '  if match_row.concluded_at is not null then';
begin
  if position(marker in definition) = 0 then
    raise exception 'Concluded fixture validation marker missing';
  end if;
  execute replace(definition, marker, $guard$  if match_row.concluded_at is not null then
    raise exception using errcode = '55000', message = 'Fixture details are locked after conclusion.';
  end if;

$guard$ || marker);
end;
$migration$;

comment on function public.update_match_day_fixture_for_team(uuid, uuid, jsonb) is
  'Updates authorised Team fixture details before kick-off. Concluded fixture details are locked.';

create function public.enforce_concluded_match_fixture_details()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.concluded_at is not null and row(
    new.title, new.opponent, new.match_date, new.kickoff_time, new.kickoff_time_tbc, new.arrival_time,
    new.home_away, new.fixture_type, new.venue_name, new.venue_address, new.location_id, new.pitch_type,
    new.shirt_choice, new.notification_team_name, new.notes, new.match_conclusion_rule, new.match_duration_minutes,
    new.extra_time_half_minutes, new.extra_time_period_count
  ) is distinct from row(
    old.title, old.opponent, old.match_date, old.kickoff_time, old.kickoff_time_tbc, old.arrival_time,
    old.home_away, old.fixture_type, old.venue_name, old.venue_address, old.location_id, old.pitch_type,
    old.shirt_choice, old.notification_team_name, old.notes, old.match_conclusion_rule, old.match_duration_minutes,
    old.extra_time_half_minutes, old.extra_time_period_count
  ) then
    raise exception using errcode = '55000', message = 'Fixture details are locked after conclusion.';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_concluded_match_fixture_details() from public, anon, authenticated, service_role;
create trigger match_days_concluded_fixture_details
before update of title, opponent, match_date, kickoff_time, kickoff_time_tbc, arrival_time,
  home_away, fixture_type, venue_name, venue_address, location_id, pitch_type, shirt_choice,
  notification_team_name, notes, match_conclusion_rule, match_duration_minutes, extra_time_half_minutes, extra_time_period_count
on public.match_days for each row execute function public.enforce_concluded_match_fixture_details();

-- The privileged editor locks and checks a single match before granting its
-- writes. Normal live, guest and parent scoring paths retain their own guards.
do $migration$
declare
  writer text := pg_get_functiondef('public.enforce_match_day_event_write()'::regprocedure);
  context_writer text := pg_get_functiondef('public.set_match_day_event_extended_context()'::regprocedure);
  score_writer text := pg_get_functiondef('public.enforce_match_day_gameplay_write()'::regprocedure);
  writer_marker text := '  full_time_correction_allowed :=';
  context_marker text := '  resolved_phase := match_row.current_match_phase;';
  score_marker text := '  if old.concluded_at is not null and (gameplay_changed or new.status is distinct from old.status) then';
begin
  if position(writer_marker in writer) = 0 or position(context_marker in context_writer) = 0 or position(score_marker in score_writer) = 0 then
    raise exception 'Concluded timeline trigger markers missing';
  end if;
  execute replace(writer, writer_marker, $guard$  if match_row.concluded_at is not null and tg_op in ('INSERT', 'UPDATE')
    and current_user not in ('anon', 'authenticated', 'service_role')
    and current_setting('app.concluded_timeline_match', true) = match_row.id::text then
    return new;
  end if;

$guard$ || writer_marker);
  execute replace(context_writer, context_marker, $guard$  if match_row.concluded_at is not null
    and current_setting('app.concluded_timeline_match', true) = match_row.id::text then
    new.phase_order := public.match_day_phase_order(new.match_phase);
    return new;
  end if;

$guard$ || context_marker);
  execute replace(score_writer, score_marker, $guard$  if old.concluded_at is not null
    and current_user not in ('anon', 'authenticated', 'service_role')
    and current_setting('app.concluded_timeline_match', true) = old.id::text
    and to_jsonb(new) - array['home_score', 'away_score', 'normal_time_home_score', 'normal_time_away_score', 'extra_time_home_score', 'extra_time_away_score', 'updated_at']
      = to_jsonb(old) - array['home_score', 'away_score', 'normal_time_home_score', 'normal_time_away_score', 'extra_time_home_score', 'extra_time_away_score', 'updated_at'] then
    return new;
  end if;

$guard$ || score_marker);
end;
$migration$;

create function public.save_coach_concluded_match_event(
  match_id uuid, expected_updated_at timestamptz, change_id uuid, event_id uuid,
  operation text, details jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := (select auth.uid());
  actor_name text := coalesce(nullif(auth.jwt()->>'name', ''), 'Coach');
  fixture public.match_days%rowtype;
  before_event public.match_day_events%rowtype;
  saved_event public.match_day_events%rowtype;
  prior_change public.match_day_event_log%rowtype;
  participant public.players%rowtype;
  event_kind text := details->>'eventType';
  side text := details->>'teamSide';
  minute_value integer := nullif(details->>'minute','')::integer;
  added_value integer := nullif(details->>'stoppageMinute','')::integer;
  reason text := trim(coalesce(details->>'reason', ''));
  notes_value text := trim(coalesce(details->>'notes', ''));
  own_goal boolean := coalesce((details->>'isOwnGoal')::boolean, false);
  penalty boolean := coalesce((details->>'isPenaltyGoal')::boolean, false) and not own_goal;
  first_id uuid := nullif(details->>'scorerPlayerId', '')::uuid;
  second_id uuid := nullif(details->>'assistPlayerId', '')::uuid;
  first_name text := trim(coalesce(details->>'scorerName', ''));
  second_name text := trim(coalesce(details->>'assistName', ''));
  first_shirt text := trim(coalesce(details->>'scorerShirtNumber', ''));
  second_shirt text := trim(coalesce(details->>'assistShirtNumber', ''));
  phase text;
  home_goal_side text;
  old_home_goals integer;
  old_away_goals integer;
  next_home integer;
  next_away integer;
  normal_home_delta integer := 0;
  normal_away_delta integer := 0;
  duration integer;
begin
  if actor is null or change_id is null or operation is null or operation not in ('save', 'void', 'score')
    or jsonb_typeof(details) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Choose a valid match correction.';
  end if;
  select * into fixture from public.match_days where id = match_id for update;
  if fixture.id is null or fixture.deleted_at is not null or fixture.previous_hidden_at is not null
    or fixture.status <> 'full_time' or fixture.concluded_at is null
    or not coalesce(public.can_manage_match_day(fixture.team_id), false)
    or public.current_user_club_id() is distinct from fixture.club_id
    or not coalesce(app_private.actor_can_manage_team_resource(actor, fixture.club_id, fixture.team_id, 20), false)
    or not exists (select 1 from public.team_staff s where s.team_id = fixture.team_id and s.user_id = actor and s.role_rank >= 30) then
    raise exception using errcode = '42501', message = 'An assigned Coach or Manager is required to correct this concluded match.';
  end if;
  select * into prior_change from public.match_day_event_log l
  where l.match_day_id = match_id and l.actor_user_id = actor and l.metadata->>'correctionId' = change_id::text;
  if prior_change.id is not null then
    if prior_change.metadata->'request' is distinct from jsonb_build_object('operation', operation, 'eventId', event_id, 'details', details) then
      raise exception using errcode = '22023', message = 'This request already saved a different correction.';
    end if;
    return prior_change.new_value;
  end if;
  if fixture.updated_at is distinct from expected_updated_at then
    raise exception using errcode = '40001', message = 'This match changed. Refresh it before saving.';
  end if;
  if reason = '' or length(reason) > 500 or length(notes_value) > 500 then
    raise exception using errcode = '22023', message = 'Enter a correction reason and keep notes within 500 characters.';
  end if;

  if event_id is not null then
    select * into before_event from public.match_day_events e
    where e.id = event_id and e.match_day_id = match_id and e.club_id = fixture.club_id and e.team_id = fixture.team_id
    for update;
    if before_event.id is null or before_event.event_status = 'voided'
      or before_event.event_type not in ('goal', 'yellow_card', 'red_card', 'substitution', 'water_break', 'note') then
      raise exception using errcode = '22023', message = 'This event cannot be corrected.';
    end if;
  elsif operation = 'void' then
    raise exception using errcode = '22023', message = 'Select an event to remove from the timeline.';
  end if;

  duration := coalesce(fixture.match_duration_minutes, 90);
  home_goal_side := case when fixture.home_away = 'away' then 'opponent' else 'club' end;
  select count(*) filter (where e.team_side = home_goal_side), count(*) filter (where e.team_side <> home_goal_side)
  into old_home_goals, old_away_goals
  from public.match_day_events e
  where e.match_day_id = match_id and e.event_type = 'goal' and e.voided_at is null and e.event_status <> 'voided';
  next_home := coalesce(fixture.home_score, 0);
  next_away := coalesce(fixture.away_score, 0);

  perform set_config('app.concluded_timeline_match', fixture.id::text, true);
  if operation = 'score' then
    next_home := (details->>'homeScore')::integer;
    next_away := (details->>'awayScore')::integer;
    if event_id is not null or next_home is null or next_away is null or next_home not between 0 and 99 or next_away not between 0 and 99 then
      raise exception using errcode = '22023', message = 'Enter a whole home and away score from 0 to 99.';
    end if;
    insert into public.match_day_events (match_day_id, club_id, team_id, event_type, team_side, match_phase,
      home_score, away_score, notes, created_by, created_by_name, request_id)
    values (match_id, fixture.club_id, fixture.team_id, 'score_correction', 'club', 'full_time',
      next_home, next_away, reason, actor, actor_name, change_id)
    returning * into saved_event;
  elsif operation = 'void' then
    update public.match_day_events set event_status = 'voided', voided_at = now(), voided_by = actor,
      correction_reason = reason, correction_metadata = correction_metadata || jsonb_build_object('correctionId', change_id)
    where id = before_event.id returning * into saved_event;
  else
    if event_kind is null or event_kind not in ('goal', 'yellow_card', 'red_card', 'substitution', 'water_break', 'note')
      or side is null or side not in ('club', 'opponent') or minute_value is null or minute_value not between 0 and 999
      or coalesce(added_value, 0) not between 0 and 30 then
      raise exception using errcode = '22023', message = 'Choose an event, a team and a valid match minute.';
    end if;
    if event_kind <> 'goal' then
      own_goal := false;
      penalty := false;
    end if;
    if (event_kind = 'goal' and ((side = 'opponent') <> own_goal)) or (event_kind <> 'goal' and side = 'opponent') then
      first_id := null;
    end if;
    if (event_kind <> 'goal' and event_kind <> 'substitution') or own_goal or side <> 'club' then
      second_id := null;
      if event_kind not in ('goal', 'substitution') or own_goal then
        second_name := '';
        second_shirt := '';
      end if;
    end if;
    if own_goal then
      second_name := '';
      second_shirt := '';
    end if;
    if event_kind in ('water_break', 'note') then
      first_id := null;
      first_name := '';
      first_shirt := '';
    end if;
    if first_id is not null then
      select * into participant from public.players p where p.id = first_id and p.club_id = fixture.club_id
        and (p.team_id = fixture.team_id or exists (select 1 from public.match_day_player_squad_decisions d
          where d.match_day_id = match_id and d.player_id = p.id and d.club_id = fixture.club_id and d.team_id = fixture.team_id and d.status = 'selected'));
      if participant.id is null then raise exception using errcode = '22023', message = 'Choose a player from this match team.'; end if;
      first_name := participant.player_name;
      first_shirt := coalesce(participant.shirt_number, '');
    end if;
    if second_id is not null then
      select * into participant from public.players p where p.id = second_id and p.club_id = fixture.club_id
        and (p.team_id = fixture.team_id or exists (select 1 from public.match_day_player_squad_decisions d
          where d.match_day_id = match_id and d.player_id = p.id and d.club_id = fixture.club_id and d.team_id = fixture.team_id and d.status = 'selected'));
      if participant.id is null or first_id = second_id then
        raise exception using errcode = '22023', message = 'Choose a different player from this match team.';
      end if;
      second_name := participant.player_name;
      second_shirt := coalesce(participant.shirt_number, '');
    end if;
    if length(first_name) > 120 or length(second_name) > 120 or length(first_shirt) > 8 or length(second_shirt) > 8
      or (event_kind = 'substitution' and side = 'club' and (first_name = '' or second_name = '')) then
      raise exception using errcode = '22023', message = 'Check the participant names and shirt numbers.';
    end if;
    phase := case
      when minute_value <= duration / 2 then 'first_half'
      when minute_value <= duration then 'second_half'
      when minute_value <= duration + coalesce(fixture.extra_time_half_minutes, 15) then 'extra_time_first_half'
      else 'extra_time_second_half'
    end;
    if event_id is null then
      insert into public.match_day_events (match_day_id, club_id, team_id, event_type, team_side, match_phase, minute,
        stoppage_minute, scorer_name, scorer_initials, scorer_shirt_number, scorer_player_id, assist_name, assist_initials,
        assist_shirt_number, assist_player_id, participant_identity_version, is_own_goal, is_penalty_goal, home_score, away_score,
        notes, created_by, created_by_name, request_id, correction_reason)
      values (match_id, fixture.club_id, fixture.team_id, event_kind, side, phase, minute_value,
        nullif(added_value, 0), first_name, public.get_initials_from_full_name(first_name), first_shirt, first_id,
        second_name, public.get_initials_from_full_name(second_name), second_shirt, second_id, 1, own_goal, penalty,
        next_home, next_away, notes_value, actor, actor_name, change_id, reason)
      returning * into saved_event;
    else
      update public.match_day_events set event_type = event_kind, team_side = side, match_phase = phase,
        phase_order = public.match_day_phase_order(phase), minute = minute_value, stoppage_minute = nullif(added_value, 0),
        scorer_name = first_name, scorer_initials = public.get_initials_from_full_name(first_name),
        scorer_shirt_number = first_shirt, scorer_player_id = first_id, assist_name = second_name,
        assist_initials = public.get_initials_from_full_name(second_name), assist_shirt_number = second_shirt,
        assist_player_id = second_id, participant_identity_version = 1, is_own_goal = own_goal, is_penalty_goal = penalty,
        notes = notes_value, event_status = 'corrected', correction_reason = reason, corrected_at = now(), corrected_by = actor,
        corrected_by_name = actor_name, correction_metadata = correction_metadata || jsonb_build_object('correctionId', change_id)
      where id = before_event.id returning * into saved_event;
    end if;
  end if;

  if operation <> 'score' then
    normal_home_delta :=
      (case when saved_event.event_status <> 'voided' and saved_event.event_type = 'goal' and saved_event.team_side = home_goal_side
        and saved_event.match_phase not like 'extra_time%' then 1 else 0 end)
      - (case when before_event.event_type = 'goal' and before_event.team_side = home_goal_side
        and before_event.match_phase not like 'extra_time%' then 1 else 0 end);
    normal_away_delta :=
      (case when saved_event.event_status <> 'voided' and saved_event.event_type = 'goal' and saved_event.team_side <> home_goal_side
        and saved_event.match_phase not like 'extra_time%' then 1 else 0 end)
      - (case when before_event.event_type = 'goal' and before_event.team_side <> home_goal_side
        and before_event.match_phase not like 'extra_time%' then 1 else 0 end);
    select greatest(0, next_home - old_home_goals + count(*) filter (where e.team_side = home_goal_side)),
      greatest(0, next_away - old_away_goals + count(*) filter (where e.team_side <> home_goal_side))
    into next_home, next_away from public.match_day_events e
    where e.match_day_id = match_id and e.event_type = 'goal' and e.voided_at is null and e.event_status <> 'voided';
    -- The prior result can include goals entered as a score correction. Keep
    -- that difference while rebuilding cumulative scores for ordinary events.
    with scores as (
      select e.id,
        count(*) filter (where e.event_type = 'goal' and e.team_side = home_goal_side) over timeline as home_goals,
        count(*) filter (where e.event_type = 'goal' and e.team_side <> home_goal_side) over timeline as away_goals,
        count(*) filter (where e.event_type = 'goal' and e.team_side = home_goal_side) over () as total_home,
        count(*) filter (where e.event_type = 'goal' and e.team_side <> home_goal_side) over () as total_away
      from public.match_day_events e
      where e.match_day_id = match_id and e.voided_at is null and e.event_status <> 'voided'
      window timeline as (order by e.phase_order, e.minute nulls last, e.stoppage_minute nulls first, e.event_sequence rows unbounded preceding)
    )
    update public.match_day_events e set
      home_score = greatest(0, next_home - scores.total_home + scores.home_goals),
      away_score = greatest(0, next_away - scores.total_away + scores.away_goals)
    from scores where e.id = scores.id and e.event_type <> 'score_correction';
  end if;

  update public.match_days set home_score = next_home, away_score = next_away, updated_at = clock_timestamp(),
    normal_time_home_score = case
      when fixture.normal_time_home_score is null then null
      when operation = 'score' and fixture.extra_time_home_score is null then next_home
      else greatest(0, fixture.normal_time_home_score + normal_home_delta) end,
    normal_time_away_score = case
      when fixture.normal_time_away_score is null then null
      when operation = 'score' and fixture.extra_time_away_score is null then next_away
      else greatest(0, fixture.normal_time_away_score + normal_away_delta) end,
    extra_time_home_score = case when fixture.extra_time_home_score is not null then next_home end,
    extra_time_away_score = case when fixture.extra_time_away_score is not null then next_away end
  where id = fixture.id;
  perform set_config('app.concluded_timeline_match', '', true);
  select * into saved_event from public.match_day_events where id = saved_event.id;
  insert into public.match_day_event_log (club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata)
  values (fixture.club_id, fixture.team_id, fixture.id, actor, actor_name, public.current_user_role(),
    'scorer_updated', 'Concluded match timeline corrected', to_jsonb(before_event), to_jsonb(saved_event),
    jsonb_build_object('correctionId', change_id, 'reason', reason, 'previousHomeScore', fixture.home_score,
      'previousAwayScore', fixture.away_score, 'homeScore', next_home, 'awayScore', next_away,
      'request', jsonb_build_object('operation', operation, 'eventId', event_id, 'details', details)));
  return to_jsonb(saved_event);
end;
$function$;

revoke all on function public.save_coach_concluded_match_event(uuid, timestamptz, uuid, uuid, text, jsonb)
  from public, anon, service_role;
grant execute on function public.save_coach_concluded_match_event(uuid, timestamptz, uuid, uuid, text, jsonb)
  to authenticated;

-- A self-managed Player can answer attendance, but volunteer offers belong
-- to Parent or guardian contacts. Keep old apps and email links aligned.
do $migration$
declare
  reader text := pg_get_functiondef('public.get_match_day_availability_response_v2(text)'::regprocedure);
  token_writer text := pg_get_functiondef('public.submit_match_day_availability_response(text,text,text,text,text,boolean,boolean,integer)'::regprocedure);
  portal_reader text := pg_get_functiondef('public.get_parent_portal_invitation_state(uuid)'::regprocedure);
  portal_writer text := pg_get_functiondef('public.respond_parent_portal_match_day_invitation(uuid,uuid,text,text,text)'::regprocedure);
  role_field text;
  role_marker text;
  token_marker text := '  if request_row.id is null then return; end if;';
  portal_reader_marker text := '    cross join target_link';
  portal_writer_marker text := '  elsif normalized_kind = ''role'' then';
begin
  foreach role_field in array array['scorer', 'linesman', 'referee'] loop
    role_marker := format('coalesce(fixture.request_%s, false)', role_field);
    if position(role_marker in reader) = 0 then raise exception 'Availability read marker missing for %', role_field; end if;
    reader := replace(reader, role_marker, format('(request_row.recipient_type = ''parent'' and %s)', role_marker));
  end loop;
  if position(token_marker in token_writer) = 0 or position(portal_reader_marker in portal_reader) = 0
    or position(portal_writer_marker in portal_writer) = 0 then
    raise exception 'Volunteer eligibility marker missing';
  end if;
  execute reader;
  execute replace(token_writer, token_marker, token_marker || $guard$

  if request_row.recipient_type is distinct from 'parent' then
    scorer_response := null;
    linesman_response := null;
    referee_response := null;
  end if;$guard$);
  -- Parent and adult self-links share this read model. Filter only role offers.
  execute replace(portal_reader, portal_reader_marker, $guard$    join target_link on (
      legacy.invitation_type <> 'match_role' or (target_link.link_type = 'parent' and exists (
        select 1 from public.match_day_availability_requests role_request
        where role_request.id = legacy.source_record_id and role_request.recipient_type = 'parent'
      ))
    )$guard$);
  execute replace(portal_writer, portal_writer_marker, portal_writer_marker || $guard$
    if link_row.link_type is distinct from 'parent' or request_row.recipient_type is distinct from 'parent' then
      raise exception using errcode = '42501', message = 'Volunteer offers require a parent contact.';
    end if;$guard$);
end;
$migration$;
