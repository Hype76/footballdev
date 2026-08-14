-- Chat sends from mobile use a stable request identity so a safe retry cannot
-- create duplicate messages when the first response is lost in transit.

alter table public.parent_chat_messages
add column if not exists client_request_id uuid;

create unique index if not exists parent_chat_messages_sender_request_key
on public.parent_chat_messages (sender_id, client_request_id)
where client_request_id is not null;

alter table public.staff_chat_messages
add column if not exists client_request_id uuid;

create unique index if not exists staff_chat_messages_sender_request_key
on public.staff_chat_messages (sender_id, client_request_id)
where client_request_id is not null;

create or replace function public.send_parent_chat_message_idempotent(
  target_room_id uuid,
  body_value text,
  request_id_value uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_record public.parent_chat_rooms%rowtype;
  normalized_body text := btrim(coalesce(body_value, ''));
  sender_kind_value text;
  sender_name_value text;
  sender_role_value text;
  existing_message public.parent_chat_messages%rowtype;
  new_message_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Login is required.';
  end if;

  if request_id_value is null then
    raise exception 'A Chat request identity is required.';
  end if;

  if char_length(normalized_body) < 1 or char_length(normalized_body) > 2000 then
    raise exception 'Chat messages must contain between 1 and 2000 characters.';
  end if;

  if not public.parent_chat_user_can_post_room(target_room_id, (select auth.uid())) then
    raise exception 'This Chat room is not available for new messages.';
  end if;

  select message.*
  into existing_message
  from public.parent_chat_messages message
  where message.sender_id = (select auth.uid())
    and message.client_request_id = request_id_value;

  if existing_message.id is not null then
    if existing_message.room_id is distinct from target_room_id
      or btrim(existing_message.body) is distinct from normalized_body then
      raise exception 'This Chat request identity has already been used.';
    end if;
    return existing_message.id;
  end if;

  select * into room_record
  from public.parent_chat_rooms room
  where room.id = target_room_id;

  if public.parent_chat_staff_can_access_team(
    (select auth.uid()),
    room_record.club_id,
    room_record.team_id
  ) then
    select
      'staff',
      coalesce(nullif(staff.display_name, ''), nullif(staff.name, ''), 'Team staff'),
      coalesce(nullif(staff.role_label, ''), 'Team staff')
    into sender_kind_value, sender_name_value, sender_role_value
    from public.users staff
    where staff.id = (select auth.uid());
  else
    sender_kind_value := 'parent';
    sender_name_value := coalesce(
      nullif((select auth.jwt()) -> 'user_metadata' ->> 'display_name', ''),
      nullif((select auth.jwt()) -> 'user_metadata' ->> 'name', ''),
      'Parent or guardian'
    );
    sender_role_value := 'Parent or guardian';
  end if;

  insert into public.parent_chat_messages (
    room_id,
    club_id,
    sender_id,
    sender_kind,
    sender_name,
    sender_role,
    body,
    client_request_id
  )
  values (
    room_record.id,
    room_record.club_id,
    (select auth.uid()),
    sender_kind_value,
    sender_name_value,
    sender_role_value,
    normalized_body,
    request_id_value
  )
  on conflict (sender_id, client_request_id)
    where client_request_id is not null
  do nothing
  returning id into new_message_id;

  if new_message_id is null then
    select message.*
    into existing_message
    from public.parent_chat_messages message
    where message.sender_id = (select auth.uid())
      and message.client_request_id = request_id_value;

    if existing_message.room_id is distinct from target_room_id
      or btrim(existing_message.body) is distinct from normalized_body then
      raise exception 'This Chat request identity has already been used.';
    end if;
    return existing_message.id;
  end if;

  update public.parent_chat_rooms
  set updated_at = timezone('utc', now())
  where id = room_record.id;

  insert into public.parent_chat_memberships (
    room_id,
    club_id,
    auth_user_id,
    member_kind,
    active,
    last_read_at,
    updated_at
  )
  values (
    room_record.id,
    room_record.club_id,
    (select auth.uid()),
    sender_kind_value,
    true,
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict (room_id, auth_user_id)
  do update set
    active = true,
    member_kind = excluded.member_kind,
    last_read_at = excluded.last_read_at,
    left_at = null,
    updated_at = excluded.updated_at;

  return new_message_id;
end;
$$;

create or replace function public.send_parent_chat_message(
  target_room_id uuid,
  body_value text,
  active_team_id_value uuid,
  request_id_value uuid
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

  return public.send_parent_chat_message_idempotent(target_room_id, body_value, request_id_value);
end;
$$;

create or replace function public.send_parent_portal_chat_message(
  parent_link_id_value uuid,
  target_room_id uuid,
  body_value text,
  child_only_value boolean,
  request_id_value uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.get_parent_portal_chat_context(parent_link_id_value)
  limit 1;

  if child_only_value
    and not public.parent_chat_room_matches_parent_link(
      target_room_id,
      parent_link_id_value,
      auth.uid()
    ) then
    raise exception 'This Chat room is not available for the selected child.';
  end if;

  return public.send_parent_chat_message_idempotent(target_room_id, body_value, request_id_value);
end;
$$;

create or replace function public.send_staff_chat_message(
  conversation_id_value uuid,
  body_value text,
  active_team_id_value uuid,
  request_id_value uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_body text := btrim(coalesce(body_value, ''));
  current_club_id uuid := public.current_user_club_id();
  existing_message public.staff_chat_messages%rowtype;
  new_message_id uuid;
begin
  if request_id_value is null then
    raise exception 'A Chat request identity is required.';
  end if;

  if char_length(normalized_body) < 1 or char_length(normalized_body) > 2000 then
    raise exception 'Staff Chat messages must contain between 1 and 2000 characters.';
  end if;

  if not public.staff_chat_conversation_in_active_context(
    conversation_id_value,
    active_team_id_value
  ) then
    raise exception 'This Staff Chat is not available in the active Team.';
  end if;

  select message.*
  into existing_message
  from public.staff_chat_messages message
  where message.sender_id = (select auth.uid())
    and message.client_request_id = request_id_value;

  if existing_message.id is not null then
    if existing_message.conversation_id is distinct from conversation_id_value
      or btrim(existing_message.body) is distinct from normalized_body then
      raise exception 'This Chat request identity has already been used.';
    end if;
    return existing_message.id;
  end if;

  insert into public.staff_chat_messages (
    conversation_id,
    club_id,
    sender_id,
    body,
    client_request_id
  )
  values (
    conversation_id_value,
    current_club_id,
    (select auth.uid()),
    normalized_body,
    request_id_value
  )
  on conflict (sender_id, client_request_id)
    where client_request_id is not null
  do nothing
  returning id into new_message_id;

  if new_message_id is null then
    select message.*
    into existing_message
    from public.staff_chat_messages message
    where message.sender_id = (select auth.uid())
      and message.client_request_id = request_id_value;

    if existing_message.conversation_id is distinct from conversation_id_value
      or btrim(existing_message.body) is distinct from normalized_body then
      raise exception 'This Chat request identity has already been used.';
    end if;
    return existing_message.id;
  end if;

  update public.staff_chat_conversations
  set
    last_message_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where id = conversation_id_value;

  perform public.mark_staff_chat_conversation_read(conversation_id_value);
  return new_message_id;
end;
$$;

revoke all on function public.send_parent_chat_message_idempotent(uuid, text, uuid) from public, anon;
grant execute on function public.send_parent_chat_message_idempotent(uuid, text, uuid) to authenticated, service_role;

revoke all on function public.send_parent_chat_message(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.send_parent_chat_message(uuid, text, uuid, uuid) to authenticated, service_role;

revoke all on function public.send_parent_portal_chat_message(uuid, uuid, text, boolean, uuid) from public, anon;
grant execute on function public.send_parent_portal_chat_message(uuid, uuid, text, boolean, uuid) to authenticated, service_role;

revoke all on function public.send_staff_chat_message(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.send_staff_chat_message(uuid, text, uuid, uuid) to authenticated, service_role;

comment on column public.parent_chat_messages.client_request_id is
  'Sender-scoped mobile idempotency key. Repeating the same request returns the original message.';

comment on column public.staff_chat_messages.client_request_id is
  'Sender-scoped mobile idempotency key. Repeating the same request returns the original message.';
