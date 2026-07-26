create table if not exists public.platform_banners (
  banner_key text primary key
    check (banner_key ~ '^[a-z0-9_]+$'),
  enabled boolean not null default false,
  message text not null
    check (char_length(btrim(message)) between 1 and 280),
  background_color text not null default '#FCD34D'
    check (background_color ~ '^#[0-9A-Fa-f]{6}$'),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_platform_banners_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

revoke all on function public.set_platform_banners_updated_at() from public, anon, authenticated;

drop trigger if exists platform_banners_set_updated_at on public.platform_banners;
create trigger platform_banners_set_updated_at
before update on public.platform_banners
for each row
execute function public.set_platform_banners_updated_at();

alter table public.platform_banners enable row level security;

revoke all on table public.platform_banners from public, anon, authenticated;
grant select on table public.platform_banners to anon, authenticated;
grant update (enabled, message, background_color) on table public.platform_banners to authenticated;
grant select, insert, update, delete on table public.platform_banners to service_role;

drop policy if exists platform_banners_public_select on public.platform_banners;
create policy platform_banners_public_select
on public.platform_banners
for select
to anon, authenticated
using (true);

drop policy if exists platform_banners_platform_admin_update on public.platform_banners;
create policy platform_banners_platform_admin_update
on public.platform_banners
for update
to authenticated
using ((select public.current_user_role()) = 'super_admin')
with check ((select public.current_user_role()) = 'super_admin');

insert into public.platform_banners (
  banner_key,
  enabled,
  message,
  background_color
)
values (
  'public_site',
  true,
  'Parent login is currently being worked on and may not work until 8:00am on Monday 27 July.',
  '#FCD34D'
)
on conflict (banner_key) do nothing;
