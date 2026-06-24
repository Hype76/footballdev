drop policy if exists evaluation_drafts_close_own_active on public.evaluation_drafts;
create policy evaluation_drafts_close_own_active
on public.evaluation_drafts
for update
to authenticated
using (
  created_by_user_id = auth.uid()
  and status = 'draft'
  and club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
)
with check (
  created_by_user_id = auth.uid()
  and club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and status in ('submitted', 'discarded')
);
