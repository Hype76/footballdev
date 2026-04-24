grant delete on public.users to authenticated;

drop policy if exists users_delete_lower_role_manager on public.users;
create policy users_delete_lower_role_manager
on public.users
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = users.club_id
    and public.current_user_role_rank() >= 50
    and coalesce(users.role_rank, 0) < public.current_user_role_rank()
    and users.id <> auth.uid()
  )
);
