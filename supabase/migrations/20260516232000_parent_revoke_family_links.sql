create or replace function public.revoke_family_player_link(link_id_value uuid)
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
  updated_at timestamptz,
  expires_at timestamptz,
  invite_sent_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Login is required before removing Friends and Family access.';
  end if;

  update public.parent_player_links family_link
  set
    status = 'revoked',
    auth_user_id = null,
    accepted_at = null,
    updated_at = timezone('utc', now())
  where family_link.id = link_id_value
    and family_link.link_type = 'family'
    and family_link.status <> 'revoked'
    and exists (
      select 1
      from public.parent_player_links parent_link
      where parent_link.id = family_link.parent_link_id
        and parent_link.auth_user_id = auth.uid()
        and parent_link.status = 'active'
        and parent_link.player_id = family_link.player_id
    )
  returning
    family_link.id,
    family_link.club_id,
    family_link.team_id,
    family_link.player_id,
    family_link.parent_link_id,
    family_link.link_type,
    family_link.email,
    family_link.auth_user_id,
    family_link.invite_token,
    family_link.status,
    family_link.invited_by,
    family_link.invited_by_name,
    family_link.accepted_at,
    family_link.created_at,
    family_link.updated_at,
    family_link.expires_at,
    family_link.invite_sent_at
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
    updated_at,
    expires_at,
    invite_sent_at;

  if id is null then
    raise exception 'Friends and Family access could not be removed.';
  end if;

  return next;
end;
$$;

grant execute on function public.revoke_family_player_link(uuid) to authenticated;
