-- Update the existing resource atomically without recreating its assignments.
create or replace function public.update_resource_library_item(
  target_resource_id uuid,
  target_club_id uuid,
  target_team_id uuid,
  expected_updated_at timestamptz,
  title_value text,
  description_value text,
  category_value text,
  external_url_value text default null,
  replacement_file jsonb default null
)
returns public.resource_library_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item public.resource_library_items;
  has_external_link boolean;
begin
  if auth.uid() is null or not public.current_user_can_manage_resource_library(target_club_id, target_team_id) then
    raise exception 'Resource library manager access required.';
  end if;

  select * into item from public.resource_library_items r
  where r.id = target_resource_id and r.club_id = target_club_id
    and r.team_id = target_team_id and r.archived_at is null
  for update;
  if not found then
    raise exception 'Resource is no longer available in this team.';
  end if;
  if expected_updated_at is null or item.updated_at is distinct from expected_updated_at then
    raise exception 'This resource has changed. Reload the page and review it before saving.';
  end if;
  if exists (select 1 from public.formation_board_publications p where p.resource_id = item.id) then
    raise exception 'Edit published formations in Formation Boards.';
  end if;

  select exists (select 1 from public.resource_library_external_links e where e.resource_id = item.id)
    into has_external_link;
  if has_external_link then
    if replacement_file is not null or coalesce(btrim(external_url_value), '') !~* '^https?://[^[:space:]]+$' then
      raise exception 'Add a valid http or https resource link.';
    end if;
    update public.resource_library_external_links
      set external_url = btrim(external_url_value), updated_at = clock_timestamp()
      where resource_id = item.id and club_id = target_club_id and team_id = target_team_id;
    if not found then
      raise exception 'Resource link could not be updated.';
    end if;
    item.original_filename := btrim(external_url_value);
  elsif external_url_value is not null then
    raise exception 'This resource is a file, not an external link.';
  end if;

  if replacement_file is not null then
    if jsonb_typeof(replacement_file) <> 'object'
      or coalesce(replacement_file ->> 'storage_path', '') not like
        target_club_id::text || '/' || target_team_id::text || '/' || item.id::text || '/%'
      or coalesce(replacement_file ->> 'storage_path', '') ~ '(^|/)\.\.(/|$)' then
      raise exception 'Replacement file must belong to this resource.';
    end if;
    item.storage_path := replacement_file ->> 'storage_path';
    item.original_filename := replacement_file ->> 'original_filename';
    item.mime_type := replacement_file ->> 'mime_type';
    item.file_size_bytes := (replacement_file ->> 'file_size_bytes')::integer;
  end if;

  update public.resource_library_items r set
    title = btrim(title_value), description = coalesce(description_value, ''), category = category_value,
    original_filename = item.original_filename, storage_path = item.storage_path,
    mime_type = item.mime_type, file_size_bytes = item.file_size_bytes,
    updated_at = clock_timestamp()
  where r.id = item.id and r.club_id = target_club_id and r.team_id = target_team_id
  returning r.* into item;
  if not found then
    raise exception 'Resource could not be updated.';
  end if;
  return item;
end;
$$;

revoke all on function public.update_resource_library_item(uuid, uuid, uuid, timestamptz, text, text, text, text, jsonb) from public, anon;
grant execute on function public.update_resource_library_item(uuid, uuid, uuid, timestamptz, text, text, text, text, jsonb) to authenticated, service_role;
