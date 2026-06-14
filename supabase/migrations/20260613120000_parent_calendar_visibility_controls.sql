alter table public.calendar_events
  add column if not exists parent_visible boolean not null default false,
  add column if not exists parent_audience text not null default 'none';

alter table public.match_days
  add column if not exists parent_visible boolean not null default false,
  add column if not exists parent_audience text not null default 'none';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'calendar_events_parent_audience_check'
  ) then
    alter table public.calendar_events
      add constraint calendar_events_parent_audience_check check (
        parent_audience in ('none', 'involved_players', 'all_team_parents', 'all_club_parents')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'match_days_parent_audience_check'
  ) then
    alter table public.match_days
      add constraint match_days_parent_audience_check check (
        parent_audience in ('none', 'involved_players', 'all_team_parents', 'all_club_parents')
      );
  end if;
end $$;

create index if not exists calendar_events_parent_visible_idx
on public.calendar_events (club_id, team_id, parent_visible, starts_at);

create index if not exists match_days_parent_visible_idx
on public.match_days (club_id, team_id, parent_visible, match_date);

drop policy if exists calendar_event_invites_insert_scoped on public.calendar_event_invites;
create policy calendar_event_invites_insert_scoped
on public.calendar_event_invites
for insert
to authenticated
with check (
  club_id = public.current_user_club_id()
  and created_by = auth.uid()
  and public.current_user_role_rank() >= 20
  and (
    public.current_user_role_rank() >= 50
    or exists (
      select 1
      from public.team_staff ts
      where ts.team_id = calendar_event_invites.team_id
        and ts.user_id = auth.uid()
    )
  )
  and exists (
    select 1
    from public.players p
    where p.id = calendar_event_invites.player_id
      and p.club_id = calendar_event_invites.club_id
      and p.team_id = calendar_event_invites.team_id
  )
  and (
    (
      calendar_event_id is not null
      and exists (
        select 1
        from public.calendar_events event
        where event.id = calendar_event_invites.calendar_event_id
          and event.club_id = calendar_event_invites.club_id
          and (
            event.team_id = calendar_event_invites.team_id
            or (
              event.team_id is null
              and public.current_user_role() = 'admin'
            )
          )
      )
    )
    or (
      assessment_session_id is not null
      and exists (
        select 1
        from public.assessment_sessions session
        where session.id = calendar_event_invites.assessment_session_id
          and session.club_id = calendar_event_invites.club_id
          and session.team_id = calendar_event_invites.team_id
      )
    )
  )
);

create or replace function public.get_parent_portal_shared_calendar_events(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  event_type text,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  notes text,
  parent_audience text
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
  select distinct
    event.id,
    event.club_id,
    event.team_id,
    event.event_type,
    event.title,
    event.starts_at,
    event.ends_at,
    event.location,
    event.notes,
    event.parent_audience
  from public.calendar_events event
  join parent_link link
    on link.club_id = event.club_id
  where auth.uid() is not null
    and event.cancelled_at is null
    and event.parent_visible is true
    and event.parent_audience in ('all_team_parents', 'all_club_parents')
    and (
      (
        event.parent_audience = 'all_team_parents'
        and event.team_id is not null
        and event.team_id = link.team_id
      )
      or (
        event.parent_audience = 'all_club_parents'
        and event.club_id = link.club_id
      )
    )
    and event.starts_at >= (timezone('utc', now()) - interval '1 day')
  order by event.starts_at asc;
$$;

revoke all on function public.get_parent_portal_shared_calendar_events(uuid) from public;
grant execute on function public.get_parent_portal_shared_calendar_events(uuid) to authenticated;

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
  phase_started_at timestamptz,
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
    match_day.phase_started_at,
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
  left join public.teams team
    on team.id = match_day.team_id
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
grant execute on function public.get_parent_portal_match_days(uuid) to authenticated;
