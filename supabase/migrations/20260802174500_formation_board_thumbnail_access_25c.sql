-- FP-V1-FORMATION-BOARD-PUBLISH-EXPORT-25C
-- Allow authorised Team staff to sign protected Formation Board thumbnails through the existing Resource policy.

create or replace function public.current_user_can_read_resource_file(target_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.resource_library_items item
    where item.storage_bucket = 'resource-library'
      and item.storage_path = target_storage_path
      and item.archived_at is null
      and public.current_user_can_view_resource_library(item.club_id, item.team_id)
  )
  or exists (
    select 1
    from public.formation_board_publications publication
    join public.resource_library_items item on item.id = publication.resource_id
    where publication.thumbnail_bucket = 'resource-library'
      and publication.thumbnail_path = target_storage_path
      and item.archived_at is null
      and public.current_user_can_view_formation_board(publication.board_id)
  );
$$;

revoke all on function public.current_user_can_read_resource_file(text) from public, anon;
grant execute on function public.current_user_can_read_resource_file(text) to authenticated, service_role;
