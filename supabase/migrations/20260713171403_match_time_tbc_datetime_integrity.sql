alter table public.match_days
  add column if not exists kickoff_time_tbc boolean not null default false;

alter table public.match_days
  drop constraint if exists match_days_kickoff_time_tbc_integrity_check;

alter table public.match_days
  add constraint match_days_kickoff_time_tbc_integrity_check
  check (
    kickoff_time_tbc is false
    or (
      match_date is not null
      and kickoff_time is null
      and arrival_time is null
    )
  );

comment on column public.match_days.kickoff_time_tbc is
  'Explicit fixture timing state. True preserves the match date while requiring kickoff and arrival times to remain null.';

alter function public.get_parent_portal_match_days(uuid)
  rename to get_parent_portal_match_days_datetime82_legacy;

revoke all on function public.get_parent_portal_match_days_datetime82_legacy(uuid) from public;
revoke execute on function public.get_parent_portal_match_days_datetime82_legacy(uuid) from anon, authenticated;

create function public.get_parent_portal_match_days(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  team_name text,
  opponent text,
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
  select
    legacy.id,
    legacy.club_id,
    legacy.team_id,
    legacy.team_name,
    legacy.opponent,
    legacy.match_date,
    legacy.kickoff_time,
    coalesce(match_day.kickoff_time_tbc, false),
    legacy.arrival_time,
    legacy.home_away,
    legacy.venue_name,
    legacy.venue_address,
    legacy.notes,
    legacy.scorer_request_message,
    legacy.request_scorer,
    legacy.request_linesman,
    legacy.request_referee,
    legacy.status,
    legacy.home_score,
    legacy.away_score,
    legacy.created_at,
    legacy.updated_at,
    legacy.phase_started_at,
    legacy.timer_started_at,
    legacy.timer_paused_at,
    legacy.timer_elapsed_seconds,
    legacy.timer_status,
    legacy.availability_status,
    legacy.availability_responded_at,
    legacy.volunteer_scorer_response,
    legacy.volunteer_linesman_response,
    legacy.volunteer_referee_response,
    legacy.volunteer_responded_at,
    legacy.has_interest,
    legacy.is_scorer,
    legacy.role_assignments,
    legacy.events
  from public.get_parent_portal_match_days_datetime82_legacy(parent_link_id_value) legacy
  join public.match_days match_day
    on match_day.id = legacy.id;
$$;

revoke all on function public.get_parent_portal_match_days(uuid) from public;
revoke execute on function public.get_parent_portal_match_days(uuid) from anon;
grant execute on function public.get_parent_portal_match_days(uuid) to authenticated, service_role;

comment on function public.get_parent_portal_match_days(uuid) is
  'Authenticated parent Match Day read model with explicit kickoff Time TBC state.';

alter function public.get_parent_portal_invitation_state(uuid)
  rename to get_parent_portal_invitation_state_datetime82_legacy;

revoke all on function public.get_parent_portal_invitation_state_datetime82_legacy(uuid) from public;
revoke execute on function public.get_parent_portal_invitation_state_datetime82_legacy(uuid) from anon, authenticated;

create function public.get_parent_portal_invitation_state(parent_link_id_value uuid)
returns table (
  invitation_id text,
  invitation_type text,
  source_record_id uuid,
  source_type text,
  source_event_type text,
  event_id uuid,
  event_type text,
  event_title text,
  event_date date,
  kickoff_time_tbc boolean,
  event_start timestamptz,
  event_end timestamptz,
  event_location text,
  team_name text,
  child_id uuid,
  child_name text,
  parent_link_id uuid,
  role_type text,
  invitation_state text,
  response_state text,
  selection_state text,
  can_respond boolean,
  can_change_response boolean,
  lock_reason text,
  response_deadline timestamptz,
  last_responded_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    legacy.invitation_id,
    legacy.invitation_type,
    legacy.source_record_id,
    legacy.source_type,
    legacy.source_event_type,
    legacy.event_id,
    legacy.event_type,
    legacy.event_title,
    case
      when legacy.source_event_type = 'match_day' then match_day.match_date
      else (legacy.event_start at time zone 'Europe/London')::date
    end,
    case
      when legacy.source_event_type = 'match_day' then coalesce(match_day.kickoff_time_tbc, false)
      else false
    end,
    case
      when coalesce(match_day.kickoff_time_tbc, false) then null
      else legacy.event_start
    end,
    case
      when coalesce(match_day.kickoff_time_tbc, false) then null
      else legacy.event_end
    end,
    legacy.event_location,
    legacy.team_name,
    legacy.child_id,
    legacy.child_name,
    legacy.parent_link_id,
    legacy.role_type,
    legacy.invitation_state,
    legacy.response_state,
    legacy.selection_state,
    legacy.can_respond,
    legacy.can_change_response,
    legacy.lock_reason,
    legacy.response_deadline,
    legacy.last_responded_at
  from public.get_parent_portal_invitation_state_datetime82_legacy(parent_link_id_value) legacy
  left join public.match_days match_day
    on legacy.source_event_type = 'match_day'
    and match_day.id = legacy.event_id;
$$;

revoke all on function public.get_parent_portal_invitation_state(uuid) from public;
revoke execute on function public.get_parent_portal_invitation_state(uuid) from anon;
grant execute on function public.get_parent_portal_invitation_state(uuid) to authenticated, service_role;

comment on function public.get_parent_portal_invitation_state(uuid) is
  'Authenticated parent invitation read model with date-only Match Day state when kickoff is explicitly Time TBC.';

alter function public.get_match_day_availability_response_v2(text)
  rename to get_match_day_availability_response_v2_datetime82_legacy;

revoke all on function public.get_match_day_availability_response_v2_datetime82_legacy(text) from public;
revoke execute on function public.get_match_day_availability_response_v2_datetime82_legacy(text) from anon, authenticated;

create function public.get_match_day_availability_response_v2(token_hash_value text)
returns table (
  request_id uuid,
  player_id uuid,
  player_name text,
  recipient_name text,
  recipient_email text,
  response_status text,
  responded_at timestamptz,
  expires_at timestamptz,
  match_day_id uuid,
  current_availability_status text,
  current_availability_selected_by_name text,
  current_availability_selected_by_email text,
  current_availability_selected_at timestamptz,
  team_name text,
  opponent text,
  match_date date,
  kickoff_time time,
  kickoff_time_tbc boolean,
  arrival_time time,
  venue_name text,
  venue_address text,
  request_scorer boolean,
  request_linesman boolean,
  request_referee boolean,
  volunteer_scorer_response text,
  volunteer_linesman_response text,
  volunteer_referee_response text,
  volunteer_responded_at timestamptz,
  transport_needs_lift boolean,
  transport_can_offer_lift boolean,
  transport_seats_offered integer,
  transport_responded_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    legacy.request_id,
    legacy.player_id,
    legacy.player_name,
    legacy.recipient_name,
    legacy.recipient_email,
    legacy.response_status,
    legacy.responded_at,
    legacy.expires_at,
    legacy.match_day_id,
    legacy.current_availability_status,
    legacy.current_availability_selected_by_name,
    legacy.current_availability_selected_by_email,
    legacy.current_availability_selected_at,
    legacy.team_name,
    legacy.opponent,
    legacy.match_date,
    legacy.kickoff_time,
    coalesce(match_day.kickoff_time_tbc, false),
    legacy.arrival_time,
    legacy.venue_name,
    legacy.venue_address,
    legacy.request_scorer,
    legacy.request_linesman,
    legacy.request_referee,
    legacy.volunteer_scorer_response,
    legacy.volunteer_linesman_response,
    legacy.volunteer_referee_response,
    legacy.volunteer_responded_at,
    legacy.transport_needs_lift,
    legacy.transport_can_offer_lift,
    legacy.transport_seats_offered,
    legacy.transport_responded_at
  from public.get_match_day_availability_response_v2_datetime82_legacy(token_hash_value) legacy
  join public.match_days match_day
    on match_day.id = legacy.match_day_id;
$$;

revoke all on function public.get_match_day_availability_response_v2(text) from public;
grant execute on function public.get_match_day_availability_response_v2(text) to anon, authenticated, service_role;

comment on function public.get_match_day_availability_response_v2(text) is
  'Token-scoped Match Day availability read model with explicit kickoff Time TBC state.';
