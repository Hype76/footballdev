alter table public.assessment_sessions
drop constraint if exists assessment_sessions_session_type_check;

alter table public.assessment_sessions
add constraint assessment_sessions_session_type_check
check (session_type in ('training', 'match', 'tournament'));

create table if not exists public.assessment_session_games (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.assessment_sessions (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  opponent text not null default '',
  team_score integer,
  opponent_score integer,
  game_date date,
  notes text not null default '',
  created_by uuid references public.users (id) on delete set null,
  created_by_name text not null default '',
  created_by_email text not null default '',
  updated_by uuid references public.users (id) on delete set null,
  updated_by_name text not null default '',
  updated_by_email text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists assessment_session_games_session_id_idx
on public.assessment_session_games (session_id, created_at desc);

create index if not exists assessment_session_games_club_id_idx
on public.assessment_session_games (club_id);

grant select, insert, update, delete on public.assessment_session_games to authenticated;

alter table public.assessment_session_games enable row level security;

drop policy if exists assessment_session_games_select_scoped on public.assessment_session_games;
create policy assessment_session_games_select_scoped
on public.assessment_session_games
for select
to authenticated
using (
  exists (
    select 1
    from public.assessment_sessions s
    where s.id = assessment_session_games.session_id
      and (
        public.current_user_role() = 'super_admin'
        or (
          s.club_id = public.current_user_club_id()
          and (
            public.current_user_role_rank() >= 50
            or s.created_by = auth.uid()
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

drop policy if exists assessment_session_games_insert_scoped on public.assessment_session_games;
create policy assessment_session_games_insert_scoped
on public.assessment_session_games
for insert
to authenticated
with check (
  club_id = public.current_user_club_id()
  and exists (
    select 1
    from public.assessment_sessions s
    where s.id = assessment_session_games.session_id
      and s.club_id = public.current_user_club_id()
      and s.session_type = 'tournament'
      and (
        public.current_user_role_rank() >= 50
        or s.created_by = auth.uid()
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = s.team_id
            and ts.user_id = auth.uid()
        )
      )
  )
);

drop policy if exists assessment_session_games_update_scoped on public.assessment_session_games;
create policy assessment_session_games_update_scoped
on public.assessment_session_games
for update
to authenticated
using (
  club_id = public.current_user_club_id()
  and exists (
    select 1
    from public.assessment_sessions s
    where s.id = assessment_session_games.session_id
      and s.club_id = public.current_user_club_id()
      and (
        public.current_user_role_rank() >= 50
        or s.created_by = auth.uid()
        or assessment_session_games.created_by = auth.uid()
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
  club_id = public.current_user_club_id()
  and exists (
    select 1
    from public.assessment_sessions s
    where s.id = assessment_session_games.session_id
      and s.club_id = public.current_user_club_id()
      and (
        public.current_user_role_rank() >= 50
        or s.created_by = auth.uid()
        or assessment_session_games.created_by = auth.uid()
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = s.team_id
            and ts.user_id = auth.uid()
        )
      )
  )
);

drop policy if exists assessment_session_games_delete_scoped on public.assessment_session_games;
create policy assessment_session_games_delete_scoped
on public.assessment_session_games
for delete
to authenticated
using (
  club_id = public.current_user_club_id()
  and exists (
    select 1
    from public.assessment_sessions s
    where s.id = assessment_session_games.session_id
      and s.club_id = public.current_user_club_id()
      and (
        public.current_user_role_rank() >= 50
        or s.created_by = auth.uid()
        or assessment_session_games.created_by = auth.uid()
      )
  )
);
