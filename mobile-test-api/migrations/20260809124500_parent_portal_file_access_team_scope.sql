create or replace function public.get_mobile_test_parent_resource_access(
  parent_link_id_value uuid,
  resource_id_value uuid
)
returns table (
  access_type text,
  external_url text,
  storage_bucket text,
  storage_path text,
  original_filename text,
  mime_type text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when external_link.resource_id is not null then 'external_link' else 'file' end,
    coalesce(external_link.external_url, ''),
    coalesce(item.storage_bucket, ''),
    coalesce(item.storage_path, ''),
    coalesce(item.original_filename, ''),
    coalesce(item.mime_type, 'application/octet-stream')
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = parent_link.club_id
   and coalesce(player.status, 'active') <> 'archived'
   and player.archived_at is null
  join public.resource_library_links link
    on link.club_id = parent_link.club_id
   and (parent_link.team_id is null or parent_link.team_id = link.team_id)
   and link.team_id = player.team_id
   and link.linked_type = 'player'
   and link.linked_id = player.id
   and link.parent_visible is true
   and link.removed_at is null
  join public.resource_library_items item
    on item.id = resource_id_value
   and item.id = link.resource_id
   and item.club_id = link.club_id
   and item.team_id = link.team_id
   and item.archived_at is null
  left join public.resource_library_external_links external_link
    on external_link.resource_id = item.id
   and external_link.club_id = item.club_id
   and external_link.team_id = item.team_id
  where parent_link.id = parent_link_id_value
    and parent_link.auth_user_id = auth.uid()
    and parent_link.status = 'active';
$$;

revoke all on function public.get_mobile_test_parent_resource_access(uuid, uuid) from public;
revoke execute on function public.get_mobile_test_parent_resource_access(uuid, uuid) from anon;
grant execute on function public.get_mobile_test_parent_resource_access(uuid, uuid) to authenticated;

drop policy if exists mobile_test_parent_resource_objects_select on storage.objects;
create policy mobile_test_parent_resource_objects_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'resource-library'
  and exists (
    select 1
    from public.parent_player_links parent_link
    join public.players player
      on player.id = parent_link.player_id
     and player.club_id = parent_link.club_id
     and coalesce(player.status, 'active') <> 'archived'
     and player.archived_at is null
    join public.resource_library_links link
      on link.club_id = parent_link.club_id
     and (parent_link.team_id is null or parent_link.team_id = link.team_id)
     and link.team_id = player.team_id
     and link.linked_type = 'player'
     and link.linked_id = player.id
     and link.parent_visible is true
     and link.removed_at is null
    join public.resource_library_items item
      on item.id = link.resource_id
     and item.club_id = link.club_id
     and item.team_id = link.team_id
     and item.storage_bucket = storage.objects.bucket_id
     and item.storage_path = storage.objects.name
     and item.archived_at is null
    where parent_link.auth_user_id = auth.uid()
      and parent_link.status = 'active'
  )
);
