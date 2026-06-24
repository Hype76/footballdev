create table if not exists public.calendar_event_invites (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  calendar_event_id uuid references public.calendar_events (id) on delete cascade,
  assessment_session_id uuid references public.assessment_sessions (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  parent_link_id uuid references public.parent_player_links (id) on delete set null,
  player_status_at_invite text not null default '',
  recipient_type text not null default 'parent_guardian',
  parent_contact_name text not null default '',
  parent_contact_email text not null default '',
  player_contact_email text not null default '',
  recipient_contacts jsonb not null default '[]'::jsonb,
  invite_status text not null default 'active',
  notify_requested boolean not null default false,
  invited_at timestamptz not null default timezone('utc', now()),
  cancelled_at timestamptz,
  responded_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_by_name text not null default '',
  created_by_email text not null default '',
  updated_by uuid references public.users (id) on delete set null,
  updated_by_name text not null default '',
  updated_by_email text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint calendar_event_invites_source_check check (
    (calendar_event_id is not null and assessment_session_id is null)
    or (calendar_event_id is null and assessment_session_id is not null)
  ),
  constraint calendar_event_invites_recipient_type_check check (
    recipient_type in ('parent_guardian', 'player', 'parent_and_player')
  ),
  constraint calendar_event_invites_status_check check (
    invite_status in ('active', 'cancelled', 'responded')
  )
);

create unique index if not exists calendar_event_invites_source_player_key
on public.calendar_event_invites (
  club_id,
  player_id,
  calendar_event_id,
  assessment_session_id
) nulls not distinct;

create index if not exists calendar_event_invites_calendar_event_idx
on public.calendar_event_invites (calendar_event_id);

create index if not exists calendar_event_invites_assessment_session_idx
on public.calendar_event_invites (assessment_session_id);

create index if not exists calendar_event_invites_parent_link_idx
on public.calendar_event_invites (parent_link_id, invite_status, invited_at);

create index if not exists calendar_event_invites_player_idx
on public.calendar_event_invites (club_id, team_id, player_id, invite_status);

create or replace function public.set_calendar_event_invites_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists calendar_event_invites_set_updated_at on public.calendar_event_invites;
create trigger calendar_event_invites_set_updated_at
before update on public.calendar_event_invites
for each row
execute function public.set_calendar_event_invites_updated_at();

alter table public.calendar_event_invites enable row level security;

grant select, insert, update, delete on public.calendar_event_invites to authenticated;

drop policy if exists calendar_event_invites_select_scoped on public.calendar_event_invites;
create policy calendar_event_invites_select_scoped
on public.calendar_event_invites
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or exists (
    select 1
    from public.parent_player_links link
    where link.player_id = calendar_event_invites.player_id
      and link.club_id = calendar_event_invites.club_id
      and link.auth_user_id = auth.uid()
      and link.status = 'active'
  )
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 20
    and (
      public.current_user_role_rank() >= 50
      or exists (
        select 1
        from public.team_staff ts
        where ts.team_id = calendar_event_invites.team_id
          and ts.user_id = auth.uid()
      )
    )
  )
);

drop policy if exists calendar_event_invites_insert_scoped on public.calendar_event_invites;
create policy calendar_event_invites_insert_scoped
on public.calendar_event_invites
for insert
to authenticated
with check (
  club_id = public.current_user_club_id()
  and created_by = auth.uid()
  and public.current_user_role_rank() >= 20
  and (
    public.current_user_role_rank() >= 50
    or exists (
      select 1
      from public.team_staff ts
      where ts.team_id = calendar_event_invites.team_id
        and ts.user_id = auth.uid()
    )
  )
  and exists (
    select 1
    from public.players p
    where p.id = calendar_event_invites.player_id
      and p.club_id = calendar_event_invites.club_id
      and p.team_id = calendar_event_invites.team_id
  )
  and (
    (
      calendar_event_id is not null
      and exists (
        select 1
        from public.calendar_events event
        where event.id = calendar_event_invites.calendar_event_id
          and event.club_id = calendar_event_invites.club_id
          and event.team_id = calendar_event_invites.team_id
      )
    )
    or (
      assessment_session_id is not null
      and exists (
        select 1
        from public.assessment_sessions session
        where session.id = calendar_event_invites.assessment_session_id
          and session.club_id = calendar_event_invites.club_id
          and session.team_id = calendar_event_invites.team_id
      )
    )
  )
);

drop policy if exists calendar_event_invites_update_scoped on public.calendar_event_invites;
create policy calendar_event_invites_update_scoped
on public.calendar_event_invites
for update
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 20
  and (
    public.current_user_role_rank() >= 50
    or exists (
      select 1
      from public.team_staff ts
      where ts.team_id = calendar_event_invites.team_id
        and ts.user_id = auth.uid()
    )
  )
)
with check (
  club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 20
  and (
    public.current_user_role_rank() >= 50
    or exists (
      select 1
      from public.team_staff ts
      where ts.team_id = calendar_event_invites.team_id
        and ts.user_id = auth.uid()
    )
  )
  and exists (
    select 1
    from public.players p
    where p.id = calendar_event_invites.player_id
      and p.club_id = calendar_event_invites.club_id
      and p.team_id = calendar_event_invites.team_id
  )
);

drop policy if exists calendar_event_invites_delete_scoped on public.calendar_event_invites;
create policy calendar_event_invites_delete_scoped
on public.calendar_event_invites
for delete
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 20
  and (
    public.current_user_role_rank() >= 50
    or exists (
      select 1
      from public.team_staff ts
      where ts.team_id = calendar_event_invites.team_id
        and ts.user_id = auth.uid()
    )
  )
);
