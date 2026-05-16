create table if not exists public.parent_player_links (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  parent_link_id uuid references public.parent_player_links (id) on delete cascade,
  link_type text not null default 'parent',
  email text,
  auth_user_id uuid references auth.users (id) on delete cascade,
  invite_token uuid not null default gen_random_uuid(),
  status text not null default 'pending',
  invited_by uuid references public.users (id) on delete set null,
  invited_by_name text,
  accepted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint parent_player_links_type_check check (link_type in ('parent', 'family')),
  constraint parent_player_links_status_check check (status in ('pending', 'active', 'revoked')),
  constraint parent_player_links_parent_required check (
    link_type = 'parent' or parent_link_id is not null
  )
);

create unique index if not exists parent_player_links_invite_token_key
on public.parent_player_links (invite_token);

create unique index if not exists parent_player_links_unique_email
on public.parent_player_links (team_id, player_id, lower(coalesce(email, '')), link_type)
where email is not null and status <> 'revoked';

create index if not exists parent_player_links_auth_user_idx
on public.parent_player_links (auth_user_id, status);

create index if not exists parent_player_links_player_idx
on public.parent_player_links (club_id, team_id, player_id);

alter table public.parent_player_links enable row level security;

grant select, insert, update, delete on public.parent_player_links to authenticated;

create or replace function public.can_manage_parent_link(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teams t
    where t.id = target_team_id
      and t.club_id = public.current_user_club_id()
      and (
        public.current_user_role_rank() >= 50
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = t.id
            and ts.user_id = auth.uid()
        )
      )
  );
$$;

grant execute on function public.can_manage_parent_link(uuid) to authenticated;

drop policy if exists parent_player_links_select_scoped on public.parent_player_links;
create policy parent_player_links_select_scoped
on public.parent_player_links
for select
to authenticated
using (
  auth.uid() = auth_user_id
  or exists (
    select 1
    from public.parent_player_links parent_link
    where parent_link.id = parent_player_links.parent_link_id
      and parent_link.auth_user_id = auth.uid()
      and parent_link.status = 'active'
      and parent_link.player_id = parent_player_links.player_id
  )
  or public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.can_manage_parent_link(team_id)
  )
);

drop policy if exists parent_player_links_insert_scoped on public.parent_player_links;
create policy parent_player_links_insert_scoped
on public.parent_player_links
for insert
to authenticated
with check (
  auth.uid() = auth_user_id
  or (
    link_type = 'family'
    and exists (
      select 1
      from public.parent_player_links parent_link
      where parent_link.id = parent_player_links.parent_link_id
        and parent_link.auth_user_id = auth.uid()
        and parent_link.status = 'active'
        and parent_link.player_id = parent_player_links.player_id
    )
  )
  or (
    club_id = public.current_user_club_id()
    and public.can_manage_parent_link(team_id)
    and exists (
      select 1
      from public.players p
      where p.id = parent_player_links.player_id
        and p.club_id = parent_player_links.club_id
        and (
          p.team_id = parent_player_links.team_id
          or parent_player_links.team_id is null
        )
    )
  )
);

drop policy if exists parent_player_links_update_scoped on public.parent_player_links;
create policy parent_player_links_update_scoped
on public.parent_player_links
for update
to authenticated
using (
  auth.uid() = auth_user_id
  or (
    club_id = public.current_user_club_id()
    and public.can_manage_parent_link(team_id)
  )
)
with check (
  auth.uid() = auth_user_id
  or (
    club_id = public.current_user_club_id()
    and public.can_manage_parent_link(team_id)
  )
);

drop policy if exists parent_player_links_delete_scoped on public.parent_player_links;
create policy parent_player_links_delete_scoped
on public.parent_player_links
for delete
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.can_manage_parent_link(team_id)
);

create or replace function public.accept_parent_player_link(invite_token_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  player_id uuid,
  parent_link_id uuid,
  link_type text,
  email text,
  auth_user_id uuid,
  invite_token uuid,
  status text,
  invited_by uuid,
  invited_by_name text,
  accepted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_email text := lower(coalesce((auth.jwt() ->> 'email'), ''));
begin
  if auth.uid() is null then
    raise exception 'Login is required before opening this parent link.';
  end if;

  update public.parent_player_links link
  set
    auth_user_id = auth.uid(),
    email = coalesce(nullif(link.email, ''), auth_email),
    status = 'active',
    accepted_at = coalesce(link.accepted_at, timezone('utc', now())),
    updated_at = timezone('utc', now())
  where link.invite_token = invite_token_value
    and link.status <> 'revoked'
  returning
    link.id,
    link.club_id,
    link.team_id,
    link.player_id,
    link.parent_link_id,
    link.link_type,
    link.email,
    link.auth_user_id,
    link.invite_token,
    link.status,
    link.invited_by,
    link.invited_by_name,
    link.accepted_at,
    link.created_at,
    link.updated_at
  into
    id,
    club_id,
    team_id,
    player_id,
    parent_link_id,
    link_type,
    email,
    auth_user_id,
    invite_token,
    status,
    invited_by,
    invited_by_name,
    accepted_at,
    created_at,
    updated_at;

  if id is null then
    raise exception 'This parent link is no longer available.';
  end if;

  return next;
end;
$$;

grant execute on function public.accept_parent_player_link(uuid) to authenticated;
