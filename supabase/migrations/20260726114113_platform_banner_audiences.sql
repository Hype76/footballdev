insert into public.platform_banners (
  banner_key,
  enabled,
  message,
  background_color
)
values
  (
    'logged_in_users',
    false,
    'Important update for club and team users.',
    '#93C5FD'
  ),
  (
    'parent_portal',
    false,
    'Important update for parents and families.',
    '#86EFAC'
  )
on conflict (banner_key) do nothing;

drop policy if exists platform_banners_public_select on public.platform_banners;
drop policy if exists platform_banners_landing_page_select on public.platform_banners;
drop policy if exists platform_banners_authenticated_select on public.platform_banners;

create policy platform_banners_landing_page_select
on public.platform_banners
for select
to anon
using (banner_key = 'public_site');

create policy platform_banners_authenticated_select
on public.platform_banners
for select
to authenticated
using (true);
