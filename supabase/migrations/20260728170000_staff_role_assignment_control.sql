-- FP-V1-STAFF-ROLE-CONTROL-01C
-- Adds contextual team roles to the existing team_staff assignment model.
-- Role transitions remain server-authoritative and do not send communication.

alter table public.team_staff
  add column if not exists role_key text,
  add column if not exists role_label text,
  add column if not exists role_rank integer,
  add column if not exists updated_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_by uuid references public.users (id) on delete set null;

insert into public.club_roles (
  club_id,
  role_key,
  role_label,
  role_rank,
  is_system
)
select distinct
  team.club_id,
  supported_role.role_key,
  supported_role.role_label,
  supported_role.role_rank,
  true
from public.team_staff assignment
join public.teams team
  on team.id = assignment.team_id
cross join (
  values
    ('head_manager', 'Team Admin', 70),
    ('manager', 'Manager', 50),
    ('coach', 'Coach', 30),
    ('assistant_coach', 'Assistant Coach', 20)
) as supported_role(role_key, role_label, role_rank)
on conflict (club_id, role_key) do nothing;

update public.team_staff assignment
set role_key = case
      when app_user.role in ('head_manager', 'manager', 'coach', 'assistant_coach') then app_user.role
      else 'coach'
    end
from public.users app_user
where app_user.id = assignment.user_id
  and assignment.role_key is null;

update public.team_staff assignment
set role_label = role_definition.role_label,
    role_rank = role_definition.role_rank
from public.teams team
join public.club_roles role_definition
  on role_definition.club_id = team.club_id
where team.id = assignment.team_id
  and role_definition.role_key = assignment.role_key
  and (assignment.role_label is null or assignment.role_rank is null);

alter table public.team_staff
  alter column role_key set not null,
  alter column role_label set not null,
  alter column role_rank set not null;

alter table public.team_staff
  drop constraint if exists team_staff_contextual_role_key_check,
  add constraint team_staff_contextual_role_key_check
    check (role_key in ('head_manager', 'manager', 'coach', 'assistant_coach'));

create index if not exists team_staff_team_role_active_idx
  on public.team_staff (team_id, role_key, user_id);

create or replace function app_private.protect_final_platform_admin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  remaining_active_platform_admins integer := 0;
begin
  if old.status <> 'active'
    or (tg_op = 'UPDATE' and new.status = 'active') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  lock table public.platform_admins in share row exclusive mode;

  select count(*)::integer
  into remaining_active_platform_admins
  from public.platform_admins platform_access
  join public.users app_user
    on app_user.id = platform_access.id
   and app_user.role = 'super_admin'
   and app_user.status = 'active'
  where platform_access.status = 'active'
    and platform_access.id <> old.id;

  if remaining_active_platform_admins = 0 then
    raise exception using
      errcode = '23514',
      message = 'final_platform_admin',
      detail = 'Another active Platform Admin must exist before removing or deactivating the final Platform Admin.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function app_private.protect_final_platform_admin()
  from public, anon, authenticated, service_role;

drop trigger if exists protect_final_platform_admin on public.platform_admins;
create trigger protect_final_platform_admin
before delete or update of status
on public.platform_admins
for each row
execute function app_private.protect_final_platform_admin();

create or replace function app_private.apply_team_staff_role_registry()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  assignment_club_id uuid;
  fallback_role_key text;
  approved_role public.club_roles%rowtype;
begin
  select team.club_id
  into assignment_club_id
  from public.teams team
  where team.id = new.team_id;

  if assignment_club_id is null then
    raise exception using errcode = '22023', message = 'team_scope_invalid';
  end if;

  if new.role_key is null or btrim(new.role_key) = '' then
    select case
      when app_user.role in ('head_manager', 'manager', 'coach', 'assistant_coach') then app_user.role
      else 'coach'
    end
    into fallback_role_key
    from public.users app_user
    where app_user.id = new.user_id;

    new.role_key := coalesce(fallback_role_key, 'coach');
  end if;

  select role_definition.*
  into approved_role
  from public.club_roles role_definition
  where role_definition.club_id = assignment_club_id
    and role_definition.role_key = btrim(new.role_key)
    and role_definition.role_key in ('head_manager', 'manager', 'coach', 'assistant_coach')
  limit 1;

  if approved_role.id is null then
    raise exception using errcode = '22023', message = 'team_role_not_supported';
  end if;

  new.role_key := approved_role.role_key;
  new.role_label := approved_role.role_label;
  new.role_rank := approved_role.role_rank;
  new.updated_at := timezone('utc', now());

  return new;
end;
$$;

revoke all on function app_private.apply_team_staff_role_registry()
  from public, anon, authenticated, service_role;

drop trigger if exists apply_team_staff_role_registry on public.team_staff;
create trigger apply_team_staff_role_registry
before insert or update of role_key, role_label, role_rank
on public.team_staff
for each row
execute function app_private.apply_team_staff_role_registry();

create or replace function public.current_user_team_role_rank(target_team_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when app_user.role in ('super_admin', 'admin') then app_user.role_rank
    else coalesce(assignment.role_rank, 0)
  end
  from public.users app_user
  left join public.team_staff assignment
    on assignment.user_id = app_user.id
   and assignment.team_id = target_team_id
  where app_user.id = auth.uid()
    and app_user.status = 'active'
  limit 1;
$$;

revoke all on function public.current_user_team_role_rank(uuid) from public, anon;
grant execute on function public.current_user_team_role_rank(uuid) to authenticated, service_role;

revoke insert, update, delete on table public.team_staff from authenticated;
grant select, insert, update, delete on table public.team_staff to service_role;

drop policy if exists team_staff_insert_exact_authority on public.team_staff;
drop policy if exists team_staff_delete_exact_authority on public.team_staff;

drop policy if exists teams_update_exact_authority on public.teams;
create policy teams_update_exact_authority
on public.teams
for update
to authenticated
using (
  public.current_user_can_access_team(club_id, id)
  and (
    public.current_user_role() in ('admin', 'super_admin')
    or public.current_user_team_role_rank(id) >= 50
  )
)
with check (
  public.current_user_can_access_team(club_id, id)
  and (
    public.current_user_role() in ('admin', 'super_admin')
    or public.current_user_team_role_rank(id) >= 50
  )
);

drop policy if exists teams_delete_exact_authority on public.teams;
create policy teams_delete_exact_authority
on public.teams
for delete
to authenticated
using (
  public.current_user_can_access_team(club_id, id)
  and (
    public.current_user_role() in ('admin', 'super_admin')
    or public.current_user_team_role_rank(id) >= 50
  )
);

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
  assignment public.team_staff%rowtype;
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

  if p_team_id is null then
    return false;
  end if;

  select team_assignment.*
  into assignment
  from public.teams team
  join public.team_staff team_assignment
    on team_assignment.team_id = team.id
   and team_assignment.user_id = p_actor_id
  where team.id = p_team_id
    and team.club_id = p_club_id
    and coalesce(team.status, 'active') = 'active'
  for key share of team, team_assignment;

  return assignment.id is not null
    and assignment.role_rank >= p_minimum_rank;
end;
$$;

alter function app_private.actor_can_manage_team_resource(uuid, uuid, uuid, integer) owner to postgres;
revoke all on function app_private.actor_can_manage_team_resource(uuid, uuid, uuid, integer)
  from public, anon, authenticated, service_role;

create or replace function app_private.record_staff_role_change_audit(
  p_actor_id uuid,
  p_actor_role_label text,
  p_actor_role_rank integer,
  p_club_id uuid,
  p_team_id uuid,
  p_assignment_id uuid,
  p_target_user_id uuid,
  p_previous_role text,
  p_new_role text,
  p_request_source text,
  p_outcome text,
  p_denial_category text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_id uuid;
  actor_name text;
begin
  select coalesce(nullif(app_user.username, ''), nullif(app_user.name, ''), 'User')
  into actor_name
  from public.users app_user
  where app_user.id = p_actor_id;

  insert into public.audit_logs (
    club_id,
    actor_id,
    actor_name,
    actor_email,
    actor_role_label,
    actor_role_rank,
    action,
    entity_type,
    entity_id,
    metadata,
    event_category,
    severity,
    outcome,
    source
  )
  values (
    p_club_id,
    p_actor_id,
    coalesce(actor_name, 'User'),
    '',
    coalesce(nullif(p_actor_role_label, ''), 'Unknown'),
    coalesce(p_actor_role_rank, 0),
    case when p_outcome = 'success' then 'staff_role_changed' else 'staff_role_change_denied' end,
    'staff_role_assignment',
    p_assignment_id,
    jsonb_strip_nulls(jsonb_build_object(
      'assignmentId', p_assignment_id,
      'targetUserId', p_target_user_id,
      'clubId', p_club_id,
      'teamId', p_team_id,
      'previousRole', p_previous_role,
      'newRole', p_new_role,
      'requestSource', left(btrim(coalesce(p_request_source, 'application')), 80),
      'result', p_outcome,
      'denialCategory', p_denial_category
    )),
    'authority',
    case when p_outcome = 'success' then 'notice' else 'warning' end,
    case when p_outcome = 'success' then 'success' else 'denied' end,
    'database'
  )
  returning id into event_id;

  return event_id;
end;
$$;

revoke all on function app_private.record_staff_role_change_audit(
  uuid, text, integer, uuid, uuid, uuid, uuid, text, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function public.change_staff_role_assignment(
  p_assignment_id uuid,
  p_target_role_key text,
  p_request_source text default 'application'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  actor public.users%rowtype;
  target_user public.users%rowtype;
  team_assignment public.team_staff%rowtype;
  actor_team_assignment public.team_staff%rowtype;
  membership_assignment public.user_club_memberships%rowtype;
  approved_role public.club_roles%rowtype;
  target_team public.teams%rowtype;
  target_club public.clubs%rowtype;
  actor_is_platform_admin boolean := false;
  actor_role_label text;
  actor_role_rank integer := 0;
  remaining_team_admins integer := 0;
  remaining_club_admins integer := 0;
  updated_assignment public.team_staff%rowtype;
  updated_membership public.user_club_memberships%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'category', 'unauthenticated', 'message', 'Login is required.');
  end if;

  select app_user.*
  into actor
  from public.users app_user
  where app_user.id = auth.uid()
    and app_user.status = 'active'
  for key share;

  if actor.id is null or p_assignment_id is null or btrim(coalesce(p_target_role_key, '')) = '' then
    return jsonb_build_object('success', false, 'category', 'invalid_request', 'message', 'The role change request is invalid.');
  end if;

  select exists (
    select 1
    from public.platform_admins platform_access
    where platform_access.id = actor.id
      and platform_access.status = 'active'
  ) and actor.role = 'super_admin'
  into actor_is_platform_admin;

  select assignment.*
  into team_assignment
  from public.team_staff assignment
  where assignment.id = p_assignment_id
  for update;

  if team_assignment.id is not null then
    select team.*
    into target_team
    from public.teams team
    where team.id = team_assignment.team_id
      and coalesce(team.status, 'active') = 'active'
    for update;

    select app_user.*
    into target_user
    from public.users app_user
    where app_user.id = team_assignment.user_id
      and app_user.status = 'active'
    for key share;

    select role_definition.*
    into approved_role
    from public.club_roles role_definition
    where role_definition.club_id = target_team.club_id
      and role_definition.role_key = btrim(p_target_role_key)
      and role_definition.role_key in ('head_manager', 'manager', 'coach', 'assistant_coach')
    limit 1;

    select assignment.*
    into actor_team_assignment
    from public.team_staff assignment
    where assignment.team_id = target_team.id
      and assignment.user_id = actor.id
    for key share;

    actor_role_label := case
      when actor_is_platform_admin then 'Platform Admin'
      when actor.role = 'admin' and actor.club_id = target_team.club_id then coalesce(actor.role_label, 'Club Admin')
      else actor_team_assignment.role_label
    end;
    actor_role_rank := case
      when actor_is_platform_admin then 100
      when actor.role = 'admin' and actor.club_id = target_team.club_id then actor.role_rank
      else coalesce(actor_team_assignment.role_rank, 0)
    end;

    if target_team.id is null or target_user.id is null then
      perform app_private.record_staff_role_change_audit(
        actor.id, actor_role_label, actor_role_rank, target_team.club_id, team_assignment.team_id,
        team_assignment.id, team_assignment.user_id, team_assignment.role_key, p_target_role_key,
        p_request_source, 'denied', 'assignment_inactive'
      );
      return jsonb_build_object('success', false, 'category', 'assignment_inactive', 'message', 'This staff assignment is no longer active.');
    end if;

    if approved_role.id is null then
      perform app_private.record_staff_role_change_audit(
        actor.id, actor_role_label, actor_role_rank, target_team.club_id, target_team.id,
        team_assignment.id, target_user.id, team_assignment.role_key, p_target_role_key,
        p_request_source, 'denied', 'role_not_supported'
      );
      return jsonb_build_object('success', false, 'category', 'role_not_supported', 'message', 'That role is not supported for team staff.');
    end if;

    if target_user.role in ('admin', 'super_admin') then
      perform app_private.record_staff_role_change_audit(
        actor.id, actor_role_label, actor_role_rank, target_team.club_id, target_team.id,
        team_assignment.id, target_user.id, team_assignment.role_key, approved_role.role_key,
        p_request_source, 'denied', 'protected_assignment'
      );
      return jsonb_build_object('success', false, 'category', 'protected_assignment', 'message', 'Platform Admin and Club Admin assignments cannot be changed from a team control.');
    end if;

    if not actor_is_platform_admin
      and not (
        actor.role = 'admin'
        and actor.club_id = target_team.club_id
      )
      and not (
        actor.club_id = target_team.club_id
        and actor_team_assignment.id is not null
        and actor_team_assignment.role_key = 'head_manager'
        and actor_team_assignment.role_rank >= approved_role.role_rank
      ) then
      perform app_private.record_staff_role_change_audit(
        actor.id, actor_role_label, actor_role_rank, target_team.club_id, target_team.id,
        team_assignment.id, target_user.id, team_assignment.role_key, approved_role.role_key,
        p_request_source, 'denied', 'team_scope_forbidden'
      );
      return jsonb_build_object('success', false, 'category', 'team_scope_forbidden', 'message', 'You can change roles only for teams you administer.');
    end if;

    if team_assignment.role_key = 'head_manager' and approved_role.role_key <> 'head_manager' then
      select count(*)::integer
      into remaining_team_admins
      from public.team_staff other_assignment
      join public.users other_user
        on other_user.id = other_assignment.user_id
       and other_user.status = 'active'
       and other_user.role not in ('admin', 'super_admin')
      where other_assignment.team_id = target_team.id
        and other_assignment.role_key = 'head_manager'
        and other_assignment.id <> team_assignment.id;

      if remaining_team_admins = 0 then
        perform app_private.record_staff_role_change_audit(
          actor.id, actor_role_label, actor_role_rank, target_team.club_id, target_team.id,
          team_assignment.id, target_user.id, team_assignment.role_key, approved_role.role_key,
          p_request_source, 'denied', 'final_team_admin'
        );
        return jsonb_build_object(
          'success', false,
          'category', 'final_team_admin',
          'message', 'Assign another active Team Admin before demoting the final Team Admin.'
        );
      end if;
    end if;

    update public.team_staff assignment
    set role_key = approved_role.role_key,
        updated_by = actor.id
    where assignment.id = team_assignment.id
      and assignment.team_id = target_team.id
    returning assignment.* into updated_assignment;

    perform app_private.record_staff_role_change_audit(
      actor.id, actor_role_label, actor_role_rank, target_team.club_id, target_team.id,
      updated_assignment.id, target_user.id, team_assignment.role_key, updated_assignment.role_key,
      p_request_source, 'success', null
    );

    return jsonb_build_object(
      'success', true,
      'scopeType', 'team',
      'assignment', to_jsonb(updated_assignment),
      'teamId', target_team.id,
      'clubId', target_team.club_id
    );
  end if;

  select membership.*
  into membership_assignment
  from public.user_club_memberships membership
  where membership.id = p_assignment_id
  for update;

  if membership_assignment.id is null then
    perform app_private.record_staff_role_change_audit(
      actor.id, coalesce(actor.role_label, actor.role), actor.role_rank, actor.club_id, null,
      p_assignment_id, null, null, p_target_role_key, p_request_source, 'denied', 'assignment_not_found'
    );
    return jsonb_build_object('success', false, 'category', 'assignment_not_found', 'message', 'This staff assignment could not be found.');
  end if;

  select club.*
  into target_club
  from public.clubs club
  where club.id = membership_assignment.club_id
  for update;

  select app_user.*
  into target_user
  from public.users app_user
  where app_user.id = membership_assignment.auth_user_id
    and app_user.club_id = membership_assignment.club_id
    and app_user.status = 'active'
  for update;

  select role_definition.*
  into approved_role
  from public.club_roles role_definition
  where role_definition.club_id = membership_assignment.club_id
    and role_definition.role_key = btrim(p_target_role_key)
    and role_definition.role_key <> 'super_admin'
  limit 1;

  if not actor_is_platform_admin then
    perform app_private.record_staff_role_change_audit(
      actor.id, coalesce(actor.role_label, actor.role), actor.role_rank, membership_assignment.club_id, null,
      membership_assignment.id, membership_assignment.auth_user_id, membership_assignment.role, p_target_role_key,
      p_request_source, 'denied', 'platform_scope_forbidden'
    );
    return jsonb_build_object('success', false, 'category', 'platform_scope_forbidden', 'message', 'Platform Admin access is required for club role changes.');
  end if;

  if target_user.id is null or target_club.id is null then
    perform app_private.record_staff_role_change_audit(
      actor.id, 'Platform Admin', 100, membership_assignment.club_id, null,
      membership_assignment.id, membership_assignment.auth_user_id, membership_assignment.role, p_target_role_key,
      p_request_source, 'denied', 'assignment_inactive'
    );
    return jsonb_build_object('success', false, 'category', 'assignment_inactive', 'message', 'This staff assignment is no longer active.');
  end if;

  if exists (
    select 1
    from public.platform_admins platform_access
    where platform_access.id = target_user.id
      and platform_access.status = 'active'
  ) then
    perform app_private.record_staff_role_change_audit(
      actor.id, 'Platform Admin', 100, membership_assignment.club_id, null,
      membership_assignment.id, target_user.id, membership_assignment.role, p_target_role_key,
      p_request_source, 'denied', 'protected_assignment'
    );
    return jsonb_build_object(
      'success', false,
      'category', 'protected_assignment',
      'message', 'A Platform Admin assignment cannot be changed through a club role control.'
    );
  end if;

  if approved_role.id is null then
    perform app_private.record_staff_role_change_audit(
      actor.id, 'Platform Admin', 100, membership_assignment.club_id, null,
      membership_assignment.id, membership_assignment.auth_user_id, membership_assignment.role, p_target_role_key,
      p_request_source, 'denied', 'role_not_supported'
    );
    return jsonb_build_object('success', false, 'category', 'role_not_supported', 'message', 'That club role is not supported.');
  end if;

  if membership_assignment.role = 'admin' and approved_role.role_key <> 'admin' then
    select count(*)::integer
    into remaining_club_admins
    from public.user_club_memberships other_membership
    join public.users other_user
      on other_user.id = other_membership.auth_user_id
     and other_user.status = 'active'
    where other_membership.club_id = membership_assignment.club_id
      and other_membership.role = 'admin'
      and other_membership.id <> membership_assignment.id;

    if remaining_club_admins = 0 then
      perform app_private.record_staff_role_change_audit(
        actor.id, 'Platform Admin', 100, membership_assignment.club_id, null,
        membership_assignment.id, target_user.id, membership_assignment.role, approved_role.role_key,
        p_request_source, 'denied', 'final_club_admin'
      );
      return jsonb_build_object(
        'success', false,
        'category', 'final_club_admin',
        'message', 'Assign another active Club Admin before changing the final Club Admin.'
      );
    end if;
  end if;

  update public.user_club_memberships membership
  set role = approved_role.role_key,
      role_label = approved_role.role_label,
      role_rank = approved_role.role_rank,
      updated_at = timezone('utc', now())
  where membership.id = membership_assignment.id
  returning membership.* into updated_membership;

  update public.users app_user
  set role = approved_role.role_key,
      role_label = approved_role.role_label,
      role_rank = approved_role.role_rank
  where app_user.id = target_user.id
    and app_user.club_id = membership_assignment.club_id
    and app_user.status = 'active';

  perform app_private.record_staff_role_change_audit(
    actor.id, 'Platform Admin', 100, membership_assignment.club_id, null,
    updated_membership.id, target_user.id, membership_assignment.role, updated_membership.role,
    p_request_source, 'success', null
  );

  return jsonb_build_object(
    'success', true,
    'scopeType', 'club',
    'assignment', to_jsonb(updated_membership),
    'user', jsonb_build_object(
      'id', target_user.id,
      'role', updated_membership.role,
      'role_label', updated_membership.role_label,
      'role_rank', updated_membership.role_rank
    ),
    'clubId', membership_assignment.club_id
  );
end;
$$;

revoke all on function public.change_staff_role_assignment(uuid, text, text) from public, anon;
grant execute on function public.change_staff_role_assignment(uuid, text, text) to authenticated;

create or replace function public.assign_team_staff_role(
  p_target_user_id uuid,
  p_team_id uuid,
  p_target_role_key text,
  p_request_source text default 'application'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  actor public.users%rowtype;
  target_user public.users%rowtype;
  target_team public.teams%rowtype;
  actor_assignment public.team_staff%rowtype;
  existing_assignment public.team_staff%rowtype;
  approved_role public.club_roles%rowtype;
  saved_assignment public.team_staff%rowtype;
  actor_role_label text;
  actor_role_rank integer := 0;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'category', 'unauthenticated', 'message', 'Login is required.');
  end if;

  select app_user.*
  into actor
  from public.users app_user
  where app_user.id = auth.uid()
    and app_user.status = 'active'
  for key share;

  select team.*
  into target_team
  from public.teams team
  where team.id = p_team_id
    and coalesce(team.status, 'active') = 'active'
  for update;

  select app_user.*
  into target_user
  from public.users app_user
  where app_user.id = p_target_user_id
    and app_user.club_id = target_team.club_id
    and app_user.status = 'active'
  for key share;

  select assignment.*
  into actor_assignment
  from public.team_staff assignment
  where assignment.team_id = target_team.id
    and assignment.user_id = actor.id
  for key share;

  select role_definition.*
  into approved_role
  from public.club_roles role_definition
  where role_definition.club_id = target_team.club_id
    and role_definition.role_key = btrim(coalesce(p_target_role_key, ''))
    and role_definition.role_key in ('head_manager', 'manager', 'coach', 'assistant_coach')
  limit 1;

  actor_role_label := case
    when actor.role = 'admin' and actor.club_id = target_team.club_id then coalesce(actor.role_label, 'Club Admin')
    else actor_assignment.role_label
  end;
  actor_role_rank := case
    when actor.role = 'admin' and actor.club_id = target_team.club_id then actor.role_rank
    else coalesce(actor_assignment.role_rank, 0)
  end;

  if actor.id is null then
    return jsonb_build_object('success', false, 'category', 'invalid_assignment', 'message', 'This team staff assignment is invalid.');
  end if;

  if target_team.id is null or target_user.id is null or approved_role.id is null then
    perform app_private.record_staff_role_change_audit(
      actor.id, coalesce(actor.role_label, actor.role), actor.role_rank, coalesce(target_team.club_id, actor.club_id),
      p_team_id, null, p_target_user_id, null, p_target_role_key,
      p_request_source, 'denied', 'invalid_assignment'
    );
    return jsonb_build_object('success', false, 'category', 'invalid_assignment', 'message', 'This team staff assignment is invalid.');
  end if;

  if target_user.role in ('admin', 'super_admin') then
    perform app_private.record_staff_role_change_audit(
      actor.id, actor_role_label, actor_role_rank, target_team.club_id, target_team.id,
      null, target_user.id, null, approved_role.role_key,
      p_request_source, 'denied', 'protected_assignment'
    );
    return jsonb_build_object('success', false, 'category', 'protected_assignment', 'message', 'Platform Admin and Club Admin assignments cannot be changed from a team control.');
  end if;

  if not (
    actor.role = 'admin'
    and actor.club_id = target_team.club_id
  ) and not (
    actor.club_id = target_team.club_id
    and actor_assignment.id is not null
    and actor_assignment.role_key = 'head_manager'
    and actor_assignment.role_rank >= 50
    and actor_assignment.role_rank >= approved_role.role_rank
  ) then
    perform app_private.record_staff_role_change_audit(
      actor.id, actor_role_label, actor_role_rank, target_team.club_id, target_team.id,
      null, target_user.id, null, approved_role.role_key,
      p_request_source, 'denied', 'team_scope_forbidden'
    );
    return jsonb_build_object('success', false, 'category', 'team_scope_forbidden', 'message', 'You cannot assign that team role.');
  end if;

  select assignment.*
  into existing_assignment
  from public.team_staff assignment
  where assignment.team_id = target_team.id
    and assignment.user_id = target_user.id
  for update;

  if existing_assignment.id is not null then
    return public.change_staff_role_assignment(
      existing_assignment.id,
      approved_role.role_key,
      p_request_source
    );
  end if;

  insert into public.team_staff (
    team_id,
    user_id,
    role_key,
    updated_by
  )
  values (
    target_team.id,
    target_user.id,
    approved_role.role_key,
    actor.id
  )
  on conflict (team_id, user_id) do update
  set role_key = excluded.role_key,
      updated_by = excluded.updated_by
  returning * into saved_assignment;

  perform app_private.record_staff_role_change_audit(
    actor.id, actor_role_label, actor_role_rank, target_team.club_id, target_team.id,
    saved_assignment.id, target_user.id, null, saved_assignment.role_key,
    p_request_source, 'success', null
  );

  return jsonb_build_object(
    'success', true,
    'scopeType', 'team',
    'assignment', to_jsonb(saved_assignment),
    'teamId', target_team.id,
    'clubId', target_team.club_id
  );
end;
$$;

revoke all on function public.assign_team_staff_role(uuid, uuid, text, text) from public, anon;
grant execute on function public.assign_team_staff_role(uuid, uuid, text, text) to authenticated;

comment on function public.change_staff_role_assignment(uuid, text, text) is
  'Changes a canonical club or team staff assignment after server-side scope, transition and final-admin checks.';
comment on function public.assign_team_staff_role(uuid, uuid, text, text) is
  'Creates or updates a contextual team staff role without changing the user club role.';
comment on function public.current_user_team_role_rank(uuid) is
  'Returns the authenticated user contextual role rank for one team, with existing club and platform admin authority preserved.';
