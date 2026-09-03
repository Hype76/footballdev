-- Squad membership is the coach's current selection, independent of attendance.
-- Keep the existing RPC shape for installed Parent app versions.
create or replace function public.get_parent_portal_confirmed_teams(parent_link_id_value uuid)
returns table (
  match_day_id uuid,
  selected_player_names text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with authorised_link as materialized (
    select link.id, link.club_id, link.team_id
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = (select auth.uid())
      and link.status = 'active'
      and link.team_id is not null
    limit 1
  ),
  visible_fixtures as materialized (
    select fixture.id as match_day_id, fixture.club_id, fixture.team_id
    from authorised_link link
    cross join lateral public.get_parent_portal_match_days(link.id) fixture
    where fixture.club_id = link.club_id
      and fixture.team_id = link.team_id
  ),
  selected_players as materialized (
    select distinct
      fixture.match_day_id,
      decision.player_id,
      pg_catalog.btrim(player.player_name) as player_name
    from visible_fixtures fixture
    join public.match_day_player_squad_decisions decision
      on decision.match_day_id = fixture.match_day_id
      and decision.club_id = fixture.club_id
      and decision.team_id = fixture.team_id
      and decision.status = 'selected'
    join public.players player
      on player.id = decision.player_id
      and player.club_id = fixture.club_id
      and player.team_id = fixture.team_id
    where coalesce(player.status, 'active') <> 'archived'
      and nullif(pg_catalog.btrim(player.player_name), '') is not null
  )
  select
    fixture.match_day_id,
    coalesce(
      pg_catalog.array_agg(
        selected.player_name
        order by pg_catalog.lower(selected.player_name), selected.player_name, selected.player_id
      ) filter (where selected.player_id is not null),
      '{}'::text[]
    ) as selected_player_names
  from visible_fixtures fixture
  left join selected_players selected
    on selected.match_day_id = fixture.match_day_id
  group by fixture.match_day_id
  order by fixture.match_day_id;
$$;

revoke all on function public.get_parent_portal_confirmed_teams(uuid) from public;
revoke execute on function public.get_parent_portal_confirmed_teams(uuid) from anon;
grant execute on function public.get_parent_portal_confirmed_teams(uuid) to authenticated;
grant execute on function public.get_parent_portal_confirmed_teams(uuid) to service_role;

comment on function public.get_parent_portal_confirmed_teams(uuid) is
  'Returns ordered display names for current selected players in authorised parent-visible fixtures. Attendance does not filter the selected squad.';
