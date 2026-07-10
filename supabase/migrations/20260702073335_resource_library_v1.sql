insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'resource-library',
  'resource-library',
  false,
  20971520,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.resource_library_items (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  title text not null,
  description text not null default '',
  category text not null default 'general',
  storage_bucket text not null default 'resource-library',
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  file_size_bytes integer not null,
  uploaded_by_profile_id uuid not null references public.users (id),
  uploaded_by_name text not null default '',
  uploaded_by_email text not null default '',
  archived_at timestamptz,
  archived_by_profile_id uuid references public.users (id),
  archived_by_name text not null default '',
  archived_by_email text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint resource_library_items_bucket_check check (storage_bucket = 'resource-library'),
  constraint resource_library_items_title_check check (char_length(btrim(title)) between 1 and 120),
  constraint resource_library_items_description_check check (char_length(description) <= 1000),
  constraint resource_library_items_category_check check (category in ('general', 'training', 'match_day', 'development', 'admin')),
  constraint resource_library_items_storage_path_check check (storage_path like club_id::text || '/' || team_id::text || '/%'),
  constraint resource_library_items_mime_check check (
    mime_type in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/csv',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/webp'
    )
  ),
  constraint resource_library_items_size_check check (file_size_bytes > 0 and file_size_bytes <= 20971520)
);

create unique index if not exists resource_library_items_id_club_id_key
on public.resource_library_items (id, club_id);

create unique index if not exists resource_library_items_storage_path_key
on public.resource_library_items (storage_bucket, storage_path);

create index if not exists resource_library_items_club_updated_idx
on public.resource_library_items (club_id, updated_at desc)
where archived_at is null;

create index if not exists resource_library_items_team_idx
on public.resource_library_items (team_id)
where archived_at is null;

create table if not exists public.resource_library_links (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null,
  club_id uuid not null,
  team_id uuid not null references public.teams (id) on delete cascade,
  linked_type text not null,
  linked_id uuid not null,
  assigned_by_profile_id uuid not null references public.users (id),
  assigned_by_name text not null default '',
  assigned_by_email text not null default '',
  assigned_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz,
  removed_by_profile_id uuid references public.users (id),
  removed_by_name text not null default '',
  removed_by_email text not null default '',
  constraint resource_library_links_resource_fkey
    foreign key (resource_id, club_id)
    references public.resource_library_items (id, club_id)
    on delete cascade,
  constraint resource_library_links_type_check check (linked_type in ('player', 'team'))
);

create unique index if not exists resource_library_links_active_target_key
on public.resource_library_links (resource_id, linked_type, linked_id)
where removed_at is null;

create index if not exists resource_library_links_player_idx
on public.resource_library_links (club_id, linked_id)
where linked_type = 'player' and removed_at is null;

create index if not exists resource_library_links_team_idx
on public.resource_library_links (club_id, team_id)
where removed_at is null;

revoke all on public.resource_library_items from public;
revoke all on public.resource_library_links from public;
revoke all on public.resource_library_items from anon;
revoke all on public.resource_library_links from anon;
revoke all on public.resource_library_items from authenticated;
revoke all on public.resource_library_links from authenticated;

grant select, insert, update on public.resource_library_items to authenticated;
grant select, insert, update on public.resource_library_links to authenticated;

alter table public.resource_library_items enable row level security;
alter table public.resource_library_links enable row level security;

create or replace function public.is_resource_library_staff(target_user_id uuid, target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = target_user_id
      and u.club_id = target_club_id
      and u.role not in ('parent_portal', 'super_admin')
      and coalesce(u.role_rank, 0) >= 20
  );
$$;

create or replace function public.resource_library_user_can_access_team(
  target_user_id uuid,
  target_team_id uuid,
  target_club_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_team_id is not null
    and exists (
      select 1
      from public.teams t
      where t.id = target_team_id
        and t.club_id = target_club_id
    )
    and exists (
      select 1
      from public.users u
      where u.id = target_user_id
        and u.club_id = target_club_id
        and u.role not in ('parent_portal', 'super_admin')
        and coalesce(u.role_rank, 0) >= 20
        and (
          coalesce(u.role_rank, 0) >= 50
          or exists (
            select 1
            from public.team_staff ts
            where ts.team_id = target_team_id
              and ts.user_id = target_user_id
          )
        )
    );
$$;

create or replace function public.current_user_can_view_resource_library(target_club_id uuid, target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and public.current_user_club_id() = target_club_id
    and public.current_user_role() not in ('parent_portal', 'super_admin')
    and public.current_user_role_rank() >= 20
    and target_team_id is not null
    and public.resource_library_user_can_access_team(auth.uid(), target_team_id, target_club_id);
$$;

create or replace function public.current_user_can_manage_resource_library(target_club_id uuid, target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and public.current_user_club_id() = target_club_id
    and public.current_user_role() not in ('parent_portal', 'super_admin')
    and public.current_user_role_rank() >= 50
    and target_team_id is not null
    and public.resource_library_user_can_access_team(auth.uid(), target_team_id, target_club_id);
$$;

create or replace function public.resource_library_player_in_scope(
  target_player_id uuid,
  target_club_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.players p
    where p.id = target_player_id
      and p.club_id = target_club_id
      and coalesce(p.status, 'active') <> 'archived'
      and p.team_id = target_team_id
  );
$$;

create or replace function public.resource_library_link_target_allowed(
  target_linked_type text,
  target_linked_id uuid,
  target_club_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    target_linked_type = 'player'
    and public.resource_library_player_in_scope(target_linked_id, target_club_id, target_team_id)
  )
  or (
    target_linked_type = 'team'
    and target_team_id is not null
    and target_linked_id = target_team_id
    and exists (
      select 1
      from public.teams t
      where t.id = target_linked_id
        and t.club_id = target_club_id
    )
  );
$$;

create or replace function public.current_user_can_read_resource_file(target_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.resource_library_items rli
    where rli.storage_bucket = 'resource-library'
      and rli.storage_path = target_storage_path
      and rli.archived_at is null
      and public.current_user_can_view_resource_library(rli.club_id, rli.team_id)
  );
$$;

drop policy if exists resource_library_items_select_staff on public.resource_library_items;
create policy resource_library_items_select_staff
on public.resource_library_items
for select
to authenticated
using (
  archived_at is null
  and public.current_user_can_view_resource_library(club_id, team_id)
);

drop policy if exists resource_library_items_insert_manager on public.resource_library_items;
create policy resource_library_items_insert_manager
on public.resource_library_items
for insert
to authenticated
with check (
  uploaded_by_profile_id = auth.uid()
  and archived_at is null
  and archived_by_profile_id is null
  and public.current_user_can_manage_resource_library(club_id, team_id)
);

drop policy if exists resource_library_items_update_manager on public.resource_library_items;
create policy resource_library_items_update_manager
on public.resource_library_items
for update
to authenticated
using (
  public.current_user_can_manage_resource_library(club_id, team_id)
)
with check (
  public.current_user_can_manage_resource_library(club_id, team_id)
  and storage_bucket = 'resource-library'
  and storage_path like club_id::text || '/' || team_id::text || '/%'
);

drop policy if exists resource_library_links_select_staff on public.resource_library_links;
create policy resource_library_links_select_staff
on public.resource_library_links
for select
to authenticated
using (
  removed_at is null
  and exists (
    select 1
    from public.resource_library_items rli
    where rli.id = resource_library_links.resource_id
      and rli.club_id = resource_library_links.club_id
      and rli.archived_at is null
      and public.current_user_can_view_resource_library(rli.club_id, rli.team_id)
  )
);

drop policy if exists resource_library_links_insert_manager on public.resource_library_links;
create policy resource_library_links_insert_manager
on public.resource_library_links
for insert
to authenticated
with check (
  assigned_by_profile_id = auth.uid()
  and removed_at is null
  and removed_by_profile_id is null
  and exists (
    select 1
    from public.resource_library_items rli
    where rli.id = resource_library_links.resource_id
      and rli.club_id = resource_library_links.club_id
      and rli.archived_at is null
      and public.current_user_can_manage_resource_library(rli.club_id, rli.team_id)
      and resource_library_links.team_id = rli.team_id
      and public.resource_library_link_target_allowed(
        resource_library_links.linked_type,
        resource_library_links.linked_id,
        rli.club_id,
        rli.team_id
      )
  )
);

drop policy if exists resource_library_links_update_manager on public.resource_library_links;
create policy resource_library_links_update_manager
on public.resource_library_links
for update
to authenticated
using (
  exists (
    select 1
    from public.resource_library_items rli
    where rli.id = resource_library_links.resource_id
      and rli.club_id = resource_library_links.club_id
      and public.current_user_can_manage_resource_library(rli.club_id, rli.team_id)
  )
)
with check (
  exists (
    select 1
    from public.resource_library_items rli
    where rli.id = resource_library_links.resource_id
      and rli.club_id = resource_library_links.club_id
      and public.current_user_can_manage_resource_library(rli.club_id, rli.team_id)
      and resource_library_links.team_id = rli.team_id
      and public.resource_library_link_target_allowed(
        resource_library_links.linked_type,
        resource_library_links.linked_id,
        rli.club_id,
        rli.team_id
      )
  )
);

drop policy if exists resource_library_storage_select_staff on storage.objects;
create policy resource_library_storage_select_staff
on storage.objects
for select
to authenticated
using (
  bucket_id = 'resource-library'
  and public.current_user_can_read_resource_file(name)
);

drop policy if exists resource_library_storage_insert_manager on storage.objects;
create policy resource_library_storage_insert_manager
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'resource-library'
  and (storage.foldername(name))[1] = public.current_user_club_id()::text
  and case
    when coalesce((storage.foldername(name))[2], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.current_user_can_manage_resource_library(public.current_user_club_id(), ((storage.foldername(name))[2])::uuid)
    else false
  end
);

revoke all on function public.is_resource_library_staff(uuid, uuid) from public;
revoke all on function public.resource_library_user_can_access_team(uuid, uuid, uuid) from public;
revoke all on function public.current_user_can_view_resource_library(uuid, uuid) from public;
revoke all on function public.current_user_can_manage_resource_library(uuid, uuid) from public;
revoke all on function public.resource_library_player_in_scope(uuid, uuid, uuid) from public;
revoke all on function public.resource_library_link_target_allowed(text, uuid, uuid, uuid) from public;
revoke all on function public.current_user_can_read_resource_file(text) from public;

revoke execute on function public.is_resource_library_staff(uuid, uuid) from anon;
revoke execute on function public.resource_library_user_can_access_team(uuid, uuid, uuid) from anon;
revoke execute on function public.current_user_can_view_resource_library(uuid, uuid) from anon;
revoke execute on function public.current_user_can_manage_resource_library(uuid, uuid) from anon;
revoke execute on function public.resource_library_player_in_scope(uuid, uuid, uuid) from anon;
revoke execute on function public.resource_library_link_target_allowed(text, uuid, uuid, uuid) from anon;
revoke execute on function public.current_user_can_read_resource_file(text) from anon;

grant execute on function public.is_resource_library_staff(uuid, uuid) to authenticated, service_role;
grant execute on function public.resource_library_user_can_access_team(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.current_user_can_view_resource_library(uuid, uuid) to authenticated, service_role;
grant execute on function public.current_user_can_manage_resource_library(uuid, uuid) to authenticated, service_role;
grant execute on function public.resource_library_player_in_scope(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.resource_library_link_target_allowed(text, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.current_user_can_read_resource_file(text) to authenticated, service_role;
