create or replace function public.sync_calendar_event_invites(
  team_id_value uuid,
  calendar_event_id_value uuid default null,
  assessment_session_id_value uuid default null,
  invite_rows_value jsonb default '[]'::jsonb
)
returns setof public.calendar_event_invites
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid := public.current_user_club_id();
  actor_role_rank integer := public.current_user_role_rank();
  actor_name text := '';
  actor_email text := '';
  selected_player_ids uuid[] := '{}'::uuid[];
begin
  if actor_id is null or actor_club_id is null then
    raise exception 'Authenticated club access is required.';
  end if;

  if actor_role_rank < 20 then
    raise exception 'Coach or manager access is required for event invites.';
  end if;

  if num_nonnulls(calendar_event_id_value, assessment_session_id_value) <> 1 then
    raise exception 'Choose one event source before saving invites.';
  end if;

  if jsonb_typeof(invite_rows_value) is distinct from 'array' then
    raise exception 'Invite rows must be a JSON array.';
  end if;

  if not exists (
    select 1
    from public.teams team
    where team.id = team_id_value
      and team.club_id = actor_club_id
  ) then
    raise exception 'The selected team is outside the active club.';
  end if;

  if actor_role_rank < 50 and not exists (
    select 1
    from public.team_staff assignment
    where assignment.team_id = team_id_value
      and assignment.user_id = actor_id
  ) then
    raise exception 'The selected team is outside the current staff assignment.';
  end if;

  if calendar_event_id_value is not null and not exists (
    select 1
    from public.calendar_events event
    where event.id = calendar_event_id_value
      and event.club_id = actor_club_id
      and event.team_id = team_id_value
  ) then
    raise exception 'The selected calendar event is outside the active club or team.';
  end if;

  if assessment_session_id_value is not null and not exists (
    select 1
    from public.assessment_sessions session
    where session.id = assessment_session_id_value
      and session.club_id = actor_club_id
      and session.team_id = team_id_value
  ) then
    raise exception 'The selected assessment session is outside the active club or team.';
  end if;

  with invite_input as (
    select distinct on (parsed.player_id) parsed.*
    from jsonb_to_recordset(invite_rows_value) as parsed(
      player_id uuid,
      parent_link_id uuid,
      player_status_at_invite text,
      recipient_type text,
      parent_contact_name text,
      parent_contact_email text,
      player_contact_email text,
      recipient_contacts jsonb,
      notify_requested boolean
    )
    where parsed.player_id is not null
    order by parsed.player_id
  )
  select coalesce(array_agg(invite_input.player_id), '{}'::uuid[])
  into selected_player_ids
  from invite_input;

  if exists (
    select 1
    from unnest(selected_player_ids) as selected(player_id)
    where not exists (
      select 1
      from public.players player
      where player.id = selected.player_id
        and player.club_id = actor_club_id
        and player.team_id = team_id_value
    )
  ) then
    raise exception 'One or more selected players are outside the active club or team.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(invite_rows_value) as parsed(
      player_id uuid,
      parent_link_id uuid
    )
    where parsed.parent_link_id is not null
      and not exists (
        select 1
        from public.parent_player_links parent_link
        where parent_link.id = parsed.parent_link_id
          and parent_link.club_id = actor_club_id
          and parent_link.team_id = team_id_value
          and parent_link.player_id = parsed.player_id
          and parent_link.status = 'active'
      )
  ) then
    raise exception 'One or more parent links are outside the authorised player scope.';
  end if;

  select coalesce(profile.name, ''), coalesce(profile.email, '')
  into actor_name, actor_email
  from public.users profile
  where profile.id = actor_id;

  update public.calendar_event_invites existing
  set
    invite_status = 'cancelled',
    cancelled_at = timezone('utc', now()),
    updated_by = actor_id,
    updated_by_name = actor_name,
    updated_by_email = actor_email
  where existing.club_id = actor_club_id
    and existing.team_id = team_id_value
    and existing.calendar_event_id is not distinct from calendar_event_id_value
    and existing.assessment_session_id is not distinct from assessment_session_id_value
    and existing.match_day_id is null
    and existing.invite_status <> 'cancelled'
    and not (existing.player_id = any(selected_player_ids));

  return query
  with invite_input as (
    select distinct on (parsed.player_id) parsed.*
    from jsonb_to_recordset(invite_rows_value) as parsed(
      player_id uuid,
      parent_link_id uuid,
      player_status_at_invite text,
      recipient_type text,
      parent_contact_name text,
      parent_contact_email text,
      player_contact_email text,
      recipient_contacts jsonb,
      notify_requested boolean
    )
    where parsed.player_id is not null
    order by parsed.player_id
  )
  insert into public.calendar_event_invites as existing (
    club_id,
    team_id,
    calendar_event_id,
    assessment_session_id,
    match_day_id,
    player_id,
    parent_link_id,
    player_status_at_invite,
    recipient_type,
    parent_contact_name,
    parent_contact_email,
    player_contact_email,
    recipient_contacts,
    invite_status,
    notify_requested,
    cancelled_at,
    created_by,
    created_by_name,
    created_by_email,
    updated_by,
    updated_by_name,
    updated_by_email
  )
  select
    actor_club_id,
    team_id_value,
    calendar_event_id_value,
    assessment_session_id_value,
    null,
    invite_input.player_id,
    invite_input.parent_link_id,
    coalesce(invite_input.player_status_at_invite, ''),
    coalesce(invite_input.recipient_type, 'parent_guardian'),
    coalesce(invite_input.parent_contact_name, ''),
    lower(coalesce(invite_input.parent_contact_email, '')),
    lower(coalesce(invite_input.player_contact_email, '')),
    coalesce(invite_input.recipient_contacts, '[]'::jsonb),
    'active',
    coalesce(invite_input.notify_requested, false),
    null,
    actor_id,
    actor_name,
    actor_email,
    actor_id,
    actor_name,
    actor_email
  from invite_input
  on conflict (
    club_id,
    player_id,
    calendar_event_id,
    assessment_session_id,
    match_day_id
  ) do update
  set
    team_id = excluded.team_id,
    parent_link_id = excluded.parent_link_id,
    player_status_at_invite = excluded.player_status_at_invite,
    recipient_type = excluded.recipient_type,
    parent_contact_name = excluded.parent_contact_name,
    parent_contact_email = excluded.parent_contact_email,
    player_contact_email = excluded.player_contact_email,
    recipient_contacts = excluded.recipient_contacts,
    invite_status = case
      when existing.responded_at is not null then existing.invite_status
      else 'active'
    end,
    notify_requested = excluded.notify_requested,
    cancelled_at = null,
    updated_by = actor_id,
    updated_by_name = actor_name,
    updated_by_email = actor_email
  returning existing.*;
end;
$$;

revoke all on function public.sync_calendar_event_invites(uuid, uuid, uuid, jsonb)
from public, anon;

grant execute on function public.sync_calendar_event_invites(uuid, uuid, uuid, jsonb)
to authenticated;
