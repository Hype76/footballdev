-- Share only the latest current carpool choice for each selected player.
-- Keep the existing names-only squad RPC unchanged for installed applications.
create or replace function app_private.parent_match_squad_transport(parent_link_id_value uuid)
returns table (match_day_id uuid, squad_players jsonb)
language sql stable security definer set search_path = ''
as $$
  with authorised_link as materialized (
    select link.id, link.club_id, link.team_id
    from public.parent_player_links link
    where link.id = parent_link_id_value and link.auth_user_id = (select auth.uid())
      and link.status = 'active' and link.link_type = 'parent' and link.team_id is not null
      and public.current_user_can_access_parent_link(link.id, link.player_id)
  ), visible_fixtures as materialized (
    select fixture.id, fixture.club_id, fixture.team_id
    from authorised_link link
    cross join lateral public.get_parent_portal_match_days(link.id) visible
    join public.match_days fixture on fixture.id = visible.id
      and fixture.club_id = link.club_id and fixture.team_id = link.team_id
    where fixture.deleted_at is null and fixture.previous_hidden_at is null
      and fixture.parent_visible and fixture.carpool_enabled
      and fixture.status not in ('cancelled', 'postponed', 'full_time') and fixture.concluded_at is null
  ), selected_players as (
  select fixture.id as match_day_id, player.id as player_id, pg_catalog.btrim(player.player_name) as player_name,
    coalesce(transport.transport_needs_lift, false) as needs_lift, coalesce(transport.transport_can_offer_lift, false) as can_offer_lift
  from visible_fixtures fixture
  join public.match_day_player_squad_decisions decision on decision.match_day_id = fixture.id
    and decision.club_id = fixture.club_id and decision.team_id = fixture.team_id and decision.status = 'selected'
  join public.players player on player.id = decision.player_id
    and player.club_id = fixture.club_id and player.team_id = fixture.team_id
    and coalesce(player.status, 'active') <> 'archived'
  left join lateral (
    select request.transport_needs_lift, request.transport_can_offer_lift
    from public.match_day_availability_requests request
    where request.match_day_id = fixture.id and request.club_id = fixture.club_id
      and request.team_id = fixture.team_id and request.player_id = player.id
      and request.transport_responded_at is not null
      and public.is_match_day_action_token_current_internal(request.token_hash)
    order by request.transport_responded_at desc, request.id desc
    limit 1
  ) transport on true
  where nullif(pg_catalog.btrim(player.player_name), '') is not null
  )
  select selected.match_day_id,
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('player_id', selected.player_id, 'player_name', selected.player_name,
      'needs_lift', selected.needs_lift, 'can_offer_lift', selected.can_offer_lift)
      order by pg_catalog.lower(selected.player_name), selected.player_name, selected.player_id)
  from selected_players selected
  group by selected.match_day_id order by selected.match_day_id;
$$;

revoke all on function app_private.parent_match_squad_transport(uuid) from public, anon;
grant execute on function app_private.parent_match_squad_transport(uuid) to authenticated;

create or replace function public.get_parent_portal_match_squad_transport(parent_link_id_value uuid)
returns table (match_day_id uuid, squad_players jsonb)
language sql stable security invoker set search_path = ''
as $$ select * from app_private.parent_match_squad_transport(parent_link_id_value); $$;
revoke all on function public.get_parent_portal_match_squad_transport(uuid) from public, anon;
grant execute on function public.get_parent_portal_match_squad_transport(uuid) to authenticated;

comment on function public.get_parent_portal_match_squad_transport(uuid) is
  'Active Parent accounts can read selected players and latest current transport choices for their authorised visible carpool-enabled fixtures. No contact details or response tokens are returned.';
