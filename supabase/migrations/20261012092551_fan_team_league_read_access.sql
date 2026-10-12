-- Accepted Fans may read their linked team league, as requested in the weekend feedback.
-- Active accounts and the original Parent sharing scope remain mandatory.
create or replace function public.get_parent_player_team_league_url(link_id_value uuid, link_type_value text)
returns table(team_id uuid, team_name text, league_url text, league_link_enabled boolean)
language plpgsql stable security definer set search_path = '' as $$
declare resolved_team_id uuid; resolved_club_id uuid;
begin
  if not app_private.team_league_account_active() then
    raise exception using errcode = '42501', message = 'Sign in to view the team league.';
  end if;
  if link_type_value = 'parent' then
    select player.team_id, player.club_id into resolved_team_id, resolved_club_id
    from public.parent_player_links link
    join public.players player on player.id = link.player_id and player.club_id = link.club_id
    where link.id = link_id_value and link.auth_user_id = auth.uid()
      and link.link_type = 'parent' and link.status = 'active'
      and player.archived_at is null and coalesce(player.status, 'active') <> 'archived'
      and (link.team_id is null or link.team_id = player.team_id)
      and public.current_user_can_access_parent_link(link.id, player.id);
  elsif link_type_value in ('player', 'fan') then
    select player.team_id, player.club_id into resolved_team_id, resolved_club_id
    from public.fan_connections connection
    join public.players player on player.id = connection.player_id and player.club_id = connection.club_id
    where connection.id = link_id_value and connection.auth_user_id = auth.uid()
      and (link_type_value = 'fan' or connection.relationship_type = 'player') and connection.status = 'active'
      and player.archived_at is null and coalesce(player.status, 'active') <> 'archived'
      and app_private.fan_scope_active(connection.parent_link_id, player.id, connection.club_id, connection.invited_by)
      and app_private.fan_account_active(auth.uid(), connection.club_id);
  else
    raise exception using errcode = '42501', message = 'Choose an authorised Parent, Player or Fan relationship.';
  end if;
  if resolved_team_id is null then
    raise exception using errcode = '42501', message = 'Choose an authorised Parent, Player or Fan relationship.';
  end if;
  return query select team.id, team.name,
    case when team.league_link_enabled then team.league_url else null end, team.league_link_enabled
  from public.teams team join public.clubs club on club.id = team.club_id
  where team.id = resolved_team_id and team.club_id = resolved_club_id and team.archived_at is null
    and coalesce(team.status, 'active') = 'active' and club.archived_at is null
    and coalesce(club.status, 'active') = 'active';
end;
$$;
alter function public.get_parent_player_team_league_url(uuid, text) owner to postgres;
revoke all on function public.get_parent_player_team_league_url(uuid, text) from public, anon, service_role;
grant execute on function public.get_parent_player_team_league_url(uuid, text) to authenticated;
