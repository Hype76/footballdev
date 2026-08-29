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
  normalized_decision text := pg_catalog.lower(pg_catalog.btrim(coalesce(decision_value, '')));
  actor_row public.users%rowtype;
  match_row public.match_days%rowtype;
  player_row public.players%rowtype;
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
    or coalesce(player_row.status, 'active') = 'archived' then
    raise exception 'This player is not an active player for the fixture team.';
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
    pg_catalog.timezone('utc', pg_catalog.now()),
    pg_catalog.timezone('utc', pg_catalog.now())
  )
  on conflict on constraint match_day_player_squad_decisions_match_player_key
  do update
  set status = excluded.status,
      club_id = excluded.club_id,
      team_id = excluded.team_id,
      decided_by = excluded.decided_by,
      decided_by_name = excluded.decided_by_name,
      decided_at = excluded.decided_at,
      updated_at = pg_catalog.timezone('utc', pg_catalog.now())
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
    pg_catalog.jsonb_build_object('status', coalesce(previous_row.status, 'undecided')),
    pg_catalog.jsonb_build_object('status', saved_row.status),
    pg_catalog.jsonb_build_object('source', 'game_day_active_team_player_manager')
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

revoke all on function public.set_match_day_player_squad_decision(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.set_match_day_player_squad_decision(uuid, uuid, text)
to service_role;

comment on function public.set_match_day_player_squad_decision(uuid, uuid, text) is
  'Server-authoritative fixture decision for any active same-club and same-team player. Archived and cross-team players remain blocked. Availability and communication remain separate.';

create or replace function public.get_parent_portal_match_transport_states(parent_link_id_value uuid)
returns table (
  request_id uuid,
  match_day_id uuid,
  transport_needs_lift boolean,
  transport_can_offer_lift boolean,
  transport_seats_offered integer,
  transport_responded_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with authorised_link as materialized (
    select link.*
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = (select auth.uid())
      and link.status = 'active'
    limit 1
  )
  select
    request.id,
    request.match_day_id,
    coalesce(request.transport_needs_lift, false),
    coalesce(request.transport_can_offer_lift, false),
    case
      when coalesce(request.transport_can_offer_lift, false)
        then greatest(coalesce(request.transport_seats_offered, 0), 0)
      else 0
    end,
    request.transport_responded_at
  from authorised_link link
  join public.match_day_availability_requests request
    on request.club_id = link.club_id
    and request.team_id = link.team_id
    and request.player_id = link.player_id
    and (
      request.parent_link_id = link.id
      or (
        request.parent_link_id is null
        and coalesce(link.email, '') <> ''
        and pg_catalog.lower(request.recipient_email) = pg_catalog.lower(link.email)
      )
    )
  join public.match_days fixture
    on fixture.id = request.match_day_id
    and fixture.club_id = link.club_id
    and fixture.team_id = link.team_id
    and fixture.deleted_at is null
    and fixture.previous_hidden_at is null
  where request.status <> 'expired'
  order by request.updated_at desc, request.created_at desc;
$$;

revoke all on function public.get_parent_portal_match_transport_states(uuid)
from public, anon;
grant execute on function public.get_parent_portal_match_transport_states(uuid)
to authenticated, service_role;

create or replace function public.set_parent_portal_match_transport(
  parent_link_id_value uuid,
  request_id_value uuid,
  transport_mode_value text,
  transport_seats_offered_value integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_row public.parent_player_links%rowtype;
  request_row public.match_day_availability_requests%rowtype;
  fixture_row public.match_days%rowtype;
  response_row record;
  normalized_mode text := pg_catalog.lower(pg_catalog.btrim(coalesce(transport_mode_value, '')));
  normalized_seats integer := greatest(least(coalesce(transport_seats_offered_value, 0), 8), 0);
begin
  if (select auth.uid()) is null then
    raise exception 'Login is required before changing carpool.';
  end if;

  if normalized_mode not in ('none', 'needs_lift', 'offering_lift') then
    raise exception 'Choose Need a lift, Offer a lift, or No carpool.';
  end if;

  select link.*
  into link_row
  from public.parent_player_links link
  where link.id = parent_link_id_value
    and link.auth_user_id = (select auth.uid())
    and link.status = 'active'
  limit 1;

  if link_row.id is null then
    raise exception 'This parent portal link is not available.';
  end if;

  select request.*
  into request_row
  from public.match_day_availability_requests request
  where request.id = request_id_value
    and request.club_id = link_row.club_id
    and request.team_id = link_row.team_id
    and request.player_id = link_row.player_id
    and (
      request.parent_link_id = link_row.id
      or (
        request.parent_link_id is null
        and coalesce(link_row.email, '') <> ''
        and pg_catalog.lower(request.recipient_email) = pg_catalog.lower(link_row.email)
      )
    )
  for update;

  if request_row.id is null then
    raise exception 'This carpool request is not available for this parent contact.';
  end if;

  select fixture.*
  into fixture_row
  from public.match_days fixture
  where fixture.id = request_row.match_day_id
    and fixture.club_id = link_row.club_id
    and fixture.team_id = link_row.team_id
    and fixture.deleted_at is null
    and fixture.previous_hidden_at is null
  limit 1;

  if fixture_row.id is null
    or fixture_row.status in ('cancelled', 'postponed', 'full_time')
    or fixture_row.concluded_at is not null
    or request_row.status = 'expired'
    or request_row.expires_at <= pg_catalog.now() then
    raise exception 'Carpool is closed for this fixture.';
  end if;

  select response.*
  into response_row
  from public.submit_match_day_availability_response(
    request_row.token_hash,
    '',
    null,
    null,
    null,
    normalized_mode = 'needs_lift',
    normalized_mode = 'offering_lift',
    case when normalized_mode = 'offering_lift' then greatest(normalized_seats, 1) else 0 end
  ) response
  limit 1;

  if response_row.request_id is null then
    raise exception 'Carpool could not be saved.';
  end if;

  return pg_catalog.jsonb_build_object(
    'requestId', response_row.request_id,
    'transportMode', normalized_mode,
    'transportNeedsLift', response_row.transport_needs_lift,
    'transportCanOfferLift', response_row.transport_can_offer_lift,
    'transportSeatsOffered', response_row.transport_seats_offered,
    'transportRespondedAt', response_row.transport_responded_at
  );
end;
$$;

revoke all on function public.set_parent_portal_match_transport(uuid, uuid, text, integer)
from public, anon;
grant execute on function public.set_parent_portal_match_transport(uuid, uuid, text, integer)
to authenticated, service_role;

comment on function public.get_parent_portal_match_transport_states(uuid) is
  'Returns only the authenticated Parent contact carpool state for active, same-child Match Day requests.';

comment on function public.set_parent_portal_match_transport(uuid, uuid, text, integer) is
  'Updates only the authenticated Parent contact carpool fields through the canonical reusable Match Day response path. Attendance is unchanged.';
