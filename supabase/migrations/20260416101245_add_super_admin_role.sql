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

alter table public.users
  add constraint users_role_check
  check (role in ('manager', 'coach', 'super_admin'));

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
      and (
        u.role = 'super_admin'
        or (u.club_id = clubs.id and u.role = 'manager')
      )
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role = 'super_admin'
        or (u.club_id = clubs.id and u.role = 'manager')
      )
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
    from public.users admin_user
    where admin_user.id = auth.uid()
      and (
        admin_user.role = 'super_admin'
        or (admin_user.club_id = users.club_id and admin_user.role = 'manager')
      )
  )
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
    from public.users admin_user
    where admin_user.id = auth.uid()
      and (
        admin_user.role = 'super_admin'
        or (admin_user.club_id = users.club_id and admin_user.role = 'manager')
      )
  )
)
with check (
  auth.uid() = id
  or exists (
    select 1
    from public.users admin_user
    where admin_user.id = auth.uid()
      and (
        admin_user.role = 'super_admin'
        or (admin_user.club_id = users.club_id and admin_user.role = 'manager')
      )
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
      and (
        u.role = 'super_admin'
        or (
          u.club_id = evaluations.club_id
          and (
            u.role = 'manager'
            or (u.role = 'coach' and evaluations.coach_id = auth.uid())
          )
        )
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
      and (
        u.role = 'super_admin'
        or (
          u.club_id = evaluations.club_id
          and (
            u.role = 'manager'
            or (u.role = 'coach' and evaluations.coach_id = auth.uid())
          )
        )
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
      and (
        u.role = 'super_admin'
        or (
          u.club_id = evaluations.club_id
          and (
            u.role = 'manager'
            or (u.role = 'coach' and evaluations.coach_id = auth.uid())
          )
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role = 'super_admin'
        or (
          u.club_id = evaluations.club_id
          and (
            u.role = 'manager'
            or (u.role = 'coach' and evaluations.coach_id = auth.uid())
          )
        )
      )
  )
);

update public.users
set role = 'super_admin',
    club_id = null
where lower(email) = lower('hype76@btopenworld.com');
