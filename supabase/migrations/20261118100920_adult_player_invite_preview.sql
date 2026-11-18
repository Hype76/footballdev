create function public.preview_adult_player_setup_invite(invite_token uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  invite app_private.adult_player_setup_invites;
  player_row public.players;
  club_name text;
  team_name text;
begin
  select * into invite from app_private.adult_player_setup_invites where token = invite_token;
  select * into player_row from public.players where id = invite.player_id;
  if invite.player_id is null or player_row.id is null
    or invite.team_id is distinct from player_row.team_id
    or invite.email is distinct from app_private.adult_player_setup_email(player_row) then
    return jsonb_build_object('state', 'invalid');
  end if;
  if invite.accepted_at is null and invite.expires_at <= now() then
    return jsonb_build_object('state', 'invalid');
  end if;
  select c.name, t.name into club_name, team_name from public.clubs c
    join public.teams t on t.club_id = c.id
    where c.id = player_row.club_id and t.id = player_row.team_id;
  if club_name is null or team_name is null then
    return jsonb_build_object('state', 'invalid');
  end if;
  return jsonb_build_object('state', case when invite.accepted_at is null then 'pending' else 'accepted' end,
    'clubId', player_row.club_id, 'teamId', player_row.team_id, 'clubName', club_name, 'teamName', team_name);
end;
$$;
revoke all on function public.preview_adult_player_setup_invite(uuid) from public, anon, authenticated;
grant execute on function public.preview_adult_player_setup_invite(uuid) to service_role;
