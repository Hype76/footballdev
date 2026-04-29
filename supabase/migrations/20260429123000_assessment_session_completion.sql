alter table public.assessment_sessions
  add column if not exists status text not null default 'open',
  add column if not exists completed_by uuid references public.users (id) on delete set null,
  add column if not exists completed_by_name text,
  add column if not exists completed_by_email text,
  add column if not exists completed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assessment_sessions_status_check'
  ) then
    alter table public.assessment_sessions
      add constraint assessment_sessions_status_check
      check (status in ('open', 'completed'));
  end if;
end $$;

create index if not exists assessment_sessions_club_status_date_idx
on public.assessment_sessions (club_id, status, session_date desc);

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
  and (
    coalesce(status, 'open') <> 'completed'
    or public.current_user_role_rank() >= 50
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
        coalesce(s.status, 'open') = 'open'
        or public.current_user_role_rank() >= 50
      )
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
        coalesce(s.status, 'open') = 'open'
        or public.current_user_role_rank() >= 50
      )
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
        coalesce(s.status, 'open') = 'open'
        or public.current_user_role_rank() >= 50
      )
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
        coalesce(s.status, 'open') = 'open'
        or public.current_user_role_rank() >= 50
      )
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
