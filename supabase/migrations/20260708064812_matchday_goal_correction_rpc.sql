alter table public.match_day_events
  add column if not exists event_status text not null default 'active',
  add column if not exists corrected_at timestamptz,
  add column if not exists corrected_by uuid references auth.users (id) on delete set null,
  add column if not exists corrected_by_parent_link_id uuid references public.parent_player_links (id) on delete set null,
  add column if not exists corrected_by_name text not null default '',
  add column if not exists correction_reason text not null default '',
  add column if not exists correction_metadata jsonb not null default '{}'::jsonb,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users (id) on delete set null,
  add column if not exists voided_by_parent_link_id uuid references public.parent_player_links (id) on delete set null,
  add column if not exists voided_by_name text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'match_day_events_event_status_check'
      and conrelid = 'public.match_day_events'::regclass
  ) then
    alter table public.match_day_events
      add constraint match_day_events_event_status_check
      check (event_status in ('active', 'corrected', 'voided'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'match_day_events_correction_metadata_object_check'
      and conrelid = 'public.match_day_events'::regclass
  ) then
    alter table public.match_day_events
      add constraint match_day_events_correction_metadata_object_check
      check (jsonb_typeof(correction_metadata) = 'object');
  end if;
end;
$$;

create index if not exists match_day_events_goal_correction_idx
on public.match_day_events (match_day_id, event_type, event_status, created_at desc);

create or replace function public.correct_match_day_goal(
  match_day_id_value uuid,
  goal_event_id_value uuid,
  parent_link_id_value uuid default null,
  team_side_value text default null,
  scorer_name_value text default null,
  scorer_shirt_number_value text default '',
  assist_name_value text default '',
  assist_shirt_number_value text default '',
  minute_value integer default null,
  notes_value text default '',
  correction_reason_value text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.match_days%rowtype;
  event_row public.match_day_events%rowtype;
  link_row public.parent_player_links%rowtype;
  actor_user_id uuid := auth.uid();
  actor_name text := '';
  actor_role text := '';
  normalized_team_side text;
  next_home_score integer;
  next_away_score integer;
  previous_event jsonb;
  next_event jsonb;
begin
  if actor_user_id is null then
    raise exception 'Login is required before correcting a goal.';
  end if;

  if minute_value is not null and (minute_value < 0 or minute_value > 130) then
    raise exception 'Minute must be between 0 and 130.';
  end if;

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null then
    raise exception 'This match day could not be found.';
  end if;

  if parent_link_id_value is null then
    if not public.can_manage_match_day(match_row.team_id)
      or (
        public.current_user_role() <> 'super_admin'
        and match_row.club_id <> public.current_user_club_id()
      ) then
      raise exception 'Coach or manager access is required to correct this goal.';
    end if;

    actor_name := coalesce(nullif(auth.jwt() ->> 'email', ''), '');
    actor_role := coalesce(nullif(public.current_user_role(), ''), 'staff');
  else
    select *
    into link_row
    from public.parent_player_links
    where id = parent_link_id_value
      and auth_user_id = actor_user_id
      and status = 'active'
      and club_id = match_row.club_id
      and (
        match_row.team_id is null
        or team_id = match_row.team_id
      )
    limit 1;

    if link_row.id is null then
      raise exception 'This parent portal link could not be opened.';
    end if;

    if not exists (
      select 1
      from public.match_day_scorer_assignments assignment
      where assignment.match_day_id = match_row.id
        and assignment.parent_link_id = link_row.id
        and assignment.auth_user_id = actor_user_id
    ) then
      raise exception 'Only selected scorers can correct this match.';
    end if;

    actor_name := coalesce(nullif(auth.jwt() ->> 'email', ''), link_row.email, '');
    actor_role := 'scorer_parent';
  end if;

  select *
  into event_row
  from public.match_day_events
  where id = goal_event_id_value
    and match_day_id = match_row.id
    and club_id = match_row.club_id
    and (
      match_row.team_id is null
      or team_id = match_row.team_id
    )
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
  else
    if match_row.home_away = 'away' then
      next_home_score := next_home_score - 1;
    else
      next_away_score := next_away_score - 1;
    end if;
  end if;

  if normalized_team_side = 'club' then
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

  if next_home_score < 0 or next_away_score < 0 then
    raise exception 'Goal correction would make the score negative.';
  end if;

  previous_event := jsonb_build_object(
    'id', event_row.id,
    'eventType', event_row.event_type,
    'teamSide', event_row.team_side,
    'minute', event_row.minute,
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
  set
    home_score = next_home_score,
    away_score = next_away_score,
    updated_at = timezone('utc', now())
  where id = match_row.id;

  update public.match_day_events
  set
    team_side = normalized_team_side,
    minute = minute_value,
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
    corrected_at = timezone('utc', now()),
    corrected_by = actor_user_id,
    corrected_by_parent_link_id = link_row.id,
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
    'scorer_updated',
    'Goal corrected',
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
      'goalEventId', event_row.id,
      'correctionAction', 'corrected',
      'actorType', actor_role,
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
$$;

create or replace function public.void_match_day_goal(
  match_day_id_value uuid,
  goal_event_id_value uuid,
  parent_link_id_value uuid default null,
  reason_value text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.match_days%rowtype;
  event_row public.match_day_events%rowtype;
  link_row public.parent_player_links%rowtype;
  actor_user_id uuid := auth.uid();
  actor_name text := '';
  actor_role text := '';
  next_home_score integer;
  next_away_score integer;
  previous_event jsonb;
  next_event jsonb;
begin
  if actor_user_id is null then
    raise exception 'Login is required before removing a goal.';
  end if;

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null then
    raise exception 'This match day could not be found.';
  end if;

  if parent_link_id_value is null then
    if not public.can_manage_match_day(match_row.team_id)
      or (
        public.current_user_role() <> 'super_admin'
        and match_row.club_id <> public.current_user_club_id()
      ) then
      raise exception 'Coach or manager access is required to remove this goal.';
    end if;

    actor_name := coalesce(nullif(auth.jwt() ->> 'email', ''), '');
    actor_role := coalesce(nullif(public.current_user_role(), ''), 'staff');
  else
    select *
    into link_row
    from public.parent_player_links
    where id = parent_link_id_value
      and auth_user_id = actor_user_id
      and status = 'active'
      and club_id = match_row.club_id
      and (
        match_row.team_id is null
        or team_id = match_row.team_id
      )
    limit 1;

    if link_row.id is null then
      raise exception 'This parent portal link could not be opened.';
    end if;

    if not exists (
      select 1
      from public.match_day_scorer_assignments assignment
      where assignment.match_day_id = match_row.id
        and assignment.parent_link_id = link_row.id
        and assignment.auth_user_id = actor_user_id
    ) then
      raise exception 'Only selected scorers can remove this goal.';
    end if;

    actor_name := coalesce(nullif(auth.jwt() ->> 'email', ''), link_row.email, '');
    actor_role := 'scorer_parent';
  end if;

  select *
  into event_row
  from public.match_day_events
  where id = goal_event_id_value
    and match_day_id = match_row.id
    and club_id = match_row.club_id
    and (
      match_row.team_id is null
      or team_id = match_row.team_id
    )
  for update;

  if event_row.id is null then
    raise exception 'This goal event could not be found for this match.';
  end if;

  if event_row.event_type <> 'goal' then
    raise exception 'Only goal events can be removed.';
  end if;

  if event_row.event_status = 'voided' then
    raise exception 'This goal has already been removed.';
  end if;

  next_home_score := greatest(coalesce(match_row.home_score, 0), 0);
  next_away_score := greatest(coalesce(match_row.away_score, 0), 0);

  if event_row.team_side = 'club' then
    if match_row.home_away = 'away' then
      next_away_score := next_away_score - 1;
    else
      next_home_score := next_home_score - 1;
    end if;
  else
    if match_row.home_away = 'away' then
      next_home_score := next_home_score - 1;
    else
      next_away_score := next_away_score - 1;
    end if;
  end if;

  if next_home_score < 0 or next_away_score < 0 then
    raise exception 'Goal removal would make the score negative.';
  end if;

  previous_event := jsonb_build_object(
    'id', event_row.id,
    'eventType', event_row.event_type,
    'teamSide', event_row.team_side,
    'minute', event_row.minute,
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
  set
    home_score = next_home_score,
    away_score = next_away_score,
    updated_at = timezone('utc', now())
  where id = match_row.id;

  update public.match_day_events
  set
    home_score = next_home_score,
    away_score = next_away_score,
    event_status = 'voided',
    voided_at = timezone('utc', now()),
    voided_by = actor_user_id,
    voided_by_parent_link_id = link_row.id,
    voided_by_name = actor_name,
    correction_reason = trim(coalesce(reason_value, '')),
    correction_metadata = jsonb_build_object(
      'action', 'voided',
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
    'voidedAt', voided_at,
    'voidedByName', voided_by_name,
    'correctionReason', correction_reason,
    'createdByName', created_by_name,
    'createdAt', created_at
  ) into next_event;

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
    'scorer_updated',
    'Goal removed',
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
      'goalEventId', event_row.id,
      'correctionAction', 'voided',
      'actorType', actor_role,
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
$$;

revoke all on function public.correct_match_day_goal(uuid, uuid, uuid, text, text, text, text, text, integer, text, text) from public;
revoke execute on function public.correct_match_day_goal(uuid, uuid, uuid, text, text, text, text, text, integer, text, text) from anon;
grant execute on function public.correct_match_day_goal(uuid, uuid, uuid, text, text, text, text, text, integer, text, text) to authenticated;
grant execute on function public.correct_match_day_goal(uuid, uuid, uuid, text, text, text, text, text, integer, text, text) to service_role;

revoke all on function public.void_match_day_goal(uuid, uuid, uuid, text) from public;
revoke execute on function public.void_match_day_goal(uuid, uuid, uuid, text) from anon;
grant execute on function public.void_match_day_goal(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.void_match_day_goal(uuid, uuid, uuid, text) to service_role;

drop function if exists public.get_parent_portal_match_days(uuid);

create or replace function public.get_parent_portal_match_days(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  team_name text,
  opponent text,
  match_date date,
  kickoff_time time,
  arrival_time time,
  home_away text,
  venue_name text,
  venue_address text,
  notes text,
  scorer_request_message text,
  request_scorer boolean,
  request_linesman boolean,
  request_referee boolean,
  status text,
  home_score integer,
  away_score integer,
  created_at timestamptz,
  updated_at timestamptz,
  phase_started_at timestamptz,
  availability_status text,
  availability_responded_at timestamptz,
  volunteer_scorer_response text,
  volunteer_linesman_response text,
  volunteer_referee_response text,
  volunteer_responded_at timestamptz,
  has_interest boolean,
  is_scorer boolean,
  role_assignments jsonb,
  events jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with parent_link as (
    select *
    from public.parent_player_links
    where id = parent_link_id_value
      and auth_user_id = auth.uid()
      and status = 'active'
    limit 1
  )
  select
    match_day.id,
    match_day.club_id,
    match_day.team_id,
    coalesce(team.name, '') as team_name,
    match_day.opponent,
    match_day.match_date,
    match_day.kickoff_time,
    match_day.arrival_time,
    match_day.home_away,
    match_day.venue_name,
    match_day.venue_address,
    match_day.notes,
    match_day.scorer_request_message,
    match_day.request_scorer,
    match_day.request_linesman,
    match_day.request_referee,
    match_day.status,
    match_day.home_score,
    match_day.away_score,
    match_day.created_at,
    match_day.updated_at,
    match_day.phase_started_at,
    coalesce(current_availability.status, availability.status) as availability_status,
    coalesce(current_availability.selected_at, availability.responded_at) as availability_responded_at,
    coalesce(availability.volunteer_scorer_response, 'no_response') as volunteer_scorer_response,
    coalesce(availability.volunteer_linesman_response, 'no_response') as volunteer_linesman_response,
    coalesce(availability.volunteer_referee_response, 'no_response') as volunteer_referee_response,
    availability.volunteer_responded_at,
    exists (
      select 1
      from public.match_day_scorer_interest interest
      where interest.match_day_id = match_day.id
        and interest.parent_link_id = parent_link_id_value
        and interest.status <> 'declined'
    ) as has_interest,
    exists (
      select 1
      from public.match_day_scorer_assignments assignment
      where assignment.match_day_id = match_day.id
        and assignment.parent_link_id = parent_link_id_value
        and assignment.auth_user_id = auth.uid()
    ) as is_scorer,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', assignment.id,
            'matchDayId', assignment.match_day_id,
            'role', assignment.role,
            'parentLinkId', assignment.parent_link_id,
            'authUserId', assignment.auth_user_id,
            'parentEmail', case when assignment.parent_link_id = parent_link_id_value then coalesce(assignment_link.email, '') else '' end,
            'playerName', case when assignment.parent_link_id = parent_link_id_value then coalesce(assignment_player.player_name, '') else '' end,
            'isCurrentParent', assignment.parent_link_id = parent_link_id_value,
            'assignedByName', assignment.assigned_by_name,
            'createdAt', assignment.created_at,
            'updatedAt', assignment.updated_at
          )
          order by assignment.role
        )
        from public.match_day_role_assignments assignment
        left join public.parent_player_links assignment_link
          on assignment_link.id = assignment.parent_link_id
        left join public.players assignment_player
          on assignment_player.id = assignment_link.player_id
        where assignment.match_day_id = match_day.id
      ),
      '[]'::jsonb
    ) as role_assignments,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', event.id,
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
            'createdByName', event.created_by_name,
            'createdAt', event.created_at
          )
          order by event.created_at desc
        )
        from public.match_day_events event
        where event.match_day_id = match_day.id
      ),
      '[]'::jsonb
    ) as events
  from public.match_days match_day
  join parent_link link
    on link.club_id = match_day.club_id
  left join public.teams team
    on team.id = match_day.team_id
  left join public.match_day_player_availability current_availability
    on current_availability.match_day_id = match_day.id
    and current_availability.player_id = link.player_id
  left join lateral (
    select request.*
    from public.match_day_availability_requests request
    where request.match_day_id = match_day.id
      and request.club_id = link.club_id
      and request.player_id = link.player_id
      and request.status <> 'expired'
      and (
        request.parent_link_id = link.id
        or lower(request.recipient_email) = lower(coalesce(link.email, ''))
      )
    order by request.updated_at desc, request.created_at desc
    limit 1
  ) availability on true
  where auth.uid() is not null
    and match_day.parent_visible is true
    and match_day.parent_audience <> 'none'
    and match_day.status in ('scorer_request', 'live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time', 'scheduled')
    and match_day.previous_hidden_at is null
    and (
      (
        match_day.parent_audience = 'involved_players'
        and exists (
          select 1
          from public.match_day_availability_requests request
          where request.match_day_id = match_day.id
            and request.club_id = link.club_id
            and request.player_id = link.player_id
            and request.status <> 'expired'
        )
      )
      or (
        match_day.parent_audience = 'all_team_parents'
        and match_day.team_id is not null
        and match_day.team_id = link.team_id
      )
      or (
        match_day.parent_audience = 'all_club_parents'
        and match_day.club_id = link.club_id
      )
    )
    and (
      match_day.match_date is null
      or match_day.match_date >= (timezone('Europe/London', now())::date - 365)
    )
  order by match_day.match_date asc nulls last, match_day.kickoff_time asc nulls last, match_day.created_at desc;
$$;

revoke all on function public.get_parent_portal_match_days(uuid) from public;
revoke execute on function public.get_parent_portal_match_days(uuid) from anon;

grant execute on function public.get_parent_portal_match_days(uuid) to authenticated;
grant execute on function public.get_parent_portal_match_days(uuid) to service_role;
