alter table public.evaluations
add column if not exists player_id uuid references public.players (id) on delete set null,
add column if not exists team_id uuid references public.teams (id) on delete set null,
add column if not exists rejection_reason text,
add column if not exists reviewed_by uuid references public.users (id) on delete set null,
add column if not exists reviewed_at timestamptz;

alter table public.players
add column if not exists status text not null default 'active',
add column if not exists promoted_at timestamptz,
add column if not exists promoted_by uuid references public.users (id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_status_check'
  ) then
    alter table public.players
      add constraint players_status_check
      check (status in ('active', 'promoted', 'archived'));
  end if;
end $$;

update public.evaluations e
set player_id = p.id
from public.players p
where e.player_id is null
  and p.club_id = e.club_id
  and lower(p.player_name) = lower(e.player_name)
  and p.section = e.section;

update public.evaluations e
set team_id = t.id
from public.teams t
where e.team_id is null
  and t.club_id = e.club_id
  and lower(t.name) = lower(e.team);

create index if not exists evaluations_player_id_idx on public.evaluations (player_id);
create index if not exists evaluations_team_id_idx on public.evaluations (team_id);
create index if not exists evaluations_status_idx on public.evaluations (status);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs (id) on delete cascade,
  actor_id uuid references public.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists audit_logs_club_id_created_at_idx
on public.audit_logs (club_id, created_at desc);

create table if not exists public.communication_logs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  player_id uuid references public.players (id) on delete set null,
  evaluation_id uuid references public.evaluations (id) on delete set null,
  user_id uuid references public.users (id) on delete set null,
  channel text not null default 'pdf',
  action text not null,
  recipient_email text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists communication_logs_club_player_created_at_idx
on public.communication_logs (club_id, player_id, created_at desc);

grant select, insert on public.audit_logs to authenticated;
grant select, insert on public.communication_logs to authenticated;

alter table public.audit_logs enable row level security;
alter table public.communication_logs enable row level security;

drop policy if exists audit_logs_select_scoped on public.audit_logs;
create policy audit_logs_select_scoped
on public.audit_logs
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or audit_logs.actor_id = auth.uid()
  or (
    audit_logs.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  )
);

drop policy if exists audit_logs_insert_scoped on public.audit_logs;
create policy audit_logs_insert_scoped
on public.audit_logs
for insert
to authenticated
with check (
  actor_id = auth.uid()
  and (
    club_id is null
    or club_id = public.current_user_club_id()
    or public.current_user_role() = 'super_admin'
  )
);

drop policy if exists communication_logs_select_scoped on public.communication_logs;
create policy communication_logs_select_scoped
on public.communication_logs
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or communication_logs.user_id = auth.uid()
  or (
    communication_logs.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  )
);

drop policy if exists communication_logs_insert_scoped on public.communication_logs;
create policy communication_logs_insert_scoped
on public.communication_logs
for insert
to authenticated
with check (
  user_id = auth.uid()
  and communication_logs.club_id = public.current_user_club_id()
);
