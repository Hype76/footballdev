-- FP-MOBILE-COMMS-POLLS-PRIVACY-CORRECTIVE-36B
-- Assigned Teams establish eligibility. The active Team establishes which
-- Team-scoped Chat is enumerated and operated in the current staff context.

create or replace function public.parent_chat_staff_can_access_active_room(
  target_room_id uuid,
  active_team_id_value uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select target_room_id is not null
    and active_team_id_value is not null
    and target_user_id is not null
    and exists (
      select 1
      from public.parent_chat_rooms room
      where room.id = target_room_id
        and room.team_id = active_team_id_value
        and public.parent_chat_staff_can_access_team(
          target_user_id,
          room.club_id,
          active_team_id_value
        )
    );
$$;

create or replace function public.get_parent_chat_rooms(active_team_id_value uuid)
returns table (
  id uuid,
  room_type text,
  status text,
  title text,
  club_id uuid,
  club_name text,
  team_id uuid,
  team_name text,
  player_id uuid,
  player_name text,
  match_day_id uuid,
  opponent text,
  match_date date,
  kickoff_time time,
  kickoff_time_tbc boolean,
  meet_time time,
  venue_name text,
  fixture_status text,
  child_names text[],
  latest_message text,
  latest_message_at timestamptz,
  unread_count bigint,
  can_post boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_club_id uuid := public.current_user_club_id();
begin
  if not public.parent_chat_staff_can_access_team(
    actor_id,
    actor_club_id,
    active_team_id_value
  ) then
    raise exception 'The active Team is not available for Parent Chat.';
  end if;

  return query
  select room.*
  from public.get_parent_chat_rooms() room
  where room.team_id = active_team_id_value;
end;
$$;

create or replace function public.get_parent_chat_messages(
  target_room_id uuid,
  active_team_id_value uuid
)
returns table (
  id uuid,
  room_id uuid,
  sender_id uuid,
  sender_kind text,
  sender_name text,
  sender_role text,
  body text,
  deleted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  can_delete boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.parent_chat_staff_can_access_active_room(
    target_room_id,
    active_team_id_value,
    (select auth.uid())
  ) then
    raise exception 'This Chat room is not available in the active Team.';
  end if;

  return query
  select message.*
  from public.get_parent_chat_messages(target_room_id) message;
end;
$$;

create or replace function public.send_parent_chat_message(
  target_room_id uuid,
  body_value text,
  active_team_id_value uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.parent_chat_staff_can_access_active_room(
    target_room_id,
    active_team_id_value,
    (select auth.uid())
  ) then
    raise exception 'This Chat room is not available in the active Team.';
  end if;

  return public.send_parent_chat_message(target_room_id, body_value);
end;
$$;

create or replace function public.mark_parent_chat_room_read(
  target_room_id uuid,
  active_team_id_value uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.parent_chat_staff_can_access_active_room(
    target_room_id,
    active_team_id_value,
    (select auth.uid())
  ) then
    raise exception 'This Chat room is not available in the active Team.';
  end if;

  return public.mark_parent_chat_room_read(target_room_id);
end;
$$;

create or replace function public.delete_parent_chat_message(
  target_message_id uuid,
  active_team_id_value uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_room_id uuid;
begin
  select message.room_id
  into target_room_id
  from public.parent_chat_messages message
  where message.id = target_message_id;

  if not public.parent_chat_staff_can_access_active_room(
    target_room_id,
    active_team_id_value,
    (select auth.uid())
  ) then
    raise exception 'This Chat message is not available in the active Team.';
  end if;

  perform public.delete_parent_chat_message(target_message_id);
end;
$$;

create or replace function public.staff_chat_active_team_is_valid(active_team_id_value uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select active_team_id_value is not null
    and public.parent_chat_staff_can_access_team(
      (select auth.uid()),
      public.current_user_club_id(),
      active_team_id_value
    );
$$;

create or replace function public.staff_chat_conversation_in_active_context(
  target_conversation_id uuid,
  active_team_id_value uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.staff_chat_conversations conversation
    where conversation.id = target_conversation_id
      and (
        active_team_id_value is null
        or public.staff_chat_active_team_is_valid(active_team_id_value)
      )
      and public.can_read_staff_chat_conversation(conversation.id)
      and (
        (
          conversation.type in ('team_staff', 'player_staff')
          and conversation.team_id = active_team_id_value
          and public.staff_chat_active_team_is_valid(active_team_id_value)
        )
        or (
          conversation.type in ('club_staff', 'group', 'direct')
          and conversation.team_id is null
        )
      )
  );
$$;

create or replace function public.get_staff_chat_conversation_ids(active_team_id_value uuid)
returns table (id uuid)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if (select auth.uid()) is null
    or not public.current_user_can_use_staff_chat(public.current_user_club_id()) then
    raise exception 'Staff Chat is only available to authorised staff.';
  end if;

  if active_team_id_value is not null
    and not public.staff_chat_active_team_is_valid(active_team_id_value) then
    raise exception 'The active Team is not available for Staff Chat.';
  end if;

  return query
  select conversation.id
  from public.staff_chat_conversations conversation
  where public.staff_chat_conversation_in_active_context(
    conversation.id,
    active_team_id_value
  )
  order by conversation.last_message_at desc nulls last, conversation.updated_at desc;
end;
$$;

create or replace function public.create_staff_chat_conversation(
  conversation_type text,
  title_value text,
  team_id_value uuid,
  member_ids uuid[],
  active_team_id_value uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_type text := btrim(coalesce(conversation_type, ''));
begin
  if normalized_type = 'team_staff' then
    if active_team_id_value is null
      or team_id_value is distinct from active_team_id_value
      or not public.staff_chat_active_team_is_valid(active_team_id_value) then
      raise exception 'Team Staff Chat must use the active authorised Team.';
    end if;
  elsif active_team_id_value is not null
    and not public.staff_chat_active_team_is_valid(active_team_id_value) then
    raise exception 'The active Team is not available for Staff Chat.';
  end if;

  return public.create_staff_chat_conversation(
    conversation_type,
    title_value,
    team_id_value,
    member_ids
  );
end;
$$;

create or replace function public.send_staff_chat_message(
  conversation_id_value uuid,
  body_value text,
  active_team_id_value uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_body text := btrim(coalesce(body_value, ''));
  current_club_id uuid := public.current_user_club_id();
  new_message_id uuid;
begin
  if char_length(normalized_body) < 1 or char_length(normalized_body) > 2000 then
    raise exception 'Staff Chat messages must contain between 1 and 2000 characters.';
  end if;

  if not public.staff_chat_conversation_in_active_context(
    conversation_id_value,
    active_team_id_value
  ) then
    raise exception 'This Staff Chat is not available in the active Team.';
  end if;

  insert into public.staff_chat_messages (
    conversation_id,
    club_id,
    sender_id,
    body
  )
  values (
    conversation_id_value,
    current_club_id,
    (select auth.uid()),
    normalized_body
  )
  returning id into new_message_id;

  update public.staff_chat_conversations
  set
    last_message_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where id = conversation_id_value;

  perform public.mark_staff_chat_conversation_read(conversation_id_value);
  return new_message_id;
end;
$$;

create or replace function public.mark_staff_chat_conversation_read(
  conversation_id_value uuid,
  active_team_id_value uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.staff_chat_conversation_in_active_context(
    conversation_id_value,
    active_team_id_value
  ) then
    raise exception 'This Staff Chat is not available in the active Team.';
  end if;

  perform public.mark_staff_chat_conversation_read(conversation_id_value);
end;
$$;

create or replace function public.archive_staff_chat_conversation(
  conversation_id_value uuid,
  active_team_id_value uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.staff_chat_conversation_in_active_context(
    conversation_id_value,
    active_team_id_value
  ) then
    raise exception 'This Staff Chat is not available in the active Team.';
  end if;

  perform public.archive_staff_chat_conversation(conversation_id_value);
end;
$$;

create or replace function public.delete_staff_chat_message(
  message_id_value uuid,
  active_team_id_value uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_conversation_id uuid;
begin
  select message.conversation_id
  into target_conversation_id
  from public.staff_chat_messages message
  where message.id = message_id_value;

  if not public.staff_chat_conversation_in_active_context(
    target_conversation_id,
    active_team_id_value
  ) then
    raise exception 'This Staff Chat message is not available in the active Team.';
  end if;

  perform public.delete_staff_chat_message(message_id_value);
end;
$$;

revoke execute on function public.get_parent_chat_rooms() from authenticated;
revoke execute on function public.get_parent_chat_messages(uuid) from authenticated;
revoke execute on function public.send_parent_chat_message(uuid, text) from authenticated;
revoke execute on function public.mark_parent_chat_room_read(uuid) from authenticated;
revoke execute on function public.delete_parent_chat_message(uuid) from authenticated;

revoke execute on function public.create_staff_chat_conversation(text, text, uuid, uuid[]) from authenticated;
revoke execute on function public.mark_staff_chat_conversation_read(uuid) from authenticated;
revoke execute on function public.archive_staff_chat_conversation(uuid) from authenticated;
revoke execute on function public.delete_staff_chat_message(uuid) from authenticated;
revoke insert, update on table public.staff_chat_messages from authenticated;

revoke all on function public.parent_chat_staff_can_access_active_room(uuid, uuid, uuid) from public, anon;
revoke all on function public.get_parent_chat_rooms(uuid) from public, anon;
revoke all on function public.get_parent_chat_messages(uuid, uuid) from public, anon;
revoke all on function public.send_parent_chat_message(uuid, text, uuid) from public, anon;
revoke all on function public.mark_parent_chat_room_read(uuid, uuid) from public, anon;
revoke all on function public.delete_parent_chat_message(uuid, uuid) from public, anon;
revoke all on function public.staff_chat_active_team_is_valid(uuid) from public, anon;
revoke all on function public.staff_chat_conversation_in_active_context(uuid, uuid) from public, anon;
revoke all on function public.get_staff_chat_conversation_ids(uuid) from public, anon;
revoke all on function public.create_staff_chat_conversation(text, text, uuid, uuid[], uuid) from public, anon;
revoke all on function public.send_staff_chat_message(uuid, text, uuid) from public, anon;
revoke all on function public.mark_staff_chat_conversation_read(uuid, uuid) from public, anon;
revoke all on function public.archive_staff_chat_conversation(uuid, uuid) from public, anon;
revoke all on function public.delete_staff_chat_message(uuid, uuid) from public, anon;

grant execute on function public.parent_chat_staff_can_access_active_room(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.get_parent_chat_rooms(uuid) to authenticated, service_role;
grant execute on function public.get_parent_chat_messages(uuid, uuid) to authenticated, service_role;
grant execute on function public.send_parent_chat_message(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.mark_parent_chat_room_read(uuid, uuid) to authenticated, service_role;
grant execute on function public.delete_parent_chat_message(uuid, uuid) to authenticated, service_role;
grant execute on function public.staff_chat_active_team_is_valid(uuid) to authenticated, service_role;
grant execute on function public.staff_chat_conversation_in_active_context(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_staff_chat_conversation_ids(uuid) to authenticated, service_role;
grant execute on function public.create_staff_chat_conversation(text, text, uuid, uuid[], uuid) to authenticated, service_role;
grant execute on function public.send_staff_chat_message(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.mark_staff_chat_conversation_read(uuid, uuid) to authenticated, service_role;
grant execute on function public.archive_staff_chat_conversation(uuid, uuid) to authenticated, service_role;
grant execute on function public.delete_staff_chat_message(uuid, uuid) to authenticated, service_role;

comment on function public.parent_chat_staff_can_access_active_room(uuid, uuid, uuid) is
  'Requires Phase 34A explicit Team assignment and an exact active-Team room match for staff-side Parent Chat operations.';

comment on function public.get_staff_chat_conversation_ids(uuid) is
  'Enumerates Team-scoped Staff Chat only for the validated active Team while retaining explicit teamless Staff Chat memberships.';
