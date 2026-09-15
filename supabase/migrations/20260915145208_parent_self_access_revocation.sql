-- A Parent may leave one player's portal without a staff profile or contact-list entry.
-- Ownership is the authenticated account ID, never a supplied account or email.
create or replace function app_private.revoke_own_parent_player_access(target_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  revoked_count integer := 0;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Sign in before removing Parent access.';
  end if;
  if target_player_id is null then
    raise exception using errcode = '22023', message = 'Choose a player before removing Parent access.';
  end if;

  with recursive owned as materialized (
    select link.id, link.club_id, link.player_id
    from public.parent_player_links link
    where link.auth_user_id = actor_id
      and link.player_id = target_player_id
      and link.link_type in ('parent', 'family')
      and link.status <> 'revoked'
    order by link.id
    for update of link
  ), dependent_links(id, club_id, player_id) as (
    select owned.id, owned.club_id, owned.player_id from owned
    union
    select family.id, family.club_id, family.player_id
    from public.parent_player_links family
    join dependent_links parent on parent.id = family.parent_link_id
      and parent.player_id = family.player_id
      and parent.club_id = family.club_id
    where family.link_type = 'family'
  ), revoked as (
    update public.parent_player_links link
    set status = 'revoked',
        invite_token = pg_catalog.gen_random_uuid(),
        expires_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where link.id in (select dependent_links.id from dependent_links)
      and link.status <> 'revoked'
    returning link.id
  )
  select pg_catalog.count(*)::integer into revoked_count from revoked;

  -- Retain account IDs and acceptance history for audit and harmless repeat calls.
  -- Existing status-update triggers reconcile chat membership. Fan access checks
  -- require an active sponsoring Parent link, so dependent access ends immediately.
  -- Player contacts, other players, other Parents and notification preferences stay intact.
  return pg_catalog.jsonb_build_object('player_id', target_player_id, 'revoked_count', revoked_count);
end;
$$;

revoke all on function app_private.revoke_own_parent_player_access(uuid) from public, anon, authenticated, service_role;
grant execute on function app_private.revoke_own_parent_player_access(uuid) to authenticated;

create or replace function public.revoke_own_parent_player_access(target_player_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.revoke_own_parent_player_access(target_player_id);
$$;

revoke all on function public.revoke_own_parent_player_access(uuid) from public, anon, authenticated, service_role;
grant execute on function public.revoke_own_parent_player_access(uuid) to authenticated;

comment on function public.revoke_own_parent_player_access(uuid) is
  'Revokes the authenticated account own Parent/family grants and their dependent legacy family grants for one player; preserves contacts, account and unrelated access.';

-- Serialize invitation acceptance with revocation and check the token again at
-- the final update. An acceptance already in flight cannot reactivate a revoked link.

create or replace function public.accept_parent_player_link(invite_token_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  player_id uuid,
  parent_link_id uuid,
  link_type text,
  email text,
  auth_user_id uuid,
  invite_token uuid,
  status text,
  invited_by uuid,
  invited_by_name text,
  accepted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_email text := lower(btrim(coalesce((auth.jwt() ->> 'email'), '')));
  target_link public.parent_player_links%rowtype;
  target_email text;
begin
  if auth.uid() is null then
    raise exception 'Login is required before opening this Parent app link.';
  end if;

  if auth_email = '' then
    raise exception 'A verified Parent email is required before opening this link.';
  end if;

  select link.*
  into target_link
  from public.parent_player_links link
  where link.invite_token = invite_token_value
    and link.status <> 'revoked'
    and (
      exists (
        select 1
        from public.players player
        where player.id = link.player_id
          and lower(btrim(coalesce(player.section, ''))) in ('trial', 'squad')
          and lower(btrim(coalesce(player.status, 'active'))) <> 'archived'
          and player.archived_at is null
      )
      or (
        link.link_type = 'family'
        and exists (
          select 1
          from public.parent_player_links parent_link
          where parent_link.id = link.parent_link_id
            and parent_link.player_id = link.player_id
            and parent_link.status = 'active'
        )
      )
    )
  limit 1
  for update of link;

  if target_link.id is null then
    raise exception 'This Parent app link is only available for an active Trial or Squad player.';
  end if;

  target_email := lower(btrim(coalesce(target_link.email, '')));

  if target_link.expires_at is not null and target_link.expires_at <= timezone('utc', now()) then
    raise exception 'This Parent app link has expired. Ask the team to send a new link.';
  end if;

  if target_email <> '' and target_email <> auth_email then
    raise exception 'This Parent app link is for a different email address.';
  end if;

  if target_link.status = 'active' then
    if target_link.auth_user_id is distinct from auth.uid() then
      raise exception 'This Parent app link is already connected to another account.';
    end if;

    return query
    select
      target_link.id,
      target_link.club_id,
      target_link.team_id,
      target_link.player_id,
      target_link.parent_link_id,
      target_link.link_type,
      target_link.email,
      target_link.auth_user_id,
      target_link.invite_token,
      target_link.status,
      target_link.invited_by,
      target_link.invited_by_name,
      target_link.accepted_at,
      target_link.created_at,
      target_link.updated_at;
    return;
  end if;

  return query
  with existing_link as (
    select existing.*
    from public.parent_player_links existing
    where existing.id <> target_link.id
      and existing.status = 'active'
      and existing.team_id is not distinct from target_link.team_id
      and existing.player_id = target_link.player_id
      and existing.link_type = target_link.link_type
      and existing.auth_user_id = auth.uid()
      and lower(btrim(coalesce(existing.email, ''))) = auth_email
    order by existing.accepted_at desc nulls last, existing.created_at desc
    limit 1
  ),
  revoke_target as (
    update public.parent_player_links link
    set
      status = 'revoked',
      updated_at = timezone('utc', now())
    where link.id = target_link.id
      and exists (select 1 from existing_link)
    returning link.id
  ),
  accept_target as (
    update public.parent_player_links link
    set
      auth_user_id = auth.uid(),
      email = coalesce(nullif(link.email, ''), auth_email),
      status = 'active',
      accepted_at = coalesce(link.accepted_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
    where link.id = target_link.id
      and link.invite_token = invite_token_value
      and link.status <> 'revoked'
      and not exists (select 1 from existing_link)
    returning link.*
  ),
  selected_link as (
    select * from existing_link
    union all
    select * from accept_target
    limit 1
  )
  select
    selected_link.id,
    selected_link.club_id,
    selected_link.team_id,
    selected_link.player_id,
    selected_link.parent_link_id,
    selected_link.link_type,
    selected_link.email,
    selected_link.auth_user_id,
    selected_link.invite_token,
    selected_link.status,
    selected_link.invited_by,
    selected_link.invited_by_name,
    selected_link.accepted_at,
    selected_link.created_at,
    selected_link.updated_at
  from selected_link;
end;
$$;

revoke all on function public.accept_parent_player_link(uuid) from public, anon;
grant execute on function public.accept_parent_player_link(uuid) to authenticated, service_role;

comment on function public.accept_parent_player_link(uuid) is
  'Accepts active Trial or Squad Parent app access for the intended signed-in email while retaining family-link idempotency.';
