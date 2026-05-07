alter table public.users
add column if not exists status text not null default 'active',
add column if not exists suspended_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_status_check'
  ) then
    alter table public.users
      add constraint users_status_check
      check (status in ('active', 'suspended'));
  end if;
end $$;

update public.users
set status = 'active'
where status is null;

create or replace function public.prevent_non_platform_user_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    old.status is distinct from new.status
    or old.suspended_at is distinct from new.suspended_at
  ) and public.current_user_role() <> 'super_admin' then
    raise exception 'Only platform admins can change user account status.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_non_platform_user_status_change on public.users;
create trigger prevent_non_platform_user_status_change
before update on public.users
for each row
execute function public.prevent_non_platform_user_status_change();

drop policy if exists users_update_self_or_manager on public.users;
create policy users_update_self_or_manager
on public.users
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or users.id = auth.uid()
  or (
    public.current_user_club_id() = users.club_id
    and public.current_user_role_rank() >= 50
    and coalesce(users.role_rank, 0) <= public.current_user_role_rank()
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or users.id = auth.uid()
  or (
    public.current_user_club_id() = users.club_id
    and public.current_user_role_rank() >= 50
    and coalesce(users.role_rank, 0) <= public.current_user_role_rank()
  )
);

drop policy if exists users_delete_lower_role_manager on public.users;
create policy users_delete_lower_role_manager
on public.users
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_club_id() = users.club_id
    and public.current_user_role_rank() >= 50
    and coalesce(users.role_rank, 0) <= public.current_user_role_rank()
    and users.id <> auth.uid()
  )
);
