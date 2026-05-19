create or replace function public.current_user_can_access_parent_player(
  target_player_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.parent_player_links link
    where link.auth_user_id = auth.uid()
      and link.status = 'active'
      and link.player_id = target_player_id
  );
$$;

create or replace function public.current_user_can_access_parent_team(
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.parent_player_links link
    left join public.players player
      on player.id = link.player_id
    where link.auth_user_id = auth.uid()
      and link.status = 'active'
      and target_team_id is not null
      and (
        link.team_id = target_team_id
        or player.team_id = target_team_id
      )
  );
$$;

revoke all on function public.current_user_can_access_parent_player(uuid) from public;
grant execute on function public.current_user_can_access_parent_player(uuid) to authenticated;

revoke all on function public.current_user_can_access_parent_team(uuid) from public;
grant execute on function public.current_user_can_access_parent_team(uuid) to authenticated;

drop policy if exists players_select_parent_portal_linked on public.players;
create policy players_select_parent_portal_linked
on public.players
for select
to authenticated
using (
  public.current_user_can_access_parent_player(players.id)
);

drop policy if exists teams_select_parent_portal_linked on public.teams;
create policy teams_select_parent_portal_linked
on public.teams
for select
to authenticated
using (
  public.current_user_can_access_parent_team(teams.id)
);
