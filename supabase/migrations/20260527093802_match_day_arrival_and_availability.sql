alter table public.match_days
  add column if not exists arrival_time time;

create table if not exists public.match_day_availability_requests (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null references public.match_days (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  player_id uuid not null references public.players (id) on delete cascade,
  player_name text not null default '',
  recipient_email text not null,
  recipient_name text not null default '',
  recipient_type text not null default 'parent',
  channel text not null default 'email',
  token_hash text not null unique,
  status text not null default 'pending',
  responded_at timestamptz,
  expires_at timestamptz not null default (timezone('utc', now()) + interval '21 days'),
  sent_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint match_day_availability_recipient_type_check check (recipient_type in ('parent', 'player')),
  constraint match_day_availability_channel_check check (channel in ('email', 'push')),
  constraint match_day_availability_status_check check (status in ('pending', 'available', 'unavailable', 'maybe', 'expired'))
);

create unique index if not exists match_day_availability_request_unique_recipient
on public.match_day_availability_requests (match_day_id, player_id, recipient_email, recipient_type, channel);

create index if not exists match_day_availability_match_status_idx
on public.match_day_availability_requests (match_day_id, status, created_at);

create index if not exists match_day_availability_club_team_idx
on public.match_day_availability_requests (club_id, team_id, status);

alter table public.match_day_availability_requests enable row level security;

grant select, insert, update, delete on public.match_day_availability_requests to authenticated;

drop policy if exists match_day_availability_staff_select_scoped on public.match_day_availability_requests;
create policy match_day_availability_staff_select_scoped
on public.match_day_availability_requests
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
  )
);

drop policy if exists match_day_availability_staff_insert_scoped on public.match_day_availability_requests;
create policy match_day_availability_staff_insert_scoped
on public.match_day_availability_requests
for insert
to authenticated
with check (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
);

drop policy if exists match_day_availability_staff_update_scoped on public.match_day_availability_requests;
create policy match_day_availability_staff_update_scoped
on public.match_day_availability_requests
for update
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
)
with check (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
);
