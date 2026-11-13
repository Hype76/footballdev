create or replace function public.claim_staff_invitations_v1(actor_id uuid, target_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  team_ids uuid[];
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
  where au.id = actor_id
    and au.email_confirmed_at is not null
    and (au.banned_until is null or au.banned_until <= now())
    and au.deleted_at is null;

  if (actor_email is null or actor_email = '') and target_token is null then
    return accepted_memberships;
  end if;
  if actor_email is null or actor_email = '' then
    raise exception using errcode = '42501', message = 'authoritative_email_unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('staff-invite:' || actor_id::text, 0));

  select *
  into existing_user
  from public.users u
  where u.id = actor_id
  for update;

  if existing_user.id is not null and existing_user.status <> 'active' and target_token is null then
    return accepted_memberships;
  end if;
  if existing_user.id is not null and existing_user.status <> 'active' then
    raise exception using errcode = '42501', message = 'invitation_acceptance_not_permitted';
  end if;

  for invite in
    select i.*
    from public.club_user_invites i
    where lower(i.email) = actor_email
      and (target_token is null or i.invite_token = target_token)
      and i.status = 'pending'
      and i.cancelled_at is null
      and i.replaced_at is null
      and i.accepted_at is null
      and (i.expires_at is null or i.expires_at > timezone('utc', now()))
      and exists (
        select 1
        from public.clubs c
        where c.id = i.club_id
          and c.status = 'active'
      )
    order by i.created_at, i.id
    for update
  loop
    select coalesce(array_agg(t.id order by t.id), '{}') into team_ids
    from public.teams t
    where t.club_id = invite.club_id and t.status = 'active'
      and (t.id = invite.team_id or exists (
        select 1 from public.club_user_invite_teams assignment
        where assignment.invite_id = invite.id and assignment.team_id = t.id
      ));

    if (invite.team_id is not null or invite.role_key = 'head_manager'
      or exists (select 1 from public.club_user_invite_teams assignment where assignment.invite_id = invite.id))
      and cardinality(team_ids) = 0 then
      if target_token is null then
        continue;
      end if;
      raise exception using errcode = '22023', message = 'invitation_team_scope_invalid';
    end if;

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
      coalesce(existing_user.username, actor_name),
      coalesce(existing_user.name, actor_name),
      invite.role_key,
      invite.role_label,
      invite.role_rank,
      invite.club_id,
      timezone('utc', now())
    )
    on conflict (auth_user_id, club_id) do update
    set email = excluded.email,
        role = case when excluded.role_rank > user_club_memberships.role_rank then excluded.role else user_club_memberships.role end,
        role_label = case when excluded.role_rank > user_club_memberships.role_rank then excluded.role_label else user_club_memberships.role_label end,
        role_rank = greatest(excluded.role_rank, user_club_memberships.role_rank),
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

    insert into public.team_staff (team_id, user_id, role_key)
    select team_id, actor_id, case
      when invite.role_key in ('head_manager', 'manager', 'coach', 'assistant_coach') then invite.role_key
      else 'coach'
    end
    from unnest(team_ids) as assigned(team_id)
    on conflict (team_id, user_id) do nothing;

    update public.club_user_invites i
    set accepted_at = timezone('utc', now())
    where i.id = invite.id
      and i.accepted_at is null;

    accepted_memberships := accepted_memberships || jsonb_build_array(to_jsonb(membership_row));
  end loop;

  -- A sign-in can claim the same invitation while the invite page is open.
  if target_token is not null and jsonb_array_length(accepted_memberships) = 0 then
    select m.* into membership_row
    from public.club_user_invites i
    join public.user_club_memberships m on m.club_id = i.club_id and m.auth_user_id = actor_id
    join public.clubs c on c.id = i.club_id and c.status = 'active'
    where i.invite_token = target_token and lower(i.email) = actor_email
      and i.status = 'accepted' and i.accepted_at is not null;
    if found then
      return jsonb_build_array(to_jsonb(membership_row));
    end if;
  end if;

  return accepted_memberships;
end;
$$;

revoke all on function public.claim_staff_invitations_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_staff_invitations_v1(uuid, uuid) to service_role;

create or replace function public.accept_own_club_user_invites()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, auth
as $$
  select public.claim_staff_invitations_v1(auth.uid(), null);
$$;
