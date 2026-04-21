alter table public.clubs
add column if not exists status text not null default 'active',
add column if not exists suspended_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clubs_status_check'
  ) then
    alter table public.clubs
      add constraint clubs_status_check
      check (status in ('active', 'suspended'));
  end if;
end $$;

update public.clubs
set status = 'active'
where status is null;

grant delete on public.clubs to authenticated;

drop policy if exists clubs_delete_super_admin on public.clubs;
create policy clubs_delete_super_admin
on public.clubs
for delete
to authenticated
using (public.current_user_role() = 'super_admin');
