-- Allow GIF resources without changing the private bucket, size limit, or access policies.

do $$
declare
  current_mime_types text[];
begin
  select allowed_mime_types
  into current_mime_types
  from storage.buckets
  where id = 'resource-library'
  for update;

  if not found then
    raise exception 'resource-library storage bucket does not exist';
  end if;

  if current_mime_types is null then
    raise exception 'resource-library storage bucket MIME allowlist is missing';
  end if;

  if not ('image/gif' = any(current_mime_types)) then
    update storage.buckets
    set allowed_mime_types = array_append(current_mime_types, 'image/gif')
    where id = 'resource-library';
  end if;
end
$$;

alter table public.resource_library_items
  drop constraint if exists resource_library_items_mime_check;

alter table public.resource_library_items
  add constraint resource_library_items_mime_check check (
    mime_type in (
      'application/pdf',
      'application/vnd.footballplayer.formation-board+json',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/csv',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp'
    )
  ) not valid;

alter table public.resource_library_items
  validate constraint resource_library_items_mime_check;
