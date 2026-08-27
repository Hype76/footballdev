create or replace function public.get_parent_portal_calendar_event_details(parent_link_id_value uuid)
returns table (
  id uuid,
  notes text
)
language sql
stable
security definer
set search_path = ''
as $$
  with target_link as (
    select link.id, link.auth_user_id, link.club_id, link.team_id, link.player_id
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = (select auth.uid())
      and link.status = 'active'
    limit 1
  )
  select distinct
    event.id,
    btrim(coalesce(event.notes, '')) as notes
  from public.calendar_events event
  cross join target_link link
  where (select auth.uid()) is not null
    and event.club_id = link.club_id
    and event.parent_visible is true
    and event.cancelled_at is null
    and (
      event.parent_audience = 'all_club_parents'
      or (
        event.parent_audience = 'all_team_parents'
        and event.team_id is not null
        and event.team_id = link.team_id
      )
      or (
        event.parent_audience = 'involved_players'
        and event.team_id is not null
        and event.team_id = link.team_id
        and exists (
          select 1
          from public.calendar_event_invites invite
          where invite.calendar_event_id = event.id
            and invite.club_id = event.club_id
            and invite.team_id = event.team_id
            and invite.player_id = link.player_id
            and invite.invite_status <> 'cancelled'
            and invite.cancelled_at is null
        )
      )
    )
  order by event.id;
$$;

alter function public.get_parent_portal_calendar_event_details(uuid) owner to postgres;
revoke all on function public.get_parent_portal_calendar_event_details(uuid) from public;
revoke execute on function public.get_parent_portal_calendar_event_details(uuid) from anon;
grant execute on function public.get_parent_portal_calendar_event_details(uuid) to authenticated, service_role;

comment on function public.get_parent_portal_calendar_event_details(uuid) is
  'Returns only parent-visible calendar event notes for the selected active child link, including events where that child has an active invitation.';
