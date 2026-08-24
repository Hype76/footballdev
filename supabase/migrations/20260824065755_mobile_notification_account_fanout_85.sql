create or replace function app_private.coach_mobile_installation_has_current_context(
  target_installation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_installation_id is not null
    and exists (
      select 1
      from public.coach_mobile_push_installations installation
      join public.users profile
        on profile.id = installation.user_profile_id
       and profile.id = installation.auth_user_id
       and coalesce(profile.status, 'active') = 'active'
      join public.user_club_memberships membership
        on membership.auth_user_id = profile.id
       and membership.club_id = profile.club_id
       and membership.role = profile.role
       and membership.role_rank = profile.role_rank
      join public.clubs club
        on club.id = profile.club_id
       and club.archived_at is null
       and coalesce(club.status, 'active') = 'active'
      where installation.installation_id = target_installation_id
        and installation.app_role = 'coach'
        and installation.status = 'active'
        and installation.enabled
        and installation.detail_level in ('minimal', 'detailed')
        and installation.expo_push_token is not null
    );
$$;

create or replace function app_private.enqueue_parent_chat_mobile_notification_intents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.parent_chat_rooms%rowtype;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  select room.*
  into target_room
  from public.parent_chat_rooms room
  where room.id = new.room_id
    and room.status = 'active';

  if target_room.id is null then
    return new;
  end if;

  insert into public.parent_chat_mobile_notification_intents (
    message_id,
    room_id,
    recipient_app,
    installation_id,
    auth_user_id,
    parent_link_id,
    club_id,
    team_id,
    room_type
  )
  select
    new.id,
    target_room.id,
    'parent',
    installation.installation_id,
    installation.auth_user_id,
    recipient_link.id,
    target_room.club_id,
    target_room.team_id,
    target_room.room_type
  from public.parent_mobile_push_installations installation
  join lateral (
    select link.id
    from public.parent_player_links link
    where link.auth_user_id = installation.auth_user_id
      and app_private.parent_chat_parent_link_can_receive_notification(
        target_room.id,
        installation.auth_user_id,
        link.id
      )
    order by (link.id = installation.parent_link_id) desc, link.id
    limit 1
  ) recipient_link on true
  where installation.status = 'active'
    and installation.enabled
    and installation.detail_level in ('minimal', 'detailed')
    and installation.expo_push_token is not null
    and installation.auth_user_id is distinct from new.sender_id
  on conflict (message_id, recipient_app, installation_id) do nothing;

  insert into public.parent_chat_mobile_notification_intents (
    message_id,
    room_id,
    recipient_app,
    installation_id,
    auth_user_id,
    user_profile_id,
    club_id,
    team_id,
    room_type
  )
  select
    new.id,
    target_room.id,
    'coach',
    installation.installation_id,
    installation.auth_user_id,
    installation.user_profile_id,
    target_room.club_id,
    target_room.team_id,
    target_room.room_type
  from public.coach_mobile_push_installations installation
  where installation.auth_user_id is distinct from new.sender_id
    and installation.user_profile_id is distinct from new.sender_id
    and app_private.coach_mobile_installation_has_current_context(installation.installation_id)
    and public.parent_chat_staff_can_access_team(
      installation.user_profile_id,
      target_room.club_id,
      target_room.team_id
    )
  on conflict (message_id, recipient_app, installation_id) do nothing;

  return new;
end;
$$;

create or replace function app_private.enqueue_staff_chat_mobile_notification_intents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_conversation public.staff_chat_conversations%rowtype;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  select conversation.*
  into target_conversation
  from public.staff_chat_conversations conversation
  where conversation.id = new.conversation_id;

  if target_conversation.id is null then
    return new;
  end if;

  insert into public.staff_chat_mobile_notification_intents (
    message_id,
    conversation_id,
    installation_id,
    auth_user_id,
    user_profile_id,
    club_id,
    team_id,
    conversation_type
  )
  select
    new.id,
    target_conversation.id,
    installation.installation_id,
    installation.auth_user_id,
    installation.user_profile_id,
    target_conversation.club_id,
    target_conversation.team_id,
    target_conversation.type
  from public.coach_mobile_push_installations installation
  where installation.auth_user_id is distinct from new.sender_id
    and installation.user_profile_id is distinct from new.sender_id
    and app_private.coach_mobile_installation_has_current_context(installation.installation_id)
    and app_private.staff_chat_recipient_can_receive_notification(
      target_conversation.id,
      installation.user_profile_id
    )
  on conflict (message_id, installation_id) do nothing;

  return new;
end;
$$;

create or replace function app_private.parent_chat_mobile_notification_intent_is_current(
  target_intent_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.parent_chat_mobile_notification_intents intent
    join public.parent_chat_messages message
      on message.id = intent.message_id
     and message.room_id = intent.room_id
     and message.deleted_at is null
     and message.sender_id is distinct from intent.auth_user_id
    join public.parent_chat_rooms room
      on room.id = intent.room_id
     and room.status = 'active'
     and room.club_id = intent.club_id
     and room.team_id = intent.team_id
     and room.room_type = intent.room_type
    where intent.id = target_intent_id
      and (
        (
          intent.recipient_app = 'parent'
          and exists (
            select 1
            from public.parent_mobile_push_installations installation
            where installation.installation_id = intent.installation_id
              and installation.auth_user_id = intent.auth_user_id
              and installation.status = 'active'
              and installation.enabled
              and installation.detail_level in ('minimal', 'detailed')
              and installation.expo_push_token is not null
              and app_private.parent_chat_parent_link_can_receive_notification(
                intent.room_id,
                intent.auth_user_id,
                intent.parent_link_id
              )
          )
        )
        or (
          intent.recipient_app = 'coach'
          and exists (
            select 1
            from public.coach_mobile_push_installations installation
            where installation.installation_id = intent.installation_id
              and installation.auth_user_id = intent.auth_user_id
              and installation.user_profile_id = intent.user_profile_id
              and app_private.coach_mobile_installation_has_current_context(installation.installation_id)
              and public.parent_chat_staff_can_access_team(
                intent.user_profile_id,
                intent.club_id,
                intent.team_id
              )
          )
        )
      )
  );
$$;

create or replace function app_private.staff_chat_mobile_notification_intent_is_current(
  target_intent_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_chat_mobile_notification_intents intent
    join public.staff_chat_messages message
      on message.id = intent.message_id
     and message.conversation_id = intent.conversation_id
     and message.deleted_at is null
     and message.sender_id is distinct from intent.user_profile_id
    join public.staff_chat_conversations conversation
      on conversation.id = intent.conversation_id
     and conversation.club_id = intent.club_id
     and conversation.team_id is not distinct from intent.team_id
     and conversation.type = intent.conversation_type
    join public.coach_mobile_push_installations installation
      on installation.installation_id = intent.installation_id
     and installation.auth_user_id = intent.auth_user_id
     and installation.user_profile_id = intent.user_profile_id
    where intent.id = target_intent_id
      and app_private.coach_mobile_installation_has_current_context(installation.installation_id)
      and app_private.staff_chat_recipient_can_receive_notification(
        intent.conversation_id,
        intent.user_profile_id
      )
  );
$$;

create or replace function app_private.enqueue_parent_poll_mobile_notification_intents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.audience <> 'parents' or new.status <> 'open' then
    return new;
  end if;

  insert into public.parent_poll_mobile_notification_intents (
    poll_id,
    installation_id,
    auth_user_id,
    parent_link_id,
    club_id,
    team_id
  )
  select
    new.id,
    installation.installation_id,
    installation.auth_user_id,
    recipient_link.id,
    new.club_id,
    new.team_id
  from public.parent_mobile_push_installations installation
  join lateral (
    select link.id
    from public.parent_player_links link
    join public.players player
      on player.id = link.player_id
     and player.club_id = new.club_id
     and coalesce(player.status, 'active') <> 'archived'
    where link.auth_user_id = installation.auth_user_id
      and link.club_id = new.club_id
      and link.status = 'active'
      and (new.team_id is null or coalesce(link.team_id, player.team_id) = new.team_id)
    order by (link.id = installation.parent_link_id) desc, link.id
    limit 1
  ) recipient_link on true
  where installation.status = 'active'
    and installation.enabled
    and installation.detail_level in ('minimal', 'detailed')
    and installation.expo_push_token is not null
  on conflict (poll_id, installation_id) do nothing;

  return new;
end;
$$;

create or replace function public.claim_parent_poll_mobile_notification_intents(
  batch_size_value integer default 50
)
returns table (
  intent_id bigint,
  recipient_app text,
  installation_id uuid,
  auth_user_id uuid,
  parent_link_id uuid,
  club_id uuid,
  team_id uuid,
  poll_id uuid,
  expo_push_token text,
  detail_level text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.parent_poll_mobile_notification_intents%rowtype;
  claimed_count integer := 0;
begin
  update public.parent_poll_mobile_notification_intents intent
  set status = 'failed',
      available_at = timezone('utc', now()),
      locked_at = null,
      safe_error_code = 'claim_timeout',
      updated_at = timezone('utc', now())
  where intent.status = 'processing'
    and intent.locked_at < timezone('utc', now()) - interval '5 minutes';

  for candidate in
    select intent.*
    from public.parent_poll_mobile_notification_intents intent
    where intent.status in ('pending', 'failed')
      and intent.attempt_count < 5
      and intent.available_at <= timezone('utc', now())
    order by intent.id
    for update skip locked
    limit greatest(least(coalesce(batch_size_value, 50) * 4, 400), 1)
  loop
    if claimed_count >= greatest(least(coalesce(batch_size_value, 50), 100), 1) then
      return;
    end if;

    if not exists (
      select 1
      from public.polls poll
      join public.parent_mobile_push_installations installation
        on installation.installation_id = candidate.installation_id
       and installation.auth_user_id = candidate.auth_user_id
       and installation.status = 'active'
       and installation.enabled
       and installation.detail_level in ('minimal', 'detailed')
       and installation.expo_push_token is not null
      join public.parent_player_links parent_link
        on parent_link.id = candidate.parent_link_id
       and parent_link.auth_user_id = candidate.auth_user_id
       and parent_link.club_id = candidate.club_id
       and parent_link.status = 'active'
      join public.players player
        on player.id = parent_link.player_id
       and player.club_id = candidate.club_id
       and coalesce(player.status, 'active') <> 'archived'
      where poll.id = candidate.poll_id
        and poll.club_id = candidate.club_id
        and poll.audience = 'parents'
        and poll.status = 'open'
        and (poll.closes_at is null or poll.closes_at > timezone('utc', now()))
        and (poll.team_id is null or coalesce(parent_link.team_id, player.team_id) = poll.team_id)
    ) then
      update public.parent_poll_mobile_notification_intents intent
      set status = 'skipped',
          processed_at = timezone('utc', now()),
          safe_error_code = 'authority_stale',
          updated_at = timezone('utc', now())
      where intent.id = candidate.id;
      continue;
    end if;

    update public.parent_poll_mobile_notification_intents intent
    set status = 'processing',
        attempt_count = intent.attempt_count + 1,
        locked_at = timezone('utc', now()),
        safe_error_code = null,
        updated_at = timezone('utc', now())
    where intent.id = candidate.id;

    intent_id := candidate.id;
    recipient_app := 'parent';
    installation_id := candidate.installation_id;
    auth_user_id := candidate.auth_user_id;
    parent_link_id := candidate.parent_link_id;
    club_id := candidate.club_id;
    team_id := candidate.team_id;
    poll_id := candidate.poll_id;

    select installation.expo_push_token, installation.detail_level
    into expo_push_token, detail_level
    from public.parent_mobile_push_installations installation
    where installation.installation_id = candidate.installation_id;

    claimed_count := claimed_count + 1;
    return next;
  end loop;
end;
$$;

alter function app_private.coach_mobile_installation_has_current_context(uuid) owner to postgres;
alter function app_private.enqueue_parent_chat_mobile_notification_intents() owner to postgres;
alter function app_private.enqueue_staff_chat_mobile_notification_intents() owner to postgres;
alter function app_private.parent_chat_mobile_notification_intent_is_current(bigint) owner to postgres;
alter function app_private.staff_chat_mobile_notification_intent_is_current(bigint) owner to postgres;
alter function app_private.enqueue_parent_poll_mobile_notification_intents() owner to postgres;
alter function public.claim_parent_poll_mobile_notification_intents(integer) owner to postgres;

revoke all on function app_private.coach_mobile_installation_has_current_context(uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.enqueue_parent_chat_mobile_notification_intents()
from public, anon, authenticated, service_role;
revoke all on function app_private.enqueue_staff_chat_mobile_notification_intents()
from public, anon, authenticated, service_role;
revoke all on function app_private.parent_chat_mobile_notification_intent_is_current(bigint)
from public, anon, authenticated, service_role;
revoke all on function app_private.staff_chat_mobile_notification_intent_is_current(bigint)
from public, anon, authenticated, service_role;
revoke all on function app_private.enqueue_parent_poll_mobile_notification_intents()
from public, anon, authenticated, service_role;
revoke all on function public.claim_parent_poll_mobile_notification_intents(integer)
from public, anon, authenticated;
grant execute on function public.claim_parent_poll_mobile_notification_intents(integer) to service_role;

comment on function app_private.coach_mobile_installation_has_current_context(uuid) is
  'Checks current account authority for an active Coach installation without coupling delivery to its selected UI context.';
comment on function public.claim_parent_poll_mobile_notification_intents(integer) is
  'Claims Parent Poll notifications while the Poll, target Parent link and installation remain authorised, independent of selected UI context.';
