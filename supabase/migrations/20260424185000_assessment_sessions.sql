create table if not exists public.assessment_sessions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  team text not null default '',
  opponent text not null default '',
  session_date date not null,
  title text not null default '',
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.assessment_session_players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.assessment_sessions (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  player_name text not null default '',
  section text not null default 'Trial',
  team text not null default '',
  parent_name text not null default '',
  parent_email text not null default '',
  notes text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (session_id, player_id)
);

create index if not exists assessment_sessions_club_date_idx
on public.assessment_sessions (club_id, session_date desc);

create index if not exists assessment_sessions_team_id_idx
on public.assessment_sessions (team_id);

create index if not exists assessment_session_players_session_id_idx
on public.assessment_session_players (session_id);

create index if not exists assessment_session_players_player_id_idx
on public.assessment_session_players (player_id);

grant select, insert, update, delete on public.assessment_sessions to authenticated;
grant select, insert, update, delete on public.assessment_session_players to authenticated;

alter table public.assessment_sessions enable row level security;
alter table public.assessment_session_players enable row level security;

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
      public.current_user_role_rank() >= 50
      or created_by = auth.uid()
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
);

drop policy if exists assessment_sessions_update_scoped on public.assessment_sessions;
create policy assessment_sessions_update_scoped
on public.assessment_sessions
for update
to authenticated
using (
  club_id = public.current_user_club_id()
  and (
    public.current_user_role_rank() >= 50
    or created_by = auth.uid()
  )
)
with check (
  club_id = public.current_user_club_id()
  and (
    public.current_user_role_rank() >= 50
    or created_by = auth.uid()
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
    public.current_user_role_rank() >= 50
    or created_by = auth.uid()
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
        public.current_user_role_rank() >= 50
        or s.created_by = auth.uid()
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
with check (
  exists (
    select 1
    from public.assessment_sessions s
    where s.id = assessment_session_players.session_id
      and s.club_id = public.current_user_club_id()
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
        public.current_user_role_rank() >= 50
        or s.created_by = auth.uid()
      )
  )
);
