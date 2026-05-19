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
begin
  if auth.uid() is null then
    raise exception 'Login is required before opening this parent link.';
  end if;

  update public.parent_player_links link
  set
    auth_user_id = auth.uid(),
    email = coalesce(nullif(link.email, ''), auth_email),
    status = 'active',
    accepted_at = coalesce(link.accepted_at, timezone('utc', now())),
    updated_at = timezone('utc', now())
  where link.invite_token = invite_token_value
    and link.status <> 'revoked'
    and exists (
      select 1
      from public.players player
      where player.id = link.player_id
        and player.section = 'Squad'
    )
  returning
    link.id,
    link.club_id,
    link.team_id,
    link.player_id,
    link.parent_link_id,
    link.link_type,
    link.email,
    link.auth_user_id,
    link.invite_token,
    link.status,
    link.invited_by,
    link.invited_by_name,
    link.accepted_at,
    link.created_at,
    link.updated_at
  into
    id,
    club_id,
    team_id,
    player_id,
    parent_link_id,
    link_type,
    email,
    auth_user_id,
    invite_token,
    status,
    invited_by,
    invited_by_name,
    accepted_at,
    created_at,
    updated_at;

  if id is null then
    raise exception 'This parent link is only available after the player has moved to Squad.';
  end if;

  return next;
end;
$$;

grant execute on function public.accept_parent_player_link(uuid) to authenticated;
