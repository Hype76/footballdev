begin;

create schema if not exists app_private;

create or replace function app_private.match_day_scorer_link_eligibility(
  match_day_id_value uuid,
  parent_link_id_value uuid
)
returns table (
  eligible boolean,
  reason text,
  auth_user_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  match_row public.match_days%rowtype;
  eligible_link record;
begin
  select * into match_row
  from public.match_days
  where id = match_day_id_value;

  if match_row.id is null or match_row.deleted_at is not null then
    return query select false, 'This fixture is no longer available.'::text, null::uuid;
    return;
  end if;

  if match_row.concluded_at is not null
    or match_row.status in ('cancelled', 'postponed', 'full_time') then
    return query select false, 'The scorer cannot be changed for a closed match.'::text, null::uuid;
    return;
  end if;

  select parent_link.auth_user_id
  into eligible_link
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = match_row.club_id
   and player.status = 'active'
   and (match_row.team_id is null or player.team_id = match_row.team_id)
  where parent_link.id = parent_link_id_value
    and parent_link.club_id = match_row.club_id
    and parent_link.status = 'active'
    and parent_link.auth_user_id is not null;

  if eligible_link.auth_user_id is null then
    return query select
      false,
      'This parent needs an active signed-in account linked to a current player on this fixture team.'::text,
      null::uuid;
    return;
  end if;

  return query select true, ''::text, eligible_link.auth_user_id;
end;
$$;

revoke all on function app_private.match_day_scorer_link_eligibility(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.match_day_scorer_link_eligibility(uuid, uuid) to service_role;

create or replace function app_private.resolve_match_day_scorer_request_eligibility(
  match_day_id_value uuid,
  request_id_value uuid
)
returns table (
  request_id uuid,
  eligible boolean,
  reason text,
  parent_link_id uuid,
  auth_user_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  request_row public.match_day_availability_requests%rowtype;
  resolved_parent_link_id uuid;
  candidate_count integer := 0;
  link_eligibility record;
begin
  select request.* into request_row
  from public.match_day_availability_requests request
  join public.match_days match_day
    on match_day.id = request.match_day_id
   and match_day.club_id = request.club_id
   and (match_day.team_id is null or request.team_id is null or request.team_id = match_day.team_id)
  where request.id = request_id_value
    and request.match_day_id = match_day_id_value;

  if request_row.id is null then
    return query select
      request_id_value,
      false,
      'This scorer response is no longer available.'::text,
      null::uuid,
      null::uuid;
    return;
  end if;

  if lower(coalesce(request_row.status, '')) = 'expired' then
    return query select
      request_row.id,
      false,
      'This scorer response has expired. Ask the parent to submit a fresh Match Day response.'::text,
      null::uuid,
      null::uuid;
    return;
  end if;

  if lower(coalesce(request_row.volunteer_scorer_response, '')) <> 'yes' then
    return query select
      request_row.id,
      false,
      'Only parents who replied Yes can be selected.'::text,
      null::uuid,
      null::uuid;
    return;
  end if;

  if request_row.parent_link_id is not null then
    select parent_link.id into resolved_parent_link_id
    from public.parent_player_links parent_link
    where parent_link.id = request_row.parent_link_id
      and parent_link.club_id = request_row.club_id
      and (request_row.player_id is null or parent_link.player_id = request_row.player_id);

    candidate_count := case when resolved_parent_link_id is null then 0 else 1 end;
  else
    select count(*), (array_agg(parent_link.id order by parent_link.id))[1]
    into candidate_count, resolved_parent_link_id
    from public.parent_player_links parent_link
    where parent_link.club_id = request_row.club_id
      and parent_link.player_id = request_row.player_id
      and lower(trim(coalesce(parent_link.email, ''))) = lower(trim(coalesce(request_row.recipient_email, '')));
  end if;

  if candidate_count = 0 or resolved_parent_link_id is null then
    return query select
      request_row.id,
      false,
      'This parent needs an active signed-in account linked to a current player on this fixture team.'::text,
      null::uuid,
      null::uuid;
    return;
  end if;

  if candidate_count > 1 then
    return query select
      request_row.id,
      false,
      'This scorer response matches more than one parent link and cannot be assigned safely.'::text,
      null::uuid,
      null::uuid;
    return;
  end if;

  select * into link_eligibility
  from app_private.match_day_scorer_link_eligibility(match_day_id_value, resolved_parent_link_id);

  return query select
    request_row.id,
    coalesce(link_eligibility.eligible, false),
    coalesce(link_eligibility.reason, 'This scorer response cannot be assigned safely.'),
    case when link_eligibility.eligible then resolved_parent_link_id else null::uuid end,
    case when link_eligibility.eligible then link_eligibility.auth_user_id else null::uuid end;
end;
$$;

revoke all on function app_private.resolve_match_day_scorer_request_eligibility(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.resolve_match_day_scorer_request_eligibility(uuid, uuid) to service_role;

create or replace function public.get_match_day_scorer_eligibility(match_day_id_value uuid)
returns table (
  request_id uuid,
  eligible boolean,
  reason text,
  parent_link_id uuid,
  auth_user_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  match_row public.match_days%rowtype;
begin
  select * into match_row
  from public.match_days
  where id = match_day_id_value
    and deleted_at is null;

  if match_row.id is null or not public.can_manage_match_day(match_row.team_id) then
    raise exception using errcode = '42501', message = 'You do not have access to scorer eligibility for this fixture.';
  end if;

  return query
  select eligibility.request_id,
         eligibility.eligible,
         eligibility.reason,
         eligibility.parent_link_id,
         eligibility.auth_user_id
  from public.match_day_availability_requests request
  cross join lateral app_private.resolve_match_day_scorer_request_eligibility(match_row.id, request.id) eligibility
  where request.match_day_id = match_row.id
    and request.club_id = match_row.club_id;
end;
$$;

revoke all on function public.get_match_day_scorer_eligibility(uuid) from public, anon;
grant execute on function public.get_match_day_scorer_eligibility(uuid) to authenticated, service_role;

create or replace function public.resolve_match_day_scorer_eligibility(
  match_day_id_value uuid,
  request_id_value uuid
)
returns table (
  request_id uuid,
  eligible boolean,
  reason text,
  parent_link_id uuid,
  auth_user_id uuid
)
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
  select *
  from app_private.resolve_match_day_scorer_request_eligibility(match_day_id_value, request_id_value);
$$;

revoke all on function public.resolve_match_day_scorer_eligibility(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_match_day_scorer_eligibility(uuid, uuid) to service_role;

create or replace function public.sync_match_day_scorer_assignment(
  match_day_id_value uuid,
  parent_link_id_value uuid,
  assigned_by_value uuid,
  assigned_by_name_value text,
  selected_value boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  match_row public.match_days%rowtype;
  parent_link_row public.parent_player_links%rowtype;
  role_assignment_row public.match_day_role_assignments%rowtype;
  link_eligibility record;
begin
  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if match_row.concluded_at is not null
    or match_row.status in ('cancelled', 'postponed', 'full_time') then
    raise exception 'The scorer cannot be changed for a closed match.';
  end if;

  if selected_value is false then
    delete from public.match_day_role_assignments
    where match_day_id = match_row.id
      and role = 'scorer'
      and parent_link_id = parent_link_id_value;

    delete from public.match_day_scorer_assignments
    where match_day_id = match_row.id
      and parent_link_id = parent_link_id_value;

    return jsonb_build_object(
      'matchDayId', match_row.id,
      'parentLinkId', parent_link_id_value,
      'selected', false
    );
  end if;

  select * into link_eligibility
  from app_private.match_day_scorer_link_eligibility(match_row.id, parent_link_id_value);

  if not coalesce(link_eligibility.eligible, false) then
    raise exception '%', coalesce(link_eligibility.reason, 'Choose an eligible scorer for this fixture.');
  end if;

  select * into parent_link_row
  from public.parent_player_links parent_link
  where parent_link.id = parent_link_id_value
  for update;

  insert into public.match_day_role_assignments (
    match_day_id, club_id, team_id, role, parent_link_id, auth_user_id,
    assigned_by, assigned_by_name, created_at, updated_at
  ) values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    'scorer',
    parent_link_row.id,
    link_eligibility.auth_user_id,
    assigned_by_value,
    trim(coalesce(assigned_by_name_value, '')),
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict (match_day_id, role)
  do update set
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    parent_link_id = excluded.parent_link_id,
    auth_user_id = excluded.auth_user_id,
    assigned_by = excluded.assigned_by,
    assigned_by_name = excluded.assigned_by_name,
    updated_at = excluded.updated_at
  returning * into role_assignment_row;

  insert into public.match_day_scorer_assignments (
    match_day_id, club_id, team_id, parent_link_id, auth_user_id,
    assigned_by, assigned_by_name, created_at
  ) values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    parent_link_row.id,
    link_eligibility.auth_user_id,
    assigned_by_value,
    trim(coalesce(assigned_by_name_value, '')),
    timezone('utc', now())
  )
  on conflict (match_day_id)
  do update set
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    parent_link_id = excluded.parent_link_id,
    auth_user_id = excluded.auth_user_id,
    assigned_by = excluded.assigned_by,
    assigned_by_name = excluded.assigned_by_name,
    created_at = excluded.created_at;

  return jsonb_build_object(
    'matchDayId', match_row.id,
    'parentLinkId', parent_link_row.id,
    'authUserId', link_eligibility.auth_user_id,
    'roleAssignmentId', role_assignment_row.id,
    'selected', true,
    'updatedAt', role_assignment_row.updated_at
  );
end;
$$;

revoke all on function public.sync_match_day_scorer_assignment(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.sync_match_day_scorer_assignment(uuid, uuid, uuid, text, boolean) to service_role;

commit;
