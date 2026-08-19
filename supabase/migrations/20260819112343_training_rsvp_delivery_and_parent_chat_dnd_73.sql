alter table public.parent_chat_memberships
  add column if not exists notifications_muted boolean not null default false;

create or replace function app_private.preserve_training_rsvp_invite_requirement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.calendar_event_id is not null
     and new.invite_status <> 'cancelled'
     and exists (
       select 1
       from public.training_availability_settings setting
       where setting.calendar_event_id = new.calendar_event_id
         and setting.club_id = new.club_id
         and setting.team_id = new.team_id
         and setting.enabled
     ) then
    new.training_availability_requested := true;
    new.notify_requested := true;
    new.response_requirement := 'response_required';
  end if;

  return new;
end;
$$;

alter function app_private.preserve_training_rsvp_invite_requirement() owner to postgres;
revoke all on function app_private.preserve_training_rsvp_invite_requirement()
from public, anon, authenticated, service_role;

drop trigger if exists preserve_training_rsvp_invite_requirement
on public.calendar_event_invites;
create trigger preserve_training_rsvp_invite_requirement
before insert or update on public.calendar_event_invites
for each row execute function app_private.preserve_training_rsvp_invite_requirement();

create or replace function public.get_parent_portal_chat_notification_preferences(
  parent_link_id_value uuid,
  child_only_value boolean default false
)
returns table (
  room_id uuid,
  notifications_muted boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor_id uuid := auth.uid();
  target_link public.parent_player_links%rowtype;
begin
  if actor_id is null then
    raise exception 'Parent authentication is required.';
  end if;

  select link.*
  into target_link
  from public.parent_player_links link
  where link.id = parent_link_id_value
    and link.auth_user_id = actor_id
    and link.status = 'active'
  limit 1;

  if target_link.id is null then
    raise exception 'Parent access is not available for this child.';
  end if;

  return query
  select
    room.id,
    coalesce(membership.notifications_muted, false)
  from public.get_parent_portal_chat_rooms(parent_link_id_value, child_only_value) room
  left join public.parent_chat_memberships membership
    on membership.room_id = room.id
   and membership.auth_user_id = actor_id
   and membership.active;
end;
$$;

revoke all on function public.get_parent_portal_chat_notification_preferences(uuid, boolean)
from public, anon;
grant execute on function public.get_parent_portal_chat_notification_preferences(uuid, boolean)
to authenticated, service_role;

create or replace function public.set_parent_portal_chat_room_notifications(
  parent_link_id_value uuid,
  target_room_id uuid,
  notifications_muted_value boolean,
  child_only_value boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_link public.parent_player_links%rowtype;
  target_room public.parent_chat_rooms%rowtype;
begin
  if actor_id is null then
    raise exception 'Parent authentication is required.';
  end if;

  select link.*
  into target_link
  from public.parent_player_links link
  where link.id = parent_link_id_value
    and link.auth_user_id = actor_id
    and link.status = 'active'
  limit 1;

  if target_link.id is null then
    raise exception 'Parent access is not available for this child.';
  end if;

  select room_record.*
  into target_room
  from public.parent_chat_rooms room_record
  where room_record.id = target_room_id
    and exists (
      select 1
      from public.get_parent_portal_chat_rooms(parent_link_id_value, child_only_value) available_room
      where available_room.id = room_record.id
    )
  limit 1;

  if target_room.id is null then
    raise exception 'This Chat room is not available for the selected child.';
  end if;

  insert into public.parent_chat_memberships (
    room_id,
    club_id,
    auth_user_id,
    member_kind,
    active,
    joined_at,
    left_at,
    notifications_muted,
    updated_at
  ) values (
    target_room.id,
    target_room.club_id,
    actor_id,
    'parent',
    true,
    timezone('utc', now()),
    null,
    coalesce(notifications_muted_value, false),
    timezone('utc', now())
  )
  on conflict (room_id, auth_user_id)
  do update
  set
    club_id = excluded.club_id,
    member_kind = 'parent',
    active = true,
    left_at = null,
    notifications_muted = excluded.notifications_muted,
    updated_at = excluded.updated_at;

  return coalesce(notifications_muted_value, false);
end;
$$;

revoke all on function public.set_parent_portal_chat_room_notifications(uuid, uuid, boolean, boolean)
from public, anon;
grant execute on function public.set_parent_portal_chat_room_notifications(uuid, uuid, boolean, boolean)
to authenticated, service_role;

create or replace function app_private.parent_chat_parent_link_can_receive_notification(
  target_room_id uuid,
  target_auth_user_id uuid,
  target_parent_link_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_room_id is not null
    and target_auth_user_id is not null
    and target_parent_link_id is not null
    and not exists (
      select 1
      from public.parent_chat_memberships membership
      where membership.room_id = target_room_id
        and membership.auth_user_id = target_auth_user_id
        and membership.active
        and membership.notifications_muted
    )
    and exists (
      select 1
      from public.parent_chat_rooms room
      join public.clubs club
        on club.id = room.club_id
       and (to_jsonb(club) ->> 'archived_at') is null
       and coalesce(club.status, 'active') = 'active'
      join public.teams team
        on team.id = room.team_id
       and team.club_id = room.club_id
       and (to_jsonb(team) ->> 'archived_at') is null
       and coalesce(team.status, 'active') = 'active'
      join public.parent_player_links link
        on link.id = target_parent_link_id
       and link.auth_user_id = target_auth_user_id
       and link.status = 'active'
       and link.club_id = room.club_id
      join public.players player
        on player.id = link.player_id
       and player.club_id = room.club_id
       and coalesce(player.status, 'active') <> 'archived'
       and coalesce(link.team_id, player.team_id) = room.team_id
      where room.id = target_room_id
        and room.status = 'active'
        and (
          (room.room_type = 'parent_staff' and room.player_id = link.player_id)
          or room.room_type = 'team'
          or (
            room.room_type = 'match_squad'
            and exists (
              select 1
              from public.match_day_player_squad_decisions decision
              where decision.match_day_id = room.match_day_id
                and decision.club_id = room.club_id
                and decision.team_id = room.team_id
                and decision.player_id = link.player_id
                and decision.status = 'selected'
            )
          )
        )
    );
$$;

alter function app_private.parent_chat_parent_link_can_receive_notification(uuid, uuid, uuid)
owner to postgres;
revoke all on function app_private.parent_chat_parent_link_can_receive_notification(uuid, uuid, uuid)
from public, anon, authenticated, service_role;

comment on column public.parent_chat_memberships.notifications_muted is
  'Parent controlled per-room notification mute. Room access and message history remain unchanged.';

comment on function app_private.preserve_training_rsvp_invite_requirement() is
  'Prevents generic Calendar scope writes from downgrading active Training RSVP invitations.';

comment on function public.get_parent_portal_chat_notification_preferences(uuid, boolean) is
  'Returns server-backed per-room Parent Chat notification preferences for rooms available to the selected child.';

comment on function public.set_parent_portal_chat_room_notifications(uuid, uuid, boolean, boolean) is
  'Updates one Parent Chat room notification preference without changing access to any other room.';
