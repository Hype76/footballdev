drop policy if exists evaluations_delete_scoped on public.evaluations;
drop policy if exists evaluations_delete_manager_only on public.evaluations;

create policy evaluations_delete_manager_only
on public.evaluations
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    evaluations.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  )
);
