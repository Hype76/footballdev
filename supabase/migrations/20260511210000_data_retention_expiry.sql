alter table public.players
  add column if not exists archived_delete_at timestamp with time zone;

update public.players
set archived_delete_at = coalesce(archived_at, timezone('utc', now())) + interval '3 months'
where status = 'archived'
  and archived_delete_at is null;

create index if not exists players_archived_delete_idx
on public.players (club_id, archived_delete_at)
where status = 'archived';

alter table public.player_staff_notes
  add column if not exists audio_expires_at timestamp with time zone;

update public.player_staff_notes
set audio_expires_at = coalesce(created_at, timezone('utc', now())) + interval '14 days'
where coalesce(audio_path, '') <> ''
  and audio_expires_at is null;

create index if not exists player_staff_notes_audio_expires_idx
on public.player_staff_notes (club_id, audio_expires_at)
where coalesce(audio_path, '') <> '';
