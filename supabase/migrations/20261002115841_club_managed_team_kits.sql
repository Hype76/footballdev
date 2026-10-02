-- Preserve stored overrides and all existing authority/entitlement checks.
-- Club Admin continues to manage public.club_kits through the existing editor.
create or replace function app_private.enforce_team_matchday_kit_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT'
     and new.home_kit_colour is null
     and new.away_kit_colour is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.home_kit_colour is not distinct from old.home_kit_colour
     and new.away_kit_colour is not distinct from old.away_kit_colour then
    return new;
  end if;

  if not coalesce(public.current_user_can_access_team(new.club_id, new.id), false)
     or (
       coalesce(public.current_user_role(), '') not in ('admin', 'super_admin')
       and coalesce(public.current_user_team_role_rank(new.id), 0) < 50
     ) then
    raise exception 'team_kit_update_not_authorized' using errcode = '42501';
  end if;

  if not coalesce(public.can_use_plan_feature(new.club_id, 'matchDay'), false) then
    raise exception 'plan_capability_not_available' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.clubs c
    where c.id = new.club_id
      and public.workspace_scope_for_plan_key(c.plan_key) = 'club'
  ) then
    raise exception 'team_kits_managed_by_club_admin' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app_private.enforce_team_matchday_kit_update() from public, anon, authenticated;
grant execute on function app_private.enforce_team_matchday_kit_update() to service_role;
