alter table public.match_days
drop constraint if exists match_days_status_check;

alter table public.match_days
add constraint match_days_status_check
check (status in ('scheduled', 'scorer_request', 'live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time', 'postponed', 'cancelled'));

create or replace function public.get_parent_portal_match_days(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  team_name text,
  opponent text,
  match_date date,
  kickoff_time time,
  home_away text,
  venue_name text,
  venue_address text,
  notes text,
  scorer_request_message text,
  status text,
  home_score integer,
  away_score integer,
  created_at timestamptz,
  updated_at timestamptz,
  has_interest boolean,
  is_scorer boolean,
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
    match_day.home_away,
    match_day.venue_name,
    match_day.venue_address,
    match_day.notes,
    match_day.scorer_request_message,
    match_day.status,
    match_day.home_score,
    match_day.away_score,
    match_day.created_at,
    match_day.updated_at,
    exists (
      select 1
      from public.match_day_scorer_interest interest
      where interest.match_day_id = match_day.id
        and interest.parent_link_id = parent_link_id_value
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
    and (match_day.team_id is null or match_day.team_id = link.team_id)
  left join public.teams team
    on team.id = match_day.team_id
  where auth.uid() is not null
    and match_day.status in ('scorer_request', 'live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time', 'scheduled')
    and match_day.previous_hidden_at is null
    and (
      match_day.match_date is null
      or match_day.match_date >= (timezone('Europe/London', now())::date - 365)
    )
  order by match_day.match_date asc nulls last, match_day.kickoff_time asc nulls last, match_day.created_at desc;
$$;

grant execute on function public.get_parent_portal_match_days(uuid) to authenticated;

create or replace function public.update_match_day_score_as_scorer(
  parent_link_id_value uuid,
  match_day_id_value uuid,
  home_score_value integer,
  away_score_value integer,
  status_value text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_player_links%rowtype;
  match_row public.match_days%rowtype;
  next_status text;
  event_id_value uuid;
begin
  if auth.uid() is null then
    raise exception 'Login is required before updating the match.';
  end if;

  select *
  into link_row
  from public.parent_player_links
  where id = parent_link_id_value
    and auth_user_id = auth.uid()
    and status = 'active'
  limit 1;

  if link_row.id is null then
    raise exception 'This parent portal link could not be opened.';
  end if;

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value
    and club_id = link_row.club_id
    and (team_id is null or team_id = link_row.team_id)
    and exists (
      select 1
      from public.match_day_scorer_assignments assignment
      where assignment.match_day_id = match_day_id_value
        and assignment.parent_link_id = parent_link_id_value
        and assignment.auth_user_id = auth.uid()
    )
  limit 1;

  if match_row.id is null then
    raise exception 'Only selected scorers can update this match.';
  end if;

  next_status := coalesce(nullif(status_value, ''), match_row.status);

  if next_status not in ('scheduled', 'scorer_request', 'live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time', 'postponed', 'cancelled') then
    next_status := match_row.status;
  end if;

  update public.match_days
  set
    home_score = greatest(coalesce(home_score_value, 0), 0),
    away_score = greatest(coalesce(away_score_value, 0), 0),
    status = next_status,
    updated_at = now()
  where id = match_row.id;

  insert into public.match_day_events (
    match_day_id,
    club_id,
    team_id,
    event_type,
    team_side,
    home_score,
    away_score,
    notes,
    created_by,
    created_by_parent_link_id,
    created_by_name
  )
  values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    'score_correction',
    'club',
    greatest(coalesce(home_score_value, 0), 0),
    greatest(coalesce(away_score_value, 0), 0),
    'Score updated by parent scorer',
    auth.uid(),
    parent_link_id_value,
    coalesce(link_row.email, 'Parent scorer')
  )
  returning id into event_id_value;

  return event_id_value;
end;
$$;

grant execute on function public.update_match_day_score_as_scorer(uuid, uuid, integer, integer, text) to authenticated;
