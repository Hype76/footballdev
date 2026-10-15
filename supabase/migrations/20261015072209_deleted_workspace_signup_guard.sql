create table app_private.deleted_workspace_access (
  user_id uuid not null,
  club_id uuid not null,
  revoked_at timestamptz not null default now(),
  primary key (user_id, club_id)
);

alter table app_private.deleted_workspace_access enable row level security;
revoke all on table app_private.deleted_workspace_access from public, anon, authenticated;

create function app_private.record_deleted_workspace_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.club_id is not null then
    insert into app_private.deleted_workspace_access (user_id, club_id)
    values (old.id, old.club_id)
    on conflict (user_id, club_id) do nothing;
  end if;
  return old;
end;
$$;

revoke all on function app_private.record_deleted_workspace_access() from public, anon, authenticated;

create trigger users_record_deleted_workspace_access
before delete on public.users
for each row execute function app_private.record_deleted_workspace_access();

create function public.has_deleted_workspace_access(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app_private.deleted_workspace_access
    where user_id = target_user_id
  );
$$;

revoke all on function public.has_deleted_workspace_access(uuid) from public, anon, authenticated;
grant execute on function public.has_deleted_workspace_access(uuid) to service_role;
