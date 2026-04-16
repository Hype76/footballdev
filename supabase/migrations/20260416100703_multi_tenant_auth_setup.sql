create extension if not exists pgcrypto;

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists clubs_name_key on public.clubs (lower(name));

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text,
  role text not null default 'coach',
  club_id uuid,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.users
  add column if not exists email text,
  add column if not exists name text,
  add column if not exists role text not null default 'coach',
  add column if not exists club_id uuid,
  add column if not exists created_at timestamptz not null default timezone('utc', now());

create unique index if not exists users_email_key on public.users (lower(email));
create index if not exists users_club_id_idx on public.users (club_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_club_id_fkey'
  ) then
    alter table public.users
      add constraint users_club_id_fkey
      foreign key (club_id) references public.clubs (id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_role_check'
  ) then
    alter table public.users
      add constraint users_role_check
      check (role in ('manager', 'coach'));
  end if;
end $$;

create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  player_name text not null,
  team text not null default '',
  club_id uuid not null,
  coach_id uuid not null,
  coach text not null default '',
  parent_email text,
  session text,
  date text,
  scores jsonb not null default '{}'::jsonb,
  average_score numeric,
  comments jsonb not null default '{}'::jsonb,
  decision text not null default 'Progress',
  status text not null default 'Submitted',
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.evaluations
  add column if not exists player_name text,
  add column if not exists team text not null default '',
  add column if not exists club_id uuid,
  add column if not exists coach_id uuid,
  add column if not exists coach text not null default '',
  add column if not exists parent_email text,
  add column if not exists session text,
  add column if not exists date text,
  add column if not exists scores jsonb not null default '{}'::jsonb,
  add column if not exists average_score numeric,
  add column if not exists comments jsonb not null default '{}'::jsonb,
  add column if not exists decision text not null default 'Progress',
  add column if not exists status text not null default 'Submitted',
  add column if not exists created_at timestamptz not null default timezone('utc', now());

create index if not exists evaluations_club_id_idx on public.evaluations (club_id);
create index if not exists evaluations_coach_id_idx on public.evaluations (coach_id);
create index if not exists evaluations_player_name_idx on public.evaluations (player_name);
create index if not exists evaluations_status_idx on public.evaluations (status);
create index if not exists evaluations_created_at_idx on public.evaluations (created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'evaluations_club_id_fkey'
  ) then
    alter table public.evaluations
      add constraint evaluations_club_id_fkey
      foreign key (club_id) references public.clubs (id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'evaluations_coach_id_fkey'
  ) then
    alter table public.evaluations
      add constraint evaluations_coach_id_fkey
      foreign key (coach_id) references public.users (id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'evaluations_status_check'
  ) then
    alter table public.evaluations
      add constraint evaluations_status_check
      check (status in ('Submitted', 'Approved', 'Rejected'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'evaluations_decision_check'
  ) then
    alter table public.evaluations
      add constraint evaluations_decision_check
      check (decision in ('Yes', 'No', 'Progress'));
  end if;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update on public.clubs to authenticated;
grant select, insert, update on public.users to authenticated;
grant select, insert, update on public.evaluations to authenticated;

alter table public.clubs enable row level security;
alter table public.users enable row level security;
alter table public.evaluations enable row level security;

drop policy if exists clubs_select_authenticated on public.clubs;
create policy clubs_select_authenticated
on public.clubs
for select
to authenticated
using (true);

drop policy if exists clubs_insert_authenticated on public.clubs;
create policy clubs_insert_authenticated
on public.clubs
for insert
to authenticated
with check (auth.uid() is not null);

drop policy if exists clubs_update_manager on public.clubs;
create policy clubs_update_manager
on public.clubs
for update
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.club_id = clubs.id
      and u.role = 'manager'
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.club_id = clubs.id
      and u.role = 'manager'
  )
);

drop policy if exists users_select_self_or_manager on public.users;
create policy users_select_self_or_manager
on public.users
for select
to authenticated
using (
  auth.uid() = id
  or exists (
    select 1
    from public.users manager_user
    where manager_user.id = auth.uid()
      and manager_user.club_id = users.club_id
      and manager_user.role = 'manager'
  )
);

drop policy if exists users_insert_self on public.users;
create policy users_insert_self
on public.users
for insert
to authenticated
with check (
  auth.uid() = id
  and role in ('manager', 'coach')
);

drop policy if exists users_update_self_or_manager on public.users;
create policy users_update_self_or_manager
on public.users
for update
to authenticated
using (
  auth.uid() = id
  or exists (
    select 1
    from public.users manager_user
    where manager_user.id = auth.uid()
      and manager_user.club_id = users.club_id
      and manager_user.role = 'manager'
  )
)
with check (
  auth.uid() = id
  or exists (
    select 1
    from public.users manager_user
    where manager_user.id = auth.uid()
      and manager_user.club_id = users.club_id
      and manager_user.role = 'manager'
  )
);

drop policy if exists evaluations_select_scoped on public.evaluations;
create policy evaluations_select_scoped
on public.evaluations
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.club_id = evaluations.club_id
      and (
        u.role = 'manager'
        or (u.role = 'coach' and evaluations.coach_id = auth.uid())
      )
  )
);

drop policy if exists evaluations_insert_scoped on public.evaluations;
create policy evaluations_insert_scoped
on public.evaluations
for insert
to authenticated
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.club_id = evaluations.club_id
      and (
        u.role = 'manager'
        or (u.role = 'coach' and evaluations.coach_id = auth.uid())
      )
  )
);

drop policy if exists evaluations_update_scoped on public.evaluations;
create policy evaluations_update_scoped
on public.evaluations
for update
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.club_id = evaluations.club_id
      and (
        u.role = 'manager'
        or (u.role = 'coach' and evaluations.coach_id = auth.uid())
      )
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.club_id = evaluations.club_id
      and (
        u.role = 'manager'
        or (u.role = 'coach' and evaluations.coach_id = auth.uid())
      )
  )
);
