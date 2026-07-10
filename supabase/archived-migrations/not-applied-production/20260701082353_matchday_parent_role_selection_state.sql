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
