create table if not exists public.club_team_limit_overrides (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  team_limit_override integer not null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint club_team_limit_overrides_team_limit_check
    check (team_limit_override between 1 and 500)
);

create index if not exists club_team_limit_overrides_updated_at_idx
on public.club_team_limit_overrides (updated_at desc);

alter table public.club_team_limit_overrides enable row level security;

grant select, insert, update, delete on public.club_team_limit_overrides to authenticated;

drop policy if exists club_team_limit_overrides_select_super_admin on public.club_team_limit_overrides;
create policy club_team_limit_overrides_select_super_admin
on public.club_team_limit_overrides
for select
to authenticated
using (public.current_user_role() = 'super_admin');

drop policy if exists club_team_limit_overrides_insert_super_admin on public.club_team_limit_overrides;
create policy club_team_limit_overrides_insert_super_admin
on public.club_team_limit_overrides
for insert
to authenticated
with check (public.current_user_role() = 'super_admin');

drop policy if exists club_team_limit_overrides_update_super_admin on public.club_team_limit_overrides;
create policy club_team_limit_overrides_update_super_admin
on public.club_team_limit_overrides
for update
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

drop policy if exists club_team_limit_overrides_delete_super_admin on public.club_team_limit_overrides;
create policy club_team_limit_overrides_delete_super_admin
on public.club_team_limit_overrides
for delete
to authenticated
using (public.current_user_role() = 'super_admin');

create or replace function public.can_insert_team_for_plan(target_club_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_plan_key text;
  target_is_plan_comped boolean;
  target_plan_is_active boolean;
  target_team_limit_override integer;
  current_team_count integer;
  team_limit integer;
begin
  select public.normalize_subscription_plan_key(c.plan_key), coalesce(c.is_plan_comped, false), o.team_limit_override
  into target_plan_key, target_is_plan_comped, target_team_limit_override
  from public.clubs c
  left join public.club_team_limit_overrides o on o.club_id = c.id
  where c.id = target_club_id;

  if target_plan_key is null or target_plan_key = '' then
    return false;
  end if;

  target_plan_is_active := public.is_club_plan_access_active(target_club_id);

  if target_is_plan_comped then
    return true;
  end if;

  if not target_plan_is_active then
    return false;
  end if;

  select count(*)
  into current_team_count
  from public.teams
  where club_id = target_club_id;

  team_limit := coalesce(
    target_team_limit_override,
    case target_plan_key
      when 'individual' then 1
      when 'single_team' then 1
      when 'small_club' then 5
      when 'development_club' then 10
      when 'large_club' then 10
      else 0
    end
  );

  return current_team_count < team_limit;
end;
$$;

revoke all on function public.can_insert_team_for_plan(uuid) from public;
grant execute on function public.can_insert_team_for_plan(uuid) to authenticated;
