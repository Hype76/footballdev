alter table public.staff_chat_conversations
  add column if not exists player_id uuid references public.players (id) on delete cascade;

alter table public.staff_chat_conversations
  drop constraint if exists staff_chat_conversations_type_check;

alter table public.staff_chat_conversations
  add constraint staff_chat_conversations_type_check
  check (type in ('club_staff', 'team_staff', 'group', 'direct', 'player_staff'));

alter table public.staff_chat_conversations
  drop constraint if exists staff_chat_conversations_team_scope_check;

alter table public.staff_chat_conversations
  add constraint staff_chat_conversations_team_scope_check
  check (
    (type in ('team_staff', 'player_staff') and team_id is not null)
    or (type not in ('team_staff', 'player_staff') and team_id is null)
  );

alter table public.staff_chat_conversations
  add constraint staff_chat_conversations_player_scope_check
  check (
    (type = 'player_staff' and player_id is not null)
    or (type <> 'player_staff' and player_id is null)
  );

create unique index if not exists staff_chat_player_staff_unique_key
on public.staff_chat_conversations (club_id, team_id, player_id)
where type = 'player_staff';

create index if not exists staff_chat_conversations_player_idx
on public.staff_chat_conversations (club_id, player_id, updated_at desc)
where player_id is not null;

create or replace function public.staff_chat_user_can_join_conversation(
  target_conversation_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_chat_conversations scc
    where scc.id = target_conversation_id
      and public.is_staff_chat_staff(target_user_id, scc.club_id)
      and (
        (scc.type = 'club_staff' and public.is_staff_chat_club_wide_staff(target_user_id, scc.club_id))
        or (scc.type = 'team_staff' and public.staff_chat_user_can_access_team(target_user_id, scc.team_id, scc.club_id))
        or (
          scc.type = 'player_staff'
          and scc.player_id is not null
          and public.parent_chat_staff_can_access_team(target_user_id, scc.club_id, scc.team_id)
          and exists (
            select 1
            from public.players player
            where player.id = scc.player_id
              and player.club_id = scc.club_id
              and player.team_id = scc.team_id
              and coalesce(player.status, 'active') <> 'archived'
          )
        )
        or scc.type in ('group', 'direct')
      )
  );
$$;

create or replace function public.can_read_staff_chat_conversation(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_chat_conversations scc
    join public.staff_chat_members scm on scm.conversation_id = scc.id
      and scm.club_id = scc.club_id
      and scm.user_id = auth.uid()
    where scc.id = target_conversation_id
      and scc.club_id = public.current_user_club_id()
      and scm.archived_at is null
      and public.current_user_can_use_staff_chat(scc.club_id)
      and public.staff_chat_user_can_join_conversation(scc.id, auth.uid())
      and (
        scc.type <> 'direct'
        or (
          select count(distinct direct_members.user_id)
          from public.staff_chat_members direct_members
          where direct_members.conversation_id = scc.id
            and direct_members.club_id = scc.club_id
            and direct_members.archived_at is null
        ) = 2
      )
  );
$$;

create or replace function public.record_player_chat_audit(
  actor_id_value uuid,
  club_id_value uuid,
  action_value text,
  entity_id_value uuid,
  outcome_value text,
  metadata_value jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_record public.users%rowtype;
begin
  select * into actor_record
  from public.users
  where id = actor_id_value;

  insert into public.audit_logs (
    club_id,
    actor_id,
    actor_name,
    actor_email,
    actor_role_label,
    actor_role_rank,
    action,
    entity_type,
    entity_id,
    event_category,
    severity,
    outcome,
    source,
    metadata
  ) values (
    club_id_value,
    actor_id_value,
    coalesce(nullif(actor_record.name, ''), actor_record.email),
    actor_record.email,
    coalesce(nullif(actor_record.role_label, ''), actor_record.role),
    coalesce(actor_record.role_rank, 0),
    action_value,
    'player_chat_conversation',
    entity_id_value,
    'data_change',
    case when outcome_value = 'success' then 'info' else 'warning' end,
    outcome_value,
    'database',
    coalesce(metadata_value, '{}'::jsonb)
  );
end;
$$;

create or replace function public.get_player_linked_chat_context(player_id_value uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid := public.current_user_club_id();
  player_record public.players%rowtype;
  conversations_value jsonb := '[]'::jsonb;
  can_start_parent boolean := false;
begin
  if actor_id is null or actor_club_id is null then
    return jsonb_build_object('ok', false, 'denialCategory', 'login_or_staff_context_required');
  end if;

  select * into player_record
  from public.players player
  where player.id = player_id_value
    and player.club_id = actor_club_id
    and coalesce(player.status, 'active') <> 'archived';

  if player_record.id is null then
    perform public.record_player_chat_audit(
      actor_id,
      actor_club_id,
      'player_chat_history_denied',
      null,
      'denied',
      jsonb_build_object('denialCategory', 'player_scope_mismatch')
    );
    return jsonb_build_object('ok', false, 'denialCategory', 'player_scope_mismatch');
  end if;

  if player_record.team_id is null
    or not public.parent_chat_staff_can_access_team(actor_id, actor_club_id, player_record.team_id) then
    perform public.record_player_chat_audit(
      actor_id,
      actor_club_id,
      'player_chat_history_denied',
      player_record.id,
      'denied',
      jsonb_build_object(
        'playerId', player_record.id,
        'teamId', player_record.team_id,
        'denialCategory', 'team_authority_required'
      )
    );
    return jsonb_build_object('ok', false, 'denialCategory', 'team_authority_required');
  end if;

  select exists (
    select 1
    from public.parent_player_links parent_link
    where parent_link.player_id = player_record.id
      and parent_link.club_id = actor_club_id
      and coalesce(parent_link.team_id, player_record.team_id) = player_record.team_id
      and parent_link.status = 'active'
      and parent_link.auth_user_id is not null
  ) into can_start_parent;

  with linked_conversations as (
    select
      room.id,
      'parent'::text as conversation_type,
      'Parent conversation'::text as label,
      room.title,
      room.status,
      room.team_id,
      room.player_id,
      room.updated_at,
      latest.created_at as last_message_at,
      coalesce(unread.total, 0)::bigint as unread_count,
      coalesce(participants.items, '[]'::jsonb) as participants,
      true as can_open
    from public.parent_chat_rooms room
    left join lateral (
      select message.created_at
      from public.parent_chat_messages message
      where message.room_id = room.id
        and message.deleted_at is null
      order by message.created_at desc
      limit 1
    ) latest on true
    left join lateral (
      select count(*)::bigint as total
      from public.parent_chat_messages message
      left join public.parent_chat_memberships membership
        on membership.room_id = room.id
        and membership.auth_user_id = actor_id
      where message.room_id = room.id
        and message.sender_id <> actor_id
        and message.deleted_at is null
        and message.created_at > coalesce(membership.last_read_at, '-infinity'::timestamptz)
    ) unread on true
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id', membership.auth_user_id,
          'name', coalesce(nullif(member_user.name, ''), member_user.email, initcap(membership.member_kind)),
          'kind', membership.member_kind
        ) order by membership.member_kind, coalesce(member_user.name, member_user.email, '')
      ) as items
      from public.parent_chat_memberships membership
      left join public.users member_user on member_user.id = membership.auth_user_id
      where membership.room_id = room.id
        and membership.active = true
    ) participants on true
    where room.club_id = actor_club_id
      and room.team_id = player_record.team_id
      and room.player_id = player_record.id
      and room.room_type = 'parent_staff'
      and public.parent_chat_user_can_access_room(room.id, actor_id)

    union all

    select
      conversation.id,
      'staff'::text as conversation_type,
      'Staff discussion'::text as label,
      conversation.title,
      case when current_member.archived_at is null then 'active' else 'archived' end as status,
      conversation.team_id,
      conversation.player_id,
      conversation.updated_at,
      conversation.last_message_at,
      coalesce(unread.total, 0)::bigint as unread_count,
      coalesce(participants.items, '[]'::jsonb) as participants,
      current_member.archived_at is null as can_open
    from public.staff_chat_conversations conversation
    join public.staff_chat_members current_member
      on current_member.conversation_id = conversation.id
      and current_member.club_id = conversation.club_id
      and current_member.user_id = actor_id
    left join lateral (
      select count(*)::bigint as total
      from public.staff_chat_messages message
      where message.conversation_id = conversation.id
        and message.sender_id <> actor_id
        and message.deleted_at is null
        and message.created_at > coalesce(current_member.last_read_at, '-infinity'::timestamptz)
    ) unread on true
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id', member.user_id,
          'name', coalesce(nullif(member_user.name, ''), member_user.email, 'Staff'),
          'kind', 'staff'
        ) order by coalesce(member_user.name, member_user.email, '')
      ) as items
      from public.staff_chat_members member
      join public.users member_user on member_user.id = member.user_id
      where member.conversation_id = conversation.id
    ) participants on true
    where conversation.club_id = actor_club_id
      and conversation.team_id = player_record.team_id
      and conversation.player_id = player_record.id
      and conversation.type = 'player_staff'
      and public.staff_chat_user_can_join_conversation(conversation.id, actor_id)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', linked.id,
      'conversationType', linked.conversation_type,
      'label', linked.label,
      'title', linked.title,
      'status', linked.status,
      'teamId', linked.team_id,
      'playerId', linked.player_id,
      'participants', linked.participants,
      'lastMessageAt', linked.last_message_at,
      'unreadCount', linked.unread_count,
      'canOpen', linked.can_open
    ) order by coalesce(linked.last_message_at, linked.updated_at) desc, linked.conversation_type
  ), '[]'::jsonb)
  into conversations_value
  from linked_conversations linked;

  return jsonb_build_object(
    'ok', true,
    'playerId', player_record.id,
    'clubId', player_record.club_id,
    'teamId', player_record.team_id,
    'permissions', jsonb_build_object(
      'canViewParent', true,
      'canStartParent', can_start_parent,
      'canViewStaff', true,
      'canStartStaff', true
    ),
    'conversations', conversations_value
  );
end;
$$;

create or replace function public.start_or_reuse_player_chat(
  player_id_value uuid,
  conversation_type_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid := public.current_user_club_id();
  player_record public.players%rowtype;
  normalized_type text := lower(btrim(coalesce(conversation_type_value, '')));
  conversation_id_value uuid;
  created_value boolean := false;
  participant_ids uuid[] := '{}'::uuid[];
begin
  if actor_id is null or actor_club_id is null then
    return jsonb_build_object('ok', false, 'denialCategory', 'login_or_staff_context_required');
  end if;

  if normalized_type not in ('parent', 'staff') then
    perform public.record_player_chat_audit(
      actor_id, actor_club_id, 'player_chat_start_denied', null, 'denied',
      jsonb_build_object('denialCategory', 'unsupported_conversation_type')
    );
    return jsonb_build_object('ok', false, 'denialCategory', 'unsupported_conversation_type');
  end if;

  select * into player_record
  from public.players player
  where player.id = player_id_value
    and player.club_id = actor_club_id
    and coalesce(player.status, 'active') <> 'archived';

  if player_record.id is null then
    perform public.record_player_chat_audit(
      actor_id, actor_club_id, 'player_chat_start_denied', null, 'denied',
      jsonb_build_object('conversationType', normalized_type, 'denialCategory', 'player_scope_mismatch')
    );
    return jsonb_build_object('ok', false, 'denialCategory', 'player_scope_mismatch');
  end if;

  if player_record.team_id is null
    or not public.parent_chat_staff_can_access_team(actor_id, actor_club_id, player_record.team_id) then
    perform public.record_player_chat_audit(
      actor_id, actor_club_id, 'player_chat_start_denied', player_record.id, 'denied',
      jsonb_build_object(
        'playerId', player_record.id,
        'teamId', player_record.team_id,
        'conversationType', normalized_type,
        'denialCategory', 'team_authority_required'
      )
    );
    return jsonb_build_object('ok', false, 'denialCategory', 'team_authority_required');
  end if;

  if normalized_type = 'parent' and not exists (
    select 1
    from public.parent_player_links parent_link
    where parent_link.player_id = player_record.id
      and parent_link.club_id = actor_club_id
      and coalesce(parent_link.team_id, player_record.team_id) = player_record.team_id
      and parent_link.status = 'active'
      and parent_link.auth_user_id is not null
  ) then
    perform public.record_player_chat_audit(
      actor_id, actor_club_id, 'player_chat_start_denied', player_record.id, 'denied',
      jsonb_build_object(
        'playerId', player_record.id,
        'teamId', player_record.team_id,
        'conversationType', normalized_type,
        'denialCategory', 'no_active_parent_recipient'
      )
    );
    return jsonb_build_object('ok', false, 'denialCategory', 'no_active_parent_recipient');
  end if;

  if normalized_type = 'parent' then
    select room.id into conversation_id_value
    from public.parent_chat_rooms room
    where room.club_id = actor_club_id
      and room.team_id = player_record.team_id
      and room.player_id = player_record.id
      and room.room_type = 'parent_staff';

    created_value := conversation_id_value is null;
    perform public.parent_chat_ensure_rooms_for_current_user();

    select room.id into conversation_id_value
    from public.parent_chat_rooms room
    where room.club_id = actor_club_id
      and room.team_id = player_record.team_id
      and room.player_id = player_record.id
      and room.room_type = 'parent_staff'
      and public.parent_chat_user_can_access_room(room.id, actor_id);

    if conversation_id_value is null then
      perform public.record_player_chat_audit(
        actor_id, actor_club_id, 'player_chat_start_denied', player_record.id, 'denied',
        jsonb_build_object(
          'playerId', player_record.id,
          'teamId', player_record.team_id,
          'conversationType', normalized_type,
          'denialCategory', 'no_active_parent_recipient'
        )
      );
      return jsonb_build_object('ok', false, 'denialCategory', 'no_active_parent_recipient');
    end if;

    perform public.parent_chat_reconcile_room(conversation_id_value);

    select coalesce(array_agg(membership.auth_user_id order by membership.auth_user_id), '{}'::uuid[])
    into participant_ids
    from public.parent_chat_memberships membership
    where membership.room_id = conversation_id_value
      and membership.active = true;
  else
    select conversation.id into conversation_id_value
    from public.staff_chat_conversations conversation
    where conversation.club_id = actor_club_id
      and conversation.team_id = player_record.team_id
      and conversation.player_id = player_record.id
      and conversation.type = 'player_staff'
    limit 1;

    if conversation_id_value is null then
      insert into public.staff_chat_conversations (
        club_id,
        team_id,
        player_id,
        type,
        title,
        created_by,
        created_by_name,
        created_by_email
      )
      select
        actor_club_id,
        player_record.team_id,
        player_record.id,
        'player_staff',
        player_record.player_name || ' staff discussion',
        actor_id,
        coalesce(nullif(actor.name, ''), actor.email, ''),
        coalesce(actor.email, '')
      from public.users actor
      where actor.id = actor_id
      on conflict (club_id, team_id, player_id) where type = 'player_staff'
      do nothing
      returning id into conversation_id_value;

      if conversation_id_value is not null then
        created_value := true;
      else
        select conversation.id into conversation_id_value
        from public.staff_chat_conversations conversation
        where conversation.club_id = actor_club_id
          and conversation.team_id = player_record.team_id
          and conversation.player_id = player_record.id
          and conversation.type = 'player_staff';
      end if;
    end if;

    insert into public.staff_chat_members (
      conversation_id,
      club_id,
      user_id,
      added_by,
      last_read_at
    )
    select
      conversation_id_value,
      actor_club_id,
      staff.id,
      actor_id,
      case when staff.id = actor_id then timezone('utc', now()) else null end
    from public.users staff
    where public.parent_chat_staff_can_access_team(
      staff.id,
      actor_club_id,
      player_record.team_id
    )
    on conflict (conversation_id, user_id) do nothing;

    update public.staff_chat_members
    set archived_at = null
    where conversation_id = conversation_id_value
      and user_id = actor_id;

    select coalesce(array_agg(member.user_id order by member.user_id), '{}'::uuid[])
    into participant_ids
    from public.staff_chat_members member
    where member.conversation_id = conversation_id_value;
  end if;

  perform public.record_player_chat_audit(
    actor_id,
    actor_club_id,
    case when created_value then 'player_chat_conversation_created' else 'player_chat_conversation_reused' end,
    conversation_id_value,
    'success',
    jsonb_build_object(
      'playerId', player_record.id,
      'conversationId', conversation_id_value,
      'clubId', actor_club_id,
      'teamId', player_record.team_id,
      'conversationType', normalized_type,
      'participantIds', to_jsonb(participant_ids),
      'result', case when created_value then 'created' else 'reused' end
    )
  );

  return jsonb_build_object(
    'ok', true,
    'conversationId', conversation_id_value,
    'conversationType', normalized_type,
    'playerId', player_record.id,
    'clubId', actor_club_id,
    'teamId', player_record.team_id,
    'participantIds', to_jsonb(participant_ids),
    'result', case when created_value then 'created' else 'reused' end
  );
end;
$$;

create or replace function public.audit_player_linked_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_player_id uuid;
  linked_team_id uuid;
  linked_type text;
  linked_conversation_id uuid;
  message_row jsonb := to_jsonb(new);
begin
  if tg_table_name = 'parent_chat_messages' then
    linked_conversation_id := (message_row->>'room_id')::uuid;
    select room.player_id, room.team_id, 'parent'
    into linked_player_id, linked_team_id, linked_type
    from public.parent_chat_rooms room
    where room.id = linked_conversation_id
      and room.room_type = 'parent_staff'
      and room.player_id is not null;
  else
    linked_conversation_id := (message_row->>'conversation_id')::uuid;
    select conversation.player_id, conversation.team_id, 'staff'
    into linked_player_id, linked_team_id, linked_type
    from public.staff_chat_conversations conversation
    where conversation.id = linked_conversation_id
      and conversation.type = 'player_staff'
      and conversation.player_id is not null;
  end if;

  if linked_player_id is not null then
    perform public.record_player_chat_audit(
      new.sender_id,
      new.club_id,
      'player_chat_message_sent',
      linked_conversation_id,
      'success',
      jsonb_build_object(
        'playerId', linked_player_id,
        'conversationId', linked_conversation_id,
        'clubId', new.club_id,
        'teamId', linked_team_id,
        'conversationType', linked_type,
        'messageId', new.id
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists audit_player_linked_parent_chat_message on public.parent_chat_messages;
create trigger audit_player_linked_parent_chat_message
after insert on public.parent_chat_messages
for each row execute function public.audit_player_linked_chat_message();

drop trigger if exists audit_player_linked_staff_chat_message on public.staff_chat_messages;
create trigger audit_player_linked_staff_chat_message
after insert on public.staff_chat_messages
for each row execute function public.audit_player_linked_chat_message();

revoke all on function public.record_player_chat_audit(uuid, uuid, text, uuid, text, jsonb) from public;
revoke all on function public.get_player_linked_chat_context(uuid) from public;
revoke all on function public.start_or_reuse_player_chat(uuid, text) from public;
revoke all on function public.audit_player_linked_chat_message() from public;

grant execute on function public.get_player_linked_chat_context(uuid) to authenticated, service_role;
grant execute on function public.start_or_reuse_player_chat(uuid, text) to authenticated, service_role;
grant execute on function public.record_player_chat_audit(uuid, uuid, text, uuid, text, jsonb) to service_role;
grant execute on function public.audit_player_linked_chat_message() to service_role;
