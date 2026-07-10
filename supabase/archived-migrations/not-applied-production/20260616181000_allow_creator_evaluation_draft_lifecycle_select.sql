drop policy if exists evaluation_drafts_select_own_active on public.evaluation_drafts;
create policy evaluation_drafts_select_own_active
on public.evaluation_drafts
for select
to authenticated
using (
  created_by_user_id = auth.uid()
  and status in ('draft', 'submitted', 'discarded')
  and club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
);
