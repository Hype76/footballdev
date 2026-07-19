-- FP-SPR-001: keep application authority server-managed.
-- This migration changes grants, policies, functions, and triggers only.
-- It does not rewrite existing user, membership, or platform-admin rows.

revoke insert, update on table public.users from anon, authenticated;
revoke insert, update on table public.user_club_memberships from anon, authenticated;
revoke insert, update, delete on table public.platform_admins from anon, authenticated;

drop policy if exists users_insert_self on public.users;
drop policy if exists users_update_self_or_manager on public.users;
drop policy if exists user_club_memberships_insert_scoped on public.user_club_memberships;
drop policy if exists user_club_memberships_update_scoped on public.user_club_memberships;

create or replace function public.enforce_user_authority_write_boundary()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      raise exception using
        errcode = '42501',
        message = 'profile_creation_requires_an_authorized_server_workflow';
    end if;

    if old.id is distinct from new.id
      or old.email is distinct from new.email
      or old.role is distinct from new.role
      or old.club_id is distinct from new.club_id
      or old.role_label is distinct from new.role_label
      or old.role_rank is distinct from new.role_rank
      or old.force_password_change is distinct from new.force_password_change
      or old.status is distinct from new.status
      or old.suspended_at is distinct from new.suspended_at
      or old.created_at is distinct from new.created_at then
      raise exception using
        errcode = '42501',
        message = 'authority_fields_are_server_managed';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_user_authority_write_boundary() from public, anon, authenticated;

drop trigger if exists enforce_user_authority_write_boundary on public.users;
create trigger enforce_user_authority_write_boundary
before insert or update on public.users
for each row
execute function public.enforce_user_authority_write_boundary();

create or replace function public.enforce_membership_authority_write_boundary()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      raise exception using
        errcode = '42501',
        message = 'membership_creation_requires_an_authorized_server_workflow';
    end if;

    if old.id is distinct from new.id
      or old.auth_user_id is distinct from new.auth_user_id
      or old.email is distinct from new.email
      or old.role is distinct from new.role
      or old.role_label is distinct from new.role_label
      or old.role_rank is distinct from new.role_rank
      or old.club_id is distinct from new.club_id
      or old.created_at is distinct from new.created_at then
      raise exception using
        errcode = '42501',
        message = 'membership_authority_is_server_managed';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_membership_authority_write_boundary() from public, anon, authenticated;

drop trigger if exists enforce_membership_authority_write_boundary on public.user_club_memberships;
create trigger enforce_membership_authority_write_boundary
before insert or update on public.user_club_memberships
for each row
execute function public.enforce_membership_authority_write_boundary();

create or replace function public.current_user_has_active_authority()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = (select auth.uid())
      and u.status = 'active'
      and (
        (
          u.role = 'super_admin'
          and exists (
            select 1
            from public.platform_admins pa
            where pa.id = u.id
              and pa.status = 'active'
          )
        )
        or (
          u.role <> 'super_admin'
          and u.club_id is not null
          and exists (
            select 1
            from public.user_club_memberships m
            where m.auth_user_id = u.id
              and m.club_id = u.club_id
              and m.role = u.role
              and m.role_rank = u.role_rank
          )
          and exists (
            select 1
            from public.clubs c
            where c.id = u.club_id
              and coalesce(c.status, 'active') = 'active'
          )
        )
      )
  );
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select u.role
  from public.users u
  where u.id = (select auth.uid())
    and u.status = 'active'
    and (
      (
        u.role = 'super_admin'
        and exists (
          select 1
          from public.platform_admins pa
          where pa.id = u.id
            and pa.status = 'active'
        )
      )
      or (
        u.role <> 'super_admin'
        and u.club_id is not null
        and exists (
          select 1
            from public.user_club_memberships m
            where m.auth_user_id = u.id
              and m.club_id = u.club_id
              and m.role = u.role
              and m.role_rank = u.role_rank
        )
        and exists (
          select 1
          from public.clubs c
          where c.id = u.club_id
            and coalesce(c.status, 'active') = 'active'
        )
      )
    )
  limit 1;
$$;

create or replace function public.current_user_club_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select u.club_id
  from public.users u
  where u.id = (select auth.uid())
    and u.status = 'active'
    and (
      (
        u.role = 'super_admin'
        and exists (
          select 1
          from public.platform_admins pa
          where pa.id = u.id
            and pa.status = 'active'
        )
      )
      or (
        u.role <> 'super_admin'
        and u.club_id is not null
        and exists (
          select 1
            from public.user_club_memberships m
            where m.auth_user_id = u.id
              and m.club_id = u.club_id
              and m.role = u.role
              and m.role_rank = u.role_rank
        )
        and exists (
          select 1
          from public.clubs c
          where c.id = u.club_id
            and coalesce(c.status, 'active') = 'active'
        )
      )
    )
  limit 1;
$$;

create or replace function public.current_user_role_rank()
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(u.role_rank, 0)
  from public.users u
  where u.id = (select auth.uid())
    and u.status = 'active'
    and (
      (
        u.role = 'super_admin'
        and exists (
          select 1
          from public.platform_admins pa
          where pa.id = u.id
            and pa.status = 'active'
        )
      )
      or (
        u.role <> 'super_admin'
        and u.club_id is not null
        and exists (
          select 1
            from public.user_club_memberships m
            where m.auth_user_id = u.id
              and m.club_id = u.club_id
              and m.role = u.role
              and m.role_rank = u.role_rank
        )
        and exists (
          select 1
          from public.clubs c
          where c.id = u.club_id
            and coalesce(c.status, 'active') = 'active'
        )
      )
    )
  limit 1;
$$;

revoke all on function public.current_user_has_active_authority() from public, anon;
revoke all on function public.current_user_role() from public, anon;
revoke all on function public.current_user_club_id() from public, anon;
revoke all on function public.current_user_role_rank() from public, anon;
grant execute on function public.current_user_has_active_authority() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_club_id() to authenticated;
grant execute on function public.current_user_role_rank() to authenticated;

create or replace function public.user_belongs_to_current_club(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.users u
    join public.user_club_memberships m
      on m.auth_user_id = u.id
     and m.club_id = u.club_id
     and m.role = u.role
     and m.role_rank = u.role_rank
    where u.id = target_user_id
      and u.status = 'active'
      and u.club_id = public.current_user_club_id()
  );
$$;

revoke all on function public.user_belongs_to_current_club(uuid) from public, anon;
grant execute on function public.user_belongs_to_current_club(uuid) to authenticated;

create or replace function public.update_own_user_profile(
  profile_username text,
  profile_display_name text,
  profile_team_name text default null,
  profile_club_name text default null,
  profile_reply_to_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.users%rowtype;
  actor_club public.clubs%rowtype;
  updated_user public.users%rowtype;
  normalized_username text := btrim(coalesce(profile_username, ''));
  normalized_display_name text := btrim(coalesce(profile_display_name, ''));
  normalized_team_name text;
  normalized_club_name text;
  normalized_reply_to_email text;
  can_edit_sender_identity boolean := false;
  can_edit_club_identity boolean := false;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'login_required';
  end if;

  select *
  into actor
  from public.users u
  where u.id = (select auth.uid())
  for update;

  if actor.id is null or actor.status <> 'active' or not public.current_user_has_active_authority() then
    raise exception using errcode = '42501', message = 'profile_update_not_permitted';
  end if;

  normalized_team_name := case
    when profile_team_name is null then actor.team_name
    else btrim(profile_team_name)
  end;
  normalized_club_name := case
    when profile_club_name is null then actor.club_name
    else btrim(profile_club_name)
  end;
  normalized_reply_to_email := case
    when profile_reply_to_email is null then lower(btrim(actor.reply_to_email))
    else lower(btrim(profile_reply_to_email))
  end;

  if normalized_username = '' or char_length(normalized_username) > 120 then
    raise exception using errcode = '22023', message = 'invalid_profile_name';
  end if;

  if char_length(normalized_display_name) > 120
    or char_length(normalized_team_name) > 160
    or char_length(normalized_club_name) > 160
    or char_length(normalized_reply_to_email) > 254 then
    raise exception using errcode = '22023', message = 'invalid_profile_value';
  end if;

  if normalized_reply_to_email <> ''
    and normalized_reply_to_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'invalid_reply_email';
  end if;

  if actor.club_id is not null then
    select * into actor_club
    from public.clubs c
    where c.id = actor.club_id;
  end if;

  can_edit_sender_identity := actor.role = 'super_admin' or actor.role_rank >= 50;
  can_edit_club_identity := actor.role = 'super_admin'
    or actor.role = 'admin'
    or actor.role_rank >= 70
    or actor_club.plan_key = 'individual';

  if (
    actor.team_name is distinct from normalized_team_name
    or lower(btrim(actor.reply_to_email)) is distinct from normalized_reply_to_email
  ) and not can_edit_sender_identity then
    raise exception using errcode = '42501', message = 'profile_field_not_permitted';
  end if;

  if actor.club_name is distinct from normalized_club_name
    and not can_edit_club_identity then
    raise exception using errcode = '42501', message = 'profile_field_not_permitted';
  end if;

  update public.users u
  set username = normalized_username,
      name = normalized_username,
      display_name = normalized_display_name,
      team_name = normalized_team_name,
      club_name = normalized_club_name,
      reply_to_email = nullif(normalized_reply_to_email, '')
  where u.id = actor.id
  returning u.* into updated_user;

  update public.user_club_memberships m
  set username = normalized_username,
      name = normalized_username,
      updated_at = timezone('utc', now())
  where m.auth_user_id = actor.id;

  return to_jsonb(updated_user);
end;
$$;

create or replace function public.update_own_theme_settings(profile_mode text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  updated_user public.users%rowtype;
  normalized_mode text := lower(btrim(coalesce(profile_mode, '')));
begin
  if (select auth.uid()) is null
    or not public.current_user_has_active_authority() then
    raise exception using errcode = '42501', message = 'profile_update_not_permitted';
  end if;

  if normalized_mode not in ('system', 'dark', 'light') then
    raise exception using errcode = '22023', message = 'invalid_theme_mode';
  end if;

  update public.users u
  set theme_mode = normalized_mode
  where u.id = (select auth.uid())
    and u.status = 'active'
  returning u.* into updated_user;

  if updated_user.id is null then
    raise exception using errcode = '42501', message = 'profile_update_not_permitted';
  end if;

  return to_jsonb(updated_user);
end;
$$;

create or replace function public.update_own_onboarding_state(
  onboarding_operation text,
  onboarding_step_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  updated_user public.users%rowtype;
  normalized_operation text := lower(btrim(coalesce(onboarding_operation, '')));
  normalized_step_id text := btrim(coalesce(onboarding_step_id, ''));
begin
  if (select auth.uid()) is null
    or not public.current_user_has_active_authority() then
    raise exception using errcode = '42501', message = 'profile_update_not_permitted';
  end if;

  if normalized_operation = 'complete_step' then
    if normalized_step_id = '' or char_length(normalized_step_id) > 120 then
      raise exception using errcode = '22023', message = 'invalid_onboarding_step';
    end if;

    update public.users u
    set onboarding_completed_steps = case
          when coalesce(u.onboarding_completed_steps, '[]'::jsonb) ? normalized_step_id
            then coalesce(u.onboarding_completed_steps, '[]'::jsonb)
          else coalesce(u.onboarding_completed_steps, '[]'::jsonb) || to_jsonb(normalized_step_id)
        end,
        onboarding_dismissed_at = null
    where u.id = (select auth.uid())
      and u.status = 'active'
    returning u.* into updated_user;
  elsif normalized_operation = 'dismiss' then
    update public.users u
    set onboarding_dismissed_at = timezone('utc', now())
    where u.id = (select auth.uid())
      and u.status = 'active'
    returning u.* into updated_user;
  elsif normalized_operation = 'reopen' then
    update public.users u
    set onboarding_dismissed_at = null,
        onboarding_enabled = true
    where u.id = (select auth.uid())
      and u.status = 'active'
    returning u.* into updated_user;
  elsif normalized_operation = 'reset' then
    update public.users u
    set onboarding_completed_steps = '[]'::jsonb,
        onboarding_dismissed_at = null,
        onboarding_enabled = true,
        onboarding_reset_at = timezone('utc', now())
    where u.id = (select auth.uid())
      and u.status = 'active'
    returning u.* into updated_user;
  else
    raise exception using errcode = '22023', message = 'invalid_onboarding_operation';
  end if;

  if updated_user.id is null then
    raise exception using errcode = '42501', message = 'profile_update_not_permitted';
  end if;

  return to_jsonb(updated_user);
end;
$$;

create or replace function public.sync_own_user_email()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  authoritative_email text;
  updated_user public.users%rowtype;
begin
  if (select auth.uid()) is null
    or not public.current_user_has_active_authority() then
    raise exception using errcode = '42501', message = 'profile_update_not_permitted';
  end if;

  select lower(btrim(coalesce(au.email, '')))
  into authoritative_email
  from auth.users au
  where au.id = (select auth.uid());

  if authoritative_email is null or authoritative_email = '' then
    raise exception using errcode = '42501', message = 'authoritative_email_unavailable';
  end if;

  update public.users u
  set email = authoritative_email
  where u.id = (select auth.uid())
    and u.status = 'active'
  returning u.* into updated_user;

  update public.user_club_memberships m
  set email = authoritative_email,
      updated_at = timezone('utc', now())
  where m.auth_user_id = (select auth.uid());

  if updated_user.id is null then
    raise exception using errcode = '42501', message = 'profile_update_not_permitted';
  end if;

  return to_jsonb(updated_user);
end;
$$;

revoke all on function public.update_own_user_profile(text, text, text, text, text) from public, anon;
revoke all on function public.update_own_theme_settings(text) from public, anon;
revoke all on function public.update_own_onboarding_state(text, text) from public, anon;
revoke all on function public.sync_own_user_email() from public, anon;
grant execute on function public.update_own_user_profile(text, text, text, text, text) to authenticated;
grant execute on function public.update_own_theme_settings(text) to authenticated;
grant execute on function public.update_own_onboarding_state(text, text) to authenticated;
grant execute on function public.sync_own_user_email() to authenticated;

create or replace function public.accept_own_club_user_invites()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_email text;
  actor_name text;
  existing_user public.users%rowtype;
  invite record;
  membership_row public.user_club_memberships%rowtype;
  accepted_memberships jsonb := '[]'::jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'login_required';
  end if;

  select
    lower(btrim(coalesce(au.email, ''))),
    coalesce(
      nullif(btrim(au.raw_user_meta_data ->> 'username'), ''),
      nullif(btrim(au.raw_user_meta_data ->> 'name'), ''),
      split_part(lower(btrim(coalesce(au.email, ''))), '@', 1)
    )
  into actor_email, actor_name
  from auth.users au
  where au.id = actor_id;

  if actor_email is null or actor_email = '' then
    raise exception using errcode = '42501', message = 'authoritative_email_unavailable';
  end if;

  select *
  into existing_user
  from public.users u
  where u.id = actor_id
  for update;

  if existing_user.id is not null and existing_user.status <> 'active' then
    raise exception using errcode = '42501', message = 'invitation_acceptance_not_permitted';
  end if;

  for invite in
    select i.*
    from public.club_user_invites i
    where lower(i.email) = actor_email
      and i.accepted_at is null
      and (i.expires_at is null or i.expires_at > timezone('utc', now()))
      and exists (
        select 1
        from public.clubs c
        where c.id = i.club_id
          and coalesce(c.status, 'active') = 'active'
      )
    order by i.created_at, i.id
    for update
  loop
    insert into public.user_club_memberships (
      auth_user_id,
      email,
      username,
      name,
      role,
      role_label,
      role_rank,
      club_id,
      updated_at
    )
    values (
      actor_id,
      actor_email,
      actor_name,
      actor_name,
      invite.role_key,
      invite.role_label,
      invite.role_rank,
      invite.club_id,
      timezone('utc', now())
    )
    on conflict (auth_user_id, club_id) do update
    set email = excluded.email,
        username = excluded.username,
        name = excluded.name,
        role = excluded.role,
        role_label = excluded.role_label,
        role_rank = excluded.role_rank,
        updated_at = excluded.updated_at
    returning * into membership_row;

    if existing_user.id is null then
      insert into public.users (
        id,
        email,
        username,
        name,
        display_name,
        role,
        role_label,
        role_rank,
        club_id,
        force_password_change,
        status
      )
      values (
        actor_id,
        actor_email,
        actor_name,
        actor_name,
        actor_name,
        membership_row.role,
        membership_row.role_label,
        membership_row.role_rank,
        membership_row.club_id,
        false,
        'active'
      )
      returning * into existing_user;

      insert into public.audit_logs (
        club_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
      )
      values (
        membership_row.club_id,
        actor_id,
        'profile_created_from_staff_invitation',
        'user',
        actor_id,
        jsonb_build_object(
          'role', membership_row.role,
          'roleRank', membership_row.role_rank,
          'clubId', membership_row.club_id
        )
      );
    end if;

    if invite.team_id is not null then
      if not exists (
        select 1
        from public.teams t
        where t.id = invite.team_id
          and t.club_id = invite.club_id
      ) then
        raise exception using errcode = '22023', message = 'invitation_team_scope_invalid';
      end if;

      insert into public.team_staff (team_id, user_id)
      values (invite.team_id, actor_id)
      on conflict (team_id, user_id) do nothing;
    end if;

    update public.club_user_invites i
    set accepted_at = timezone('utc', now())
    where i.id = invite.id
      and i.accepted_at is null;

    accepted_memberships := accepted_memberships || jsonb_build_array(to_jsonb(membership_row));
  end loop;

  return accepted_memberships;
end;
$$;

create or replace function public.activate_own_club_membership(target_club_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_email text;
  current_profile public.users%rowtype;
  selected_membership public.user_club_memberships%rowtype;
  updated_user public.users%rowtype;
begin
  if actor_id is null or target_club_id is null then
    raise exception using errcode = '42501', message = 'membership_activation_not_permitted';
  end if;

  select lower(btrim(coalesce(au.email, '')))
  into actor_email
  from auth.users au
  where au.id = actor_id;

  if actor_email is null or actor_email = '' then
    raise exception using errcode = '42501', message = 'authoritative_email_unavailable';
  end if;

  select *
  into current_profile
  from public.users u
  where u.id = actor_id
  for update;

  if current_profile.id is null
    or current_profile.status <> 'active'
    or current_profile.role = 'super_admin' then
    raise exception using errcode = '42501', message = 'membership_activation_not_permitted';
  end if;

  select *
  into selected_membership
  from public.user_club_memberships m
  where m.auth_user_id = actor_id
    and m.club_id = target_club_id
    and exists (
      select 1
      from public.clubs c
      where c.id = m.club_id
        and coalesce(c.status, 'active') = 'active'
    )
  for update;

  if selected_membership.id is null then
    raise exception using errcode = '42501', message = 'membership_activation_not_permitted';
  end if;

  if lower(current_profile.email) = actor_email
    and current_profile.role = selected_membership.role
    and current_profile.role_label is not distinct from selected_membership.role_label
    and current_profile.role_rank = selected_membership.role_rank
    and current_profile.club_id = selected_membership.club_id then
    return to_jsonb(current_profile);
  end if;

  update public.users u
  set email = actor_email,
      username = coalesce(nullif(btrim(selected_membership.username), ''), u.username),
      name = coalesce(nullif(btrim(selected_membership.name), ''), u.name),
      role = selected_membership.role,
      role_label = selected_membership.role_label,
      role_rank = selected_membership.role_rank,
      club_id = selected_membership.club_id
  where u.id = actor_id
    and u.status = 'active'
  returning u.* into updated_user;

  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    updated_user.club_id,
    actor_id,
    'club_membership_activated',
    'user',
    actor_id,
    jsonb_build_object(
      'previousRole', current_profile.role,
      'previousRoleRank', current_profile.role_rank,
      'previousClubId', current_profile.club_id,
      'newRole', updated_user.role,
      'newRoleRank', updated_user.role_rank,
      'newClubId', updated_user.club_id
    )
  );

  return to_jsonb(updated_user);
end;
$$;

create or replace function public.set_club_user_role(
  target_user_id uuid,
  target_role_key text,
  target_team_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  actor public.users%rowtype;
  target public.users%rowtype;
  approved_role public.club_roles%rowtype;
  updated_user public.users%rowtype;
  actor_role text;
  actor_rank integer;
  actor_club_id uuid;
  membership_update_count integer := 0;
begin
  if actor_id is null or target_user_id is null or btrim(coalesce(target_role_key, '')) = '' then
    raise exception using errcode = '42501', message = 'authority_change_not_permitted';
  end if;

  select * into actor
  from public.users u
  where u.id = actor_id
  for update;

  actor_role := public.current_user_role();
  actor_rank := public.current_user_role_rank();
  actor_club_id := public.current_user_club_id();

  if actor.id is null or actor.status <> 'active' or actor_role is null then
    raise exception using errcode = '42501', message = 'authority_change_not_permitted';
  end if;

  if actor_id = target_user_id then
    raise exception using errcode = '42501', message = 'self_authority_change_not_permitted';
  end if;

  select * into target
  from public.users u
  where u.id = target_user_id
  for update;

  if target.id is null or target.status <> 'active' or target.role = 'super_admin' or target.club_id is null then
    raise exception using errcode = '42501', message = 'authority_change_not_permitted';
  end if;

  select * into approved_role
  from public.club_roles r
  where r.club_id = target.club_id
    and r.role_key = btrim(target_role_key)
  limit 1;

  if approved_role.id is null or approved_role.role_key = 'super_admin' then
    raise exception using errcode = '22023', message = 'approved_role_not_found';
  end if;

  if actor_role <> 'super_admin' and (
    actor_club_id is distinct from target.club_id
    or actor_rank < 50
    or target.role_rank > actor_rank
    or approved_role.role_rank > actor_rank
  ) then
    raise exception using errcode = '42501', message = 'authority_change_not_permitted';
  end if;

  if target_team_id is not null and not exists (
    select 1
    from public.teams t
    where t.id = target_team_id
      and t.club_id = target.club_id
  ) then
    raise exception using errcode = '22023', message = 'team_scope_invalid';
  end if;

  update public.users u
  set role = approved_role.role_key,
      role_label = approved_role.role_label,
      role_rank = approved_role.role_rank
  where u.id = target.id
    and u.club_id = target.club_id
    and u.status = 'active'
  returning u.* into updated_user;

  update public.user_club_memberships m
  set role = approved_role.role_key,
      role_label = approved_role.role_label,
      role_rank = approved_role.role_rank,
      updated_at = timezone('utc', now())
  where m.auth_user_id = target.id
    and m.club_id = target.club_id;

  get diagnostics membership_update_count = row_count;

  if membership_update_count <> 1 then
    raise exception using errcode = '42501', message = 'membership_authority_unavailable';
  end if;

  if target_team_id is not null then
    insert into public.team_staff (team_id, user_id)
    values (target_team_id, target.id)
    on conflict (team_id, user_id) do nothing;
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
    target.club_id,
    actor_id,
    'club_user_role_changed',
    'user',
    target.id,
    jsonb_build_object(
      'previousRole', target.role,
      'previousRoleLabel', target.role_label,
      'previousRoleRank', target.role_rank,
      'newRole', updated_user.role,
      'newRoleLabel', updated_user.role_label,
      'newRoleRank', updated_user.role_rank,
      'clubId', target.club_id,
      'teamId', target_team_id
    )
  );

  return to_jsonb(updated_user);
end;
$$;

create or replace function public.update_club_user_name(
  target_user_id uuid,
  target_name text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  actor public.users%rowtype;
  target public.users%rowtype;
  updated_user public.users%rowtype;
  actor_role text;
  actor_rank integer;
  actor_club_id uuid;
  normalized_name text := btrim(coalesce(target_name, ''));
begin
  if actor_id is null or target_user_id is null
    or normalized_name = '' or char_length(normalized_name) > 120 then
    raise exception using errcode = '22023', message = 'invalid_user_name';
  end if;

  select * into actor
  from public.users u
  where u.id = actor_id;

  actor_role := public.current_user_role();
  actor_rank := public.current_user_role_rank();
  actor_club_id := public.current_user_club_id();

  select * into target
  from public.users u
  where u.id = target_user_id
  for update;

  if actor.id is null or actor.status <> 'active' or actor_role is null
    or target.id is null or target.status <> 'active'
    or actor_id = target.id or target.role = 'super_admin' then
    raise exception using errcode = '42501', message = 'user_name_change_not_permitted';
  end if;

  if actor_role <> 'super_admin' and (
    actor_club_id is distinct from target.club_id
    or actor_rank < 50
    or target.role_rank > actor_rank
  ) then
    raise exception using errcode = '42501', message = 'user_name_change_not_permitted';
  end if;

  update public.users u
  set username = normalized_name,
      name = normalized_name
  where u.id = target.id
  returning u.* into updated_user;

  update public.user_club_memberships m
  set username = normalized_name,
      name = normalized_name,
      updated_at = timezone('utc', now())
  where m.auth_user_id = target.id;

  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    target.club_id,
    actor_id,
    'user_name_updated',
    'user',
    target.id,
    jsonb_build_object('clubId', target.club_id)
  );

  return to_jsonb(updated_user);
end;
$$;

create or replace function public.set_platform_user_status(
  target_user_id uuid,
  target_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  target public.users%rowtype;
  updated_user public.users%rowtype;
  normalized_status text := lower(btrim(coalesce(target_status, '')));
begin
  if actor_id is null
    or public.current_user_role() is distinct from 'super_admin'
    or target_user_id is null
    or target_user_id = actor_id then
    raise exception using errcode = '42501', message = 'status_change_not_permitted';
  end if;

  if normalized_status not in ('active', 'suspended') then
    raise exception using errcode = '22023', message = 'invalid_account_status';
  end if;

  select * into target
  from public.users u
  where u.id = target_user_id
  for update;

  if target.id is null or target.role = 'super_admin' then
    raise exception using errcode = '42501', message = 'status_change_not_permitted';
  end if;

  if target.status = normalized_status then
    return to_jsonb(target);
  end if;

  update public.users u
  set status = normalized_status,
      suspended_at = case
        when normalized_status = 'suspended' then timezone('utc', now())
        else null
      end
  where u.id = target.id
    and u.role <> 'super_admin'
  returning u.* into updated_user;

  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    target.club_id,
    actor_id,
    case when normalized_status = 'suspended' then 'user_suspended' else 'user_reactivated' end,
    'user',
    target.id,
    jsonb_build_object(
      'previousStatus', target.status,
      'newStatus', normalized_status,
      'clubId', target.club_id
    )
  );

  return to_jsonb(updated_user);
end;
$$;

revoke all on function public.accept_own_club_user_invites() from public, anon;
revoke all on function public.activate_own_club_membership(uuid) from public, anon;
revoke all on function public.set_club_user_role(uuid, text, uuid) from public, anon;
revoke all on function public.update_club_user_name(uuid, text) from public, anon;
revoke all on function public.set_platform_user_status(uuid, text) from public, anon;
grant execute on function public.accept_own_club_user_invites() to authenticated;
grant execute on function public.activate_own_club_membership(uuid) to authenticated;
grant execute on function public.set_club_user_role(uuid, text, uuid) to authenticated;
grant execute on function public.update_club_user_name(uuid, text) to authenticated;
grant execute on function public.set_platform_user_status(uuid, text) to authenticated;

comment on function public.update_own_user_profile(text, text, text, text, text)
is 'FP-SPR-001 safe self-service profile allowlist. Does not accept authority fields.';

comment on function public.activate_own_club_membership(uuid)
is 'FP-SPR-001 activates only an existing membership bound to auth.uid().' ;

comment on function public.set_club_user_role(uuid, text, uuid)
is 'FP-SPR-001 explicit scoped administrative role operation using server-derived role metadata.';
