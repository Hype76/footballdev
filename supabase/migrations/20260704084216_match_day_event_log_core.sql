create table if not exists public.match_day_event_log (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  match_day_id uuid not null references public.match_days (id) on delete cascade,
  player_id uuid references public.players (id) on delete set null,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_display_name text not null default '',
  actor_role text not null default '',
  event_type text not null,
  event_label text not null,
  previous_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint match_day_event_log_event_type_check check (
    event_type in (
      'match_day_created',
      'match_day_updated',
      'player_selected',
      'player_deselected',
      'player_availability_changed',
      'match_role_assigned',
      'match_role_removed',
      'scorer_updated',
      'linesman_updated',
      'invite_prepared',
      'invite_queued',
      'note_updated'
    )
  ),
  constraint match_day_event_log_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint match_day_event_log_previous_object_check check (previous_value is null or jsonb_typeof(previous_value) = 'object'),
  constraint match_day_event_log_new_object_check check (new_value is null or jsonb_typeof(new_value) = 'object')
);

create index if not exists match_day_event_log_match_created_idx
on public.match_day_event_log (match_day_id, created_at desc);

create index if not exists match_day_event_log_team_created_idx
on public.match_day_event_log (club_id, team_id, created_at desc);

create index if not exists match_day_event_log_player_created_idx
on public.match_day_event_log (player_id, created_at desc)
where player_id is not null;

alter table public.match_day_event_log enable row level security;
alter table public.match_day_event_log force row level security;

revoke all on public.match_day_event_log from public;
revoke all on public.match_day_event_log from anon;
revoke all on public.match_day_event_log from authenticated;

grant select, insert on public.match_day_event_log to authenticated;

drop policy if exists match_day_event_log_staff_select_scoped on public.match_day_event_log;
create policy match_day_event_log_staff_select_scoped
on public.match_day_event_log
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.can_read_match_day(team_id)
    and exists (
      select 1
      from public.match_days match_day
      where match_day.id = match_day_event_log.match_day_id
        and match_day.club_id = match_day_event_log.club_id
        and match_day.team_id = match_day_event_log.team_id
    )
  )
);

drop policy if exists match_day_event_log_staff_insert_scoped on public.match_day_event_log;
create policy match_day_event_log_staff_insert_scoped
on public.match_day_event_log
for insert
to authenticated
with check (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
  and exists (
    select 1
    from public.match_days match_day
    where match_day.id = match_day_event_log.match_day_id
      and match_day.club_id = match_day_event_log.club_id
      and match_day.team_id = match_day_event_log.team_id
  )
  and (
    player_id is null
    or exists (
      select 1
      from public.players player
      where player.id = match_day_event_log.player_id
        and player.club_id = match_day_event_log.club_id
        and player.team_id = match_day_event_log.team_id
    )
  )
);

comment on table public.match_day_event_log is
  'Staff-visible V1 Match Day event log for fixture actions. Parent and player portal reads are not granted.';

comment on column public.match_day_event_log.metadata is
  'Non-sensitive operational context only. Do not store parent or player contact details here.';
