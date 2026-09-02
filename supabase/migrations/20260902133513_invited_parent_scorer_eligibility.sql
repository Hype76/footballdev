begin;

CREATE OR REPLACE FUNCTION app_private.match_day_scorer_link_eligibility(match_day_id_value uuid, parent_link_id_value uuid)
 RETURNS TABLE(eligible boolean, reason text, auth_user_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
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
   and (
     player.section = 'Squad'
     or exists (
       select 1
       from public.match_day_availability_requests request
       where request.match_day_id = match_row.id
         and request.club_id = match_row.club_id
         and (request.team_id is null or request.team_id = match_row.team_id)
         and request.player_id = player.id
         and (
           request.parent_link_id = parent_link.id
           or (
             request.parent_link_id is null
             and nullif(lower(btrim(request.recipient_email)), '') = nullif(lower(btrim(parent_link.email)), '')
           )
         )
         and lower(coalesce(request.status, '')) <> 'expired'
         and lower(coalesce(request.volunteer_scorer_response, '')) = 'yes'
     )
   )
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
      'Check the active parent account, team link and scorer invitation response.'::text,
      null::uuid;
    return;
  end if;

  return query select true, ''::text, eligible_link.auth_user_id;
end;
$function$;

notify pgrst, 'reload schema';
commit;
