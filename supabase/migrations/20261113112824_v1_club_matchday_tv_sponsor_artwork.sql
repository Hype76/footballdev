insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'club-matchday-tv-sponsors', 'club-matchday-tv-sponsors', false,
  5242880, array['image/png', 'image/jpeg', 'image/webp']
);

-- Only the V1 Matchday TV service can issue path-specific upload or read URLs.
create policy club_matchday_tv_sponsors_service_only
  on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id <> 'club-matchday-tv-sponsors')
  with check (bucket_id <> 'club-matchday-tv-sponsors');
