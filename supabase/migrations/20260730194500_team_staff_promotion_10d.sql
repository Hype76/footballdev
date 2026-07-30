-- FP-V1-TEAM-STAFF-PROMOTION-10D
-- Restores contextual Manager role promotion within the canonical rank model.
-- Team Admin has a grant ceiling of 70 and Manager has a grant ceiling of 50.
-- Global profile roles are never changed by this team-scoped function.

alter function public.change_staff_role_assignment(uuid, text, text)
  set schema app_private;

alter function app_private.change_staff_role_assignment(uuid, text, text)
  rename to change_staff_role_assignment_legacy_10d;

revoke all on function app_private.change_staff_role_assignment_legacy_10d(uuid, text, text)
  from public, anon, authenticated, service_role;

comment on function app_private.change_staff_role_assignment_legacy_10d(uuid, text, text) is
  'Retains the approved Platform Admin club-role branch for the Phase 10D public wrapper.';

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
  approved_role public.club_roles%rowtype;
  target_team public.teams%rowtype;
  actor_is_platform_admin boolean := false;
  actor_has_global_team_authority boolean := false;
  actor_role_label text;
  actor_role_rank integer := 0;
  remaining_team_admins integer := 0;
  updated_assignment public.team_staff%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object(
      'success', false,
      'category', 'unauthenticated',
      'message', 'Login is required.'
    );
  end if;

  select app_user.*
  into actor
  from public.users app_user
  where app_user.id = auth.uid()
    and app_user.status = 'active'
  for key share;

  if actor.id is null
    or p_assignment_id is null
    or btrim(coalesce(p_target_role_key, '')) = '' then
    return jsonb_build_object(
      'success', false,
      'category', 'invalid_request',
      'message', 'The role change request is invalid.'
    );
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

  if team_assignment.id is null then
    return app_private.change_staff_role_assignment_legacy_10d(
      p_assignment_id,
      p_target_role_key,
      p_request_source
    );
  end if;

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
    and role_definition.role_key in (
      'head_manager',
      'manager',
      'coach',
      'assistant_coach'
    )
  limit 1;

  select assignment.*
  into actor_team_assignment
  from public.team_staff assignment
  where assignment.team_id = target_team.id
    and assignment.user_id = actor.id
  for key share;

  actor_has_global_team_authority := actor_is_platform_admin
    or (
      actor.role = 'admin'
      and actor.club_id = target_team.club_id
    );

  actor_role_label := case
    when actor_is_platform_admin then 'Platform Admin'
    when actor.role = 'admin' and actor.club_id = target_team.club_id
      then coalesce(actor.role_label, 'Club Admin')
    else actor_team_assignment.role_label
  end;

  actor_role_rank := case
    when actor_is_platform_admin then 100
    when actor.role = 'admin' and actor.club_id = target_team.club_id
      then actor.role_rank
    else coalesce(actor_team_assignment.role_rank, 0)
  end;

  if target_team.id is null or target_user.id is null then
    perform app_private.record_staff_role_change_audit(
      actor.id,
      actor_role_label,
      actor_role_rank,
      target_team.club_id,
      team_assignment.team_id,
      team_assignment.id,
      team_assignment.user_id,
      team_assignment.role_key,
      p_target_role_key,
      p_request_source,
      'denied',
      'assignment_inactive'
    );

    return jsonb_build_object(
      'success', false,
      'category', 'assignment_inactive',
      'message', 'This staff assignment is no longer active.'
    );
  end if;

  if approved_role.id is null then
    perform app_private.record_staff_role_change_audit(
      actor.id,
      actor_role_label,
      actor_role_rank,
      target_team.club_id,
      target_team.id,
      team_assignment.id,
      target_user.id,
      team_assignment.role_key,
      p_target_role_key,
      p_request_source,
      'denied',
      'role_not_supported'
    );

    return jsonb_build_object(
      'success', false,
      'category', 'role_not_supported',
      'message', 'That role is not supported for team staff.'
    );
  end if;

  if target_user.role in ('admin', 'super_admin') then
    perform app_private.record_staff_role_change_audit(
      actor.id,
      actor_role_label,
      actor_role_rank,
      target_team.club_id,
      target_team.id,
      team_assignment.id,
      target_user.id,
      team_assignment.role_key,
      approved_role.role_key,
      p_request_source,
      'denied',
      'protected_assignment'
    );

    return jsonb_build_object(
      'success', false,
      'category', 'protected_assignment',
      'message', 'Platform Admin and Club Admin assignments cannot be changed from a team control.'
    );
  end if;

  if target_user.club_id is distinct from target_team.club_id then
    perform app_private.record_staff_role_change_audit(
      actor.id,
      actor_role_label,
      actor_role_rank,
      target_team.club_id,
      target_team.id,
      team_assignment.id,
      target_user.id,
      team_assignment.role_key,
      approved_role.role_key,
      p_request_source,
      'denied',
      'cross_club_target'
    );

    return jsonb_build_object(
      'success', false,
      'category', 'cross_club_target',
      'message', 'The staff assignment does not belong to this club.'
    );
  end if;

  if not actor_has_global_team_authority
    and not (
      actor.club_id = target_team.club_id
      and actor_team_assignment.id is not null
      and actor_team_assignment.role_key in ('head_manager', 'manager')
      and actor_team_assignment.role_rank >= 50
    ) then
    perform app_private.record_staff_role_change_audit(
      actor.id,
      actor_role_label,
      actor_role_rank,
      target_team.club_id,
      target_team.id,
      team_assignment.id,
      target_user.id,
      team_assignment.role_key,
      approved_role.role_key,
      p_request_source,
      'denied',
      'team_scope_forbidden'
    );

    return jsonb_build_object(
      'success', false,
      'category', 'team_scope_forbidden',
      'message', 'You can change roles only for teams you manage.'
    );
  end if;

  if not actor_has_global_team_authority
    and team_assignment.role_rank > actor_team_assignment.role_rank then
    perform app_private.record_staff_role_change_audit(
      actor.id,
      actor_role_label,
      actor_role_rank,
      target_team.club_id,
      target_team.id,
      team_assignment.id,
      target_user.id,
      team_assignment.role_key,
      approved_role.role_key,
      p_request_source,
      'denied',
      'target_above_grant_ceiling'
    );

    return jsonb_build_object(
      'success', false,
      'category', 'target_above_grant_ceiling',
      'message', 'You cannot change a team role above your grant ceiling.'
    );
  end if;

  if not actor_has_global_team_authority
    and approved_role.role_rank > actor_team_assignment.role_rank then
    perform app_private.record_staff_role_change_audit(
      actor.id,
      actor_role_label,
      actor_role_rank,
      target_team.club_id,
      target_team.id,
      team_assignment.id,
      target_user.id,
      team_assignment.role_key,
      approved_role.role_key,
      p_request_source,
      'denied',
      'grant_ceiling_exceeded'
    );

    return jsonb_build_object(
      'success', false,
      'category', 'grant_ceiling_exceeded',
      'message', 'That role is above your team-role grant ceiling.'
    );
  end if;

  if team_assignment.role_key = 'head_manager'
    and approved_role.role_key <> 'head_manager' then
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
        actor.id,
        actor_role_label,
        actor_role_rank,
        target_team.club_id,
        target_team.id,
        team_assignment.id,
        target_user.id,
        team_assignment.role_key,
        approved_role.role_key,
        p_request_source,
        'denied',
        'final_team_admin'
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
    actor.id,
    actor_role_label,
    actor_role_rank,
    target_team.club_id,
    target_team.id,
    updated_assignment.id,
    target_user.id,
    team_assignment.role_key,
    updated_assignment.role_key,
    p_request_source,
    'success',
    null
  );

  return jsonb_build_object(
    'success', true,
    'scopeType', 'team',
    'assignment', to_jsonb(updated_assignment),
    'teamId', target_team.id,
    'clubId', target_team.club_id,
    'actorRole', actor_role_label,
    'grantCeiling', actor_role_rank
  );
end;
$$;

alter function public.change_staff_role_assignment(uuid, text, text)
  owner to postgres;

revoke all on function public.change_staff_role_assignment(uuid, text, text)
  from public, anon;

grant execute on function public.change_staff_role_assignment(uuid, text, text)
  to authenticated;

comment on function public.change_staff_role_assignment(uuid, text, text) is
  'Changes a canonical club or team staff assignment. Team Admin may grant through rank 70 and Manager through rank 50, with same-team, same-club, protected-role and final-admin enforcement.';
