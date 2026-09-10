create table public.club_kits (
  club_id uuid not null references public.clubs(id) on delete cascade,
  kit_type text not null check (kit_type in ('home', 'away')),
  colour text not null default '#1d4ed8' check (colour ~ '^#[0-9a-fA-F]{6}$'),
  image_path text,
  primary key (club_id, kit_type),
  check (image_path is null or (image_path like club_id::text || '/' || kit_type || '/%' and image_path !~ '\.\.'))
);
alter table public.club_kits enable row level security;
revoke all on public.club_kits from anon;
grant select, insert, update, delete on public.club_kits to authenticated;
grant all on public.club_kits to service_role;
create policy club_kits_read on public.club_kits for select to authenticated
using (exists (select 1 from public.clubs where clubs.id = club_kits.club_id));
create policy club_kits_admin_insert on public.club_kits for insert to authenticated
with check (public.current_user_role() = 'admin' and club_id = public.current_user_club_id());
create policy club_kits_admin_update on public.club_kits for update to authenticated
using (public.current_user_role() = 'admin' and club_id = public.current_user_club_id())
with check (public.current_user_role() = 'admin' and club_id = public.current_user_club_id());
create policy club_kits_admin_delete on public.club_kits for delete to authenticated
using (public.current_user_role() = 'admin' and club_id = public.current_user_club_id());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-kits', 'club-kits', true, 2097152, array['image/png','image/jpeg','image/webp']);
create policy club_kit_objects_admin_read on storage.objects for select to authenticated
using (bucket_id = 'club-kits' and public.current_user_role() = 'admin' and (storage.foldername(name))[1] = public.current_user_club_id()::text);
create policy club_kit_objects_admin_insert on storage.objects for insert to authenticated
with check (bucket_id = 'club-kits' and public.current_user_role() = 'admin' and (storage.foldername(name))[1] = public.current_user_club_id()::text and (storage.foldername(name))[2] in ('home','away'));
create policy club_kit_objects_admin_delete on storage.objects for delete to authenticated
using (bucket_id = 'club-kits' and public.current_user_role() = 'admin' and (storage.foldername(name))[1] = public.current_user_club_id()::text);
