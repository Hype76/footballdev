grant update on public.player_staff_notes to authenticated;

drop policy if exists player_staff_notes_update_assignment_scoped on public.player_staff_notes;
create policy player_staff_notes_update_assignment_scoped
on public.player_staff_notes
for update
to authenticated
using (
  player_staff_notes.club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 20
  and (
    player_staff_notes.user_id = auth.uid()
    or public.current_user_role_rank() >= 50
  )
)
with check (
  player_staff_notes.club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 20
  and (
    player_staff_notes.user_id = auth.uid()
    or public.current_user_role_rank() >= 50
  )
);
