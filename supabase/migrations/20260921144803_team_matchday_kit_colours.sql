alter table public.teams
  add column if not exists home_kit_colour text,
  add column if not exists away_kit_colour text;

alter table public.teams
  drop constraint if exists teams_home_kit_colour_hex,
  add constraint teams_home_kit_colour_hex
    check (home_kit_colour is null or home_kit_colour ~ '^#[0-9A-Fa-f]{6}$'),
  drop constraint if exists teams_away_kit_colour_hex,
  add constraint teams_away_kit_colour_hex
    check (away_kit_colour is null or away_kit_colour ~ '^#[0-9A-Fa-f]{6}$');

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

  return new;
end;
$$;

revoke all on function app_private.enforce_team_matchday_kit_update() from public, anon, authenticated;
grant execute on function app_private.enforce_team_matchday_kit_update() to service_role;

drop trigger if exists teams_enforce_matchday_kit_update on public.teams;
create trigger teams_enforce_matchday_kit_update
before insert or update of home_kit_colour, away_kit_colour on public.teams
for each row execute function app_private.enforce_team_matchday_kit_update();

comment on column public.teams.home_kit_colour is
  'Matchday home shirt colour. Null preserves the legacy club kit fallback.';
comment on column public.teams.away_kit_colour is
  'Matchday away shirt colour. Null preserves the legacy club kit fallback.';
