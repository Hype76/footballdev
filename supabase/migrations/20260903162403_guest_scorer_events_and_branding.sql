-- Guest and selected Parent scorers use the same scoped event authority as goals.
CREATE OR REPLACE FUNCTION public.record_match_day_scorer_event_v1(match_day_id_value uuid, event_type_value text, team_side_value text, minute_value integer, player_name_value text, player_shirt_number_value text, player_on_name_value text, player_on_shirt_number_value text, notes_value text, request_id_value uuid, parent_link_id_value uuid DEFAULT NULL, stoppage_minute_value integer DEFAULT NULL)
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

  select * into event_row
  from public.match_day_events
  where match_day_id = match_day_id_value
    and request_id = request_id_value;

  if event_row.id is not null then
    if event_row.event_type<>normalized_event_type or event_row.team_side<>normalized_team_side
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
      and player.archived_at is null and coalesce(player.status, 'active') <> 'archived'
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
            and player.archived_at is null and coalesce(player.status, 'active') <> 'archived'
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
    home_score, away_score, notes, created_by, created_by_name, created_by_parent_link_id,
    match_phase, phase_order, request_id, stoppage_minute
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
    request_id_value, nullif(stoppage_minute_value,0)
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
revoke all on function public.record_match_day_scorer_event_v1(uuid,text,text,integer,text,text,text,text,text,uuid,uuid,integer) from public, anon;
grant execute on function public.record_match_day_scorer_event_v1(uuid,text,text,integer,text,text,text,text,text,uuid,uuid,integer) to authenticated, service_role;

create or replace function private.guest_match_snapshot(match_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',m.id,'clubName',c.name,'clubLogoUrl',c.logo_url,'themeAccent',c.theme_accent,'teamName',t.name,'opponent',m.opponent,'homeAway',m.home_away,
    'homeScore',m.home_score,'awayScore',m.away_score,'status',m.status,
    'matchDate',m.match_date,'isToday',public.match_day_local_date_is_today(m.id),
    'matchDurationMinutes',m.match_duration_minutes,'clockMode',m.match_clock_mode,
    'currentMatchPhase',m.current_match_phase,'conclusionRule',m.match_conclusion_rule,'matchConclusionRule',m.match_conclusion_rule,
    'extraTimeHalfMinutes',m.extra_time_half_minutes,'extraTimePeriodCount',m.extra_time_period_count,
    'timerStatus',m.timer_status,'timerStartedAt',m.timer_started_at,'phaseStartedAt',m.phase_started_at,
    'timerElapsedSeconds',m.timer_elapsed_seconds,'homeShootoutScore',m.home_shootout_score,'awayShootoutScore',m.away_shootout_score,
    'players',coalesce((select jsonb_agg(jsonb_build_object('name',p.player_name,'shirtNumber',p.shirt_number) order by p.player_name)
      from public.match_day_player_squad_decisions d join public.players p on p.id=d.player_id
      where d.match_day_id=m.id and d.club_id=m.club_id and d.team_id=m.team_id and d.status='selected'
        and p.club_id=m.club_id and p.archived_at is null and coalesce(p.status,'active')<>'archived'), '[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'eventType',e.event_type,'matchPhase',e.match_phase,'teamSide',e.team_side,'minute',e.minute,
      'stoppageMinute',e.stoppage_minute,'scorerName',e.scorer_name,'scorerShirtNumber',e.scorer_shirt_number,
      'assistName',e.assist_name,'assistShirtNumber',e.assist_shirt_number,'isOwnGoal',e.is_own_goal,
      'isPenaltyGoal',e.is_penalty_goal,'notes',e.notes,'createdAt',e.created_at) order by e.created_at desc,e.event_sequence desc)
      from public.match_day_events e where e.match_day_id=m.id and e.event_type in ('goal','yellow_card','red_card','substitution','water_break') and e.event_status<>'voided'), '[]'::jsonb)
  ) from public.match_days m join public.teams t on t.id=m.team_id join public.clubs c on c.id=m.club_id where m.id=match_id;
$$;
revoke all on function private.guest_match_snapshot(uuid) from public, anon, authenticated;


create or replace function public.guest_match_day_scoring(token_hash text, action text, details jsonb default '{}'::jsonb, request_id_value uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.match_day_guest_sessions%rowtype; m public.match_days%rowtype;
  prior public.match_day_guest_commands%rowtype; result jsonb; g jsonb; mid uuid; phase_action text;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Guest gateway access required.'; end if;
  if token_hash is null or token_hash !~ '^[a-f0-9]{64}$' or octet_length(details::text)>12000 then raise exception 'Invalid scoring request.'; end if;
  -- Match first, then session: use the same lock order as coach approval and revocation.
  select match_day_id into mid from public.match_day_guest_sessions where
    case when action='claim' then invite_hash=token_hash else session_hash=token_hash end;
  select * into m from public.match_days where id=mid for update;
  select * into s from public.match_day_guest_sessions where match_day_id=mid and
    case when action='claim' then invite_hash=token_hash else session_hash=token_hash end for update;
  if s.id is null or s.status='revoked' or s.expires_at<=now() or m.deleted_at is not null
    or not exists(select 1 from public.clubs c join public.teams t on t.club_id=c.id where c.id=m.club_id and t.id=m.team_id and c.status='active' and coalesce(t.status,'active')='active')
    then raise exception 'This guest scoring access has expired or been removed. Ask the coach for a new QR code.'; end if;
  if action='claim' then
    if s.status='pending' and s.session_hash=details->>'sessionHash' then return jsonb_build_object('status','pending'); end if;
    if s.status<>'offered' or s.invite_expires_at<=now() or m.status in ('full_time','cancelled','postponed') or m.concluded_at is not null
      then raise exception 'This QR code has already been used or has expired.'; end if;
    if length(trim(coalesce(details->>'name',''))) not between 2 and 80
      or coalesce(details->>'sessionHash','') !~ '^[a-f0-9]{64}$'
      then raise exception 'Enter your name to ask the coach for access.'; end if;
    update public.match_day_guest_sessions set status='pending',guest_name=trim(details->>'name'),session_hash=details->>'sessionHash' where id=s.id;
    return jsonb_build_object('status','pending');
  end if;
  if s.status='pending' and action='read' and s.invite_expires_at>now() then return jsonb_build_object('status','pending'); end if;
  if s.status<>'approved' then raise exception 'Coach approval is required before scoring.'; end if;
  -- A saved command may be reconciled after Full Time, without granting further access.
  if request_id_value is not null then
    select * into prior from public.match_day_guest_commands where session_id=s.id and request_id=request_id_value;
    if prior.request_id is not null then
      if prior.action<>action or prior.input<>details then raise exception 'This request has already been used for a different change.'; end if;
      return prior.result || jsonb_build_object('duplicate',true);
    end if;
  end if;
  if m.status='full_time' or m.concluded_at is not null then
    if action='read' then return jsonb_build_object('status','finished','message','The match has ended. The coach will review and conclude the game.'); end if;
    raise exception 'Guest scoring has ended for this match.';
  end if;
  perform set_config('app.guest_scorer_session',s.id::text,true);
  if not private.is_guest_match_scorer(m.id) then raise exception 'Guest scoring is unavailable for this match.'; end if;
  if action='read' then
    result:=jsonb_build_object('status','approved','name',s.guest_name,'match',private.guest_match_snapshot(m.id));
  else
    if request_id_value is null then raise exception 'A unique scoring request is required.'; end if;
    case action
      when 'start' then g:=public.start_match_day(m.id);
      when 'timer' then
        phase_action:=details->>'action';
        if phase_action not in ('pause','half_time','hydration','resume','full_time') or phase_action is null then raise exception 'Choose a supported clock action.'; end if;
        g:=public.set_match_day_timer_state(m.id,phase_action);
      when 'extended' then
        phase_action:=details->>'action';
        if phase_action not in ('normal_time_complete','start_extra_time','extra_time_half_time','start_extra_time_second_half','complete_extra_time','start_penalties') or phase_action is null then raise exception 'Choose a supported match period.'; end if;
        g:=public.set_match_day_extended_state(m.id,phase_action);
      when 'goal' then g:=public.record_match_day_goal_v3(m.id,null,details->>'teamSide',details->>'scorerName',details->>'scorerShirtNumber',
        details->>'assistName',details->>'assistShirtNumber',(details->>'minute')::integer,details->>'notes',coalesce((details->>'isPenaltyGoal')::boolean,false),
        request_id_value,coalesce((details->>'isOwnGoal')::boolean,false),(details->>'stoppageMinute')::integer);
      when 'correct_goal' then g:=public.correct_match_day_goal_v2(m.id,(details->>'eventId')::uuid,null,details->>'teamSide',details->>'scorerName',
        details->>'scorerShirtNumber',details->>'assistName',details->>'assistShirtNumber',(details->>'minute')::integer,details->>'notes',details->>'reason',
        (details->>'isOwnGoal')::boolean,(details->>'stoppageMinute')::integer);
      when 'remove_goal' then
        if not exists(select 1 from public.match_day_events where id=(details->>'eventId')::uuid and match_day_id=m.id and event_type='goal') then raise exception 'Choose a goal from this match.'; end if;
        g:=public.void_match_day_event(m.id,(details->>'eventId')::uuid,'added_by_mistake',left(coalesce(details->>'reason',''),240));
      when 'event' then g:=public.record_match_day_scorer_event_v1(m.id,details->>'eventType',details->>'teamSide',
        (details->>'minute')::integer,details->>'playerName',details->>'playerShirtNumber',details->>'playerOnName',
        details->>'playerOnShirtNumber',details->>'notes',request_id_value,null,(details->>'stoppageMinute')::integer);
      when 'remove_event' then
        if not exists(select 1 from public.match_day_events where id=(details->>'eventId')::uuid and match_day_id=m.id
          and event_type in ('yellow_card','red_card','substitution','water_break')) then raise exception 'Choose an event from this match.'; end if;
        g:=public.void_match_day_event(m.id,(details->>'eventId')::uuid,'added_by_mistake',left(coalesce(details->>'reason',''),240));
      when 'score' then g:=public.record_match_day_score_correction_v2(m.id,null,(details->>'homeScore')::integer,(details->>'awayScore')::integer,details->>'reason',request_id_value);
      when 'shootout' then g:=public.record_match_day_shootout_kick(m.id,details->>'teamSide',details->>'outcome',details->>'playerName',details->>'notes');
      else raise exception 'This action is not available to guest scorers.';
    end case;
    result:=jsonb_build_object('status',case when action='timer' and phase_action='full_time' then 'finished' else 'approved' end,'saved',true,
      'matchId',m.id,'commandId',request_id_value,'name',s.guest_name);
    if result->>'status'='approved' then result:=result||jsonb_build_object('match',private.guest_match_snapshot(m.id)); end if;
    insert into public.match_day_guest_commands(session_id,request_id,action,input,result) values(s.id,request_id_value,action,details,result);
  end if;
  perform set_config('app.guest_scorer_session','',true);
  return result;
end;
$$;
revoke all on function public.guest_match_day_scoring(text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.guest_match_day_scoring(text,text,jsonb,uuid) to service_role;

-- Keep staff delivery unchanged. A Parent can notify only an event they saved
-- through the currently selected scorer link for this fixture.
create or replace function public.authorize_match_day_scorer_event_push(
  actor_user_id_value uuid, match_day_id_value uuid, parent_link_id_value uuid,
  notification_type_value text, event_id_value uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare m public.match_days%rowtype; e public.match_day_events%rowtype; authorization_result jsonb;
begin
  if parent_link_id_value is null then
    return public.authorize_match_day_push_v2(actor_user_id_value,match_day_id_value,null,notification_type_value,event_id_value);
  end if;
  if notification_type_value not in ('yellow_card','red_card','substitution') or notification_type_value is null then
    return jsonb_build_object('allowed',false,'reason','unsupported_type');
  end if;
  select * into m from public.match_days where id=match_day_id_value and deleted_at is null;
  if m.id is null or m.concluded_at is not null or m.status not in ('live','half_time','second_half','extra_time','penalties')
    or coalesce(m.timer_status,'not_started') in ('not_started','full_time') then
    return jsonb_build_object('allowed',false,'reason','gameplay_state');
  end if;
  -- The existing lifecycle permission checks the active scorer assignment,
  -- verified Parent link, fixture date and notification audience.
  authorization_result:=public.authorize_match_day_push(actor_user_id_value,m.id,parent_link_id_value,m.status,null);
  if coalesce((authorization_result->>'allowed')::boolean,false) is not true then return authorization_result; end if;
  select * into e from public.match_day_events where id=event_id_value and match_day_id=m.id
    and club_id=m.club_id and team_id=m.team_id and event_type=notification_type_value
    and event_status='active' and created_by=actor_user_id_value and created_by_parent_link_id=parent_link_id_value;
  if e.id is null then return jsonb_build_object('allowed',false,'reason','event_scope'); end if;
  return authorization_result||jsonb_build_object('operationKey',concat('match-day:',m.id,':',notification_type_value,':',e.id));
end;
$$;
revoke all on function public.authorize_match_day_scorer_event_push(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.authorize_match_day_scorer_event_push(uuid,uuid,uuid,text,uuid) to service_role;
