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
      or exists (
        select 1
        from public.team_staff ts
        where ts.team_id = assessment_sessions.team_id
          and ts.user_id = auth.uid()
      )
    )
  )
);

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
    from public.team_staff ts
    where ts.team_id = assessment_sessions.team_id
      and ts.user_id = auth.uid()
  )
);

drop policy if exists assessment_sessions_update_scoped on public.assessment_sessions;
create policy assessment_sessions_update_scoped
on public.assessment_sessions
for update
to authenticated
using (
  club_id = public.current_user_club_id()
  and (
    created_by = auth.uid()
    or exists (
      select 1
      from public.team_staff ts
      where ts.team_id = assessment_sessions.team_id
        and ts.user_id = auth.uid()
    )
  )
)
with check (
  club_id = public.current_user_club_id()
  and (
    created_by = auth.uid()
    or exists (
      select 1
      from public.team_staff ts
      where ts.team_id = assessment_sessions.team_id
        and ts.user_id = auth.uid()
    )
  )
);

drop policy if exists assessment_sessions_delete_scoped on public.assessment_sessions;
create policy assessment_sessions_delete_scoped
on public.assessment_sessions
for delete
to authenticated
using (
  club_id = public.current_user_club_id()
  and (
    created_by = auth.uid()
    or exists (
      select 1
      from public.team_staff ts
      where ts.team_id = assessment_sessions.team_id
        and ts.user_id = auth.uid()
    )
  )
);

drop policy if exists assessment_session_players_select_scoped on public.assessment_session_players;
create policy assessment_session_players_select_scoped
on public.assessment_session_players
for select
to authenticated
using (
  exists (
    select 1
    from public.assessment_sessions s
    where s.id = assessment_session_players.session_id
      and (
        public.current_user_role() = 'super_admin'
        or (
          s.club_id = public.current_user_club_id()
          and (
            s.created_by = auth.uid()
            or exists (
              select 1
              from public.team_staff ts
              where ts.team_id = s.team_id
                and ts.user_id = auth.uid()
            )
          )
        )
      )
  )
);

drop policy if exists assessment_session_players_insert_scoped on public.assessment_session_players;
create policy assessment_session_players_insert_scoped
on public.assessment_session_players
for insert
to authenticated
with check (
  exists (
    select 1
    from public.assessment_sessions s
    where s.id = assessment_session_players.session_id
      and s.club_id = public.current_user_club_id()
      and (
        s.created_by = auth.uid()
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = s.team_id
            and ts.user_id = auth.uid()
        )
      )
  )
);

drop policy if exists assessment_session_players_update_scoped on public.assessment_session_players;
create policy assessment_session_players_update_scoped
on public.assessment_session_players
for update
to authenticated
using (
  exists (
    select 1
    from public.assessment_sessions s
    where s.id = assessment_session_players.session_id
      and s.club_id = public.current_user_club_id()
      and (
        s.created_by = auth.uid()
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = s.team_id
            and ts.user_id = auth.uid()
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.assessment_sessions s
    where s.id = assessment_session_players.session_id
      and s.club_id = public.current_user_club_id()
      and (
        s.created_by = auth.uid()
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = s.team_id
            and ts.user_id = auth.uid()
        )
      )
  )
);

drop policy if exists assessment_session_players_delete_scoped on public.assessment_session_players;
create policy assessment_session_players_delete_scoped
on public.assessment_session_players
for delete
to authenticated
using (
  exists (
    select 1
    from public.assessment_sessions s
    where s.id = assessment_session_players.session_id
      and s.club_id = public.current_user_club_id()
      and (
        s.created_by = auth.uid()
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = s.team_id
            and ts.user_id = auth.uid()
        )
      )
  )
);
