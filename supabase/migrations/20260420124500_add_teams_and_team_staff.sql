create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists teams_club_id_name_key
on public.teams (club_id, name);

create table if not exists public.team_staff (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists team_staff_team_id_user_id_key
on public.team_staff (team_id, user_id);

grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, update, delete on public.team_staff to authenticated;

alter table public.teams enable row level security;
alter table public.team_staff enable row level security;

drop policy if exists teams_select_scoped on public.teams;
create policy teams_select_scoped
on public.teams
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or teams.club_id = public.current_user_club_id()
);

drop policy if exists teams_insert_scoped on public.teams;
create policy teams_insert_scoped
on public.teams
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or (
    teams.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  )
);

drop policy if exists teams_update_scoped on public.teams;
create policy teams_update_scoped
on public.teams
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    teams.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    teams.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  )
);

drop policy if exists teams_delete_scoped on public.teams;
create policy teams_delete_scoped
on public.teams
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    teams.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  )
);

drop policy if exists team_staff_select_scoped on public.team_staff;
create policy team_staff_select_scoped
on public.team_staff
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or exists (
    select 1
    from public.teams t
    where t.id = team_staff.team_id
      and t.club_id = public.current_user_club_id()
  )
);

drop policy if exists team_staff_insert_scoped on public.team_staff;
create policy team_staff_insert_scoped
on public.team_staff
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role_rank() >= 50
    and exists (
      select 1
      from public.teams t
      where t.id = team_staff.team_id
        and t.club_id = public.current_user_club_id()
    )
    and exists (
      select 1
      from public.users u
      where u.id = team_staff.user_id
        and u.club_id = public.current_user_club_id()
    )
  )
);

drop policy if exists team_staff_delete_scoped on public.team_staff;
create policy team_staff_delete_scoped
on public.team_staff
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role_rank() >= 50
    and exists (
      select 1
      from public.teams t
      where t.id = team_staff.team_id
        and t.club_id = public.current_user_club_id()
    )
  )
);
