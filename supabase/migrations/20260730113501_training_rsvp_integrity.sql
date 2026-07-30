alter table public.training_availability_request_players
drop constraint if exists training_availability_request_players_email_check;

alter table public.training_availability_request_players
add constraint training_availability_request_players_email_check
check (
  btrim(recipient_email) <> ''
  or recipient_type = 'unavailable'
);

alter table public.calendar_event_invites
add column if not exists training_availability_requested boolean not null default false;

update public.calendar_event_invites invite
set
  training_availability_requested = true,
  notify_requested = true,
  response_requirement = 'response_required'
where invite.calendar_event_id is not null
  and invite.invite_status <> 'cancelled'
  and exists (
    select 1
    from public.training_availability_request_players request_player
    where request_player.calendar_event_id = invite.calendar_event_id
      and request_player.player_id = invite.player_id
      and request_player.status <> 'cancelled'
  );

create or replace function public.save_training_availability_setting_v2(
  event_id_value uuid,
  enabled_value boolean,
  send_days_before_value integer
)
returns setof public.training_availability_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  event_record public.calendar_events%rowtype;
  normalized_days integer := least(30, greatest(0, coalesce(send_days_before_value, 2)));
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
      notify_requested = true,
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
      notify_requested = false,
      response_requirement = 'informational',
      updated_by = actor_id,
      updated_at = timezone('utc', now())
    where invite.calendar_event_id = event_record.id
      and invite.club_id = event_record.club_id
      and invite.team_id = event_record.team_id
      and invite.invite_status <> 'cancelled'
      and invite.training_availability_requested = true
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

revoke all on function public.save_training_availability_setting_v2(uuid, boolean, integer)
from public, anon;

grant execute on function public.save_training_availability_setting_v2(uuid, boolean, integer)
to authenticated;

comment on function public.save_training_availability_setting_v2(uuid, boolean, integer) is
'Atomically saves a team training availability setting and turns only the event current participant scope into genuine response-required invitations.';

comment on constraint training_availability_request_players_email_check
on public.training_availability_request_players is
'A recipient email is required unless the invitation has a truthful unavailable-recipient state.';

comment on column public.calendar_event_invites.training_availability_requested is
'True only when staff explicitly turned an attached training participant into a response-required training invitation.';
