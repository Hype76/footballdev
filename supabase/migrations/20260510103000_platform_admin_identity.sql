create table if not exists public.platform_admins (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

drop policy if exists platform_admins_select_self on public.platform_admins;
create policy platform_admins_select_self
on public.platform_admins
for select
to authenticated
using (id = auth.uid());

drop policy if exists platform_admins_select_super_admin on public.platform_admins;
create policy platform_admins_select_super_admin
on public.platform_admins
for select
to authenticated
using (
  exists (
    select 1
    from public.platform_admins admins
    where admins.id = auth.uid()
      and admins.status = 'active'
  )
);

insert into public.platform_admins (id, email, name, status)
select id, lower(email), coalesce(name, display_name, username, email), coalesce(status, 'active')
from public.users
where role = 'super_admin'
on conflict (id) do update set
  email = excluded.email,
  name = excluded.name,
  status = excluded.status,
  updated_at = now();
