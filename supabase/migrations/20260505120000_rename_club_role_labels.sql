update public.club_roles
set role_label = 'Club Admin Custom'
where role_key <> 'admin'
  and role_label = 'Club Admin';

update public.club_roles
set role_label = 'Team Admin Custom'
where role_key <> 'head_manager'
  and role_label = 'Team Admin';

update public.club_roles
set role_label = 'Club Admin'
where role_key = 'admin';

update public.club_roles
set role_label = 'Team Admin'
where role_key = 'head_manager';

update public.club_user_invites
set role_label = 'Club Admin'
where role_key = 'admin';

update public.club_user_invites
set role_label = 'Team Admin'
where role_key = 'head_manager';

update public.users
set role_label = 'Club Admin'
where role = 'admin';

update public.users
set role_label = 'Team Admin'
where role = 'head_manager';

create or replace function public.seed_default_club_roles(target_club_id uuid default public.current_user_club_id())
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_club_id is null then
    return;
  end if;

  insert into public.club_roles (club_id, role_key, role_label, role_rank, is_system)
  values
    (target_club_id, 'admin', 'Club Admin', 90, true),
    (target_club_id, 'head_manager', 'Team Admin', 70, true),
    (target_club_id, 'manager', 'Manager', 50, true),
    (target_club_id, 'coach', 'Coach', 30, true),
    (target_club_id, 'assistant_coach', 'Assistant Coach', 20, true)
  on conflict (club_id, role_key) do update
  set role_label = excluded.role_label,
      role_rank = excluded.role_rank,
      is_system = true;
end;
$$;

revoke all on function public.seed_default_club_roles(uuid) from public;
grant execute on function public.seed_default_club_roles(uuid) to authenticated;
