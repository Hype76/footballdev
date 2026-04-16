insert into storage.buckets (id, name, public)
values ('club-logos', 'club-logos', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists club_logos_public_read on storage.objects;
create policy club_logos_public_read
on storage.objects
for select
to public
using (bucket_id = 'club-logos');

drop policy if exists club_logos_manager_insert on storage.objects;
create policy club_logos_manager_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'club-logos'
  and (
    public.current_user_role() = 'super_admin'
    or (
      public.current_user_role() = 'manager'
      and (storage.foldername(name))[1] = public.current_user_club_id()::text
      and name = public.current_user_club_id()::text || '/logo.png'
    )
  )
);

drop policy if exists club_logos_manager_update on storage.objects;
create policy club_logos_manager_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'club-logos'
  and (
    public.current_user_role() = 'super_admin'
    or (
      public.current_user_role() = 'manager'
      and (storage.foldername(name))[1] = public.current_user_club_id()::text
      and name = public.current_user_club_id()::text || '/logo.png'
    )
  )
)
with check (
  bucket_id = 'club-logos'
  and (
    public.current_user_role() = 'super_admin'
    or (
      public.current_user_role() = 'manager'
      and (storage.foldername(name))[1] = public.current_user_club_id()::text
      and name = public.current_user_club_id()::text || '/logo.png'
    )
  )
);

drop policy if exists club_logos_manager_delete on storage.objects;
create policy club_logos_manager_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'club-logos'
  and (
    public.current_user_role() = 'super_admin'
    or (
      public.current_user_role() = 'manager'
      and (storage.foldername(name))[1] = public.current_user_club_id()::text
      and name = public.current_user_club_id()::text || '/logo.png'
    )
  )
);
