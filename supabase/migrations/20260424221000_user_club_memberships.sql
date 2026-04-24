create table if not exists public.user_club_memberships (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  username text,
  name text,
  role text not null default 'coach',
  role_label text not null default 'Coach',
  role_rank integer not null default 30,
  club_id uuid not null references public.clubs (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists user_club_memberships_auth_user_club_key
on public.user_club_memberships (auth_user_id, club_id);

create index if not exists user_club_memberships_email_idx
on public.user_club_memberships (lower(email));

insert into public.user_club_memberships (
  auth_user_id,
  email,
  username,
  name,
  role,
  role_label,
  role_rank,
  club_id,
  created_at,
  updated_at
)
select
  u.id,
  u.email,
  u.username,
  u.name,
  u.role,
  coalesce(u.role_label, u.role),
  coalesce(u.role_rank, 0),
  u.club_id,
  coalesce(u.created_at, timezone('utc', now())),
  timezone('utc', now())
from public.users u
where u.club_id is not null
  and u.role <> 'super_admin'
on conflict (auth_user_id, club_id) do update
set email = excluded.email,
    username = excluded.username,
    name = excluded.name,
    role = excluded.role,
    role_label = excluded.role_label,
    role_rank = excluded.role_rank,
    updated_at = timezone('utc', now());

grant select, insert, update, delete on public.user_club_memberships to authenticated;

alter table public.user_club_memberships enable row level security;

drop policy if exists user_club_memberships_select_scoped on public.user_club_memberships;
create policy user_club_memberships_select_scoped
on public.user_club_memberships
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or auth.uid() = auth_user_id
  or lower(email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  )
);

drop policy if exists user_club_memberships_insert_scoped on public.user_club_memberships;
create policy user_club_memberships_insert_scoped
on public.user_club_memberships
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or auth.uid() = auth_user_id
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and role_rank <= public.current_user_role_rank()
  )
);

drop policy if exists user_club_memberships_update_scoped on public.user_club_memberships;
create policy user_club_memberships_update_scoped
on public.user_club_memberships
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or auth.uid() = auth_user_id
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and role_rank <= public.current_user_role_rank()
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or auth.uid() = auth_user_id
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and role_rank <= public.current_user_role_rank()
  )
);

drop policy if exists user_club_memberships_delete_scoped on public.user_club_memberships;
create policy user_club_memberships_delete_scoped
on public.user_club_memberships
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and role_rank <= public.current_user_role_rank()
  )
);
