-- FP-V1-SECURITY FP-SPR-008 privileged database function authority hardening.
-- This migration changes function, grant and policy metadata only.
-- It does not seed roles, create polls or locations, or update existing business rows.

create schema if not exists app_private authorization postgres;
revoke all on schema app_private from public, anon, authenticated, service_role;

create or replace function app_private.actor_can_manage_team_resource(
  p_actor_id uuid,
  p_club_id uuid,
  p_team_id uuid,
  p_minimum_rank integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
begin
  if p_actor_id is null
    or p_club_id is null
    or p_minimum_rank not in (20, 50) then
    return false;
  end if;

  select app_user.*
  into actor
  from public.users app_user
  join public.user_club_memberships membership
    on membership.auth_user_id = app_user.id
   and membership.club_id = app_user.club_id
   and membership.role = app_user.role
   and membership.role_rank = app_user.role_rank
  join public.clubs club
    on club.id = app_user.club_id
   and coalesce(club.status, 'active') = 'active'
  where app_user.id = p_actor_id
    and app_user.club_id = p_club_id
    and app_user.status = 'active'
    and app_user.role not in ('parent_portal', 'super_admin')
  for key share of app_user, membership, club;

  if actor.id is null then
    return false;
  end if;

  if actor.role = 'admin' then
    return true;
  end if;

  if p_team_id is null or actor.role_rank < p_minimum_rank then
    return false;
  end if;

  perform 1
  from public.teams team
  join public.team_staff assignment
    on assignment.team_id = team.id
   and assignment.user_id = p_actor_id
  where team.id = p_team_id
    and team.club_id = p_club_id
    and coalesce(team.status, 'active') = 'active'
  for key share of team, assignment;

  return found;
end;
$$;

alter function app_private.actor_can_manage_team_resource(uuid, uuid, uuid, integer) owner to postgres;
revoke all on function app_private.actor_can_manage_team_resource(uuid, uuid, uuid, integer)
  from public, anon, authenticated, service_role;

create or replace function app_private.seed_default_club_roles_impl(
  p_club_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text,
  p_workflow text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
begin
  if p_club_id is null or p_actor_id is null then
    raise exception using errcode = '22023', message = 'role_seed_invalid';
  end if;

  insert into public.club_roles (
    club_id,
    role_key,
    role_label,
    role_rank,
    is_system,
    created_by,
    created_by_name,
    created_by_email
  )
  values
    (p_club_id, 'admin', 'Club Admin', 90, true, p_actor_id, p_actor_name, p_actor_email),
    (p_club_id, 'head_manager', 'Team Admin', 70, true, p_actor_id, p_actor_name, p_actor_email),
    (p_club_id, 'manager', 'Manager', 50, true, p_actor_id, p_actor_name, p_actor_email),
    (p_club_id, 'coach', 'Coach', 30, true, p_actor_id, p_actor_name, p_actor_email),
    (p_club_id, 'assistant_coach', 'Assistant Coach', 20, true, p_actor_id, p_actor_name, p_actor_email)
  on conflict (club_id, role_key) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count > 0 then
    insert into public.audit_logs (
      club_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      p_club_id,
      p_actor_id,
      'default_club_roles_seeded',
      'club',
      p_club_id,
      jsonb_build_object(
        'workflow', left(coalesce(p_workflow, 'unknown'), 80),
        'insertedCount', inserted_count
      )
    );
  end if;

  return inserted_count;
end;
$$;

alter function app_private.seed_default_club_roles_impl(uuid, uuid, text, text, text) owner to postgres;
revoke all on function app_private.seed_default_club_roles_impl(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;

drop function if exists public.seed_default_club_roles(uuid);

create or replace function public.seed_default_club_roles()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
begin
  select app_user.*
  into actor
  from public.users app_user
  join public.user_club_memberships membership
    on membership.auth_user_id = app_user.id
   and membership.club_id = app_user.club_id
   and membership.role = app_user.role
   and membership.role_rank = app_user.role_rank
  join public.clubs club
    on club.id = app_user.club_id
   and coalesce(club.status, 'active') = 'active'
  where app_user.id = (select auth.uid())
    and app_user.status = 'active'
    and app_user.role = 'admin'
  for key share of app_user, membership;

  if actor.id is null then
    raise exception using errcode = '42501', message = 'role_seed_not_permitted';
  end if;

  perform 1
  from public.clubs club
  where club.id = actor.club_id
  for update;

  return app_private.seed_default_club_roles_impl(
    actor.club_id,
    actor.id,
    coalesce(actor.name, actor.display_name, actor.username, actor.email),
    lower(actor.email),
    'authenticated_club_admin'
  );
end;
$$;

alter function public.seed_default_club_roles() owner to postgres;
revoke all on function public.seed_default_club_roles() from public, anon, service_role;
grant execute on function public.seed_default_club_roles() to authenticated;

create or replace function public.seed_default_club_roles_for_actor(
  p_target_club_id uuid,
  p_actor_id uuid,
  p_workflow text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  normalized_workflow text := lower(btrim(coalesce(p_workflow, '')));
begin
  if p_target_club_id is null
    or p_actor_id is null
    or normalized_workflow not in ('platform_create_club', 'signup_workspace') then
    raise exception using errcode = '22023', message = 'role_seed_invalid';
  end if;

  perform 1
  from public.clubs club
  where club.id = p_target_club_id
    and coalesce(club.status, 'active') = 'active'
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'role_seed_not_permitted';
  end if;

  if normalized_workflow = 'platform_create_club' then
    select app_user.*
    into actor
    from public.users app_user
    join public.platform_admins platform_admin
      on platform_admin.id = app_user.id
     and platform_admin.status = 'active'
    where app_user.id = p_actor_id
      and app_user.status = 'active'
      and app_user.role = 'super_admin'
    for key share of app_user, platform_admin;
  else
    select app_user.*
    into actor
    from public.users app_user
    join public.user_club_memberships membership
      on membership.auth_user_id = app_user.id
     and membership.club_id = app_user.club_id
     and membership.role = app_user.role
     and membership.role_rank = app_user.role_rank
    where app_user.id = p_actor_id
      and app_user.club_id = p_target_club_id
      and app_user.status = 'active'
      and app_user.role not in ('parent_portal', 'super_admin')
      and app_user.role_rank >= 50
    for key share of app_user, membership;
  end if;

  if actor.id is null then
    raise exception using errcode = '42501', message = 'role_seed_not_permitted';
  end if;

  return app_private.seed_default_club_roles_impl(
    p_target_club_id,
    actor.id,
    coalesce(actor.name, actor.display_name, actor.username, actor.email),
    lower(actor.email),
    normalized_workflow
  );
end;
$$;

alter function public.seed_default_club_roles_for_actor(uuid, uuid, text) owner to postgres;
revoke all on function public.seed_default_club_roles_for_actor(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.seed_default_club_roles_for_actor(uuid, uuid, text) to service_role;

create or replace function public.create_club_role(
  p_role_key text,
  p_role_label text,
  p_role_rank integer
)
returns public.club_roles
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  existing_role public.club_roles%rowtype;
  result_role public.club_roles%rowtype;
  normalized_key text := lower(btrim(coalesce(p_role_key, '')));
  normalized_label text := btrim(coalesce(p_role_label, ''));
begin
  select app_user.*
  into actor
  from public.users app_user
  join public.user_club_memberships membership
    on membership.auth_user_id = app_user.id
   and membership.club_id = app_user.club_id
   and membership.role = app_user.role
   and membership.role_rank = app_user.role_rank
  join public.clubs club
    on club.id = app_user.club_id
   and coalesce(club.status, 'active') = 'active'
  where app_user.id = (select auth.uid())
    and app_user.status = 'active'
    and app_user.role = 'admin'
    and app_user.role_rank = 90
  for key share of app_user, membership;

  if actor.id is null then
    raise exception using errcode = '42501', message = 'role_change_not_permitted';
  end if;

  if normalized_key !~ '^[a-z][a-z0-9_]{2,39}$'
    or normalized_key in (
      'admin', 'head_manager', 'manager', 'coach', 'assistant_coach',
      'parent_portal', 'super_admin', 'platform_admin', 'club_owner', 'owner'
    )
    or length(normalized_label) < 2
    or length(normalized_label) > 80
    or p_role_rank is null
    or p_role_rank < 10
    or p_role_rank > 70
    or p_role_rank >= actor.role_rank then
    raise exception using errcode = '22023', message = 'role_definition_invalid';
  end if;

  perform 1
  from public.clubs club
  where club.id = actor.club_id
  for update;

  select role.*
  into existing_role
  from public.club_roles role
  where role.club_id = actor.club_id
    and role.role_key = normalized_key
  for update;

  if existing_role.id is not null and existing_role.is_system then
    raise exception using errcode = '42501', message = 'system_role_change_not_permitted';
  end if;

  insert into public.club_roles (
    club_id,
    role_key,
    role_label,
    role_rank,
    is_system,
    created_by,
    created_by_name,
    created_by_email,
    updated_by,
    updated_by_name,
    updated_by_email
  )
  values (
    actor.club_id,
    normalized_key,
    normalized_label,
    p_role_rank,
    false,
    actor.id,
    coalesce(actor.name, actor.display_name, actor.username, actor.email),
    lower(actor.email),
    actor.id,
    coalesce(actor.name, actor.display_name, actor.username, actor.email),
    lower(actor.email)
  )
  on conflict (club_id, role_key) do update
  set role_label = excluded.role_label,
      role_rank = excluded.role_rank,
      updated_by = excluded.updated_by,
      updated_by_name = excluded.updated_by_name,
      updated_by_email = excluded.updated_by_email
  where public.club_roles.is_system = false
  returning * into result_role;

  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    actor.club_id,
    actor.id,
    case when existing_role.id is null then 'club_role_created' else 'club_role_updated' end,
    'club_role',
    result_role.id,
    jsonb_build_object(
      'roleKey', result_role.role_key,
      'previousRank', existing_role.role_rank,
      'newRank', result_role.role_rank,
      'isSystem', false
    )
  );

  return result_role;
end;
$$;

alter function public.create_club_role(text, text, integer) owner to postgres;
revoke all on function public.create_club_role(text, text, integer) from public, anon, service_role;
grant execute on function public.create_club_role(text, text, integer) to authenticated;

drop function if exists public.upsert_match_location(uuid, text, text, text);

create or replace function public.upsert_match_location_for_team(
  p_team_id uuid,
  p_name text,
  p_address text,
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_team public.teams%rowtype;
  location_row public.match_locations%rowtype;
  previous_notes text;
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_address text := btrim(coalesce(p_address, ''));
  normalized_notes text := btrim(coalesce(p_notes, ''));
  operation text := 'unchanged';
begin
  if p_team_id is null
    or normalized_name = ''
    or length(normalized_name) > 160
    or length(normalized_address) > 500
    or length(normalized_notes) > 2000 then
    raise exception using errcode = '22023', message = 'match_location_invalid';
  end if;

  select team.*
  into target_team
  from public.teams team
  join public.clubs club
    on club.id = team.club_id
   and coalesce(club.status, 'active') = 'active'
  where team.id = p_team_id
    and coalesce(team.status, 'active') = 'active'
  for key share of team, club;

  if target_team.id is null
    or not app_private.actor_can_manage_team_resource(actor_id, target_team.club_id, target_team.id, 20) then
    raise exception using errcode = '42501', message = 'match_location_not_permitted';
  end if;

  insert into public.match_locations (
    club_id,
    name,
    address,
    notes,
    created_by
  )
  values (
    target_team.club_id,
    normalized_name,
    normalized_address,
    normalized_notes,
    actor_id
  )
  on conflict (club_id, (lower(name)), (lower(address))) do nothing
  returning * into location_row;

  if location_row.id is not null then
    operation := 'created';
  else
    select location.*
    into location_row
    from public.match_locations location
    where location.club_id = target_team.club_id
      and lower(location.name) = lower(normalized_name)
      and lower(location.address) = lower(normalized_address)
    for update;

    if location_row.id is null then
      raise exception using errcode = '55000', message = 'match_location_unavailable';
    end if;

    previous_notes := location_row.notes;

    if normalized_notes <> '' and normalized_notes is distinct from location_row.notes then
      update public.match_locations location
      set notes = normalized_notes,
          updated_at = timezone('utc', now())
      where location.id = location_row.id
      returning * into location_row;
      operation := 'updated';
    end if;
  end if;

  if operation <> 'unchanged' then
    insert into public.audit_logs (
      club_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      target_team.club_id,
      actor_id,
      'match_location_' || operation,
      'match_location',
      location_row.id,
      jsonb_build_object(
        'teamId', target_team.id,
        'previousNotesPresent', coalesce(previous_notes, '') <> '',
        'newNotesPresent', coalesce(location_row.notes, '') <> ''
      )
    );
  end if;

  return location_row.id;
end;
$$;

alter function public.upsert_match_location_for_team(uuid, text, text, text) owner to postgres;
revoke all on function public.upsert_match_location_for_team(uuid, text, text, text)
  from public, anon, service_role;
grant execute on function public.upsert_match_location_for_team(uuid, text, text, text)
  to authenticated;

alter table public.polls
  add column if not exists privileged_request_id uuid;

create unique index if not exists polls_creator_privileged_request_id_uidx
  on public.polls (created_by, privileged_request_id)
  where privileged_request_id is not null;

create or replace function public.create_team_poll(
  p_team_id uuid,
  p_title text,
  p_description text,
  p_audience text,
  p_poll_type text,
  p_options jsonb,
  p_closes_at timestamptz,
  p_allow_multiple boolean,
  p_max_choices integer,
  p_allow_own_child_votes boolean,
  p_allow_vote_changes boolean,
  p_hide_votes boolean,
  p_allow_comments boolean,
  p_request_id uuid
)
returns public.polls
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  target_club_id uuid;
  result_poll public.polls%rowtype;
  normalized_title text := btrim(coalesce(p_title, ''));
  normalized_description text := btrim(coalesce(p_description, ''));
  normalized_audience text := lower(btrim(coalesce(p_audience, '')));
  normalized_poll_type text := lower(btrim(coalesce(p_poll_type, '')));
  option_count integer;
begin
  select app_user.*
  into actor
  from public.users app_user
  where app_user.id = (select auth.uid())
  for key share;

  if actor.id is null then
    raise exception using errcode = '42501', message = 'poll_change_not_permitted';
  end if;

  if p_team_id is null then
    target_club_id := actor.club_id;
  else
    select team.club_id
    into target_club_id
    from public.teams team
    join public.clubs club
      on club.id = team.club_id
     and coalesce(club.status, 'active') = 'active'
    where team.id = p_team_id
      and coalesce(team.status, 'active') = 'active'
    for key share of team, club;
  end if;

  if target_club_id is null
    or not app_private.actor_can_manage_team_resource(actor.id, target_club_id, p_team_id, 20) then
    raise exception using errcode = '42501', message = 'poll_change_not_permitted';
  end if;

  if normalized_title = ''
    or length(normalized_title) > 160
    or length(normalized_description) > 2000
    or normalized_audience not in ('parents', 'staff')
    or normalized_poll_type not in ('text', 'time', 'awards')
    or p_request_id is null
    or jsonb_typeof(p_options) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'poll_definition_invalid';
  end if;

  option_count := jsonb_array_length(p_options);

  if option_count < 2
    or option_count > 50
    or exists (
      select 1
      from jsonb_array_elements(p_options) option_row
      where jsonb_typeof(option_row) is distinct from 'object'
        or btrim(coalesce(option_row ->> 'id', '')) = ''
        or length(btrim(coalesce(option_row ->> 'id', ''))) > 80
        or btrim(coalesce(option_row ->> 'label', '')) = ''
        or length(btrim(coalesce(option_row ->> 'label', ''))) > 160
    )
    or (
      select count(distinct btrim(option_row ->> 'id'))
      from jsonb_array_elements(p_options) option_row
    ) <> option_count
    or (p_closes_at is not null and p_closes_at <= timezone('utc', now()))
    or (
      coalesce(p_allow_multiple, false)
      and (p_max_choices is null or p_max_choices < 1 or p_max_choices > option_count)
    ) then
    raise exception using errcode = '22023', message = 'poll_definition_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor.id::text || ':' || p_request_id::text, 0));

  insert into public.polls (
    club_id,
    team_id,
    title,
    description,
    audience,
    poll_type,
    options,
    status,
    closes_at,
    allow_multiple,
    max_choices,
    allow_own_child_votes,
    allow_vote_changes,
    hide_votes,
    allow_comments,
    created_by,
    created_by_name,
    privileged_request_id
  )
  values (
    target_club_id,
    p_team_id,
    normalized_title,
    normalized_description,
    normalized_audience,
    normalized_poll_type,
    p_options,
    'open',
    p_closes_at,
    coalesce(p_allow_multiple, false),
    case when coalesce(p_allow_multiple, false) then p_max_choices else null end,
    case when normalized_audience = 'parents' then coalesce(p_allow_own_child_votes, true) else true end,
    coalesce(p_allow_vote_changes, true),
    coalesce(p_hide_votes, false),
    coalesce(p_allow_comments, false),
    actor.id,
    coalesce(actor.name, actor.display_name, actor.username, actor.email),
    p_request_id
  )
  on conflict (created_by, privileged_request_id)
    where privileged_request_id is not null
    do nothing
  returning * into result_poll;

  if result_poll.id is null then
    select poll.*
    into result_poll
    from public.polls poll
    where poll.created_by = actor.id
      and poll.privileged_request_id = p_request_id
      and poll.club_id = target_club_id
      and poll.team_id is not distinct from p_team_id
      and poll.title = normalized_title
      and poll.audience = normalized_audience
      and poll.poll_type = normalized_poll_type
      and poll.options = p_options
    for update;

    if result_poll.id is null then
      raise exception using errcode = '55000', message = 'poll_request_conflict';
    end if;

    return result_poll;
  end if;

  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    target_club_id,
    actor.id,
    'poll_created',
    'poll',
    result_poll.id,
    jsonb_build_object(
      'teamId', p_team_id,
      'requestId', p_request_id,
      'audience', normalized_audience,
      'pollType', normalized_poll_type,
      'optionCount', option_count
    )
  );

  return result_poll;
end;
$$;

alter function public.create_team_poll(uuid, text, text, text, text, jsonb, timestamptz, boolean, integer, boolean, boolean, boolean, boolean, uuid) owner to postgres;
revoke all on function public.create_team_poll(uuid, text, text, text, text, jsonb, timestamptz, boolean, integer, boolean, boolean, boolean, boolean, uuid)
  from public, anon, service_role;
grant execute on function public.create_team_poll(uuid, text, text, text, text, jsonb, timestamptz, boolean, integer, boolean, boolean, boolean, boolean, uuid)
  to authenticated;

create or replace function public.set_team_poll_status(
  p_poll_id uuid,
  p_status text
)
returns public.polls
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  poll_row public.polls%rowtype;
  normalized_status text := lower(btrim(coalesce(p_status, '')));
begin
  if p_poll_id is null or normalized_status not in ('open', 'closed') then
    raise exception using errcode = '22023', message = 'poll_status_invalid';
  end if;

  select poll.*
  into poll_row
  from public.polls poll
  where poll.id = p_poll_id
  for update;

  if poll_row.id is null
    or not app_private.actor_can_manage_team_resource(actor_id, poll_row.club_id, poll_row.team_id, 20) then
    raise exception using errcode = '42501', message = 'poll_change_not_permitted';
  end if;

  if poll_row.status is distinct from normalized_status then
    update public.polls poll
    set status = normalized_status,
        updated_at = timezone('utc', now())
    where poll.id = poll_row.id
    returning * into poll_row;

    insert into public.audit_logs (
      club_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      poll_row.club_id,
      actor_id,
      'poll_status_changed',
      'poll',
      poll_row.id,
      jsonb_build_object('teamId', poll_row.team_id, 'newStatus', poll_row.status)
    );
  end if;

  return poll_row;
end;
$$;

alter function public.set_team_poll_status(uuid, text) owner to postgres;
revoke all on function public.set_team_poll_status(uuid, text) from public, anon, service_role;
grant execute on function public.set_team_poll_status(uuid, text) to authenticated;

create or replace function public.delete_team_poll(p_poll_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  poll_row public.polls%rowtype;
begin
  if p_poll_id is null then
    raise exception using errcode = '22023', message = 'poll_id_invalid';
  end if;

  select poll.*
  into poll_row
  from public.polls poll
  where poll.id = p_poll_id
  for update;

  if poll_row.id is null
    or not app_private.actor_can_manage_team_resource(actor_id, poll_row.club_id, poll_row.team_id, 50) then
    raise exception using errcode = '42501', message = 'poll_delete_not_permitted';
  end if;

  if exists (select 1 from public.poll_votes vote where vote.poll_id = poll_row.id)
    or exists (select 1 from public.match_days match_day where match_day.motm_poll_id = poll_row.id) then
    raise exception using errcode = '55000', message = 'poll_delete_unsafe';
  end if;

  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    poll_row.club_id,
    actor_id,
    'poll_deleted',
    'poll',
    poll_row.id,
    jsonb_build_object('teamId', poll_row.team_id, 'status', poll_row.status)
  );

  delete from public.polls poll where poll.id = poll_row.id;
  return poll_row.id;
end;
$$;

alter function public.delete_team_poll(uuid) owner to postgres;
revoke all on function public.delete_team_poll(uuid) from public, anon, service_role;
grant execute on function public.delete_team_poll(uuid) to authenticated;

create or replace function public.submit_staff_poll_vote(
  p_poll_id uuid,
  p_option_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  poll_row public.polls%rowtype;
  normalized_option_id text := btrim(coalesce(p_option_id, ''));
  voter_email_value text;
  existing_vote_id uuid;
  current_vote_count integer;
  vote_id_value uuid;
begin
  if p_poll_id is null or normalized_option_id = '' or length(normalized_option_id) > 80 then
    raise exception using errcode = '22023', message = 'poll_vote_invalid';
  end if;

  select app_user.*
  into actor
  from public.users app_user
  where app_user.id = (select auth.uid())
  for key share;

  select poll.*
  into poll_row
  from public.polls poll
  where poll.id = p_poll_id
  for update;

  if actor.id is null
    or poll_row.id is null
    or poll_row.status <> 'open'
    or (poll_row.closes_at is not null and poll_row.closes_at <= timezone('utc', now()))
    or not app_private.actor_can_manage_team_resource(actor.id, poll_row.club_id, poll_row.team_id, 20) then
    raise exception using errcode = '42501', message = 'poll_vote_not_permitted';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(poll_row.options) option_row
    where option_row ->> 'id' = normalized_option_id
  ) then
    raise exception using errcode = '22023', message = 'poll_vote_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(poll_row.id::text || ':' || actor.id::text, 0));
  voter_email_value := lower(actor.email);

  select vote.id
  into existing_vote_id
  from public.poll_votes vote
  where vote.poll_id = poll_row.id
    and vote.auth_user_id = actor.id
    and vote.option_id = normalized_option_id
  for update;

  if existing_vote_id is not null then
    return existing_vote_id;
  end if;

  if poll_row.allow_vote_changes is false and exists (
    select 1 from public.poll_votes vote
    where vote.poll_id = poll_row.id and vote.auth_user_id = actor.id
  ) then
    raise exception using errcode = '55000', message = 'poll_vote_locked';
  end if;

  if poll_row.allow_multiple is false then
    delete from public.poll_votes vote
    where vote.poll_id = poll_row.id and vote.auth_user_id = actor.id;
  else
    select count(*)::integer
    into current_vote_count
    from public.poll_votes vote
    where vote.poll_id = poll_row.id and vote.auth_user_id = actor.id;

    if poll_row.max_choices is not null and current_vote_count >= poll_row.max_choices then
      raise exception using errcode = '55000', message = 'poll_vote_limit_reached';
    end if;
  end if;

  insert into public.poll_votes (
    poll_id,
    club_id,
    team_id,
    auth_user_id,
    voter_email,
    voter_name,
    option_id
  )
  values (
    poll_row.id,
    poll_row.club_id,
    poll_row.team_id,
    actor.id,
    voter_email_value,
    coalesce(actor.name, actor.display_name, actor.username, actor.email),
    normalized_option_id
  )
  on conflict (poll_id, voter_email, option_id) do update
  set auth_user_id = excluded.auth_user_id,
      voter_name = excluded.voter_name,
      updated_at = timezone('utc', now())
  returning id into vote_id_value;

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    poll_row.club_id,
    actor.id,
    'poll_vote_submitted',
    'poll',
    poll_row.id,
    jsonb_build_object('teamId', poll_row.team_id, 'optionId', normalized_option_id)
  );

  return vote_id_value;
end;
$$;

alter function public.submit_staff_poll_vote(uuid, text) owner to postgres;
revoke all on function public.submit_staff_poll_vote(uuid, text) from public, anon, service_role;
grant execute on function public.submit_staff_poll_vote(uuid, text) to authenticated;

create or replace function public.get_parent_portal_polls(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  title text,
  description text,
  audience text,
  poll_type text,
  options jsonb,
  status text,
  closes_at timestamptz,
  allow_multiple boolean,
  max_choices integer,
  allow_own_child_votes boolean,
  allow_vote_changes boolean,
  hide_votes boolean,
  allow_comments boolean,
  created_at timestamptz,
  current_option_id text,
  current_option_ids jsonb,
  votes jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with parent_link as (
    select link.*
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = (select auth.uid())
      and link.status = 'active'
      and public.current_user_has_active_authority()
      and public.current_user_role() = 'parent_portal'
    limit 1
  ),
  own_votes as (
    select
      vote.poll_id,
      jsonb_agg(vote.option_id order by vote.option_id) as option_ids,
      min(vote.option_id) as first_option_id
    from public.poll_votes vote
    where vote.auth_user_id = (select auth.uid())
    group by vote.poll_id
  ),
  vote_counts as (
    select vote.poll_id, vote.option_id, count(*)::integer as vote_count
    from public.poll_votes vote
    group by vote.poll_id, vote.option_id
  )
  select
    poll.id,
    poll.club_id,
    poll.team_id,
    poll.title,
    poll.description,
    poll.audience,
    poll.poll_type,
    poll.options,
    poll.status,
    poll.closes_at,
    poll.allow_multiple,
    poll.max_choices,
    poll.allow_own_child_votes,
    poll.allow_vote_changes,
    poll.hide_votes,
    poll.allow_comments,
    poll.created_at,
    own_votes.first_option_id,
    coalesce(own_votes.option_ids, '[]'::jsonb),
    case
      when poll.hide_votes and own_votes.poll_id is null then '[]'::jsonb
      else coalesce(
        jsonb_agg(
          jsonb_build_object('optionId', vote_counts.option_id, 'count', vote_counts.vote_count)
          order by vote_counts.option_id
        ) filter (where vote_counts.option_id is not null),
        '[]'::jsonb
      )
    end
  from public.polls poll
  join parent_link link
    on link.club_id = poll.club_id
   and (poll.team_id is null or poll.team_id = link.team_id)
  left join own_votes on own_votes.poll_id = poll.id
  left join vote_counts on vote_counts.poll_id = poll.id
  where poll.audience = 'parents'
    and poll.status = 'open'
    and (poll.closes_at is null or poll.closes_at > timezone('utc', now()))
  group by poll.id, own_votes.poll_id, own_votes.first_option_id, own_votes.option_ids
  order by poll.created_at desc;
$$;

alter function public.get_parent_portal_polls(uuid) owner to postgres;
revoke all on function public.get_parent_portal_polls(uuid) from public, anon, service_role;
grant execute on function public.get_parent_portal_polls(uuid) to authenticated;

create or replace function public.submit_parent_portal_poll_vote(
  parent_link_id_value uuid,
  poll_id_value uuid,
  option_id_value text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  link_row public.parent_player_links%rowtype;
  poll_row public.polls%rowtype;
  normalized_option_id text := btrim(coalesce(option_id_value, ''));
  selected_option jsonb;
  selected_player_id_value text;
  voter_email_value text;
  voter_name_value text;
  existing_vote_id uuid;
  current_vote_count integer;
  vote_id_value uuid;
begin
  if actor_id is null
    or parent_link_id_value is null
    or poll_id_value is null
    or normalized_option_id = ''
    or length(normalized_option_id) > 80
    or not public.current_user_has_active_authority()
    or public.current_user_role() <> 'parent_portal' then
    raise exception using errcode = '42501', message = 'parent_poll_unavailable';
  end if;

  select link.*
  into link_row
  from public.parent_player_links link
  where link.id = parent_link_id_value
    and link.auth_user_id = actor_id
    and link.status = 'active'
  for key share;

  if link_row.id is null then
    raise exception using errcode = '42501', message = 'parent_poll_unavailable';
  end if;

  select poll.*
  into poll_row
  from public.polls poll
  where poll.id = poll_id_value
    and poll.club_id = link_row.club_id
    and poll.audience = 'parents'
    and poll.status = 'open'
    and (poll.team_id is null or poll.team_id = link_row.team_id)
    and (poll.closes_at is null or poll.closes_at > timezone('utc', now()))
  for update;

  if poll_row.id is null then
    raise exception using errcode = '42501', message = 'parent_poll_unavailable';
  end if;

  select option_row
  into selected_option
  from jsonb_array_elements(poll_row.options) option_row
  where option_row ->> 'id' = normalized_option_id
  limit 1;

  if selected_option is null then
    raise exception using errcode = '22023', message = 'parent_poll_option_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(poll_row.id::text || ':' || actor_id::text, 0));

  select lower(app_user.email), coalesce(app_user.name, app_user.display_name, app_user.username, app_user.email)
  into voter_email_value, voter_name_value
  from public.users app_user
  where app_user.id = actor_id
  for key share;

  select vote.id
  into existing_vote_id
  from public.poll_votes vote
  where vote.poll_id = poll_row.id
    and vote.auth_user_id = actor_id
    and vote.option_id = normalized_option_id
  for update;

  if existing_vote_id is not null then
    return existing_vote_id;
  end if;

  if poll_row.allow_vote_changes is false and exists (
    select 1 from public.poll_votes vote
    where vote.poll_id = poll_row.id and vote.auth_user_id = actor_id
  ) then
    raise exception using errcode = '55000', message = 'parent_poll_vote_locked';
  end if;

  selected_player_id_value := nullif(selected_option ->> 'playerId', '');

  if poll_row.allow_own_child_votes is false
    and selected_player_id_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and selected_player_id_value::uuid = link_row.player_id then
    raise exception using errcode = '42501', message = 'parent_poll_vote_not_permitted';
  end if;

  if poll_row.allow_multiple is false then
    delete from public.poll_votes vote
    where vote.poll_id = poll_row.id and vote.auth_user_id = actor_id;
  else
    select count(*)::integer
    into current_vote_count
    from public.poll_votes vote
    where vote.poll_id = poll_row.id and vote.auth_user_id = actor_id;

    if poll_row.max_choices is not null and current_vote_count >= poll_row.max_choices then
      raise exception using errcode = '55000', message = 'parent_poll_vote_limit_reached';
    end if;
  end if;

  insert into public.poll_votes (
    poll_id,
    club_id,
    team_id,
    auth_user_id,
    voter_email,
    voter_name,
    option_id,
    parent_link_id
  )
  values (
    poll_row.id,
    poll_row.club_id,
    poll_row.team_id,
    actor_id,
    voter_email_value,
    voter_name_value,
    normalized_option_id,
    link_row.id
  )
  on conflict (poll_id, voter_email, option_id) do update
  set auth_user_id = excluded.auth_user_id,
      parent_link_id = excluded.parent_link_id,
      voter_name = excluded.voter_name,
      updated_at = timezone('utc', now())
  returning id into vote_id_value;

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    poll_row.club_id,
    actor_id,
    'parent_poll_vote_submitted',
    'poll',
    poll_row.id,
    jsonb_build_object('teamId', poll_row.team_id, 'parentLinkId', link_row.id, 'optionId', normalized_option_id)
  );

  return vote_id_value;
end;
$$;

alter function public.submit_parent_portal_poll_vote(uuid, uuid, text) owner to postgres;
revoke all on function public.submit_parent_portal_poll_vote(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.submit_parent_portal_poll_vote(uuid, uuid, text)
  to authenticated;

create or replace function public.create_match_day_motm_poll(target_match_day_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  option_rows jsonb;
  poll_id_value uuid;
  audit_actor_id uuid;
begin
  if target_match_day_id is null then
    return null;
  end if;

  select match_day.*
  into match_row
  from public.match_days match_day
  where match_day.id = target_match_day_id
  for update;

  if match_row.id is null then
    return null;
  end if;

  if match_row.status <> 'full_time'
    or match_row.enable_motm_poll is false
    or match_row.motm_poll_id is not null then
    return match_row.motm_poll_id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', player.id::text,
        'label', btrim(concat(
          coalesce(nullif(player.player_name, ''), 'Player'),
          case when nullif(player.shirt_number, '') is null then '' else ' #' || player.shirt_number end
        )),
        'playerId', player.id::text
      )
      order by player.player_name
    ),
    '[]'::jsonb
  )
  into option_rows
  from public.players player
  where player.club_id = match_row.club_id
    and player.archived_at is null
    and (match_row.team_id is null or player.team_id = match_row.team_id);

  if jsonb_array_length(option_rows) = 0 then
    return null;
  end if;

  insert into public.polls (
    club_id,
    team_id,
    title,
    description,
    audience,
    poll_type,
    options,
    status,
    closes_at,
    allow_multiple,
    max_choices,
    allow_own_child_votes,
    allow_vote_changes,
    hide_votes,
    allow_comments,
    created_by,
    created_by_name
  )
  values (
    match_row.club_id,
    match_row.team_id,
    'Player of the Match',
    'Vote for your Player of the Match: ' || coalesce(match_row.opponent, 'Match Day'),
    'parents',
    'awards',
    option_rows,
    'open',
    timezone('utc', now()) + make_interval(hours => greatest(coalesce(match_row.motm_poll_expiry_hours, 2), 1)),
    false,
    1,
    true,
    false,
    false,
    false,
    match_row.created_by,
    coalesce(match_row.created_by_name, 'Match Day')
  )
  returning id into poll_id_value;

  update public.match_days match_day
  set motm_poll_id = poll_id_value,
      updated_at = timezone('utc', now())
  where match_day.id = match_row.id;

  audit_actor_id := coalesce((select auth.uid()), match_row.created_by);

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    match_row.club_id,
    audit_actor_id,
    'match_day_poll_created',
    'poll',
    poll_id_value,
    jsonb_build_object('teamId', match_row.team_id, 'matchDayId', match_row.id, 'pollType', 'awards')
  );

  return poll_id_value;
end;
$$;

alter function public.create_match_day_motm_poll(uuid) owner to postgres;
revoke all on function public.create_match_day_motm_poll(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.create_match_day_motm_poll_on_full_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.demo_reset_skip_communication_sync', true) = 'on' then
    return new;
  end if;

  if new.status = 'full_time'
    and old.status is distinct from new.status
    and new.enable_motm_poll is true
    and new.motm_poll_id is null then
    perform public.create_match_day_motm_poll(new.id);
  end if;

  return new;
end;
$$;

alter function public.create_match_day_motm_poll_on_full_time() owner to postgres;
revoke all on function public.create_match_day_motm_poll_on_full_time()
  from public, anon, authenticated, service_role;

revoke all on table public.match_locations from anon;
revoke all on table public.polls from anon;
revoke all on table public.poll_votes from anon;
revoke all on table public.club_roles from anon;

revoke insert, update, delete, truncate, references, trigger
  on table public.match_locations from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.polls from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.poll_votes from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.club_roles from authenticated;

grant select on table public.match_locations to authenticated;
grant select on table public.polls to authenticated;
grant select on table public.poll_votes to authenticated;
grant select on table public.club_roles to authenticated;

drop policy if exists match_locations_staff_scoped on public.match_locations;
create policy match_locations_select_exact_authority
on public.match_locations
for select
to authenticated
using (
  public.current_user_has_active_authority()
  and club_id = public.current_user_club_id()
  and public.current_user_role() not in ('parent_portal', 'super_admin')
  and (
    public.current_user_role() = 'admin'
    or exists (
      select 1
      from public.teams team
      join public.team_staff assignment
        on assignment.team_id = team.id
       and assignment.user_id = (select auth.uid())
      where team.club_id = match_locations.club_id
        and coalesce(team.status, 'active') = 'active'
    )
  )
);

drop policy if exists polls_select_staff_scoped on public.polls;
drop policy if exists polls_insert_staff_scoped on public.polls;
drop policy if exists polls_update_staff_scoped on public.polls;
drop policy if exists polls_delete_staff_scoped on public.polls;
create policy polls_select_exact_authority
on public.polls
for select
to authenticated
using (
  public.current_user_has_active_authority()
  and club_id = public.current_user_club_id()
  and (
    public.current_user_role() = 'admin'
    or public.current_user_has_active_team_assignment(club_id, team_id)
  )
);

drop policy if exists poll_votes_select_staff_scoped on public.poll_votes;
drop policy if exists poll_votes_upsert_own_scoped on public.poll_votes;
drop policy if exists poll_votes_update_own_scoped on public.poll_votes;
drop policy if exists poll_votes_delete_own_scoped on public.poll_votes;
create policy poll_votes_select_exact_authority
on public.poll_votes
for select
to authenticated
using (
  public.current_user_has_active_authority()
  and club_id = public.current_user_club_id()
  and (
    public.current_user_role() = 'admin'
    or public.current_user_has_active_team_assignment(club_id, team_id)
  )
);

drop policy if exists club_roles_select_scoped on public.club_roles;
drop policy if exists club_roles_insert_scoped on public.club_roles;
drop policy if exists club_roles_update_scoped on public.club_roles;
drop policy if exists club_roles_delete_custom_only on public.club_roles;
create policy club_roles_select_exact_authority
on public.club_roles
for select
to authenticated
using (
  public.current_user_has_active_authority()
  and club_id = public.current_user_club_id()
  and public.current_user_role() <> 'super_admin'
);

drop policy if exists match_days_staff_insert_scoped on public.match_days;
create policy match_days_staff_insert_scoped
on public.match_days
for insert
to authenticated
with check (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
  and (
    location_id is null
    or exists (
      select 1
      from public.match_locations location
      where location.id = match_days.location_id
        and location.club_id = match_days.club_id
    )
  )
);

drop policy if exists match_days_staff_update_scoped on public.match_days;
create policy match_days_staff_update_scoped
on public.match_days
for update
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
)
with check (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
  and (
    location_id is null
    or exists (
      select 1
      from public.match_locations location
      where location.id = match_days.location_id
        and location.club_id = match_days.club_id
    )
  )
);

comment on function public.upsert_match_location_for_team(uuid, text, text, text) is
  'Authenticated Match Day location upsert. Derives club scope and requires current exact-team or Club Admin authority.';
comment on function public.create_team_poll(uuid, text, text, text, text, jsonb, timestamptz, boolean, integer, boolean, boolean, boolean, boolean, uuid) is
  'Authenticated poll creation with current database authority, exact-team scope and bounded fields.';
comment on function public.submit_staff_poll_vote(uuid, text) is
  'Authenticated staff vote wrapper with exact-team authority, poll locking and retry-safe uniqueness.';
comment on function public.submit_parent_portal_poll_vote(uuid, uuid, text) is
  'Authenticated parent vote wrapper with active-link scope, poll locking and retry-safe uniqueness.';
comment on function public.seed_default_club_roles() is
  'Authenticated Club Admin role seed wrapper. Scope is derived from current active authority.';
comment on function public.seed_default_club_roles_for_actor(uuid, uuid, text) is
  'Service-only onboarding wrapper. Revalidates the supplied actor against the deliberate platform or signup workflow.';
