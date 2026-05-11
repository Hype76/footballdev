alter table public.teams
  add column if not exists logo_url text;

drop policy if exists team_logos_manager_insert on storage.objects;
create policy team_logos_manager_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'club-logos'
  and public.current_user_role_rank() >= 50
  and (storage.foldername(name))[1] = public.current_user_club_id()::text
  and (storage.foldername(name))[2] = 'teams'
  and exists (
    select 1
    from public.teams t
    where t.id::text = (storage.foldername(name))[3]
      and t.club_id = public.current_user_club_id()
      and name = public.current_user_club_id()::text || '/teams/' || t.id::text || '/logo.png'
  )
);

drop policy if exists team_logos_manager_update on storage.objects;
create policy team_logos_manager_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'club-logos'
  and public.current_user_role_rank() >= 50
  and (storage.foldername(name))[1] = public.current_user_club_id()::text
  and (storage.foldername(name))[2] = 'teams'
  and exists (
    select 1
    from public.teams t
    where t.id::text = (storage.foldername(name))[3]
      and t.club_id = public.current_user_club_id()
      and name = public.current_user_club_id()::text || '/teams/' || t.id::text || '/logo.png'
  )
)
with check (
  bucket_id = 'club-logos'
  and public.current_user_role_rank() >= 50
  and (storage.foldername(name))[1] = public.current_user_club_id()::text
  and (storage.foldername(name))[2] = 'teams'
  and exists (
    select 1
    from public.teams t
    where t.id::text = (storage.foldername(name))[3]
      and t.club_id = public.current_user_club_id()
      and name = public.current_user_club_id()::text || '/teams/' || t.id::text || '/logo.png'
  )
);

drop policy if exists team_logos_manager_delete on storage.objects;
create policy team_logos_manager_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'club-logos'
  and public.current_user_role_rank() >= 50
  and (storage.foldername(name))[1] = public.current_user_club_id()::text
  and (storage.foldername(name))[2] = 'teams'
  and exists (
    select 1
    from public.teams t
    where t.id::text = (storage.foldername(name))[3]
      and t.club_id = public.current_user_club_id()
      and name = public.current_user_club_id()::text || '/teams/' || t.id::text || '/logo.png'
  )
);
