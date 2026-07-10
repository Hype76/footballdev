alter table public.resource_library_links
  drop constraint if exists resource_library_links_type_check;

alter table public.resource_library_links
  add constraint resource_library_links_type_check
  check (linked_type in ('player', 'team', 'calendar_event'));

create index if not exists resource_library_links_calendar_event_idx
on public.resource_library_links (club_id, team_id, linked_id)
where linked_type = 'calendar_event' and removed_at is null;

create or replace function public.resource_library_calendar_event_in_scope(
  target_event_id uuid,
  target_club_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_team_id is not null
    and exists (
      select 1
      from public.calendar_events event
      where event.id = target_event_id
        and event.club_id = target_club_id
        and event.team_id = target_team_id
        and event.cancelled_at is null
    );
$$;

create or replace function public.resource_library_link_target_allowed(
  target_linked_type text,
  target_linked_id uuid,
  target_club_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    target_linked_type = 'player'
    and public.resource_library_player_in_scope(target_linked_id, target_club_id, target_team_id)
  )
  or (
    target_linked_type = 'team'
    and target_team_id is not null
    and target_linked_id = target_team_id
    and exists (
      select 1
      from public.teams t
      where t.id = target_linked_id
        and t.club_id = target_club_id
    )
  )
  or (
    target_linked_type = 'calendar_event'
    and public.resource_library_calendar_event_in_scope(target_linked_id, target_club_id, target_team_id)
  );
$$;

revoke all on function public.resource_library_calendar_event_in_scope(uuid, uuid, uuid) from public;
revoke execute on function public.resource_library_calendar_event_in_scope(uuid, uuid, uuid) from anon;
grant execute on function public.resource_library_calendar_event_in_scope(uuid, uuid, uuid) to authenticated, service_role;
