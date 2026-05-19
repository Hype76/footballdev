alter table public.parent_player_links
add column if not exists expires_at timestamptz;

alter table public.parent_player_links
alter column expires_at set default (timezone('utc', now()) + interval '24 hours');

update public.parent_player_links
set expires_at = coalesce(created_at, timezone('utc', now())) + interval '24 hours'
where expires_at is null;

create index if not exists parent_player_links_expires_idx
on public.parent_player_links (status, expires_at);

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
set search_path = public
as $$
declare
  auth_email text := lower(coalesce((auth.jwt() ->> 'email'), ''));
  target_link public.parent_player_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Login is required before opening this parent link.';
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
          and lower(trim(coalesce(player.section, ''))) = 'squad'
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
  limit 1;

  if target_link.id is null then
    raise exception 'This parent link is only available after parent portal access is active for a Squad player.';
  end if;

  if target_link.expires_at is not null and target_link.expires_at <= timezone('utc', now()) then
    raise exception 'This parent link has expired. Ask the team to send a new parent portal link.';
  end if;

  if target_link.status = 'active' then
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
      and lower(coalesce(existing.email, '')) = auth_email
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

grant execute on function public.accept_parent_player_link(uuid) to authenticated;
