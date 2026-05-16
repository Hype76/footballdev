drop policy if exists assessment_sessions_insert_scoped on public.assessment_sessions;
create policy assessment_sessions_insert_scoped
on public.assessment_sessions
for insert
to authenticated
with check (
  club_id = public.current_user_club_id()
  and created_by = auth.uid()
  and public.current_user_role_rank() >= 20
  and exists (
    select 1
    from public.teams t
    where t.id = assessment_sessions.team_id
      and t.club_id = public.current_user_club_id()
  )
);

drop policy if exists assessment_sessions_select_scoped on public.assessment_sessions;
create policy assessment_sessions_select_scoped
on public.assessment_sessions
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and (
      created_by = auth.uid()
      or public.current_user_role_rank() >= 50
      or exists (
        select 1
        from public.team_staff ts
        where ts.team_id = assessment_sessions.team_id
          and ts.user_id = auth.uid()
      )
    )
  )
);
