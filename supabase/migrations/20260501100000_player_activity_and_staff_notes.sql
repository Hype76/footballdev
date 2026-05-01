alter table public.communication_logs
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.player_staff_notes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  user_name text,
  user_email text,
  note text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists player_staff_notes_player_created_idx
on public.player_staff_notes (club_id, player_id, created_at desc);

grant select, insert on public.player_staff_notes to authenticated;

alter table public.player_staff_notes enable row level security;

drop policy if exists player_staff_notes_select_scoped on public.player_staff_notes;
create policy player_staff_notes_select_scoped
on public.player_staff_notes
for select
to authenticated
using (
  player_staff_notes.club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 20
);

drop policy if exists player_staff_notes_insert_scoped on public.player_staff_notes;
create policy player_staff_notes_insert_scoped
on public.player_staff_notes
for insert
to authenticated
with check (
  player_staff_notes.club_id = public.current_user_club_id()
  and player_staff_notes.user_id = auth.uid()
  and public.current_user_role_rank() >= 20
);
