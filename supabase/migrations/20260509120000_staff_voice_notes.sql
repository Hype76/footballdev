insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staff-voice-notes',
  'staff-voice-notes',
  false,
  10485760,
  array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.player_staff_notes
  alter column player_id drop not null,
  add column if not exists session_id uuid references public.assessment_sessions (id) on delete set null,
  add column if not exists audio_path text not null default '',
  add column if not exists audio_mime_type text not null default '',
  add column if not exists audio_duration_seconds numeric;

create index if not exists player_staff_notes_session_created_idx
on public.player_staff_notes (club_id, session_id, created_at desc);

drop policy if exists staff_voice_notes_select_scoped on storage.objects;
create policy staff_voice_notes_select_scoped
on storage.objects
for select
to authenticated
using (
  bucket_id = 'staff-voice-notes'
  and (storage.foldername(name))[1] = public.current_user_club_id()::text
  and public.current_user_role_rank() >= 20
);

drop policy if exists staff_voice_notes_insert_scoped on storage.objects;
create policy staff_voice_notes_insert_scoped
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'staff-voice-notes'
  and (storage.foldername(name))[1] = public.current_user_club_id()::text
  and public.current_user_role_rank() >= 20
);
