-- Add canonical Calendar attachment targets without changing resource visibility,
-- parent access, notification behavior, or existing recurring-event links.
alter table public.resource_library_links
  drop constraint if exists resource_library_links_type_check;
alter table public.resource_library_links
  add constraint resource_library_links_type_check
  check (linked_type in ('player', 'team', 'calendar_event', 'match_day', 'assessment_session'));

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
set search_path = ''
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
      select 1 from public.teams team
      where team.id = target_linked_id and team.club_id = target_club_id
    )
  )
  or (
    target_linked_type = 'calendar_event'
    and public.resource_library_calendar_event_in_scope(target_linked_id, target_club_id, target_team_id)
  )
  or (
    target_linked_type = 'match_day'
    and auth.uid() is not null
    and public.current_user_can_manage_resource_library(target_club_id, target_team_id)
    and target_team_id is not null
    and exists (
      select 1 from public.match_days fixture
      where fixture.id = target_linked_id
        and fixture.club_id = target_club_id
        and fixture.team_id = target_team_id
        and fixture.deleted_at is null
        and fixture.status not in ('cancelled', 'deleted')
    )
  )
  or (
    target_linked_type = 'assessment_session'
    and auth.uid() is not null
    and public.current_user_can_manage_resource_library(target_club_id, target_team_id)
    and target_team_id is not null
    and exists (
      select 1 from public.assessment_sessions session
      where session.id = target_linked_id
        and session.club_id = target_club_id
        and session.team_id = target_team_id
        and session.status not in ('cancelled', 'deleted')
    )
  );
$$;

alter function public.resource_library_link_target_allowed(text, uuid, uuid, uuid) owner to postgres;
revoke all on function public.resource_library_link_target_allowed(text, uuid, uuid, uuid) from public, anon;
grant execute on function public.resource_library_link_target_allowed(text, uuid, uuid, uuid) to authenticated, service_role;

-- The existing non-calendar unique index protects duplicate attachments. The
-- occurrence constraint/trigger requires null dates for these one-off targets.
