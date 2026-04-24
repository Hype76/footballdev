drop policy if exists assessment_sessions_insert_scoped on public.assessment_sessions;
create policy assessment_sessions_insert_scoped
on public.assessment_sessions
for insert
to authenticated
with check (
  club_id = public.current_user_club_id()
  and created_by = auth.uid()
  and public.current_user_role_rank() >= 20
  and (
    public.current_user_role_rank() >= 50
    or exists (
      select 1
      from public.team_staff ts
      where ts.team_id = assessment_sessions.team_id
        and ts.user_id = auth.uid()
    )
  )
);
