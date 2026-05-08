create or replace function public.user_belongs_to_current_club(target_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = target_user_id
      and u.club_id = public.current_user_club_id()
  );
$$;

grant execute on function public.user_belongs_to_current_club(uuid) to authenticated;

drop policy if exists team_staff_insert_scoped on public.team_staff;
create policy team_staff_insert_scoped
on public.team_staff
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role_rank() >= 50
    and exists (
      select 1
      from public.teams t
      where t.id = team_staff.team_id
        and t.club_id = public.current_user_club_id()
    )
    and public.user_belongs_to_current_club(team_staff.user_id)
  )
);
