-- Extend only the existing resource upload MIME allowlist. Keep the private
-- bucket, every existing format and the 20 MiB resource size constraint.
do $$
declare types text[];
begin
  select allowed_mime_types into types from storage.buckets where id='resource-library' for update;
  if not found or types is null then raise exception 'resource_library_mime_allowlist_missing'; end if;
  if not ('video/mp4'=any(types)) then types:=array_append(types,'video/mp4'); end if;
  if not ('video/quicktime'=any(types)) then types:=array_append(types,'video/quicktime'); end if;
  update storage.buckets set allowed_mime_types=types where id='resource-library';
end;
$$;
alter table public.resource_library_items drop constraint resource_library_items_mime_check;
alter table public.resource_library_items add constraint resource_library_items_mime_check check (mime_type in (
  'application/pdf','application/vnd.footballplayer.formation-board+json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv','text/plain','image/png','image/jpeg','image/gif','image/webp','video/mp4','video/quicktime'
)) not valid;
alter table public.resource_library_items validate constraint resource_library_items_mime_check;
