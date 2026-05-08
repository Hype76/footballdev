alter table public.evaluations
  add column if not exists assessment_session_id uuid references public.assessment_sessions (id) on delete set null;

create index if not exists evaluations_assessment_session_id_idx
on public.evaluations (assessment_session_id);

drop policy if exists assessment_sessions_delete_scoped on public.assessment_sessions;

create policy assessment_sessions_delete_scoped
on public.assessment_sessions
for delete
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 50
  and (
    public.current_user_role() = 'admin'
    or exists (
      select 1
      from public.team_staff ts
      where ts.team_id = assessment_sessions.team_id
        and ts.user_id = auth.uid()
    )
  )
  and not exists (
    select 1
    from public.evaluations e
    where e.club_id = assessment_sessions.club_id
      and (
        e.assessment_session_id = assessment_sessions.id
        or (
          e.assessment_session_id is null
          and (
            e.team_id = assessment_sessions.team_id
            or lower(coalesce(e.team, '')) = lower(coalesce(assessment_sessions.team, ''))
          )
          and left(coalesce(e.session, e.date, ''), 10) = assessment_sessions.session_date::text
        )
      )
  )
);
