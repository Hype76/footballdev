create table if not exists public.evaluation_drafts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  player_id uuid references public.players (id) on delete set null,
  created_by_user_id uuid not null references public.users (id) on delete cascade,
  report_type text not null default 'development_record',
  context_key text not null,
  draft_data jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  last_saved_at timestamptz not null default timezone('utc', now()),
  submitted_at timestamptz,
  discarded_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint evaluation_drafts_status_check check (status in ('draft', 'submitted', 'discarded')),
  constraint evaluation_drafts_context_key_present check (length(trim(context_key)) > 0),
  constraint evaluation_drafts_report_type_present check (length(trim(report_type)) > 0)
);

create unique index if not exists evaluation_drafts_one_active_context
on public.evaluation_drafts (
  club_id,
  created_by_user_id,
  report_type,
  context_key
)
where status = 'draft';

create index if not exists evaluation_drafts_creator_status_idx
on public.evaluation_drafts (created_by_user_id, status, last_saved_at desc);

create index if not exists evaluation_drafts_player_context_idx
on public.evaluation_drafts (club_id, team_id, player_id, status);

grant select, insert, update on public.evaluation_drafts to authenticated;
revoke all on public.evaluation_drafts from anon;

alter table public.evaluation_drafts enable row level security;

drop policy if exists evaluation_drafts_select_own_active on public.evaluation_drafts;
create policy evaluation_drafts_select_own_active
on public.evaluation_drafts
for select
to authenticated
using (
  created_by_user_id = auth.uid()
  and status = 'draft'
  and club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
);

drop policy if exists evaluation_drafts_insert_own_active on public.evaluation_drafts;
create policy evaluation_drafts_insert_own_active
on public.evaluation_drafts
for insert
to authenticated
with check (
  created_by_user_id = auth.uid()
  and status = 'draft'
  and club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    team_id is null
    or exists (
      select 1
      from public.teams team
      join public.team_staff staff
        on staff.team_id = team.id
      where team.id = evaluation_drafts.team_id
        and team.club_id = evaluation_drafts.club_id
        and staff.user_id = auth.uid()
    )
  )
  and (
    player_id is null
    or exists (
      select 1
      from public.players player
      where player.id = evaluation_drafts.player_id
        and player.club_id = evaluation_drafts.club_id
        and (
          evaluation_drafts.team_id is null
          or player.team_id = evaluation_drafts.team_id
        )
    )
  )
);

drop policy if exists evaluation_drafts_update_own_active on public.evaluation_drafts;
create policy evaluation_drafts_update_own_active
on public.evaluation_drafts
for update
to authenticated
using (
  created_by_user_id = auth.uid()
  and status = 'draft'
  and club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
)
with check (
  created_by_user_id = auth.uid()
  and status in ('draft', 'submitted', 'discarded')
  and club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    team_id is null
    or exists (
      select 1
      from public.teams team
      join public.team_staff staff
        on staff.team_id = team.id
      where team.id = evaluation_drafts.team_id
        and team.club_id = evaluation_drafts.club_id
        and staff.user_id = auth.uid()
    )
  )
  and (
    player_id is null
    or exists (
      select 1
      from public.players player
      where player.id = evaluation_drafts.player_id
        and player.club_id = evaluation_drafts.club_id
        and (
          evaluation_drafts.team_id is null
          or player.team_id = evaluation_drafts.team_id
        )
    )
  )
);
