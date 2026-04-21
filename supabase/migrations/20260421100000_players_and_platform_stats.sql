create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  player_name text not null,
  section text not null default 'Trial',
  team text not null default '',
  parent_name text,
  parent_email text,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.players
  add column if not exists parent_name text,
  add column if not exists parent_email text,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table public.evaluations
  add column if not exists parent_name text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_section_check'
  ) then
    alter table public.players
      add constraint players_section_check
      check (section in ('Trial', 'Squad'));
  end if;
end $$;

create unique index if not exists players_club_section_name_key
on public.players (club_id, section, lower(player_name));

create unique index if not exists players_club_section_player_name_key
on public.players (club_id, section, player_name);

create index if not exists players_club_id_idx
on public.players (club_id);

create index if not exists players_club_section_idx
on public.players (club_id, section);

create or replace function public.set_players_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists players_set_updated_at on public.players;
create trigger players_set_updated_at
before update on public.players
for each row
execute function public.set_players_updated_at();

grant select, insert, update, delete on public.players to authenticated;

alter table public.players enable row level security;

drop policy if exists players_select_scoped on public.players;
create policy players_select_scoped
on public.players
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or players.club_id = public.current_user_club_id()
);

drop policy if exists players_insert_scoped on public.players;
create policy players_insert_scoped
on public.players
for insert
to authenticated
with check (
  public.current_user_role() <> 'super_admin'
  and players.club_id = public.current_user_club_id()
);

drop policy if exists players_update_scoped on public.players;
create policy players_update_scoped
on public.players
for update
to authenticated
using (
  public.current_user_role() <> 'super_admin'
  and players.club_id = public.current_user_club_id()
)
with check (
  public.current_user_role() <> 'super_admin'
  and players.club_id = public.current_user_club_id()
);

drop policy if exists players_delete_manager_only on public.players;
create policy players_delete_manager_only
on public.players
for delete
to authenticated
using (
  public.current_user_role() <> 'super_admin'
  and players.club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 50
);
