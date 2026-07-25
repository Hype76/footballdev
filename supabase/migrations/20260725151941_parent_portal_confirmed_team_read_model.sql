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
    select
      link.id,
      link.club_id,
      link.team_id,
      link.player_id
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = (select auth.uid())
      and link.status = 'active'
      and link.team_id is not null
    limit 1
  ),
  visible_fixtures as materialized (
    select distinct
      fixture.id as match_day_id,
      fixture.club_id,
      fixture.team_id
    from authorised_link link
    join public.match_days fixture
      on fixture.club_id = link.club_id
      and fixture.team_id = link.team_id
    where fixture.deleted_at is null
      and fixture.parent_visible is true
      and fixture.parent_audience <> 'none'
      and fixture.status in (
        'scorer_request',
        'live',
        'half_time',
        'second_half',
        'extra_time',
        'penalties',
        'full_time',
        'scheduled'
      )
      and fixture.previous_hidden_at is null
      and (
        fixture.match_date is null
        or fixture.match_date >= (pg_catalog.timezone('Europe/London', pg_catalog.now())::date - 365)
      )
      and (
        fixture.parent_audience in ('all_team_parents', 'all_club_parents')
        or (
          fixture.parent_audience = 'involved_players'
          and (
            exists (
              select 1
              from public.match_day_availability_requests request
              where request.match_day_id = fixture.id
                and request.club_id = link.club_id
                and request.player_id = link.player_id
                and request.status <> 'expired'
            )
            or exists (
              select 1
              from public.calendar_event_invites invite
              where invite.match_day_id = fixture.id
                and invite.club_id = link.club_id
                and invite.team_id = link.team_id
                and invite.player_id = link.player_id
                and invite.invite_status <> 'cancelled'
                and invite.response_requirement = 'informational'
            )
          )
        )
      )
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
    where nullif(pg_catalog.btrim(player.player_name), '') is not null
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
  'Returns only ordered staff-selected player display names for parent-visible fixtures in the authenticated parent link team.';

-- Repair procedure:
-- 1. Revoke execute from authenticated and service_role.
-- 2. Drop public.get_parent_portal_confirmed_teams(uuid).
-- 3. Roll the application back to the previous production commit.
