create table if not exists public.match_day_player_squad_decisions (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null references public.match_days (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  status text not null default 'undecided',
  decided_by uuid references auth.users (id) on delete set null,
  decided_by_name text not null default '',
  decided_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint match_day_player_squad_decisions_status_check
    check (status in ('undecided', 'waiting', 'selected', 'not_selected')),
  constraint match_day_player_squad_decisions_match_player_key
    unique (match_day_id, player_id)
);

create index if not exists match_day_player_squad_decisions_team_status_idx
on public.match_day_player_squad_decisions (club_id, team_id, status);

create index if not exists match_day_player_squad_decisions_player_idx
on public.match_day_player_squad_decisions (player_id, match_day_id);

alter table public.match_day_player_squad_decisions enable row level security;
alter table public.match_day_player_squad_decisions force row level security;

revoke all on public.match_day_player_squad_decisions from public;
revoke all on public.match_day_player_squad_decisions from anon;
revoke all on public.match_day_player_squad_decisions from authenticated;

grant select on public.match_day_player_squad_decisions to authenticated;
grant select, insert, update, delete on public.match_day_player_squad_decisions to service_role;

drop policy if exists match_day_player_squad_decisions_staff_select_scoped
on public.match_day_player_squad_decisions;

create policy match_day_player_squad_decisions_staff_select_scoped
on public.match_day_player_squad_decisions
for select
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
  and exists (
    select 1
    from public.users staff
    where staff.id = (select auth.uid())
      and staff.club_id = match_day_player_squad_decisions.club_id
      and coalesce(staff.status, 'active') = 'active'
      and staff.role not in ('parent_portal', 'super_admin')
      and coalesce(staff.role_rank, 0) >= 20
  )
  and exists (
    select 1
    from public.match_days match_day
    where match_day.id = match_day_player_squad_decisions.match_day_id
      and match_day.club_id = match_day_player_squad_decisions.club_id
      and match_day.team_id = match_day_player_squad_decisions.team_id
  )
);

alter table public.match_day_event_log
  drop constraint if exists match_day_event_log_event_type_check;

alter table public.match_day_event_log
  add constraint match_day_event_log_event_type_check check (
    event_type in (
      'match_day_created',
      'match_day_updated',
      'player_selected',
      'player_deselected',
      'player_availability_changed',
      'player_squad_decision_changed',
      'match_role_assigned',
      'match_role_removed',
      'scorer_updated',
      'linesman_updated',
      'invite_prepared',
      'invite_queued',
      'note_updated',
      'yellow_card',
      'red_card',
      'substitution',
      'water_break'
    )
  );

create or replace function public.set_match_day_player_squad_decision(
  match_day_id_value uuid,
  player_id_value uuid,
  decision_value text
)
returns table (
  id uuid,
  match_day_id uuid,
  club_id uuid,
  team_id uuid,
  player_id uuid,
  status text,
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_decision text := lower(trim(coalesce(decision_value, '')));
  actor_row public.users%rowtype;
  match_row public.match_days%rowtype;
  player_row public.players%rowtype;
  availability_row public.match_day_player_availability%rowtype;
  previous_row public.match_day_player_squad_decisions%rowtype;
  saved_row public.match_day_player_squad_decisions%rowtype;
  actor_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'Login is required.';
  end if;

  if normalized_decision not in ('undecided', 'waiting', 'selected', 'not_selected') then
    raise exception 'Choose Selected, Waiting, Not selected, or Undecided.';
  end if;

  select staff.*
  into actor_row
  from public.users staff
  where staff.id = (select auth.uid())
    and coalesce(staff.status, 'active') = 'active'
  limit 1;

  if actor_row.id is null
    or actor_row.club_id is null
    or actor_row.role in ('parent_portal', 'super_admin')
    or coalesce(actor_row.role_rank, 0) < 20 then
    raise exception 'Only active authorised team staff can change squad decisions.';
  end if;

  select fixture.*
  into match_row
  from public.match_days fixture
  where fixture.id = match_day_id_value
  limit 1;

  if match_row.id is null then
    raise exception 'Fixture not found.';
  end if;

  if match_row.club_id <> actor_row.club_id then
    raise exception 'This fixture is outside your club.';
  end if;

  if match_row.team_id is null or not public.can_manage_match_day(match_row.team_id) then
    raise exception 'You are not authorised for this fixture team.';
  end if;

  if match_row.status not in ('scheduled', 'scorer_request') then
    raise exception 'Squad decisions are locked for this fixture lifecycle.';
  end if;

  if match_row.previous_hidden_at is not null then
    raise exception 'Squad decisions are locked for an archived fixture.';
  end if;

  select player.*
  into player_row
  from public.players player
  where player.id = player_id_value
  limit 1;

  if player_row.id is null
    or player_row.club_id <> match_row.club_id
    or player_row.team_id is distinct from match_row.team_id
    or player_row.section <> 'Squad'
    or coalesce(player_row.status, 'active') = 'archived' then
    raise exception 'This player is not an active squad player for the fixture team.';
  end if;

  select availability.*
  into availability_row
  from public.match_day_player_availability availability
  where availability.match_day_id = match_row.id
    and availability.club_id = match_row.club_id
    and availability.team_id = match_row.team_id
    and availability.player_id = player_row.id
  limit 1;

  if normalized_decision = 'selected'
    and coalesce(availability_row.status, 'pending') <> 'available' then
    raise exception 'Only a player with an Available response can be selected.';
  end if;

  select decision.*
  into previous_row
  from public.match_day_player_squad_decisions decision
  where decision.match_day_id = match_row.id
    and decision.player_id = player_row.id
  limit 1;

  if previous_row.id is not null and previous_row.status = normalized_decision then
    return query
    select
      previous_row.id,
      previous_row.match_day_id,
      previous_row.club_id,
      previous_row.team_id,
      previous_row.player_id,
      previous_row.status,
      previous_row.decided_by,
      previous_row.decided_by_name,
      previous_row.decided_at,
      previous_row.created_at,
      previous_row.updated_at;
    return;
  end if;

  actor_name := coalesce(
    nullif(actor_row.display_name, ''),
    nullif(actor_row.name, ''),
    nullif(actor_row.email, ''),
    'Team staff'
  );

  insert into public.match_day_player_squad_decisions (
    match_day_id,
    club_id,
    team_id,
    player_id,
    status,
    decided_by,
    decided_by_name,
    decided_at,
    updated_at
  )
  values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    player_row.id,
    normalized_decision,
    actor_row.id,
    actor_name,
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict on constraint match_day_player_squad_decisions_match_player_key
  do update
  set status = excluded.status,
      club_id = excluded.club_id,
      team_id = excluded.team_id,
      decided_by = excluded.decided_by,
      decided_by_name = excluded.decided_by_name,
      decided_at = excluded.decided_at,
      updated_at = timezone('utc', now())
  returning *
  into saved_row;

  insert into public.match_day_event_log (
    club_id,
    team_id,
    match_day_id,
    player_id,
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
    saved_row.club_id,
    saved_row.team_id,
    saved_row.match_day_id,
    saved_row.player_id,
    actor_row.id,
    actor_name,
    coalesce(nullif(actor_row.role_label, ''), actor_row.role, ''),
    'player_squad_decision_changed',
    'Player squad decision changed',
    jsonb_build_object('status', coalesce(previous_row.status, 'undecided')),
    jsonb_build_object('status', saved_row.status),
    jsonb_build_object('source', 'staff_match_day_squad_review')
  );

  return query
  select
    saved_row.id,
    saved_row.match_day_id,
    saved_row.club_id,
    saved_row.team_id,
    saved_row.player_id,
    saved_row.status,
    saved_row.decided_by,
    saved_row.decided_by_name,
    saved_row.decided_at,
    saved_row.created_at,
    saved_row.updated_at;
end;
$$;

revoke all on function public.set_match_day_player_squad_decision(uuid, uuid, text) from public;
revoke execute on function public.set_match_day_player_squad_decision(uuid, uuid, text) from anon;
grant execute on function public.set_match_day_player_squad_decision(uuid, uuid, text) to authenticated, service_role;

alter function public.get_parent_portal_match_days(uuid)
  rename to get_parent_portal_match_days_match_selection86_legacy;

revoke all on function public.get_parent_portal_match_days_match_selection86_legacy(uuid) from public;
revoke execute on function public.get_parent_portal_match_days_match_selection86_legacy(uuid) from anon, authenticated;

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
  select
    legacy.id,
    legacy.club_id,
    legacy.team_id,
    legacy.team_name,
    legacy.opponent,
    legacy.match_date,
    legacy.kickoff_time,
    legacy.kickoff_time_tbc,
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
    coalesce(decision.status, 'undecided'),
    decision.updated_at,
    legacy.volunteer_scorer_response,
    legacy.volunteer_linesman_response,
    legacy.volunteer_referee_response,
    legacy.volunteer_responded_at,
    legacy.has_interest,
    legacy.is_scorer,
    legacy.role_assignments,
    legacy.events
  from public.get_parent_portal_match_days_match_selection86_legacy(parent_link_id_value) legacy
  join public.parent_player_links parent_link
    on parent_link.id = parent_link_id_value
    and parent_link.auth_user_id = (select auth.uid())
    and parent_link.status = 'active'
    and parent_link.club_id = legacy.club_id
  left join public.match_day_player_squad_decisions decision
    on decision.match_day_id = legacy.id
    and decision.club_id = legacy.club_id
    and decision.team_id = legacy.team_id
    and decision.player_id = parent_link.player_id;
$$;

revoke all on function public.get_parent_portal_match_days(uuid) from public;
revoke execute on function public.get_parent_portal_match_days(uuid) from anon;
grant execute on function public.get_parent_portal_match_days(uuid) to authenticated, service_role;

alter function public.get_parent_portal_invitation_state(uuid)
  rename to get_parent_portal_invitation_state_match_selection86_legacy;

revoke all on function public.get_parent_portal_invitation_state_match_selection86_legacy(uuid) from public;
revoke execute on function public.get_parent_portal_invitation_state_match_selection86_legacy(uuid) from anon, authenticated;

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
set search_path = ''
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
    legacy.event_date,
    legacy.kickoff_time_tbc,
    legacy.event_start,
    legacy.event_end,
    legacy.event_location,
    legacy.team_name,
    legacy.child_id,
    legacy.child_name,
    legacy.parent_link_id,
    legacy.role_type,
    legacy.invitation_state,
    legacy.response_state,
    case
      when legacy.source_event_type = 'match_day'
        and legacy.invitation_type = 'match_attendance'
        then coalesce(decision.status, 'undecided')
      else legacy.selection_state
    end,
    legacy.can_respond,
    legacy.can_change_response,
    legacy.lock_reason,
    legacy.response_deadline,
    legacy.last_responded_at
  from public.get_parent_portal_invitation_state_match_selection86_legacy(parent_link_id_value) legacy
  left join public.match_day_player_squad_decisions decision
    on legacy.source_event_type = 'match_day'
    and legacy.invitation_type = 'match_attendance'
    and decision.match_day_id = legacy.event_id
    and decision.player_id = legacy.child_id
    and decision.club_id = (
      select parent_link.club_id
      from public.parent_player_links parent_link
      where parent_link.id = parent_link_id_value
        and parent_link.auth_user_id = (select auth.uid())
        and parent_link.status = 'active'
      limit 1
    );
$$;

revoke all on function public.get_parent_portal_invitation_state(uuid) from public;
revoke execute on function public.get_parent_portal_invitation_state(uuid) from anon;
grant execute on function public.get_parent_portal_invitation_state(uuid) to authenticated, service_role;

comment on table public.match_day_player_squad_decisions is
  'Authoritative staff squad decision for one fixture and player. Parent availability remains in match_day_player_availability.';

comment on function public.set_match_day_player_squad_decision(uuid, uuid, text) is
  'Server-authoritative pre-match squad decision action with staff, club, team, player, availability, lifecycle, and audit enforcement.';
