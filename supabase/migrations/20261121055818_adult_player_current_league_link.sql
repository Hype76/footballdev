-- Expose only the enabled team league for the signed-in, verified Player.
create function public.get_own_adult_player_team_league_url(link_id_value uuid)
returns table(team_id uuid, team_name text, league_url text, league_link_enabled boolean)
language sql stable security definer set search_path = '' as $$
  select team.id, team.name, case when team.league_link_enabled then team.league_url end, team.league_link_enabled
  from app_private.own_adult_player_portal_context() actor
  join public.teams team on team.id = actor.team_id and team.club_id = actor.club_id
  where actor.user_id = (select auth.uid()) and actor.link_id = link_id_value
    and team.status = 'active' and team.archived_at is null;
$$;
revoke all on function public.get_own_adult_player_team_league_url(uuid) from public, anon, service_role;
grant execute on function public.get_own_adult_player_team_league_url(uuid) to authenticated;
