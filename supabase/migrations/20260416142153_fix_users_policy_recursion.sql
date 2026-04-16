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

revoke all on function public.current_user_role() from public;
revoke all on function public.current_user_club_id() from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_club_id() to authenticated;

drop policy if exists clubs_update_manager on public.clubs;
create policy clubs_update_manager
on public.clubs
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() = 'manager'
    and public.current_user_club_id() = clubs.id
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() = 'manager'
    and public.current_user_club_id() = clubs.id
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
    public.current_user_role() = 'manager'
    and public.current_user_club_id() = users.club_id
  )
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
    public.current_user_role() = 'manager'
    and public.current_user_club_id() = users.club_id
  )
)
with check (
  auth.uid() = id
  or public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() = 'manager'
    and public.current_user_club_id() = users.club_id
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
      public.current_user_role() = 'manager'
      or (
        public.current_user_role() = 'coach'
        and evaluations.coach_id = auth.uid()
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
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = evaluations.club_id
    and (
      public.current_user_role() = 'manager'
      or (
        public.current_user_role() = 'coach'
        and evaluations.coach_id = auth.uid()
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
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = evaluations.club_id
    and (
      public.current_user_role() = 'manager'
      or (
        public.current_user_role() = 'coach'
        and evaluations.coach_id = auth.uid()
      )
    )
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = evaluations.club_id
    and (
      public.current_user_role() = 'manager'
      or (
        public.current_user_role() = 'coach'
        and evaluations.coach_id = auth.uid()
      )
    )
  )
);
