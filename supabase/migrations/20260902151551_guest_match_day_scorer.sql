-- Guest scoring uses an expiring capability, never an Auth account or a staff identity.
create schema if not exists private;


create table public.match_day_guest_sessions (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null references public.match_days(id) on delete cascade,
  invite_hash text not null unique check (invite_hash ~ '^[a-f0-9]{64}$'),
  session_hash text unique check (session_hash ~ '^[a-f0-9]{64}$'),
  guest_name text not null default '' check (length(guest_name) <= 80),
  status text not null default 'offered' check (status in ('offered','pending','approved','revoked')),
  created_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  invite_expires_at timestamptz not null default now() + interval '10 minutes',
  expires_at timestamptz not null default now() + interval '8 hours',
  approved_at timestamptz,
  revoked_at timestamptz
);
create unique index match_day_guest_one_current on public.match_day_guest_sessions(match_day_id) where status <> 'revoked';
alter table public.match_day_guest_sessions enable row level security;
revoke all on public.match_day_guest_sessions from public, anon, authenticated;
grant all on public.match_day_guest_sessions to service_role;

create table public.match_day_guest_commands (
  session_id uuid not null references public.match_day_guest_sessions(id) on delete cascade,
  request_id uuid not null,
  action text not null,
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (session_id, request_id)
);
alter table public.match_day_guest_commands enable row level security;
revoke all on public.match_day_guest_commands from public, anon, authenticated;
grant all on public.match_day_guest_commands to service_role;

create or replace function private.is_guest_match_scorer(match_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'role' = 'service_role', false) and exists (
    select 1 from public.match_day_guest_sessions s
    join public.match_days m on m.id=s.match_day_id
    join public.clubs c on c.id=m.club_id and c.status='active'
    join public.teams t on t.id=m.team_id and coalesce(t.status,'active')='active'
    where s.id::text=current_setting('app.guest_scorer_session',true)
      and s.match_day_id=match_id and s.status='approved' and s.expires_at>now()
      and m.deleted_at is null and m.concluded_at is null
      and m.status not in ('full_time','cancelled','postponed')
  );
$$;
revoke all on function private.is_guest_match_scorer(uuid) from public, anon, authenticated;

create or replace function private.guest_match_scorer_name(match_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select s.guest_name from public.match_day_guest_sessions s
  where s.id::text=current_setting('app.guest_scorer_session',true)
    and s.match_day_id=match_id and private.is_guest_match_scorer(match_id);
$$;
revoke all on function private.guest_match_scorer_name(uuid) from public, anon, authenticated;

create or replace function public.manage_match_day_guest_scorer(match_id uuid, action text, invite_hash_value text default null, session_id_value uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.match_days%rowtype; s public.match_day_guest_sessions%rowtype;
begin
  select * into m from public.match_days where id=match_id for update;
  if auth.uid() is null or m.id is null or m.deleted_at is not null
    or not coalesce(public.can_manage_match_day(m.team_id),false)
    or (public.current_user_role()<>'super_admin' and m.club_id is distinct from public.current_user_club_id())
    then raise exception 'Coach access to this match is required.'; end if;
  if action not in ('status','create','approve','revoke') then raise exception 'Unknown guest scorer action.'; end if;
  if action in ('create','approve') and (m.concluded_at is not null or m.status in ('full_time','cancelled','postponed'))
    then raise exception 'Guest scoring is closed for this match.'; end if;
  if action='create' then
    if invite_hash_value is null or invite_hash_value !~ '^[a-f0-9]{64}$' then raise exception 'A secure invitation is required.'; end if;
    update public.match_day_guest_sessions set status='revoked',revoked_at=now() where match_day_id=m.id and status<>'revoked';
    insert into public.match_day_guest_sessions(match_day_id,invite_hash,created_by) values(m.id,invite_hash_value,auth.uid()) returning * into s;
  else
    select * into s from public.match_day_guest_sessions where match_day_id=m.id and status<>'revoked' for update;
    if action='approve' then
      if s.id is null or s.id is distinct from session_id_value or s.status<>'pending' or s.invite_expires_at<=now()
        then raise exception 'This request has expired. Generate a new QR code.'; end if;
      update public.match_day_guest_sessions set status='approved',approved_by=auth.uid(),approved_at=now(),expires_at=now()+interval '8 hours' where id=s.id returning * into s;
    elsif action='revoke' and s.id is not null then
      if s.id is distinct from session_id_value then raise exception 'Refresh the current guest before removing access.'; end if;
      update public.match_day_guest_sessions set status='revoked',revoked_at=now() where id=s.id returning * into s;
    end if;
  end if;
  if action<>'status' then
    insert into public.match_day_event_log(club_id,team_id,match_day_id,actor_user_id,actor_display_name,actor_role,event_type,event_label,metadata)
    values(m.club_id,m.team_id,m.id,auth.uid(),coalesce(auth.jwt()->>'email','Coach'),public.current_user_role(),'scorer_updated',
      case action when 'create' then 'Guest scorer QR created' when 'approve' then 'Guest scorer approved' else 'Guest scorer access removed' end,
      jsonb_build_object('guestSessionId',s.id,'guestName',s.guest_name));
  end if;
  return jsonb_build_object('id',s.id,'status',case when s.expires_at<=now() or (s.status in ('offered','pending') and s.invite_expires_at<=now()) then 'expired' else s.status end,
    'name',s.guest_name,'inviteExpiresAt',s.invite_expires_at,'expiresAt',s.expires_at);
end;
$$;
revoke all on function public.manage_match_day_guest_scorer(uuid,text,text,uuid) from public, anon;
grant execute on function public.manage_match_day_guest_scorer(uuid,text,text,uuid) to authenticated;

create or replace function private.guest_match_snapshot(match_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',m.id,'clubName',c.name,'teamName',t.name,'opponent',m.opponent,'homeAway',m.home_away,
    'homeScore',m.home_score,'awayScore',m.away_score,'status',m.status,
    'matchDate',m.match_date,'isToday',public.match_day_local_date_is_today(m.id),
    'matchDurationMinutes',m.match_duration_minutes,'clockMode',m.match_clock_mode,
    'currentMatchPhase',m.current_match_phase,'conclusionRule',m.match_conclusion_rule,
    'extraTimeHalfMinutes',m.extra_time_half_minutes,'extraTimePeriodCount',m.extra_time_period_count,
    'timerStatus',m.timer_status,'timerStartedAt',m.timer_started_at,'phaseStartedAt',m.phase_started_at,
    'timerElapsedSeconds',m.timer_elapsed_seconds,'homeShootoutScore',m.home_shootout_score,'awayShootoutScore',m.away_shootout_score,
    'players',coalesce((select jsonb_agg(jsonb_build_object('name',p.player_name,'shirtNumber',p.shirt_number) order by p.player_name)
      from public.match_day_player_squad_decisions d join public.players p on p.id=d.player_id
      where d.match_day_id=m.id and d.club_id=m.club_id and d.team_id=m.team_id and d.status='selected'
        and p.club_id=m.club_id and p.archived_at is null and coalesce(p.status,'active')<>'archived'), '[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'teamSide',e.team_side,'minute',e.minute,
      'stoppageMinute',e.stoppage_minute,'scorerName',e.scorer_name,'scorerShirtNumber',e.scorer_shirt_number,
      'assistName',e.assist_name,'assistShirtNumber',e.assist_shirt_number,'isOwnGoal',e.is_own_goal,
      'isPenaltyGoal',e.is_penalty_goal,'notes',e.notes,'createdAt',e.created_at) order by e.created_at desc,e.event_sequence desc)
      from public.match_day_events e where e.match_day_id=m.id and e.event_type='goal' and e.event_status<>'voided'), '[]'::jsonb)
  ) from public.match_days m join public.teams t on t.id=m.team_id join public.clubs c on c.id=m.club_id where m.id=match_id;
$$;
revoke all on function private.guest_match_snapshot(uuid) from public, anon, authenticated;


CREATE OR REPLACE FUNCTION public.correct_match_day_goal_v2(match_day_id_value uuid, goal_event_id_value uuid, parent_link_id_value uuid DEFAULT NULL::uuid, team_side_value text DEFAULT NULL::text, scorer_name_value text DEFAULT NULL::text, scorer_shirt_number_value text DEFAULT ''::text, assist_name_value text DEFAULT ''::text, assist_shirt_number_value text DEFAULT ''::text, minute_value integer DEFAULT NULL::integer, notes_value text DEFAULT ''::text, correction_reason_value text DEFAULT ''::text, is_own_goal_value boolean DEFAULT NULL::boolean, stoppage_minute_value integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  match_row public.match_days%rowtype;
  event_row public.match_day_events%rowtype;
  parent_link_row public.parent_player_links%rowtype;
  actor_user_id uuid := auth.uid();
  actor_name text := '';
  actor_role text := '';
  normalized_team_side text;
  next_home_score integer;
  next_away_score integer;
  previous_event jsonb;
  next_event jsonb;
begin
  if actor_user_id is null and not private.is_guest_match_scorer(match_day_id_value) then
    raise exception 'Login is required before correcting a goal.';
  end if;

  if minute_value is not null and minute_value < 0 then
    raise exception 'Minute must be zero or greater.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if private.is_guest_match_scorer(match_row.id) then
    actor_name := private.guest_match_scorer_name(match_row.id);
    actor_role := 'scorer_guest';
  elsif parent_link_id_value is null then
    if not public.can_manage_match_day(match_row.team_id)
      or (public.current_user_role() <> 'super_admin' and match_row.club_id <> public.current_user_club_id()) then
      raise exception 'Coach or manager access is required to correct this goal.';
    end if;

    actor_name := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), '');
    actor_role := coalesce(nullif(public.current_user_role(), ''), 'staff');
  else
    if not public.current_user_is_match_day_scorer(match_row.id) then
      raise exception 'Only the current selected scorer can correct this match.';
    end if;

    select parent_link.* into parent_link_row
    from public.match_day_role_assignments role_assignment
    join public.parent_player_links parent_link
      on parent_link.id = role_assignment.parent_link_id
     and parent_link.auth_user_id = role_assignment.auth_user_id
     and parent_link.club_id = role_assignment.club_id
     and parent_link.team_id = role_assignment.team_id
     and parent_link.status = 'active'
    where role_assignment.match_day_id = match_row.id
      and role_assignment.role = 'scorer'
      and role_assignment.parent_link_id = parent_link_id_value
      and role_assignment.auth_user_id = actor_user_id
      and role_assignment.club_id = match_row.club_id
      and role_assignment.team_id = match_row.team_id
    limit 1;

    if parent_link_row.id is null then
      raise exception 'The selected scorer link does not match this fixture.';
    end if;

    actor_name := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), parent_link_row.email, '');
    actor_role := 'scorer_parent';
  end if;

  select * into event_row
  from public.match_day_events
  where id = goal_event_id_value
    and match_day_id = match_row.id
    and club_id = match_row.club_id
    and team_id = match_row.team_id
  for update;

  if event_row.id is null then
    raise exception 'This goal event could not be found for this match.';
  end if;

  if event_row.event_type <> 'goal' then
    raise exception 'Only goal events can be corrected.';
  end if;

  if event_row.event_status = 'voided' then
    raise exception 'This goal has already been removed.';
  end if;

  normalized_team_side := coalesce(nullif(trim(team_side_value), ''), event_row.team_side);
  if normalized_team_side not in ('club', 'opponent') then
    raise exception 'Choose who scored the goal.';
  end if;

  next_home_score := greatest(coalesce(match_row.home_score, 0), 0);
  next_away_score := greatest(coalesce(match_row.away_score, 0), 0);

  if event_row.team_side = 'club' then
    if match_row.home_away = 'away' then
      next_away_score := next_away_score - 1;
    else
      next_home_score := next_home_score - 1;
    end if;
  elsif match_row.home_away = 'away' then
    next_home_score := next_home_score - 1;
  else
    next_away_score := next_away_score - 1;
  end if;

  if normalized_team_side = 'club' then
    if match_row.home_away = 'away' then
      next_away_score := next_away_score + 1;
    else
      next_home_score := next_home_score + 1;
    end if;
  elsif match_row.home_away = 'away' then
    next_home_score := next_home_score + 1;
  else
    next_away_score := next_away_score + 1;
  end if;

  if next_home_score < 0 or next_away_score < 0 then
    raise exception 'Goal correction would make the score negative.';
  end if;

  if coalesce(stoppage_minute_value, 0) < 0 or coalesce(stoppage_minute_value, 0) > 30 then
    raise exception 'Added time must be between 0 and 30 minutes.';
  end if;
  if coalesce(is_own_goal_value, event_row.is_own_goal) then
    assist_name_value := '';
    assist_shirt_number_value := '';
  end if;

  previous_event := jsonb_build_object(
    'id', event_row.id,
    'eventType', event_row.event_type,
    'teamSide', event_row.team_side,
    'minute', event_row.minute,
    'isOwnGoal', event_row.is_own_goal,
    'stoppageMinute', event_row.stoppage_minute,
    'scorerName', event_row.scorer_name,
    'scorerInitials', event_row.scorer_initials,
    'scorerShirtNumber', event_row.scorer_shirt_number,
    'assistName', event_row.assist_name,
    'assistInitials', event_row.assist_initials,
    'assistShirtNumber', event_row.assist_shirt_number,
    'homeScore', event_row.home_score,
    'awayScore', event_row.away_score,
    'notes', event_row.notes,
    'eventStatus', event_row.event_status,
    'createdByName', event_row.created_by_name,
    'createdAt', event_row.created_at
  );

  update public.match_days
  set home_score = next_home_score,
      away_score = next_away_score,
      updated_at = now()
  where id = match_row.id;

  update public.match_day_events
  set team_side = normalized_team_side,
      minute = minute_value,
      is_own_goal = coalesce(is_own_goal_value, event_row.is_own_goal),
      is_penalty_goal = case when coalesce(is_own_goal_value, event_row.is_own_goal) then false else event_row.is_penalty_goal end,
      stoppage_minute = nullif(stoppage_minute_value, 0),
      scorer_name = trim(coalesce(scorer_name_value, '')),
      scorer_initials = public.get_initials_from_full_name(scorer_name_value),
      scorer_shirt_number = trim(coalesce(scorer_shirt_number_value, '')),
      assist_name = trim(coalesce(assist_name_value, '')),
      assist_initials = public.get_initials_from_full_name(assist_name_value),
      assist_shirt_number = trim(coalesce(assist_shirt_number_value, '')),
      home_score = next_home_score,
      away_score = next_away_score,
      notes = trim(coalesce(notes_value, '')),
      event_status = 'corrected',
      corrected_at = now(),
      corrected_by = actor_user_id,
      corrected_by_parent_link_id = parent_link_row.id,
      corrected_by_name = actor_name,
      correction_reason = trim(coalesce(correction_reason_value, '')),
      correction_metadata = jsonb_build_object(
        'action', 'corrected',
        'actorRole', actor_role,
        'previousEvent', previous_event
      )
  where id = event_row.id
  returning jsonb_build_object(
    'id', id,
    'matchDayId', match_day_id,
    'eventType', event_type,
    'teamSide', team_side,
    'minute', minute,
    'isOwnGoal', is_own_goal,
    'stoppageMinute', stoppage_minute,
    'scorerName', scorer_name,
    'scorerInitials', scorer_initials,
    'scorerShirtNumber', scorer_shirt_number,
    'assistName', assist_name,
    'assistInitials', assist_initials,
    'assistShirtNumber', assist_shirt_number,
    'homeScore', home_score,
    'awayScore', away_score,
    'notes', notes,
    'eventStatus', event_status,
    'correctedAt', corrected_at,
    'correctedByName', corrected_by_name,
    'correctionReason', correction_reason,
    'createdByName', created_by_name,
    'createdAt', created_at
  ) into next_event;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id,
    match_row.team_id,
    match_row.id,
    actor_user_id,
    actor_name,
    actor_role,
    'scorer_updated',
    'Goal corrected',
    jsonb_build_object('homeScore', match_row.home_score, 'awayScore', match_row.away_score, 'event', previous_event),
    jsonb_build_object('homeScore', next_home_score, 'awayScore', next_away_score, 'event', next_event),
    jsonb_build_object(
      'goalEventId', event_row.id,
      'correctionAction', 'corrected',
      'actorType', actor_role,
      'parentLinkId', parent_link_row.id,
      'source', 'match_day_goal_correction_rpc'
    )
  );

  return jsonb_build_object(
    'matchDayId', match_row.id,
    'homeScore', next_home_score,
    'awayScore', next_away_score,
    'status', match_row.status,
    'event', next_event
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.current_user_is_match_day_scorer(target_match_day_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select (public.current_user_has_match_day_scorer_assignment(target_match_day_id) or private.is_guest_match_scorer(target_match_day_id))
    and public.match_day_local_date_is_today(target_match_day_id)
    and exists (
      select 1
      from public.match_days match_day
      where match_day.id = target_match_day_id
        and match_day.deleted_at is null
        and match_day.concluded_at is null
        and match_day.status not in ('cancelled', 'postponed')
    );
$function$
;


CREATE OR REPLACE FUNCTION public.record_match_day_goal_v3(match_day_id_value uuid, parent_link_id_value uuid, team_side_value text, scorer_name_value text, scorer_shirt_number_value text, assist_name_value text, assist_shirt_number_value text, minute_value integer, notes_value text, is_penalty_goal_value boolean, request_id_value uuid, is_own_goal_value boolean, stoppage_minute_value integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  match_row public.match_days%rowtype;
  actor_record record;
  normalized_team_side text := trim(coalesce(team_side_value, 'club'));
  next_home_score integer;
  next_away_score integer;
  event_row public.match_day_events%rowtype;
begin
  if auth.uid() is null and not private.is_guest_match_scorer(match_day_id_value) then
    raise exception 'Login is required before adding a goal.';
  end if;

  if request_id_value is null then
    raise exception 'A request id is required before adding a goal.';
  end if;

  if normalized_team_side not in ('club', 'opponent') then
    raise exception 'Choose who scored the goal.';
  end if;

  if minute_value is not null and minute_value < 0 then
    raise exception 'Minute must be zero or greater.';
  end if;

  if coalesce(stoppage_minute_value, 0) < 0 or coalesce(stoppage_minute_value, 0) > 30 then
    raise exception 'Added time must be between 0 and 30 minutes.';
  end if;
  if coalesce(is_own_goal_value, false) and coalesce(is_penalty_goal_value, false) then
    raise exception 'An own goal cannot also be a penalty goal.';
  end if;
  if coalesce(is_own_goal_value, false) then
    assist_name_value := '';
    assist_shirt_number_value := '';
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
    raise exception 'Start or resume the match before recording a goal.';
  end if;

  select * into actor_record
  from public.resolve_match_day_mutation_actor(match_row.id, parent_link_id_value);

  if actor_record.actor_user_id is null and actor_record.actor_role is distinct from 'scorer_guest' then
    raise exception 'You cannot record goals for this match.';
  end if;

  select * into event_row
  from public.match_day_events
  where match_day_id = match_day_id_value
    and request_id = request_id_value;

  if event_row.id is not null then
    return to_jsonb(event_row);
  end if;

  next_home_score := greatest(coalesce(match_row.home_score, 0), 0);
  next_away_score := greatest(coalesce(match_row.away_score, 0), 0);

  if normalized_team_side = 'club' then
    if match_row.home_away = 'away' then
      next_away_score := next_away_score + 1;
    else
      next_home_score := next_home_score + 1;
    end if;
  elsif match_row.home_away = 'away' then
    next_home_score := next_home_score + 1;
  else
    next_away_score := next_away_score + 1;
  end if;

  update public.match_days
  set home_score = next_home_score,
      away_score = next_away_score,
      updated_at = now()
  where id = match_row.id;

  insert into public.match_day_events (
    match_day_id, club_id, team_id, event_type, team_side, minute,
    scorer_name, scorer_initials, scorer_shirt_number,
    assist_name, assist_initials, assist_shirt_number,
    home_score, away_score, notes, created_by,
    created_by_parent_link_id, created_by_name, is_penalty_goal,
    match_phase, phase_order, request_id, is_own_goal, stoppage_minute
  ) values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    'goal',
    normalized_team_side,
    minute_value,
    trim(coalesce(scorer_name_value, '')),
    public.get_initials_from_full_name(scorer_name_value),
    trim(coalesce(scorer_shirt_number_value, '')),
    trim(coalesce(assist_name_value, '')),
    public.get_initials_from_full_name(assist_name_value),
    trim(coalesce(assist_shirt_number_value, '')),
    next_home_score,
    next_away_score,
    trim(coalesce(notes_value, '')),
    actor_record.actor_user_id,
    actor_record.actor_parent_link_id,
    actor_record.actor_name,
    coalesce(is_penalty_goal_value, false),
    match_row.current_match_phase,
    public.match_day_phase_order(match_row.current_match_phase),
    request_id_value, coalesce(is_own_goal_value, false), nullif(stoppage_minute_value, 0)
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
    'Goal added',
    jsonb_build_object('homeScore', match_row.home_score, 'awayScore', match_row.away_score),
    jsonb_build_object('homeScore', next_home_score, 'awayScore', next_away_score),
    jsonb_build_object(
      'matchEventId', event_row.id,
      'parentLinkId', actor_record.actor_parent_link_id,
      'requestId', request_id_value,
      'source', 'match_day_goal_v3', 'isOwnGoal', event_row.is_own_goal, 'stoppageMinute', event_row.stoppage_minute
    )
  );

  return to_jsonb(event_row);
end;
$function$
;


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
    or match_row.status not in ('live', 'half_time', 'second_half', 'extra_time', 'penalties')
    or coalesce(match_row.timer_status, 'not_started') in ('not_started', 'full_time') then
    raise exception 'Start or resume the match before correcting the score.';
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


CREATE OR REPLACE FUNCTION public.resolve_match_day_mutation_actor(match_day_id_value uuid, parent_link_id_value uuid DEFAULT NULL::uuid)
 RETURNS TABLE(actor_user_id uuid, actor_name text, actor_role text, actor_parent_link_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with candidates as (
    select null::uuid as actor_user_id, private.guest_match_scorer_name(match_day_id_value) as actor_name,
      'scorer_guest'::text as actor_role, null::uuid as actor_parent_link_id, 0 as priority
    where private.is_guest_match_scorer(match_day_id_value)
    union all
    select
      staff_user.id as actor_user_id,
      coalesce(nullif(trim(staff_user.name), ''), staff_user.email, '') as actor_name,
      coalesce(nullif(trim(staff_user.role), ''), 'staff') as actor_role,
      null::uuid as actor_parent_link_id,
      1 as priority
    from public.users staff_user
    join public.match_days match_day on match_day.id = match_day_id_value
    where staff_user.id = (select auth.uid())
      and public.can_manage_match_day(match_day.team_id)

    union all

    select
      parent_link.auth_user_id,
      coalesce(
        nullif(trim(auth.jwt() ->> 'name'), ''),
        nullif(trim(auth.jwt() ->> 'email'), ''),
        parent_link.email,
        ''
      ),
      'scorer_parent',
      parent_link.id,
      2
    from public.match_days match_day
    join public.match_day_role_assignments role_assignment
      on role_assignment.match_day_id = match_day.id
     and role_assignment.role = 'scorer'
     and role_assignment.parent_link_id = parent_link_id_value
     and role_assignment.auth_user_id = (select auth.uid())
     and role_assignment.club_id = match_day.club_id
     and role_assignment.team_id = match_day.team_id
    join public.match_day_scorer_assignments legacy_assignment
      on legacy_assignment.match_day_id = match_day.id
     and legacy_assignment.parent_link_id = role_assignment.parent_link_id
     and legacy_assignment.auth_user_id = role_assignment.auth_user_id
     and legacy_assignment.club_id = role_assignment.club_id
     and legacy_assignment.team_id = role_assignment.team_id
    join public.parent_player_links parent_link
      on parent_link.id = role_assignment.parent_link_id
     and parent_link.auth_user_id = role_assignment.auth_user_id
     and parent_link.status = 'active'
    where match_day.id = match_day_id_value
      and public.current_user_is_match_day_scorer(match_day.id)
  )
  select
    candidates.actor_user_id,
    candidates.actor_name,
    candidates.actor_role,
    candidates.actor_parent_link_id
  from candidates
  order by candidates.priority
  limit 1;
$function$
;


CREATE OR REPLACE FUNCTION public.set_match_day_extended_state(match_day_id_value uuid, action_value text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  match_row public.match_days%rowtype;
  updated_match_row public.match_days%rowtype;
  actor_user_id uuid := auth.uid();
  actor_name text := '';
  actor_role text := '';
  actor_parent_link_id uuid;
  normalized_action text := lower(trim(coalesce(action_value, '')));
  is_staff_actor boolean := false;
  is_scorer_actor boolean := false;
  now_value timestamptz := now();
  effective_elapsed_seconds integer := 0;
  next_status text;
  next_phase text;
  next_timer_status text;
  next_timer_started_at timestamptz;
  next_timer_paused_at timestamptz;
  next_timer_elapsed_seconds integer;
begin
  if actor_user_id is null and not private.is_guest_match_scorer(match_day_id_value) then
    raise exception 'Login is required before controlling extended match operations.';
  end if;

  if normalized_action not in (
    'normal_time_complete', 'start_extra_time', 'extra_time_half_time',
    'start_extra_time_second_half', 'complete_extra_time', 'start_penalties'
  ) then
    raise exception 'Choose a supported extended match action.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if match_row.concluded_at is not null then
    raise exception 'A concluded match cannot be changed.';
  end if;

  is_staff_actor := public.can_manage_match_day(match_row.team_id)
    and (public.current_user_role() = 'super_admin' or match_row.club_id = public.current_user_club_id());
  is_scorer_actor := public.current_user_is_match_day_scorer(match_row.id);

  if not is_staff_actor and not is_scorer_actor then
    raise exception 'Current coach, manager, or selected scorer access is required for extended match operations.';
  end if;

  if is_scorer_actor then
    select assignment.parent_link_id
    into actor_parent_link_id
    from public.match_day_role_assignments assignment
    where assignment.match_day_id = match_row.id
      and assignment.role = 'scorer'
      and assignment.auth_user_id = actor_user_id
      and assignment.club_id = match_row.club_id
      and assignment.team_id = match_row.team_id
    limit 1;
    actor_role := 'scorer_parent';
  else
    actor_role := coalesce(nullif(public.current_user_role(), ''), 'staff');
  end if;

  actor_name := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), 'Match Day operator');
  if private.is_guest_match_scorer(match_row.id) then
    actor_name := private.guest_match_scorer_name(match_row.id);
    actor_role := 'scorer_guest';
  end if;
  effective_elapsed_seconds := greatest(coalesce(match_row.timer_elapsed_seconds, 0), 0);
  if match_row.timer_status = 'running' then
    effective_elapsed_seconds := effective_elapsed_seconds + greatest(
      floor(extract(epoch from (now_value - coalesce(match_row.timer_started_at, match_row.phase_started_at, now_value))))::integer,
      0
    );
  end if;

  next_status := match_row.status;
  next_phase := match_row.current_match_phase;
  next_timer_status := match_row.timer_status;
  next_timer_started_at := match_row.timer_started_at;
  next_timer_paused_at := match_row.timer_paused_at;
  next_timer_elapsed_seconds := greatest(coalesce(match_row.timer_elapsed_seconds, 0), 0);

  if normalized_action = 'normal_time_complete' then
    if match_row.match_conclusion_rule = 'normal_time' then
      raise exception 'This fixture finishes through the Full Time action.';
    end if;
    if match_row.current_match_phase not in ('first_half', 'second_half')
      or match_row.status not in ('live', 'second_half') then
      raise exception 'Normal time can only finish from active regulation play.';
    end if;
    next_phase := 'normal_time_complete';
    next_timer_status := 'paused';
    next_timer_started_at := null;
    next_timer_paused_at := now_value;
    next_timer_elapsed_seconds := effective_elapsed_seconds;
  elsif normalized_action = 'start_extra_time' then
    if match_row.match_conclusion_rule not in ('extra_time', 'extra_time_then_penalties')
      or match_row.current_match_phase <> 'normal_time_complete' then
      raise exception 'Extra time is not available from the current match phase.';
    end if;
    next_status := 'extra_time';
    next_phase := 'extra_time_first_half';
    next_timer_status := 'running';
    next_timer_started_at := now_value;
    next_timer_paused_at := null;
  elsif normalized_action = 'extra_time_half_time' then
    if match_row.extra_time_period_count <> 2
      or match_row.current_match_phase <> 'extra_time_first_half'
      or match_row.status <> 'extra_time'
      or match_row.timer_status not in ('running', 'paused', 'hydration') then
      raise exception 'Extra time half time is not available from the current match phase.';
    end if;
    next_phase := 'extra_time_half_time';
    next_timer_status := 'half_time';
    next_timer_started_at := null;
    next_timer_paused_at := now_value;
    next_timer_elapsed_seconds := effective_elapsed_seconds;
  elsif normalized_action = 'start_extra_time_second_half' then
    if match_row.current_match_phase <> 'extra_time_half_time'
      or match_row.status <> 'extra_time' then
      raise exception 'The second extra-time period is not available from the current match phase.';
    end if;
    next_phase := 'extra_time_second_half';
    next_timer_status := 'running';
    next_timer_started_at := now_value;
    next_timer_paused_at := null;
  elsif normalized_action = 'complete_extra_time' then
    if ((match_row.extra_time_period_count = 1 and match_row.current_match_phase <> 'extra_time_first_half')
      or (match_row.extra_time_period_count = 2 and match_row.current_match_phase <> 'extra_time_second_half'))
      or match_row.status <> 'extra_time'
      or match_row.timer_status not in ('running', 'paused', 'hydration') then
      raise exception 'Extra time can only finish from its configured final period.';
    end if;
    next_phase := 'extra_time_complete';
    next_timer_status := 'paused';
    next_timer_started_at := null;
    next_timer_paused_at := now_value;
    next_timer_elapsed_seconds := effective_elapsed_seconds;
  elsif normalized_action = 'start_penalties' then
    if match_row.match_conclusion_rule = 'straight_to_penalties'
      and match_row.current_match_phase <> 'normal_time_complete' then
      raise exception 'Straight penalties can only start after normal time.';
    elsif match_row.match_conclusion_rule = 'extra_time_then_penalties'
      and match_row.current_match_phase <> 'extra_time_complete' then
      raise exception 'Penalties can only start after extra time.';
    elsif match_row.match_conclusion_rule not in ('straight_to_penalties', 'extra_time_then_penalties') then
      raise exception 'This fixture is not configured for penalties.';
    end if;
    next_status := 'penalties';
    next_phase := 'penalties';
    next_timer_status := 'paused';
    next_timer_started_at := null;
    next_timer_paused_at := coalesce(match_row.timer_paused_at, now_value);
    next_timer_elapsed_seconds := effective_elapsed_seconds;
  end if;

  perform pg_catalog.set_config('app.match_day_lifecycle_authorized', 'true', true);

  update public.match_days
  set status = next_status,
      current_match_phase = next_phase,
      normal_time_home_score = case when normalized_action = 'normal_time_complete' then home_score else normal_time_home_score end,
      normal_time_away_score = case when normalized_action = 'normal_time_complete' then away_score else normal_time_away_score end,
      extra_time_home_score = case when normalized_action = 'complete_extra_time' then home_score else extra_time_home_score end,
      extra_time_away_score = case when normalized_action = 'complete_extra_time' then away_score else extra_time_away_score end,
      phase_started_at = case when next_phase is distinct from match_row.current_match_phase then now_value else phase_started_at end,
      timer_status = next_timer_status,
      timer_started_at = next_timer_started_at,
      timer_paused_at = next_timer_paused_at,
      timer_elapsed_seconds = next_timer_elapsed_seconds,
      updated_at = now_value
  where id = match_row.id
  returning * into updated_match_row;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    updated_match_row.club_id, updated_match_row.team_id, updated_match_row.id,
    actor_user_id, actor_name, actor_role, 'match_day_updated', 'Extended match phase updated',
    jsonb_build_object('status', match_row.status, 'phase', match_row.current_match_phase, 'timerStatus', match_row.timer_status),
    jsonb_build_object('status', updated_match_row.status, 'phase', updated_match_row.current_match_phase, 'timerStatus', updated_match_row.timer_status),
    jsonb_build_object('action', normalized_action, 'parentLinkId', actor_parent_link_id, 'source', 'match_day_extended_state_rpc')
  );

  return jsonb_build_object(
    'id', updated_match_row.id,
    'matchDayId', updated_match_row.id,
    'status', updated_match_row.status,
    'currentMatchPhase', updated_match_row.current_match_phase,
    'conclusionRule', updated_match_row.match_conclusion_rule,
    'extraTimeHalfMinutes', updated_match_row.extra_time_half_minutes,
    'extraTimePeriodCount', updated_match_row.extra_time_period_count,
    'normalTimeHomeScore', updated_match_row.normal_time_home_score,
    'normalTimeAwayScore', updated_match_row.normal_time_away_score,
    'extraTimeHomeScore', updated_match_row.extra_time_home_score,
    'extraTimeAwayScore', updated_match_row.extra_time_away_score,
    'phaseStartedAt', updated_match_row.phase_started_at,
    'timerStartedAt', updated_match_row.timer_started_at,
    'timerPausedAt', updated_match_row.timer_paused_at,
    'timerElapsedSeconds', updated_match_row.timer_elapsed_seconds,
    'timerStatus', updated_match_row.timer_status,
    'homeShootoutScore', updated_match_row.home_shootout_score,
    'awayShootoutScore', updated_match_row.away_shootout_score,
    'shootoutWinner', updated_match_row.shootout_winner,
    'updatedAt', updated_match_row.updated_at
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.set_match_day_timer_state(match_day_id_value uuid, action_value text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  match_row public.match_days%rowtype;
  updated_match_row public.match_days%rowtype;
  timer_result jsonb;
  actor_user_id uuid := auth.uid();
  actor_name text := '';
  actor_role text := '';
  scorer_parent_link_id uuid;
  normalized_action text := lower(trim(coalesce(action_value, '')));
  is_staff_actor boolean := false;
  is_scorer_actor boolean := false;
  next_phase text;
begin
  if actor_user_id is null and not private.is_guest_match_scorer(match_day_id_value) then
    raise exception 'Login is required before controlling this match clock.';
  end if;

  if private.is_guest_match_scorer(match_day_id_value) and normalized_action = 'conclude' then
    raise exception 'Only a coach can conclude the game.';
  end if;
  if normalized_action = 'water_break' then
    normalized_action := 'hydration';
  end if;

  if normalized_action not in ('start', 'pause', 'half_time', 'hydration', 'resume', 'full_time', 'conclude') then
    raise exception 'Choose a supported match clock action.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  is_staff_actor := public.can_manage_match_day(match_row.team_id)
    and (public.current_user_role() = 'super_admin' or match_row.club_id = public.current_user_club_id());
  is_scorer_actor := public.current_user_is_match_day_scorer(match_row.id);

  if not is_staff_actor and not is_scorer_actor then
    if match_row.concluded_at is not null
      and normalized_action = 'conclude'
      and public.current_user_has_match_day_scorer_assignment(match_row.id) then
      is_scorer_actor := true;
    else
      raise exception 'Current coach, manager, or selected scorer access is required to control this match clock.';
    end if;
  end if;

  if is_scorer_actor then
    select assignment.parent_link_id
    into scorer_parent_link_id
    from public.match_day_role_assignments assignment
    where assignment.match_day_id = match_row.id
      and assignment.role = 'scorer'
      and assignment.auth_user_id = actor_user_id
      and assignment.club_id = match_row.club_id
      and assignment.team_id = match_row.team_id
    limit 1;
    actor_role := 'scorer_parent';
  else
    actor_role := coalesce(nullif(public.current_user_role(), ''), 'staff');
  end if;

  actor_name := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), '');
  if private.is_guest_match_scorer(match_row.id) then
    actor_name := private.guest_match_scorer_name(match_row.id);
    actor_role := 'scorer_guest';
  end if;

  if match_row.concluded_at is not null and normalized_action = 'conclude' then
    return jsonb_build_object(
      'id', match_row.id, 'matchDayId', match_row.id, 'status', match_row.status,
      'currentMatchPhase', match_row.current_match_phase, 'timerStatus', match_row.timer_status,
      'concludedAt', match_row.concluded_at, 'concludedBy', match_row.concluded_by,
      'alreadyConcluded', true
    );
  end if;

  if normalized_action = 'start'
    and (coalesce(match_row.timer_status, 'not_started') = 'running' or match_row.status in ('live', 'second_half', 'extra_time', 'penalties')) then
    return jsonb_build_object(
      'id', match_row.id, 'matchDayId', match_row.id, 'status', match_row.status,
      'currentMatchPhase', match_row.current_match_phase, 'timerStatus', match_row.timer_status,
      'alreadyStarted', true
    );
  end if;

  if normalized_action = 'full_time' then
    if match_row.match_conclusion_rule = 'extra_time'
      and match_row.current_match_phase <> 'extra_time_complete' then
      raise exception 'Complete both extra-time periods before Full Time.';
    elsif match_row.match_conclusion_rule in ('extra_time_then_penalties', 'straight_to_penalties') then
      if match_row.current_match_phase <> 'penalties'
        or match_row.home_shootout_score = match_row.away_shootout_score
        or not public.match_day_shootout_can_finish(match_row.id) then
        raise exception 'Complete the penalty shootout with a clear winner before Full Time.';
      end if;
    end if;
  end if;

  timer_result := public.apply_match_day_timer_action(
    match_row.id,
    normalized_action,
    actor_user_id,
    actor_name,
    actor_role,
    scorer_parent_link_id
  );

  next_phase := match_row.current_match_phase;
  if normalized_action = 'start' then
    next_phase := 'first_half';
  elsif normalized_action = 'half_time' and match_row.current_match_phase = 'first_half' then
    next_phase := 'half_time';
  elsif normalized_action = 'resume' and match_row.current_match_phase = 'half_time' then
    next_phase := 'second_half';
  elsif normalized_action = 'resume' and match_row.current_match_phase = 'extra_time_half_time' then
    next_phase := 'extra_time_second_half';
  elsif normalized_action = 'resume' and match_row.current_match_phase = 'full_time' then
    next_phase := case match_row.full_time_resume_status
      when 'extra_time' then 'extra_time_second_half'
      when 'penalties' then 'penalties'
      else 'second_half'
    end;
  elsif normalized_action = 'full_time' then
    next_phase := 'full_time';
  end if;

  perform pg_catalog.set_config('app.match_day_lifecycle_authorized', 'true', true);
  update public.match_days
  set current_match_phase = next_phase,
      normal_time_home_score = case
        when normalized_action = 'full_time' and match_conclusion_rule = 'normal_time' then home_score
        else normal_time_home_score
      end,
      normal_time_away_score = case
        when normalized_action = 'full_time' and match_conclusion_rule = 'normal_time' then away_score
        else normal_time_away_score
      end,
      shootout_winner = case
        when normalized_action = 'full_time' and current_match_phase = 'penalties'
          then case when home_shootout_score > away_shootout_score then 'home' else 'away' end
        when normalized_action = 'resume' and next_phase = 'penalties' then null
        else shootout_winner
      end,
      updated_at = case when next_phase is distinct from match_row.current_match_phase then now() else updated_at end
  where id = match_row.id
  returning * into updated_match_row;

  return timer_result || jsonb_build_object(
    'currentMatchPhase', updated_match_row.current_match_phase,
    'conclusionRule', updated_match_row.match_conclusion_rule,
    'extraTimeHalfMinutes', updated_match_row.extra_time_half_minutes,
    'extraTimePeriodCount', updated_match_row.extra_time_period_count,
    'normalTimeHomeScore', updated_match_row.normal_time_home_score,
    'normalTimeAwayScore', updated_match_row.normal_time_away_score,
    'extraTimeHomeScore', updated_match_row.extra_time_home_score,
    'extraTimeAwayScore', updated_match_row.extra_time_away_score,
    'homeShootoutScore', updated_match_row.home_shootout_score,
    'awayShootoutScore', updated_match_row.away_shootout_score,
    'shootoutWinner', updated_match_row.shootout_winner
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.start_match_day(match_day_id_value uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  actor_user_id uuid := auth.uid();
  match_row public.match_days%rowtype;
  start_result jsonb;
  is_staff_actor boolean := false;
  is_scorer_actor boolean := false;
begin
  if actor_user_id is null and not private.is_guest_match_scorer(match_day_id_value) then
    raise exception 'Login is required before starting this match.';
  end if;
  if match_day_id_value is null then
    raise exception 'Choose a match to start.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match could not be found.';
  end if;

  is_staff_actor := public.can_manage_match_day(match_row.team_id)
    and (public.current_user_role() = 'super_admin' or match_row.club_id = public.current_user_club_id());
  is_scorer_actor := public.current_user_is_match_day_scorer(match_row.id);

  if not is_staff_actor and not is_scorer_actor then
    raise exception 'Assigned staff or selected scorer access is required to start this match.';
  end if;

  if match_row.concluded_at is not null
    or match_row.status in ('full_time', 'cancelled', 'postponed')
    or coalesce(match_row.timer_status, 'not_started') = 'full_time' then
    raise exception 'A completed, cancelled, or postponed match cannot be started.';
  end if;

  if not public.match_day_local_date_is_today(match_row.id) then
    raise exception 'This match can only be started on the fixture date.';
  end if;

  if coalesce(match_row.timer_status, 'not_started') = 'running'
    or match_row.status in ('live', 'second_half', 'extra_time', 'penalties') then
    return jsonb_build_object(
      'id', match_row.id, 'matchDayId', match_row.id, 'status', match_row.status,
      'phaseStartedAt', match_row.phase_started_at, 'timerStartedAt', match_row.timer_started_at,
      'timerPausedAt', match_row.timer_paused_at, 'timerElapsedSeconds', match_row.timer_elapsed_seconds,
      'timerStatus', match_row.timer_status, 'fullTimeResumeStatus', match_row.full_time_resume_status,
      'concludedAt', match_row.concluded_at, 'concludedBy', match_row.concluded_by,
      'updatedAt', match_row.updated_at, 'alreadyStarted', true
    );
  end if;

  if match_row.status not in ('scheduled', 'scorer_request')
    or coalesce(match_row.timer_status, 'not_started') <> 'not_started'
    or coalesce(match_row.timer_elapsed_seconds, 0) <> 0
    or match_row.timer_started_at is not null
    or match_row.phase_started_at is not null then
    raise exception 'This match is not in the Ready state. Use the existing clock controls.';
  end if;

  start_result := public.set_match_day_timer_state(match_row.id, 'start');
  return start_result || jsonb_build_object('alreadyStarted', false);
end;
$function$
;


CREATE OR REPLACE FUNCTION public.record_match_day_shootout_kick(match_day_id_value uuid, team_side_value text, outcome_value text, player_name_value text DEFAULT ''::text, notes_value text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  match_row public.match_days%rowtype;
  kick_row public.match_day_shootout_kicks%rowtype;
  actor_user_id uuid := auth.uid();
  actor_name text := '';
  actor_role text := '';
  actor_parent_link_id uuid;
  normalized_team_side text := lower(trim(coalesce(team_side_value, '')));
  normalized_outcome text := lower(trim(coalesce(outcome_value, '')));
  normalized_player_name text := trim(coalesce(player_name_value, ''));
  normalized_notes text := trim(coalesce(notes_value, ''));
  next_home_score integer;
  next_away_score integer;
  next_kick_number integer;
  is_staff_actor boolean := false;
  is_scorer_actor boolean := false;
begin
  if actor_user_id is null and not private.is_guest_match_scorer(match_day_id_value) then
    raise exception 'Login is required before recording a shootout kick.';
  end if;
  if normalized_team_side not in ('club', 'opponent') then
    raise exception 'Choose our team or the opponent for this shootout kick.';
  end if;
  if normalized_outcome not in ('scored', 'missed') then
    raise exception 'Choose scored or missed for this shootout kick.';
  end if;
  if char_length(normalized_player_name) > 160 or char_length(normalized_notes) > 240 then
    raise exception 'Keep the shootout player and note details concise.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;
  if match_row.concluded_at is not null or match_row.current_match_phase <> 'penalties' or match_row.status <> 'penalties' then
    raise exception 'Shootout kicks can only be recorded during the active penalty shootout.';
  end if;
  if public.match_day_shootout_can_finish(match_row.id) then
    raise exception 'The penalty shootout already has a decisive result.';
  end if;

  is_staff_actor := public.can_manage_match_day(match_row.team_id)
    and (public.current_user_role() = 'super_admin' or match_row.club_id = public.current_user_club_id());
  is_scorer_actor := public.current_user_is_match_day_scorer(match_row.id);
  if not is_staff_actor and not is_scorer_actor then
    raise exception 'Current coach, manager, or selected scorer access is required to record a shootout kick.';
  end if;

  if is_scorer_actor then
    select assignment.parent_link_id
    into actor_parent_link_id
    from public.match_day_role_assignments assignment
    where assignment.match_day_id = match_row.id
      and assignment.role = 'scorer'
      and assignment.auth_user_id = actor_user_id
      and assignment.club_id = match_row.club_id
      and assignment.team_id = match_row.team_id
    limit 1;
    actor_role := 'scorer_parent';
  else
    actor_role := coalesce(nullif(public.current_user_role(), ''), 'staff');
  end if;

  actor_name := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), 'Match Day operator');
  if private.is_guest_match_scorer(match_row.id) then
    actor_name := private.guest_match_scorer_name(match_row.id);
    actor_role := 'scorer_guest';
  end if;
  next_home_score := match_row.home_shootout_score;
  next_away_score := match_row.away_shootout_score;

  if normalized_outcome = 'scored' then
    if (normalized_team_side = 'club' and match_row.home_away <> 'away')
      or (normalized_team_side = 'opponent' and match_row.home_away = 'away') then
      next_home_score := next_home_score + 1;
    else
      next_away_score := next_away_score + 1;
    end if;
  end if;

  select count(*)::integer + 1
  into next_kick_number
  from public.match_day_shootout_kicks kick
  where kick.match_day_id = match_row.id
    and kick.team_side = normalized_team_side
    and kick.event_status = 'active';

  insert into public.match_day_shootout_kicks (
    match_day_id, club_id, team_id, team_side, outcome, kick_number,
    player_name, notes, home_shootout_score, away_shootout_score,
    created_by, created_by_parent_link_id, created_by_name
  ) values (
    match_row.id, match_row.club_id, match_row.team_id, normalized_team_side, normalized_outcome,
    next_kick_number, normalized_player_name, normalized_notes, next_home_score, next_away_score,
    actor_user_id, actor_parent_link_id, actor_name
  ) returning * into kick_row;

  update public.match_days
  set home_shootout_score = next_home_score,
      away_shootout_score = next_away_score,
      shootout_winner = null,
      updated_at = now()
  where id = match_row.id;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id, match_row.team_id, match_row.id, actor_user_id, actor_name,
    actor_role, 'match_day_updated', 'Shootout kick recorded',
    jsonb_build_object('homeShootoutScore', match_row.home_shootout_score, 'awayShootoutScore', match_row.away_shootout_score),
    jsonb_build_object('homeShootoutScore', next_home_score, 'awayShootoutScore', next_away_score),
    jsonb_build_object('shootoutKickId', kick_row.id, 'teamSide', normalized_team_side, 'outcome', normalized_outcome, 'source', 'match_day_shootout_rpc')
  );

  return jsonb_build_object(
    'id', kick_row.id,
    'matchDayId', kick_row.match_day_id,
    'teamSide', kick_row.team_side,
    'outcome', kick_row.outcome,
    'kickNumber', kick_row.kick_number,
    'playerName', kick_row.player_name,
    'notes', kick_row.notes,
    'homeShootoutScore', next_home_score,
    'awayShootoutScore', next_away_score,
    'createdByName', kick_row.created_by_name,
    'createdAt', kick_row.created_at
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.void_match_day_event(match_day_id_value uuid, event_id_value uuid, reason_code_value text, note_value text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if actor_user_id is null and not private.is_guest_match_scorer(match_day_id_value) then
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

  if not private.is_guest_match_scorer(match_row.id) then
  if not public.can_manage_match_day(match_row.team_id)
    or (
      public.current_user_role() <> 'super_admin'
      and match_row.club_id <> public.current_user_club_id()
    ) then
    raise exception 'Coach or manager access is required to void this event.';
  end if;
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
  if private.is_guest_match_scorer(match_row.id) then
    actor_name := private.guest_match_scorer_name(match_row.id);
    actor_role := 'scorer_guest';
  end if;

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
$function$
;

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

alter table public.match_day_guest_commands add column notification_claimed_at timestamptz, add column notification_sent_at timestamptz;
create or replace function public.claim_guest_match_notification(token_hash text, request_id_value uuid, completed boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.match_day_guest_sessions%rowtype; c public.match_day_guest_commands%rowtype; event_id uuid;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Guest gateway access required.'; end if;
  select * into s from public.match_day_guest_sessions where session_hash=token_hash and status='approved' and expires_at>now();
  if s.id is null then return null; end if;
  select * into c from public.match_day_guest_commands where session_id=s.id and request_id=request_id_value for update;
  if c.request_id is null or c.notification_sent_at is not null then return null; end if;
  if completed then
    update public.match_day_guest_commands set notification_sent_at=now() where session_id=s.id and request_id=request_id_value;
    return null;
  end if;
  if c.notification_claimed_at>now()-interval '45 seconds' then return jsonb_build_object('pending',true); end if;
  update public.match_day_guest_commands set notification_claimed_at=now() where session_id=s.id and request_id=request_id_value;
  select id into event_id from public.match_day_events where match_day_id=s.match_day_id and request_id=request_id_value;
  return jsonb_build_object('matchId',s.match_day_id,'action',c.action,'details',c.input,'eventId',event_id);
end;
$$;
revoke all on function public.claim_guest_match_notification(text,uuid,boolean) from public, anon, authenticated;
grant execute on function public.claim_guest_match_notification(text,uuid,boolean) to service_role;
