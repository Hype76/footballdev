-- PARENT-DATA-SAFETY-03
-- Limit the parent portal match day player picker to the selected linked child.

create or replace function public.get_parent_portal_match_day_players(parent_link_id_value uuid)
returns table (
  id uuid,
  player_name text,
  shirt_number text,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  with parent_link as (
    select
      link.club_id,
      link.team_id,
      link.player_id
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = auth.uid()
      and link.status = 'active'
    limit 1
  )
  select
    player.id,
    player.player_name,
    coalesce(player.shirt_number, '') as shirt_number,
    coalesce(player.status, 'active') as status
  from public.players player
  join parent_link link
    on player.id = link.player_id
    and player.club_id = link.club_id
    and (
      link.team_id is null
      or player.team_id = link.team_id
    )
  where auth.uid() is not null
    and coalesce(player.status, 'active') <> 'archived'
    and player.section = 'Squad'
  order by player.player_name asc;
$$;

revoke all on function public.get_parent_portal_match_day_players(uuid) from public;
revoke execute on function public.get_parent_portal_match_day_players(uuid) from anon;
grant execute on function public.get_parent_portal_match_day_players(uuid) to authenticated;
grant execute on function public.get_parent_portal_match_day_players(uuid) to service_role;
