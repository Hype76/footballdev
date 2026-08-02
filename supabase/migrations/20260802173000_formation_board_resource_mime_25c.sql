-- FP-V1-FORMATION-BOARD-PUBLISH-EXPORT-25C
-- Extend the existing Team Resource Library MIME allowlist for protected Formation Board records.

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
      'image/webp'
    )
  ) not valid;

alter table public.resource_library_items
  validate constraint resource_library_items_mime_check;
