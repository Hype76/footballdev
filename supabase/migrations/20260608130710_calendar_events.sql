alter table public.assessment_sessions
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists location text not null default '',
  add column if not exists notes text not null default '';

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  event_type text not null default 'general',
  title text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text not null default '',
  notes text not null default '',
  recurrence_frequency text not null default 'none',
  recurrence_until date,
  cancelled_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_by_name text not null default '',
  created_by_email text not null default '',
  updated_by uuid references public.users (id) on delete set null,
  updated_by_name text not null default '',
  updated_by_email text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint calendar_events_event_type_check check (
    event_type in ('general', 'availability_deadline', 'parent_cutoff')
  ),
  constraint calendar_events_recurrence_frequency_check check (
    recurrence_frequency in ('none', 'weekly', 'fortnightly', 'monthly')
  ),
  constraint calendar_events_time_order_check check (
    ends_at is null or ends_at >= starts_at
  )
);

create index if not exists calendar_events_club_starts_at_idx
on public.calendar_events (club_id, starts_at);

create index if not exists calendar_events_team_id_idx
on public.calendar_events (team_id);

grant select, insert, update, delete on public.calendar_events to authenticated;

alter table public.calendar_events enable row level security;

drop policy if exists calendar_events_select_scoped on public.calendar_events;
create policy calendar_events_select_scoped
on public.calendar_events
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
    and (
      team_id is null
      or public.current_user_role_rank() >= 50
      or exists (
        select 1
        from public.team_staff ts
        where ts.team_id = calendar_events.team_id
          and ts.user_id = auth.uid()
      )
    )
  )
);

drop policy if exists calendar_events_insert_scoped on public.calendar_events;
create policy calendar_events_insert_scoped
on public.calendar_events
for insert
to authenticated
with check (
  club_id = public.current_user_club_id()
  and created_by = auth.uid()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    team_id is null
    or public.current_user_role_rank() >= 50
    or exists (
      select 1
      from public.team_staff ts
      where ts.team_id = calendar_events.team_id
        and ts.user_id = auth.uid()
    )
  )
);

drop policy if exists calendar_events_update_scoped on public.calendar_events;
create policy calendar_events_update_scoped
on public.calendar_events
for update
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    team_id is null
    or public.current_user_role_rank() >= 50
    or created_by = auth.uid()
    or exists (
      select 1
      from public.team_staff ts
      where ts.team_id = calendar_events.team_id
        and ts.user_id = auth.uid()
    )
  )
)
with check (
  club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    team_id is null
    or public.current_user_role_rank() >= 50
    or created_by = auth.uid()
    or exists (
      select 1
      from public.team_staff ts
      where ts.team_id = calendar_events.team_id
        and ts.user_id = auth.uid()
    )
  )
);

drop policy if exists calendar_events_delete_scoped on public.calendar_events;
create policy calendar_events_delete_scoped
on public.calendar_events
for delete
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    public.current_user_role_rank() >= 50
    or created_by = auth.uid()
    or exists (
      select 1
      from public.team_staff ts
      where ts.team_id = calendar_events.team_id
        and ts.user_id = auth.uid()
    )
  )
);
