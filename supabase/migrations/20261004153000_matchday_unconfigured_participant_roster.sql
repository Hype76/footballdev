-- Local review only. No production execution authorised.
-- Empty means no decision rows, no prior squad decision log and no removal command.
-- Waiting/undecided rows are intentional configuration and disable fallback.
alter table public.match_day_events
  add column scorer_player_id uuid references public.players(id) on delete set null,
  add column assist_player_id uuid references public.players(id) on delete set null,
  add column participant_identity_version integer;

create or replace function private.match_day_event_participants(match_id uuid)
returns table(id uuid, player_name text, shirt_number text, team_id uuid)
language sql stable security definer set search_path = '' as $function$
  with fixture as (select m.* from public.match_days m where m.id=match_id and m.deleted_at is null),
  policy as (select f.*,
    not exists(select 1 from public.match_day_player_squad_decisions d where d.match_day_id=f.id)
    and not exists(select 1 from public.match_day_event_log l where l.match_day_id=f.id
      and (l.event_type in ('player_squad_decision_changed','player_selected','player_deselected')
        or l.event_type like '%player%remov%' or l.event_type like '%squad%'))
    and not exists(select 1 from public.event_player_removal_commands r where r.match_day_id=f.id)
    as unconfigured from fixture f)
  select p.id,p.player_name,coalesce(p.shirt_number,''),p.team_id
  from policy f join public.players p on p.club_id=f.club_id and p.team_id=f.team_id
  where p.archived_at is null and coalesce(p.status,'active')='active'
    and (p.section='Squad' or (p.section='Trial' and public.can_use_plan_feature(f.club_id,'trialPlayers')))
    and nullif(trim(p.player_name),'') is not null
    and (f.unconfigured or exists(select 1 from public.match_day_player_squad_decisions d
      where d.match_day_id=f.id and d.club_id=f.club_id and d.team_id=f.team_id
        and d.player_id=p.id and d.status='selected'))
  order by lower(p.player_name),p.id;
$function$;
revoke all on function private.match_day_event_participants(uuid) from public,anon,authenticated;

create or replace function public.get_match_day_event_participants(match_day_id_value uuid, parent_link_id_value uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare m public.match_days%rowtype;
begin
  select * into m from public.match_days where id=match_day_id_value;
  if auth.uid() is null or m.id is null or m.team_id is null or m.deleted_at is not null
    or m.concluded_at is not null or m.status in ('cancelled','postponed')
    or not coalesce(public.match_day_local_date_is_today(m.id),false)
    or not coalesce(public.can_use_plan_feature(m.club_id,'fixtures'),false) or not coalesce(public.can_use_plan_feature(m.club_id,'players'),false)
    then raise exception 'Current Match Day access is required.'; end if;
  if parent_link_id_value is not null then
    if not coalesce(public.current_user_is_match_day_scorer(m.id),false) or not exists(
      select 1 from public.match_day_role_assignments a join public.parent_player_links l on l.id=a.parent_link_id
      where a.match_day_id=m.id and a.role='scorer' and a.parent_link_id=parent_link_id_value
        and a.club_id=m.club_id and a.team_id=m.team_id and l.club_id=m.club_id and l.team_id=m.team_id
        and a.auth_user_id=auth.uid() and l.auth_user_id=a.auth_user_id and l.status='active')
    then raise exception 'Current selected Parent scorer access is required.'; end if;
  elsif not coalesce(public.can_manage_match_day(m.team_id),false) or public.current_user_club_id() is distinct from m.club_id then
    raise exception 'Current team staff access is required.';
  end if;
  return jsonb_build_object('matchId',m.id,'teamId',m.team_id,'players',
    (select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from private.match_day_event_participants(m.id) p),
    'eventIdentities',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,
      'scorer_player_id',e.scorer_player_id,'assist_player_id',e.assist_player_id,
      'participant_identity_version',e.participant_identity_version)),'[]'::jsonb)
      from public.match_day_events e where e.match_day_id=m.id and e.club_id=m.club_id and e.team_id=m.team_id));
end;
$function$;
revoke all on function public.get_match_day_event_participants(uuid,uuid) from public,anon;
grant execute on function public.get_match_day_event_participants(uuid,uuid) to authenticated;

create or replace function public.record_match_day_goal_v4(match_day_id_value uuid, parent_link_id_value uuid,
  team_side_value text, scorer_name_value text, scorer_shirt_number_value text, assist_name_value text,
  assist_shirt_number_value text, minute_value integer, notes_value text, is_penalty_goal_value boolean,
  request_id_value uuid, is_own_goal_value boolean, stoppage_minute_value integer,
  scorer_player_id_value uuid default null, assist_player_id_value uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare m public.match_days%rowtype; p record; result jsonb; prior public.match_day_events%rowtype;
begin
  -- Lock the fixture before eligibility so concurrent squad changes cannot bypass it.
  select * into m from public.match_days where id=match_day_id_value for update;
  perform public.get_match_day_event_participants(m.id,parent_link_id_value);
  select * into prior from public.match_day_events where match_day_id=m.id and request_id=request_id_value;
  if prior.id is not null then
    if prior.scorer_player_id is distinct from scorer_player_id_value or prior.assist_player_id is distinct from
      (case when is_own_goal_value then null else assist_player_id_value end) then raise exception 'This request has different player identities.'; end if;
    -- The journal APIs compare the complete saved payload. The old direct goal
    -- writer retains its existing behaviour of returning a matching request.
  end if;
  if scorer_player_id_value is not null then
    if (coalesce(is_own_goal_value,false) and team_side_value <> 'opponent') or
      (not coalesce(is_own_goal_value,false) and team_side_value <> 'club') then raise exception 'Opponent participants cannot link team players.'; end if;
    select * into p from private.match_day_event_participants(m.id) where id=scorer_player_id_value;
    if p.id is null then raise exception 'This scorer is no longer eligible for this fixture.'; end if;
    scorer_name_value:=p.player_name; scorer_shirt_number_value:=p.shirt_number;
  elsif ((is_own_goal_value and team_side_value='opponent') or (not is_own_goal_value and team_side_value='club'))
    and coalesce(scorer_name_value,'') not like 'Other: %' then raise exception 'Choose a linked scorer or explicitly choose Other.';
  end if;
  if is_own_goal_value then assist_player_id_value:=null; assist_name_value:=''; assist_shirt_number_value:=''; end if;
  if assist_player_id_value is not null then
    if team_side_value <> 'club' or is_own_goal_value then raise exception 'Opponent assists cannot link team players.'; end if;
    select * into p from private.match_day_event_participants(m.id) where id=assist_player_id_value;
    if p.id is null or p.id=scorer_player_id_value then raise exception 'Choose a different eligible assist player.'; end if;
    assist_name_value:=p.player_name; assist_shirt_number_value:=p.shirt_number;
  elsif team_side_value='club' and not is_own_goal_value and coalesce(assist_name_value,'')<>'' and assist_name_value not like 'Other: %' then
    raise exception 'Choose a linked assist or explicitly choose Other.';
  end if;
  result:=public.record_match_day_goal_v3(m.id,parent_link_id_value,team_side_value,scorer_name_value,
    scorer_shirt_number_value,assist_name_value,assist_shirt_number_value,minute_value,notes_value,
    is_penalty_goal_value,request_id_value,is_own_goal_value,stoppage_minute_value);
  update public.match_day_events set scorer_player_id=scorer_player_id_value,assist_player_id=assist_player_id_value,participant_identity_version=1
    where id=(result->>'id')::uuid returning to_jsonb(match_day_events.*) into result;
  return result;
end;
$function$;
revoke all on function public.record_match_day_goal_v4(uuid,uuid,text,text,text,text,text,integer,text,boolean,uuid,boolean,integer,uuid,uuid) from public,anon;
grant execute on function public.record_match_day_goal_v4(uuid,uuid,text,text,text,text,text,integer,text,boolean,uuid,boolean,integer,uuid,uuid) to authenticated;


CREATE OR REPLACE FUNCTION public.record_match_day_scorer_event_v2(match_day_id_value uuid, event_type_value text, team_side_value text, minute_value integer, player_name_value text, player_shirt_number_value text, player_on_name_value text, player_on_shirt_number_value text, notes_value text, request_id_value uuid, parent_link_id_value uuid DEFAULT NULL, stoppage_minute_value integer DEFAULT NULL, player_id_value uuid DEFAULT NULL, player_on_id_value uuid DEFAULT NULL)
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

  perform public.get_match_day_event_participants(match_row.id,parent_link_id_value);
  select * into event_row
  from public.match_day_events
  where match_day_id = match_day_id_value
    and request_id = request_id_value;

  if event_row.id is not null then
    if event_row.scorer_player_id is distinct from player_id_value or event_row.assist_player_id is distinct from player_on_id_value or event_row.event_type<>normalized_event_type or event_row.team_side<>normalized_team_side
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
      from private.match_day_event_participants(match_row.id) player
      where true
        and player.id=player_id_value
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
        from private.match_day_event_participants(match_row.id) player
      where true
          and player.id=player_on_id_value
        and lower(trim(player.player_name)) = lower(normalized_player_on_name)
          and (normalized_player_on_shirt = '' or trim(coalesce(player.shirt_number, '')) = normalized_player_on_shirt);

        if participant_on_match_count <> 1 or participant_player_on_id is null then
          raise exception 'Choose one selected Match squad Player On from this fixture Team.' using errcode = '22023';
        end if;

      end if;

      if participant_player_id = participant_player_on_id or (named_off and named_on and lower(normalized_player_name) = lower(normalized_player_on_name)) then
        raise exception 'Choose a different Player On for this substitution.' using errcode = '22023';
      end if;
    end if;
  end if;

  insert into public.match_day_events (
    match_day_id, club_id, team_id, event_type, team_side, minute,
    scorer_name, scorer_initials, scorer_shirt_number,
    assist_name, assist_initials, assist_shirt_number,
    home_score, away_score, notes, created_by, created_by_name, created_by_parent_link_id,
    match_phase, phase_order, request_id, stoppage_minute, scorer_player_id, assist_player_id
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
    request_id_value, nullif(stoppage_minute_value,0), participant_player_id, participant_player_on_id
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
revoke all on function public.record_match_day_scorer_event_v2(uuid,text,text,integer,text,text,text,text,text,uuid,uuid,integer,uuid,uuid) from public,anon;
grant execute on function public.record_match_day_scorer_event_v2(uuid,text,text,integer,text,text,text,text,text,uuid,uuid,integer,uuid,uuid) to authenticated;


create or replace function public.apply_parent_match_day_command_v2(
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
    event_result := public.record_match_day_goal_v4(m.id,parent_link_id_value,payload_value->>'teamSide',payload_value->>'scorerName',
      payload_value->>'scorerShirtNumber',payload_value->>'assistName',payload_value->>'assistShirtNumber',
      nullif(payload_value->>'minute','')::integer,payload_value->>'notes',coalesce((payload_value->>'isPenaltyGoal')::boolean,false),
      command_id_value,coalesce((payload_value->>'isOwnGoal')::boolean,false),nullif(payload_value->>'stoppageMinute','')::integer,
      nullif(payload_value->>'scorerPlayerId','')::uuid,nullif(payload_value->>'assistPlayerId','')::uuid);
    notification_type := 'goal';
  elsif kind_value = 'event' then
    if event_type not in ('yellow_card','red_card','substitution') or event_type is null then raise exception 'Unsupported saved event.'; end if;
    event_result := public.record_match_day_scorer_event_v2(m.id,event_type,payload_value->>'teamSide',
      (payload_value->>'minute')::integer,payload_value->>'playerName',payload_value->>'playerShirtNumber',
      payload_value->>'playerOnName',payload_value->>'playerOnShirtNumber',payload_value->>'notes',command_id_value,
      parent_link_id_value,nullif(payload_value->>'stoppageMinute','')::integer,
      nullif(payload_value->>'playerId','')::uuid,nullif(payload_value->>'playerOnId','')::uuid);
    notification_type := event_type;
  elsif kind_value = 'correct-goal' then
    target_event_id := (payload_value->>'eventId')::uuid;
    select coalesce(command.event_id,target_event_id) into target_event_id
      from private.parent_scorer_match_day_commands command
      where command.id = target_event_id and command.actor_user_id = actor and command.parent_link_id = parent_link_id_value
        and command.match_day_id = m.id and command.kind = 'goal';
    target_event_id := coalesce(target_event_id,(payload_value->>'eventId')::uuid);
    event_result := public.correct_match_day_goal_v3(m.id,target_event_id,parent_link_id_value,
      payload_value->'goal'->>'teamSide',payload_value->'goal'->>'scorerName',payload_value->'goal'->>'scorerShirtNumber',
      payload_value->'goal'->>'assistName',payload_value->'goal'->>'assistShirtNumber',
      nullif(payload_value->'goal'->>'minute','')::integer,payload_value->'goal'->>'notes',payload_value->>'reason',
      (payload_value->'goal'->>'isOwnGoal')::boolean,nullif(payload_value->'goal'->>'stoppageMinute','')::integer,
      nullif(payload_value->'goal'->>'scorerPlayerId','')::uuid,nullif(payload_value->'goal'->>'assistPlayerId','')::uuid);
    event_result := event_result->'event';
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
revoke all on function public.apply_parent_match_day_command_v2(uuid,uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid) from public,anon;
grant execute on function public.apply_parent_match_day_command_v2(uuid,uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid) to authenticated;


CREATE OR REPLACE FUNCTION public.get_end_season_stats(team_id_value uuid DEFAULT NULL::uuid)
 RETURNS TABLE(player_id uuid, player_name text, shirt_number text, team_id uuid, team_name text, goals integer, assists integer, motm_votes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with staff_scope as (
    select
      public.current_user_club_id() as club_id,
      public.current_user_role() as role,
      public.current_user_role_rank() as role_rank
  ),
  allowed_scope as (
    select
      scope.club_id,
      scope.role,
      scope.role_rank,
      (
        scope.role = 'admin'
        or (
          scope.role_rank >= 20
          and team_id_value is not null
          and exists (
            select 1
            from public.team_staff staff
            where staff.team_id = team_id_value
              and staff.user_id = auth.uid()
          )
        )
      ) as can_read
    from staff_scope scope
  ),
  scoped_players as (
    select
      player.id,
      player.player_name,
      coalesce(player.shirt_number, '') as shirt_number,
      player.team_id,
      coalesce(team.name, '') as team_name
    from public.players player
    join allowed_scope scope
      on scope.club_id = player.club_id
    left join public.teams team
      on team.id = player.team_id
    where auth.uid() is not null
      and scope.can_read is true
      and coalesce(player.status, 'active') <> 'archived'
      and (player.section='Squad' or (player.section='Trial' and public.can_use_plan_feature(player.club_id,'trialPlayers')))
      and player.archived_at is null
      and (
        team_id_value is null
        or player.team_id = team_id_value
      )
  ),
  year_matches as (
    select match_day.*
    from public.match_days match_day
    join allowed_scope scope
      on scope.club_id = match_day.club_id
    where auth.uid() is not null
      and scope.can_read is true
      and match_day.match_date >= date_trunc('year', timezone('Europe/London', now()))::date
      and match_day.match_date < (date_trunc('year', timezone('Europe/London', now())) + interval '1 year')::date
      and match_day.deleted_at is null
      and match_day.status not in ('cancelled', 'postponed')
      and (
        team_id_value is null
        or match_day.team_id = team_id_value
      )
  ),
  goal_counts as (
    select
      player.id as player_id,
      count(*)::integer as goals
    from scoped_players player
    join year_matches match_day
      on match_day.team_id is null or match_day.team_id = player.team_id
    join public.match_day_events event
      on event.match_day_id = match_day.id
      and event.event_type = 'goal'
      and event.team_side = 'club'
      and coalesce(event.event_status, 'active') in ('active','corrected')
      and event.voided_at is null
      and coalesce(event.is_own_goal, false) = false
      and (event.scorer_player_id=player.id or (event.participant_identity_version is null and event.scorer_player_id is null and lower(trim(regexp_replace(event.scorer_name, '^Other:\s*', '', 'i'))) = lower(trim(player.player_name))))
    group by player.id
  ),
  assist_counts as (
    select
      player.id as player_id,
      count(*)::integer as assists
    from scoped_players player
    join year_matches match_day
      on match_day.team_id is null or match_day.team_id = player.team_id
    join public.match_day_events event
      on event.match_day_id = match_day.id
      and event.event_type = 'goal'
      and event.team_side = 'club'
      and coalesce(event.event_status, 'active') in ('active','corrected')
      and event.voided_at is null
      and coalesce(event.is_own_goal, false) = false
      and (event.assist_player_id=player.id or (event.participant_identity_version is null and event.assist_player_id is null and lower(trim(regexp_replace(event.assist_name, '^Other:\s*', '', 'i'))) = lower(trim(player.player_name))))
    group by player.id
  ),
  motm_vote_totals as (
    select
      match_day.id as match_day_id,
      player.id as player_id,
      count(vote.id)::integer as vote_count
    from year_matches match_day
    join public.polls poll
      on poll.id = match_day.motm_poll_id
      and (
        poll.status = 'closed'
        or (
          poll.closes_at is not null
          and poll.closes_at <= timezone('utc', now())
        )
      )
    join public.poll_votes vote
      on vote.poll_id = match_day.motm_poll_id
    join scoped_players player
      on player.id::text = vote.option_id
      and (match_day.team_id is null or match_day.team_id = player.team_id)
    group by match_day.id, player.id
  ),
  motm_match_maximums as (
    select
      match_day_id,
      max(vote_count) as winning_vote_count
    from motm_vote_totals
    group by match_day_id
  ),
  motm_counts as (
    select
      totals.player_id,
      count(*)::integer as motm_votes
    from motm_vote_totals totals
    join motm_match_maximums maximums
      on maximums.match_day_id = totals.match_day_id
      and maximums.winning_vote_count = totals.vote_count
    group by totals.player_id
  )
  select
    player.id as player_id,
    player.player_name,
    player.shirt_number,
    player.team_id,
    player.team_name,
    coalesce(goal_counts.goals, 0) as goals,
    coalesce(assist_counts.assists, 0) as assists,
    coalesce(motm_counts.motm_votes, 0) as motm_votes
  from scoped_players player
  left join goal_counts
    on goal_counts.player_id = player.id
  left join assist_counts
    on assist_counts.player_id = player.id
  left join motm_counts
    on motm_counts.player_id = player.id
  order by player.team_name, player.player_name;
$function$;

CREATE OR REPLACE FUNCTION app_private.end_season_stats_range(team_id_value uuid, start_date_value date, end_date_value date)
 RETURNS TABLE(player_id uuid, player_name text, shirt_number text, team_id uuid, team_name text, goals integer, assists integer, motm_votes integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if start_date_value is null or end_date_value is null or not isfinite(start_date_value) or not isfinite(end_date_value) or start_date_value > end_date_value then
    raise exception 'Choose a valid start and end date.' using errcode = '22023';
  end if;
  return query
  with staff_scope as (
    select
      public.current_user_club_id() as club_id,
      public.current_user_role() as role,
      public.current_user_role_rank() as role_rank
  ),
  allowed_scope as (
    select
      scope.club_id,
      scope.role,
      scope.role_rank,
      (
        scope.role = 'admin'
        or (
          scope.role_rank >= 20
          and team_id_value is not null
          and exists (
            select 1
            from public.team_staff staff
            where staff.team_id = team_id_value
              and staff.user_id = auth.uid()
          )
        )
      ) as can_read
    from staff_scope scope
  ),
  scoped_players as (
    select
      player.id,
      player.player_name,
      coalesce(player.shirt_number, '') as shirt_number,
      player.team_id,
      coalesce(team.name, '') as team_name
    from public.players player
    join allowed_scope scope
      on scope.club_id = player.club_id
    left join public.teams team
      on team.id = player.team_id
    where auth.uid() is not null
      and scope.can_read is true
      and coalesce(player.status, 'active') <> 'archived'
      and (player.section='Squad' or (player.section='Trial' and public.can_use_plan_feature(player.club_id,'trialPlayers')))
      and player.archived_at is null
      and (
        team_id_value is null
        or player.team_id = team_id_value
      )
  ),
  year_matches as (
    select match_day.*
    from public.match_days match_day
    join allowed_scope scope
      on scope.club_id = match_day.club_id
    where auth.uid() is not null
      and scope.can_read is true
      and match_day.match_date >= start_date_value
      and match_day.match_date <= end_date_value
      and match_day.deleted_at is null
      and match_day.status not in ('cancelled', 'postponed')
      and (
        team_id_value is null
        or match_day.team_id = team_id_value
      )
  ),
  goal_counts as (
    select
      player.id as player_id,
      count(*)::integer as goals
    from scoped_players player
    join year_matches match_day
      on match_day.team_id is null or match_day.team_id = player.team_id
    join public.match_day_events event
      on event.match_day_id = match_day.id
      and event.event_type = 'goal'
      and event.team_side = 'club'
      and coalesce(event.event_status, 'active') in ('active','corrected')
      and event.voided_at is null
      and coalesce(event.is_own_goal, false) = false
      and (event.scorer_player_id=player.id or (event.participant_identity_version is null and event.scorer_player_id is null and lower(trim(regexp_replace(event.scorer_name, '^Other:\s*', '', 'i'))) = lower(trim(player.player_name))))
    group by player.id
  ),
  assist_counts as (
    select
      player.id as player_id,
      count(*)::integer as assists
    from scoped_players player
    join year_matches match_day
      on match_day.team_id is null or match_day.team_id = player.team_id
    join public.match_day_events event
      on event.match_day_id = match_day.id
      and event.event_type = 'goal'
      and event.team_side = 'club'
      and coalesce(event.event_status, 'active') in ('active','corrected')
      and event.voided_at is null
      and coalesce(event.is_own_goal, false) = false
      and (event.assist_player_id=player.id or (event.participant_identity_version is null and event.assist_player_id is null and lower(trim(regexp_replace(event.assist_name, '^Other:\s*', '', 'i'))) = lower(trim(player.player_name))))
    group by player.id
  ),
  motm_vote_totals as (
    select
      match_day.id as match_day_id,
      player.id as player_id,
      count(vote.id)::integer as vote_count
    from year_matches match_day
    join public.polls poll
      on poll.id = match_day.motm_poll_id
      and (
        poll.status = 'closed'
        or (
          poll.closes_at is not null
          and poll.closes_at <= timezone('utc', now())
        )
      )
    join public.poll_votes vote
      on vote.poll_id = match_day.motm_poll_id
    join scoped_players player
      on player.id::text = vote.option_id
      and (match_day.team_id is null or match_day.team_id = player.team_id)
    group by match_day.id, player.id
  ),
  motm_match_maximums as (
    select
      match_day_id,
      max(vote_count) as winning_vote_count
    from motm_vote_totals
    group by match_day_id
  ),
  motm_counts as (
    select
      totals.player_id,
      count(*)::integer as motm_votes
    from motm_vote_totals totals
    join motm_match_maximums maximums
      on maximums.match_day_id = totals.match_day_id
      and maximums.winning_vote_count = totals.vote_count
    group by totals.player_id
  )
  select
    player.id as player_id,
    player.player_name,
    player.shirt_number,
    player.team_id,
    player.team_name,
    coalesce(goal_counts.goals, 0) as goals,
    coalesce(assist_counts.assists, 0) as assists,
    coalesce(motm_counts.motm_votes, 0) as motm_votes
  from scoped_players player
  left join goal_counts
    on goal_counts.player_id = player.id
  left join assist_counts
    on assist_counts.player_id = player.id
  left join motm_counts
    on motm_counts.player_id = player.id
  order by player.team_name, player.player_name;
end;
$function$;


-- Legacy name corrections must not retain an identity for a different player.
create or replace function private.clear_changed_match_day_participant_ids()
returns trigger language plpgsql set search_path='' as $function$
begin
  if (new.scorer_name is distinct from old.scorer_name or new.scorer_shirt_number is distinct from old.scorer_shirt_number
      or new.team_side is distinct from old.team_side or new.is_own_goal is distinct from old.is_own_goal)
    and new.scorer_player_id is not distinct from old.scorer_player_id then
    new.scorer_player_id:=null;
    if old.scorer_player_id is not null then new.participant_identity_version:=1; end if;
  end if;
  if (new.assist_name is distinct from old.assist_name or new.assist_shirt_number is distinct from old.assist_shirt_number
      or new.team_side is distinct from old.team_side or new.is_own_goal is distinct from old.is_own_goal)
    and new.assist_player_id is not distinct from old.assist_player_id then
    new.assist_player_id:=null;
    if old.assist_player_id is not null then new.participant_identity_version:=1; end if;
  end if;
  return new;
end;
$function$;
create trigger match_day_clear_changed_participant_ids before update on public.match_day_events
for each row execute function private.clear_changed_match_day_participant_ids();

-- Coach offline/reconnect uses the same identity-aware writers.
create or replace function public.apply_coach_match_day_command_v2(
  command_id_value uuid, match_day_id_value uuid, kind_value text, payload_value jsonb,
  captured_at_value timestamptz, expected_updated_at_value timestamptz default null,
  previous_command_id_value uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  m public.match_days%rowtype;
  saved private.coach_match_day_commands%rowtype;
  previous private.coach_match_day_commands%rowtype;
  next_match public.match_days%rowtype;
  event_result jsonb;
  action text := payload_value->>'action';
  event_type text := payload_value->>'eventType';
  notification_type text := '';
  saved_event_id uuid;
  timer_result jsonb;
  result_payload jsonb;
  shift interval;
  shifted_start timestamptz;
  capture_time timestamptz := least(captured_at_value, now());
begin
  if actor is null then raise exception 'Login is required.' using errcode = '42501'; end if;
  select * into m from public.match_days where id = match_day_id_value for update;
  if m.id is null or m.deleted_at is not null or m.previous_hidden_at is not null then
    raise exception 'This fixture is unavailable. Your saved actions need review.';
  end if;
  if not coalesce(public.can_manage_match_day(m.team_id), false)
    or m.club_id is distinct from public.current_user_club_id()
    or public.current_user_role() in ('super_admin','admin','parent_portal','adult_player') then
    raise exception 'Current Coach or manager access to this team is required.' using errcode = '42501';
  end if;
  select * into saved from private.coach_match_day_commands where id = command_id_value;
  if found then
    if saved.actor_user_id <> actor or saved.match_day_id <> m.id or saved.kind <> kind_value
      or saved.payload is distinct from payload_value or saved.captured_at is distinct from captured_at_value then
      raise exception 'This saved action identifier is already in use.';
    end if;
    return saved.result;
  end if;
  if command_id_value is null or captured_at_value is null or captured_at_value > now() + interval '2 minutes'
    or captured_at_value < now() - interval '24 hours' or jsonb_typeof(payload_value) is distinct from 'object'
    or octet_length(payload_value::text) > 16000 then
    raise exception 'The saved action is invalid or over 24 hours old. Review it before continuing.';
  end if;
  if m.concluded_at is not null or m.status in ('cancelled','postponed') then
    raise exception 'This fixture has been closed. Your saved actions need review.';
  end if;
  if previous_command_id_value is not null then
    select * into previous from private.coach_match_day_commands where id = previous_command_id_value;
    if previous.id is null or previous.actor_user_id <> actor or previous.match_day_id <> m.id
      or previous.result_updated_at is distinct from m.updated_at or captured_at_value < previous.captured_at then
      raise exception 'The match changed on another device. Your saved actions are safe and need review.' using errcode = '40001';
    end if;
  elsif expected_updated_at_value is null or expected_updated_at_value is distinct from m.updated_at then
    raise exception 'The match changed on another device. Your saved actions are safe and need review.' using errcode = '40001';
  end if;
  if kind_value = 'event' then
    if event_type = 'goal' then
      event_result := public.record_match_day_goal_v4(m.id,null,payload_value->>'teamSide',payload_value->>'scorerName',payload_value->>'scorerShirtNumber',
        payload_value->>'assistName',payload_value->>'assistShirtNumber',(payload_value->>'minute')::integer,payload_value->>'notes',
        coalesce((payload_value->>'isPenaltyGoal')::boolean,false),command_id_value,coalesce((payload_value->>'isOwnGoal')::boolean,false),nullif(payload_value->>'stoppageMinute','')::integer,
        nullif(payload_value->>'scorerPlayerId','')::uuid,nullif(payload_value->>'assistPlayerId','')::uuid);
    elsif event_type in ('yellow_card','red_card','substitution') then
      event_result := public.record_match_day_scorer_event_v2(match_day_id_value=>m.id,parent_link_id_value=>null,event_type_value=>event_type,
        team_side_value=>payload_value->>'teamSide',minute_value=>(payload_value->>'minute')::integer,
        stoppage_minute_value=>nullif(payload_value->>'stoppageMinute','')::integer,player_name_value=>payload_value->>'playerName',
        player_shirt_number_value=>payload_value->>'playerShirtNumber',player_on_name_value=>payload_value->>'playerOnName',
        player_on_shirt_number_value=>payload_value->>'playerOnShirtNumber',notes_value=>payload_value->>'notes',request_id_value=>command_id_value,
        player_id_value=>nullif(payload_value->>'playerPlayerId','')::uuid,player_on_id_value=>nullif(payload_value->>'playerOnPlayerId','')::uuid);
    else raise exception 'Unsupported saved match event.'; end if;
    saved_event_id := (event_result->>'id')::uuid;
    notification_type := event_type;
  elsif kind_value = 'score' then
    event_result := public.record_match_day_score_correction_v2(m.id,null,(payload_value->>'homeScore')::integer,(payload_value->>'awayScore')::integer,
      'Score corrected in the Coach app',command_id_value);
    saved_event_id := (event_result->>'id')::uuid;
    notification_type := 'score_correction';
  elsif kind_value = 'timer' then
    if action not in ('start','pause','hydration','half_time','resume','full_time') or action is null then raise exception 'This clock action needs an online connection.'; end if;
    if coalesce(m.timer_started_at,m.phase_started_at) is not null and capture_time < coalesce(m.timer_started_at,m.phase_started_at) then raise exception 'This saved clock action predates the current clock. Review it before continuing.'; end if;
    shift := now() - capture_time;
    -- Shift only inside this locked transaction so canonical timer calculations use the recorded time.
    -- No intermediate state is visible to another reader or scorer.
    if m.timer_status = 'running' or (coalesce(m.timer_status,'not_started') = 'not_started' and m.status in ('live','second_half','extra_time','penalties')) then
      shifted_start := coalesce(m.timer_started_at,m.phase_started_at,capture_time) + shift;
      perform pg_catalog.set_config('app.match_day_lifecycle_authorized','true',true);
      update public.match_days set timer_started_at = shifted_start where id = m.id;
    end if;
    if action = 'start' then
      timer_result := public.start_match_day(m.id);
      notification_type := 'live';
    else
      timer_result := public.set_match_day_timer_state(m.id,action);
      notification_type := case when action in ('half_time','full_time') then action when action = 'resume' and m.status = 'half_time' then 'second_half' else '' end;
    end if;
    perform pg_catalog.set_config('app.match_day_lifecycle_authorized','true',true);
    update public.match_days set
      timer_started_at = case when timer_started_at = now() then capture_time when timer_started_at = shifted_start then m.timer_started_at else timer_started_at end,
      timer_paused_at = case when timer_paused_at = now() then capture_time else timer_paused_at end,
      phase_started_at = case when phase_started_at = now() then capture_time else phase_started_at end
    where id = m.id;
  else raise exception 'Unsupported saved Match Day action.'; end if;
  select * into next_match from public.match_days where id = m.id;
  result_payload := to_jsonb(next_match) || jsonb_build_object('savedEvent',event_result);
  insert into private.coach_match_day_commands(id,match_day_id,actor_user_id,kind,payload,captured_at,result,result_updated_at,notification_type,event_id)
    values(command_id_value,m.id,actor,kind_value,payload_value,captured_at_value,result_payload,next_match.updated_at,notification_type,saved_event_id);
  return result_payload;
end;
$$;
revoke all on function public.apply_coach_match_day_command_v2(uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid) from public,anon;
grant execute on function public.apply_coach_match_day_command_v2(uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid) to authenticated;

-- New corrections use explicit IDs or explicitly unlinked text. Never guess from
-- a name, including historical events. The original writer retains scoring/audit.
create or replace function public.correct_match_day_goal_v3(
  match_day_id_value uuid,goal_event_id_value uuid,parent_link_id_value uuid,
  team_side_value text,scorer_name_value text,scorer_shirt_number_value text,
  assist_name_value text,assist_shirt_number_value text,minute_value integer,
  notes_value text,correction_reason_value text,is_own_goal_value boolean,
  stoppage_minute_value integer,scorer_player_id_value uuid default null,assist_player_id_value uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare m public.match_days%rowtype; before_event public.match_day_events%rowtype;
  after_event public.match_day_events%rowtype; p record; result jsonb; current_match boolean;
begin
  select * into m from public.match_days where id=match_day_id_value for update;
  if auth.uid() is null or m.id is null or m.deleted_at is not null or m.concluded_at is not null
    or m.status in ('cancelled','postponed') then raise exception 'This fixture is closed or unavailable.'; end if;
  -- Coach corrections retain their existing lifecycle and super-admin authority.
  -- The current-day roster endpoint governs new capture, not historical correction.
  if parent_link_id_value is null then
    if not coalesce(public.can_manage_match_day(m.team_id),false)
      or (coalesce(public.current_user_role(),'') <> 'super_admin'
        and public.current_user_club_id() is distinct from m.club_id) then
      raise exception 'Coach or manager access is required to correct this goal.';
    end if;
  else
    perform public.get_match_day_event_participants(m.id,parent_link_id_value);
  end if;
  current_match:=coalesce(public.match_day_local_date_is_today(m.id),false);
  select * into before_event from public.match_day_events where id=goal_event_id_value
    and match_day_id=m.id and club_id=m.club_id and team_id=m.team_id for update;
  if before_event.id is null or before_event.event_type <> 'goal' or before_event.event_status='voided' then
    raise exception 'This goal could not be corrected.';
  end if;
  if team_side_value is null or team_side_value not in ('club','opponent') or is_own_goal_value is null
    or (((is_own_goal_value and team_side_value='opponent') or (not is_own_goal_value and team_side_value='club'))
      and nullif(trim(scorer_name_value),'') is null) then raise exception 'Choose the corrected scorer, side and own-goal status.'; end if;
  if scorer_player_id_value is not null then
    if (coalesce(is_own_goal_value,false) and team_side_value <> 'opponent') or
      (not coalesce(is_own_goal_value,false) and team_side_value <> 'club') then
      raise exception 'Opponent participants cannot link team players.';
    end if;
    select * into p from private.match_day_event_participants(m.id) participants where id=scorer_player_id_value
      and (current_match or id=before_event.scorer_player_id or exists(
        select 1 from public.match_day_player_squad_decisions d where d.match_day_id=m.id
          and d.club_id=m.club_id and d.team_id=m.team_id and d.player_id=participants.id and d.status='selected'));
    if p.id is null then raise exception 'This scorer is no longer eligible for this fixture.'; end if;
    if trim(coalesce(scorer_name_value,'')) is distinct from p.player_name
      or coalesce(scorer_shirt_number_value,'') is distinct from p.shirt_number then
      raise exception 'Scorer name and player identity differ. Select the player again or clear the link.';
    end if;
  end if;
  if coalesce(is_own_goal_value,false) then
    assist_player_id_value:=null; assist_name_value:=''; assist_shirt_number_value:='';
  end if;
  if assist_player_id_value is not null then
    if team_side_value <> 'club' or coalesce(is_own_goal_value,false) then
      raise exception 'Opponent assists cannot link team players.';
    end if;
    select * into p from private.match_day_event_participants(m.id) participants where id=assist_player_id_value
      and (current_match or id=before_event.assist_player_id or exists(
        select 1 from public.match_day_player_squad_decisions d where d.match_day_id=m.id
          and d.club_id=m.club_id and d.team_id=m.team_id and d.player_id=participants.id and d.status='selected'));
    if p.id is null or p.id=scorer_player_id_value then raise exception 'Choose a different eligible assist player.'; end if;
    if trim(coalesce(assist_name_value,'')) is distinct from p.player_name
      or coalesce(assist_shirt_number_value,'') is distinct from p.shirt_number then
      raise exception 'Assist name and player identity differ. Select the player again or clear the link.';
    end if;
  end if;
  result:=public.correct_match_day_goal_v2(m.id,before_event.id,parent_link_id_value,team_side_value,
    scorer_name_value,scorer_shirt_number_value,assist_name_value,assist_shirt_number_value,minute_value,
    notes_value,correction_reason_value,is_own_goal_value,stoppage_minute_value);
  update public.match_day_events set scorer_player_id=scorer_player_id_value,
    assist_player_id=assist_player_id_value,participant_identity_version=1,
    correction_metadata=coalesce(correction_metadata,'{}'::jsonb) || jsonb_build_object(
      'previousScorerPlayerId',before_event.scorer_player_id,'previousAssistPlayerId',before_event.assist_player_id,
      'correctedScorerPlayerId',scorer_player_id_value,'correctedAssistPlayerId',assist_player_id_value)
    where id=before_event.id returning * into after_event;
  insert into public.match_day_event_log(club_id,team_id,match_day_id,actor_user_id,actor_display_name,actor_role,
    event_type,event_label,previous_value,new_value,metadata)
  values(m.club_id,m.team_id,m.id,auth.uid(),after_event.corrected_by_name,
    case when parent_link_id_value is null then public.current_user_role() else 'scorer_parent' end,
    'scorer_updated','Goal participant links corrected',
    jsonb_build_object('scorerPlayerId',before_event.scorer_player_id,'assistPlayerId',before_event.assist_player_id),
    jsonb_build_object('scorerPlayerId',after_event.scorer_player_id,'assistPlayerId',after_event.assist_player_id),
    jsonb_build_object('goalEventId',after_event.id,'source','match_day_identity_correction_rpc'));
  return result || jsonb_build_object('event',to_jsonb(after_event),
    'scorerPlayerId',after_event.scorer_player_id,'assistPlayerId',after_event.assist_player_id);
end;
$function$;
revoke all on function public.correct_match_day_goal_v3(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,boolean,integer,uuid,uuid) from public,anon;
grant execute on function public.correct_match_day_goal_v3(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,boolean,integer,uuid,uuid) to authenticated;


create or replace function public.correct_coach_match_day_goal_v2(
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
  stoppage_minute_value integer,
  scorer_player_id_value uuid default null,
  assist_player_id_value uuid default null
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
  corrected_goal := public.correct_match_day_goal_v3(
    match_day_id_value, goal_event_id_value, null, team_side_value,
    scorer_name_value, scorer_shirt_number_value, assist_name_value,
    assist_shirt_number_value, minute_value, notes_value,
    correction_reason_value, is_own_goal_value, stoppage_minute_value,
    scorer_player_id_value, assist_player_id_value
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

revoke all on function public.correct_coach_match_day_goal_v2(
  uuid,uuid,text,text,text,text,text,integer,text,text,boolean,boolean,integer,uuid,uuid
) from public, anon;
grant execute on function public.correct_coach_match_day_goal_v2(
  uuid,uuid,text,text,text,text,text,integer,text,text,boolean,boolean,integer,uuid,uuid
) to authenticated, service_role;
