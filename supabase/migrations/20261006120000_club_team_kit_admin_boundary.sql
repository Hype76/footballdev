-- Club workspace kit colours are managed by the active Club Admin only.
-- Standalone team authority, validation, existing kit rows and fixture choices are unchanged.
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

  -- Resolve the workspace from trusted billing state, never a client plan claim.
  -- current_user_role/current_user_club_id already require active matched membership.
  if exists (
    select 1 from public.clubs c
    where c.id = new.club_id
      and public.workspace_scope_for_plan_key(c.plan_key) = 'club'
  ) and (
    coalesce(public.current_user_role(), '') <> 'admin'
    or public.current_user_club_id() is distinct from new.club_id
  ) then
    raise exception 'club_kit_update_requires_club_admin' using errcode = '42501';
  end if;

  if not coalesce(public.can_use_plan_feature(new.club_id, 'matchDay'), false) then
    raise exception 'plan_capability_not_available' using errcode = '42501';
  end if;

  return new;
end;
$$;

