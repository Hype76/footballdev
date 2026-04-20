alter table public.clubs
  add column if not exists require_approval boolean not null default true;

alter table public.users
  add column if not exists role_label text,
  add column if not exists role_rank integer not null default 30;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'users_role_check'
  ) then
    alter table public.users
      drop constraint users_role_check;
  end if;
end $$;

update public.users
set role = case
      when role = 'super_admin' then 'super_admin'
      when role = 'manager' then 'admin'
      when role = 'coach' then 'coach'
      else coalesce(nullif(role, ''), 'coach')
    end,
    role_label = case
      when role = 'super_admin' then 'Super Admin'
      when role = 'manager' then 'Admin'
      when role = 'coach' then 'Coach'
      else coalesce(nullif(role_label, ''), initcap(replace(role, '_', ' ')), 'Coach')
    end,
    role_rank = case
      when role = 'super_admin' then 100
      when role = 'manager' then 90
      when role = 'coach' then 30
      else coalesce(role_rank, 30)
    end;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_role_not_blank_check'
  ) then
    alter table public.users
      add constraint users_role_not_blank_check
      check (char_length(trim(role)) > 0);
  end if;
end $$;

alter table public.evaluations
  add column if not exists section text not null default 'Trial';

update public.evaluations
set section = coalesce(nullif(section, ''), 'Trial');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'evaluations_section_check'
  ) then
    alter table public.evaluations
      add constraint evaluations_section_check
      check (section in ('Trial', 'Squad'));
  end if;
end $$;

create table if not exists public.club_roles (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  role_key text not null,
  role_label text not null,
  role_rank integer not null,
  is_system boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists club_roles_club_id_role_key_key
on public.club_roles (club_id, role_key);

create unique index if not exists club_roles_club_id_role_label_key
on public.club_roles (club_id, role_label);

create table if not exists public.club_user_invites (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  email text not null,
  role_key text not null,
  role_label text not null,
  role_rank integer not null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  accepted_at timestamptz
);

create unique index if not exists club_user_invites_club_id_email_key
on public.club_user_invites (club_id, email);

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.role
  from public.users u
  where u.id = auth.uid()
  limit 1;
$$;

create or replace function public.current_user_club_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.club_id
  from public.users u
  where u.id = auth.uid()
  limit 1;
$$;

create or replace function public.current_user_role_rank()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(u.role_rank, 0)
  from public.users u
  where u.id = auth.uid()
  limit 1;
$$;

create or replace function public.seed_default_club_roles(target_club_id uuid default public.current_user_club_id())
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_club_id is null then
    return;
  end if;

  insert into public.club_roles (club_id, role_key, role_label, role_rank, is_system)
  values
    (target_club_id, 'admin', 'Admin', 90, true),
    (target_club_id, 'head_manager', 'Head Manager', 70, true),
    (target_club_id, 'manager', 'Manager', 50, true),
    (target_club_id, 'coach', 'Coach', 30, true),
    (target_club_id, 'assistant_coach', 'Assistant Coach', 20, true)
  on conflict (club_id, role_key) do update
  set role_label = excluded.role_label,
      role_rank = excluded.role_rank,
      is_system = true;
end;
$$;

revoke all on function public.current_user_role() from public;
revoke all on function public.current_user_club_id() from public;
revoke all on function public.current_user_role_rank() from public;
revoke all on function public.seed_default_club_roles(uuid) from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_club_id() to authenticated;
grant execute on function public.current_user_role_rank() to authenticated;
grant execute on function public.seed_default_club_roles(uuid) to authenticated;

grant select, insert, update, delete on public.club_roles to authenticated;
grant select, insert, update, delete on public.club_user_invites to authenticated;
grant delete on public.evaluations to authenticated;

alter table public.club_roles enable row level security;
alter table public.club_user_invites enable row level security;

drop policy if exists clubs_update_manager on public.clubs;
create policy clubs_update_manager
on public.clubs
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = clubs.id
    and public.current_user_role_rank() >= 50
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = clubs.id
    and public.current_user_role_rank() >= 50
  )
);

drop policy if exists users_select_self_or_manager on public.users;
create policy users_select_self_or_manager
on public.users
for select
to authenticated
using (
  auth.uid() = id
  or public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = users.club_id
    and public.current_user_role_rank() >= 50
  )
);

drop policy if exists users_insert_self on public.users;
create policy users_insert_self
on public.users
for insert
to authenticated
with check (
  auth.uid() = id
);

drop policy if exists users_update_self_or_manager on public.users;
create policy users_update_self_or_manager
on public.users
for update
to authenticated
using (
  auth.uid() = id
  or public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = users.club_id
    and public.current_user_role_rank() >= 50
    and coalesce(users.role_rank, 0) <= public.current_user_role_rank()
  )
)
with check (
  auth.uid() = id
  or public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = users.club_id
    and public.current_user_role_rank() >= 50
    and coalesce(users.role_rank, 0) <= public.current_user_role_rank()
  )
);

drop policy if exists evaluations_select_scoped on public.evaluations;
create policy evaluations_select_scoped
on public.evaluations
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = evaluations.club_id
    and (
      public.current_user_role_rank() >= 50
      or evaluations.coach_id = auth.uid()
    )
  )
);

drop policy if exists evaluations_insert_scoped on public.evaluations;
create policy evaluations_insert_scoped
on public.evaluations
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = evaluations.club_id
    and (
      public.current_user_role_rank() >= 50
      or evaluations.coach_id = auth.uid()
    )
  )
);

drop policy if exists evaluations_update_scoped on public.evaluations;
create policy evaluations_update_scoped
on public.evaluations
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = evaluations.club_id
    and (
      public.current_user_role_rank() >= 50
      or evaluations.coach_id = auth.uid()
    )
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = evaluations.club_id
    and (
      public.current_user_role_rank() >= 50
      or evaluations.coach_id = auth.uid()
    )
  )
);

drop policy if exists evaluations_delete_manager_only on public.evaluations;
create policy evaluations_delete_manager_only
on public.evaluations
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = evaluations.club_id
    and public.current_user_role_rank() >= 50
  )
);

drop policy if exists club_roles_select_scoped on public.club_roles;
create policy club_roles_select_scoped
on public.club_roles
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or club_roles.club_id = public.current_user_club_id()
);

drop policy if exists club_roles_insert_scoped on public.club_roles;
create policy club_roles_insert_scoped
on public.club_roles
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or (
    club_roles.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  )
);

drop policy if exists club_roles_update_scoped on public.club_roles;
create policy club_roles_update_scoped
on public.club_roles
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_roles.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    club_roles.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  )
);

drop policy if exists club_roles_delete_custom_only on public.club_roles;
create policy club_roles_delete_custom_only
on public.club_roles
for delete
to authenticated
using (
  (public.current_user_role() = 'super_admin' or (
    club_roles.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  ))
  and club_roles.is_system = false
);

drop policy if exists club_user_invites_select_scoped on public.club_user_invites;
create policy club_user_invites_select_scoped
on public.club_user_invites
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_user_invites.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  )
  or lower(club_user_invites.email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
);

drop policy if exists club_user_invites_insert_scoped on public.club_user_invites;
create policy club_user_invites_insert_scoped
on public.club_user_invites
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or (
    club_user_invites.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and club_user_invites.role_rank <= public.current_user_role_rank()
  )
);

drop policy if exists club_user_invites_update_scoped on public.club_user_invites;
create policy club_user_invites_update_scoped
on public.club_user_invites
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_user_invites.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and club_user_invites.role_rank <= public.current_user_role_rank()
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    club_user_invites.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and club_user_invites.role_rank <= public.current_user_role_rank()
  )
);

drop policy if exists club_user_invites_delete_scoped on public.club_user_invites;
create policy club_user_invites_delete_scoped
on public.club_user_invites
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_user_invites.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and club_user_invites.role_rank <= public.current_user_role_rank()
  )
);
