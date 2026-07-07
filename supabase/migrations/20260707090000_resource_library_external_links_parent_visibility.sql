alter table public.resource_library_items
  add column if not exists resource_type text not null default 'file',
  add column if not exists external_url text not null default '';

alter table public.resource_library_links
  add column if not exists parent_visible boolean not null default false;

alter table public.resource_library_items
  drop constraint if exists resource_library_items_resource_type_check,
  add constraint resource_library_items_resource_type_check
    check (resource_type in ('file', 'external_link'));

alter table public.resource_library_items
  drop constraint if exists resource_library_items_external_url_check,
  add constraint resource_library_items_external_url_check
    check (
      (resource_type = 'file' and external_url = '')
      or
      (resource_type = 'external_link' and external_url ~* '^https?://')
    );

alter table public.resource_library_items
  drop constraint if exists resource_library_items_storage_path_check,
  add constraint resource_library_items_storage_path_check
    check (
      (resource_type = 'file' and storage_path like club_id::text || '/' || team_id::text || '/%')
      or
      (resource_type = 'external_link' and storage_path = '')
    );

create index if not exists resource_library_links_parent_visible_player_idx
on public.resource_library_links (club_id, linked_id)
where linked_type = 'player' and parent_visible is true and removed_at is null;

create or replace function public.get_parent_portal_player_resources(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  player_id uuid,
  title text,
  description text,
  category text,
  resource_type text,
  external_url text,
  storage_bucket text,
  storage_path text,
  original_filename text,
  mime_type text,
  file_size_bytes integer,
  uploaded_by_profile_id uuid,
  uploaded_by_name text,
  uploaded_by_email text,
  archived_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  link_id uuid,
  assigned_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    item.id,
    item.club_id,
    item.team_id,
    link.linked_id as player_id,
    item.title,
    item.description,
    item.category,
    item.resource_type,
    item.external_url,
    item.storage_bucket,
    item.storage_path,
    item.original_filename,
    item.mime_type,
    item.file_size_bytes,
    item.uploaded_by_profile_id,
    item.uploaded_by_name,
    item.uploaded_by_email,
    item.archived_at,
    item.created_at,
    item.updated_at,
    link.id as link_id,
    link.assigned_at
  from public.parent_portal_links parent_link
  join public.resource_library_links link
    on link.club_id = parent_link.club_id
   and link.team_id = parent_link.team_id
   and link.linked_type = 'player'
   and link.linked_id = parent_link.player_id
   and link.parent_visible is true
   and link.removed_at is null
  join public.resource_library_items item
    on item.id = link.resource_id
   and item.club_id = link.club_id
   and item.team_id = link.team_id
   and item.archived_at is null
  where parent_link.id = parent_link_id_value
    and parent_link.user_id = auth.uid()
    and parent_link.revoked_at is null;
$$;

revoke all on function public.get_parent_portal_player_resources(uuid) from public;
revoke execute on function public.get_parent_portal_player_resources(uuid) from anon;
grant execute on function public.get_parent_portal_player_resources(uuid) to authenticated, service_role;
