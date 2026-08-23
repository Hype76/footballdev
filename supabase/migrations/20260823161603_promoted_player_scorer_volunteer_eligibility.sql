begin;

create or replace function app_private.match_day_scorer_link_eligibility(
  match_day_id_value uuid,
  parent_link_id_value uuid
)
returns table (
  eligible boolean,
  reason text,
  auth_user_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  match_row public.match_days%rowtype;
  eligible_link record;
begin
  select * into match_row
  from public.match_days
  where id = match_day_id_value;

  if match_row.id is null or match_row.deleted_at is not null then
    return query select false, 'This fixture is no longer available.'::text, null::uuid;
    return;
  end if;

  if match_row.concluded_at is not null
    or match_row.status in ('cancelled', 'postponed', 'full_time') then
    return query select false, 'The scorer cannot be changed for a closed match.'::text, null::uuid;
    return;
  end if;

  select parent_link.auth_user_id
  into eligible_link
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = match_row.club_id
   and player.status in ('active', 'promoted')
   and player.section = 'Squad'
   and player.archived_at is null
  where parent_link.id = parent_link_id_value
    and parent_link.club_id = match_row.club_id
    and parent_link.link_type = 'parent'
    and parent_link.status = 'active'
    and parent_link.auth_user_id is not null
    and (
      match_row.team_id is null
      or parent_link.team_id is null
      or parent_link.team_id = match_row.team_id
    )
    and exists (
      select 1
      from public.player_team_memberships membership
      where membership.club_id = match_row.club_id
        and membership.player_id = player.id
        and membership.status = 'active'
        and membership.ended_at is null
        and (match_row.team_id is null or membership.team_id = match_row.team_id)
    );

  if eligible_link.auth_user_id is null then
    return query select
      false,
      'This parent needs an active signed-in account linked to a current Squad player on this fixture team.'::text,
      null::uuid;
    return;
  end if;

  return query select true, ''::text, eligible_link.auth_user_id;
end;
$$;

revoke all on function app_private.match_day_scorer_link_eligibility(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.match_day_scorer_link_eligibility(uuid, uuid) to service_role;

commit;
