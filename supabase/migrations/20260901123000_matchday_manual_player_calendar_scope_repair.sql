create or replace function public.get_parent_portal_match_days(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  team_name text,
  opponent text,
  fixture_type text,
  match_date date,
  kickoff_time time,
  kickoff_time_tbc boolean,
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
  timer_started_at timestamptz,
  timer_paused_at timestamptz,
  timer_elapsed_seconds integer,
  timer_status text,
  availability_status text,
  availability_responded_at timestamptz,
  squad_decision_state text,
  squad_decision_updated_at timestamptz,
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
set search_path = ''
as $$
  with authorised_link as (
    select link.*
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = (select auth.uid())
      and link.status = 'active'
    limit 1
  ), legacy as (
    select legacy_row.*, fixture.fixture_type
    from public.get_parent_portal_match_days_calendar_notify_hotfix_legacy(parent_link_id_value) legacy_row
    join public.match_days fixture on fixture.id = legacy_row.id
    where fixture.deleted_at is null
  )
  select
    legacy.id, legacy.club_id, legacy.team_id, legacy.team_name, legacy.opponent, legacy.fixture_type,
    legacy.match_date, legacy.kickoff_time, legacy.kickoff_time_tbc, legacy.arrival_time, legacy.home_away,
    legacy.venue_name, legacy.venue_address, legacy.notes, legacy.scorer_request_message,
    legacy.request_scorer, legacy.request_linesman, legacy.request_referee, legacy.status,
    legacy.home_score, legacy.away_score, legacy.created_at, legacy.updated_at, legacy.phase_started_at,
    legacy.timer_started_at, legacy.timer_paused_at, legacy.timer_elapsed_seconds, legacy.timer_status,
    legacy.availability_status, legacy.availability_responded_at, legacy.squad_decision_state,
    legacy.squad_decision_updated_at, legacy.volunteer_scorer_response, legacy.volunteer_linesman_response,
    legacy.volunteer_referee_response, legacy.volunteer_responded_at, legacy.has_interest,
    legacy.is_scorer, legacy.role_assignments, legacy.events
  from legacy
  union all
  select
    fixture.id, fixture.club_id, fixture.team_id, coalesce(team.name, ''), fixture.opponent, fixture.fixture_type,
    fixture.match_date, fixture.kickoff_time, fixture.kickoff_time_tbc, fixture.arrival_time, fixture.home_away,
    fixture.venue_name, fixture.venue_address, fixture.notes, fixture.scorer_request_message,
    fixture.request_scorer, fixture.request_linesman, fixture.request_referee, fixture.status,
    fixture.home_score, fixture.away_score, fixture.created_at, fixture.updated_at, fixture.phase_started_at,
    fixture.timer_started_at, fixture.timer_paused_at, fixture.timer_elapsed_seconds, fixture.timer_status,
    null::text, null::timestamptz, coalesce(decision.status, 'undecided'), decision.updated_at,
    'no_response'::text, 'no_response'::text, 'no_response'::text, null::timestamptz,
    false, false, '[]'::jsonb,
    coalesce((
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
        ) order by event.created_at desc
      )
      from public.match_day_events event
      where event.match_day_id = fixture.id
    ), '[]'::jsonb)
  from public.match_days fixture
  join authorised_link link
    on link.club_id = fixture.club_id
    and link.team_id = fixture.team_id
  join public.teams team on team.id = fixture.team_id
  join public.calendar_event_invites invite
    on invite.match_day_id = fixture.id
    and invite.club_id = fixture.club_id
    and invite.team_id = fixture.team_id
    and invite.player_id = link.player_id
    and invite.invite_status <> 'cancelled'
  left join public.match_day_player_squad_decisions decision
    on decision.match_day_id = fixture.id
    and decision.club_id = fixture.club_id
    and decision.team_id = fixture.team_id
    and decision.player_id = link.player_id
  where fixture.deleted_at is null
    and fixture.parent_visible is true
    and fixture.parent_audience = 'involved_players'
    and fixture.status in ('scorer_request', 'live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time', 'scheduled')
    and fixture.previous_hidden_at is null
    and (fixture.match_date is null or fixture.match_date >= (timezone('Europe/London', now())::date - 365))
    and not exists (select 1 from legacy where legacy.id = fixture.id)
  order by match_date asc nulls last, kickoff_time asc nulls last, created_at desc;
$$;

revoke all on function public.get_parent_portal_match_days(uuid) from public;
revoke execute on function public.get_parent_portal_match_days(uuid) from anon;
grant execute on function public.get_parent_portal_match_days(uuid) to authenticated;
grant execute on function public.get_parent_portal_match_days(uuid) to service_role;

comment on function public.get_parent_portal_match_days(uuid) is
  'Returns authorised Match Day items for an active linked Player when their Calendar participant scope is active, independently of whether an availability invitation was requested.';
