drop policy if exists users_select_self_or_manager on public.users;
create policy users_select_self_or_manager
on public.users
for select
to authenticated
using (
  auth.uid() = id
  or public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() = 'admin'
    and public.current_user_club_id() = users.club_id
  )
  or (
    public.current_user_club_id() = users.club_id
    and public.current_user_role_rank() >= 50
    and coalesce(users.role_rank, 0) <= public.current_user_role_rank()
    and exists (
      select 1
      from public.team_staff viewer_staff
      join public.team_staff target_staff
        on target_staff.team_id = viewer_staff.team_id
      where viewer_staff.user_id = auth.uid()
        and target_staff.user_id = users.id
    )
  )
);
