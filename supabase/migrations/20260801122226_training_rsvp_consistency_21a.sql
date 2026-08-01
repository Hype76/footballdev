create or replace function public.save_training_availability_setting_v3(
  event_id_value uuid,
  enabled_value boolean,
  send_days_before_value integer,
  notify_invited_families_value boolean
)
returns setof public.training_availability_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  event_record public.calendar_events%rowtype;
  normalized_days integer := least(30, greatest(0, coalesce(send_days_before_value, 2)));
  normalized_notify boolean := coalesce(notify_invited_families_value, false);
begin
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;

  select event.*
  into event_record
  from public.calendar_events event
  where event.id = event_id_value
    and event.event_type = 'training'
    and event.team_id is not null
    and event.cancelled_at is null;

  if not found then
    raise exception 'Training event not found.';
  end if;

  if not public.training_availability_user_can_manage(
    event_record.club_id,
    event_record.team_id
  ) then
    raise exception 'You do not have access to manage Training Availability for this team.';
  end if;

  insert into public.training_availability_settings (
    club_id,
    team_id,
    calendar_event_id,
    enabled,
    send_days_before,
    created_by,
    updated_by
  ) values (
    event_record.club_id,
    event_record.team_id,
    event_record.id,
    coalesce(enabled_value, false),
    normalized_days,
    actor_id,
    actor_id
  )
  on conflict (calendar_event_id)
  do update
  set
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    enabled = excluded.enabled,
    send_days_before = excluded.send_days_before,
    updated_by = excluded.updated_by;

  if coalesce(enabled_value, false) then
    update public.calendar_event_invites invite
    set
      training_availability_requested = true,
      notify_requested = normalized_notify,
      response_requirement = 'response_required',
      updated_by = actor_id,
      updated_at = timezone('utc', now())
    where invite.calendar_event_id = event_record.id
      and invite.club_id = event_record.club_id
      and invite.team_id = event_record.team_id
      and invite.invite_status <> 'cancelled';
  else
    update public.calendar_event_invites invite
    set
      training_availability_requested = false,
      notify_requested = normalized_notify,
      response_requirement = 'informational',
      updated_by = actor_id,
      updated_at = timezone('utc', now())
    where invite.calendar_event_id = event_record.id
      and invite.club_id = event_record.club_id
      and invite.team_id = event_record.team_id
      and invite.invite_status <> 'cancelled'
      and not exists (
        select 1
        from public.training_availability_request_players request_player
        where request_player.calendar_event_id = invite.calendar_event_id
          and request_player.player_id = invite.player_id
          and request_player.status <> 'cancelled'
      );
  end if;

  return query
  select setting.*
  from public.training_availability_settings setting
  where setting.calendar_event_id = event_record.id;
end;
$$;

revoke all on function public.save_training_availability_setting_v3(uuid, boolean, integer, boolean)
from public, anon;
grant execute on function public.save_training_availability_setting_v3(uuid, boolean, integer, boolean)
to authenticated, service_role;

comment on function public.save_training_availability_setting_v3(uuid, boolean, integer, boolean) is
  'Saves canonical Training RSVP settings while keeping parent visibility, response requirement, and communication suppression as distinct decisions.';
