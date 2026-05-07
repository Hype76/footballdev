create or replace function public.can_insert_team_for_plan(target_club_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_team_count integer := 0;
  team_limit integer;
  target_plan_key text;
  target_is_plan_comped boolean;
begin
  select coalesce(plan_key, 'small_club'), coalesce(is_plan_comped, false)
  into target_plan_key, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null then
    return false;
  end if;

  if target_is_plan_comped or target_plan_key = 'large_club' then
    return true;
  end if;

  team_limit := case target_plan_key
    when 'individual' then 1
    when 'single_team' then 1
    when 'small_club' then 10
    else 10
  end;

  select count(*)
  into existing_team_count
  from public.teams
  where club_id = target_club_id;

  return existing_team_count < team_limit;
end;
$$;

revoke all on function public.can_insert_team_for_plan(uuid) from public;
grant execute on function public.can_insert_team_for_plan(uuid) to authenticated;

drop policy if exists teams_insert_scoped on public.teams;
create policy teams_insert_scoped
on public.teams
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or (
    teams.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and public.can_insert_team_for_plan(teams.club_id)
  )
);
