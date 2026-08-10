-- FP-MOBILE-COMMS-POLLS-PRIVACY-CORRECTIVE-36 Chat notification intents.
-- Parent Chat and Staff Chat retain separate authority and outbox models.
-- Message bodies are never copied into either intent table.

alter table public.parent_mobile_notification_events
  drop constraint if exists parent_mobile_notification_events_intent_check;
alter table public.parent_mobile_notification_events
  add constraint parent_mobile_notification_events_intent_check
  check (intent_type in ('parent_message', 'parent_poll', 'matchday_update', 'parent_chat'));

alter table public.coach_mobile_notification_events
  drop constraint if exists coach_mobile_notification_events_intent_check;
alter table public.coach_mobile_notification_events
  add constraint coach_mobile_notification_events_intent_check
  check (intent_type in ('coach_update', 'scorer_volunteer', 'parent_chat', 'staff_chat'));

create table public.parent_chat_mobile_notification_intents (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.parent_chat_messages (id) on delete cascade,
  room_id uuid not null references public.parent_chat_rooms (id) on delete cascade,
  recipient_app text not null check (recipient_app in ('parent', 'coach')),
  installation_id uuid not null,
  auth_user_id uuid not null,
  parent_link_id uuid references public.parent_player_links (id) on delete cascade,
  user_profile_id uuid references public.users (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  room_type text not null check (room_type in ('parent_staff', 'team', 'match_squad')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default timezone('utc', now()),
  locked_at timestamptz,
  processed_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint parent_chat_mobile_notification_intents_recipient_shape_check check (
    (recipient_app = 'parent' and parent_link_id is not null and user_profile_id is null)
    or (recipient_app = 'coach' and parent_link_id is null and user_profile_id is not null)
  ),
  constraint parent_chat_mobile_notification_intents_message_installation_key
    unique (message_id, recipient_app, installation_id)
);

create index parent_chat_mobile_notification_intents_due_idx
on public.parent_chat_mobile_notification_intents (status, available_at, id)
where status in ('pending', 'failed');

create table public.staff_chat_mobile_notification_intents (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.staff_chat_messages (id) on delete cascade,
  conversation_id uuid not null references public.staff_chat_conversations (id) on delete cascade,
  installation_id uuid not null,
  auth_user_id uuid not null,
  user_profile_id uuid not null references public.users (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  conversation_type text not null
    check (conversation_type in ('club_staff', 'team_staff', 'group', 'direct', 'player_staff')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default timezone('utc', now()),
  locked_at timestamptz,
  processed_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint staff_chat_mobile_notification_intents_message_installation_key
    unique (message_id, installation_id)
);

create index staff_chat_mobile_notification_intents_due_idx
on public.staff_chat_mobile_notification_intents (status, available_at, id)
where status in ('pending', 'failed');

alter table public.parent_chat_mobile_notification_intents enable row level security;
alter table public.parent_chat_mobile_notification_intents force row level security;
alter table public.staff_chat_mobile_notification_intents enable row level security;
alter table public.staff_chat_mobile_notification_intents force row level security;

revoke all on public.parent_chat_mobile_notification_intents from public, anon, authenticated;
revoke all on public.staff_chat_mobile_notification_intents from public, anon, authenticated;
revoke all on sequence public.parent_chat_mobile_notification_intents_id_seq from public, anon, authenticated;
revoke all on sequence public.staff_chat_mobile_notification_intents_id_seq from public, anon, authenticated;

grant select, insert, update, delete on public.parent_chat_mobile_notification_intents to service_role;
grant select, insert, update, delete on public.staff_chat_mobile_notification_intents to service_role;
grant usage, select on sequence public.parent_chat_mobile_notification_intents_id_seq to service_role;
grant usage, select on sequence public.staff_chat_mobile_notification_intents_id_seq to service_role;

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
    and exists (
      select 1
      from public.parent_chat_rooms room
      join public.clubs club
        on club.id = room.club_id
       and club.archived_at is null
       and coalesce(club.status, 'active') = 'active'
      join public.teams team
        on team.id = room.team_id
       and team.club_id = room.club_id
       and team.archived_at is null
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
       and profile.club_id = installation.club_id
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
        and (
          (
            installation.team_id is not null
            and installation.context_id = 'team:' || installation.team_id::text
            and public.parent_chat_staff_can_access_team(
              profile.id,
              installation.club_id,
              installation.team_id
            )
          )
          or (
            installation.team_id is null
            and installation.context_id = 'club:' || installation.club_id::text
            and profile.role = 'admin'
          )
        )
    );
$$;

create or replace function app_private.staff_chat_recipient_can_receive_notification(
  target_conversation_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_conversation_id is not null
    and target_user_id is not null
    and exists (
      select 1
      from public.staff_chat_conversations conversation
      join public.staff_chat_members conversation_member
        on conversation_member.conversation_id = conversation.id
       and conversation_member.club_id = conversation.club_id
       and conversation_member.user_id = target_user_id
       and conversation_member.archived_at is null
      join public.users profile
        on profile.id = target_user_id
       and profile.club_id = conversation.club_id
       and coalesce(profile.status, 'active') = 'active'
       and profile.role not in ('parent_portal', 'super_admin', 'adult_player', 'player')
      join public.user_club_memberships membership
        on membership.auth_user_id = profile.id
       and membership.club_id = profile.club_id
       and membership.role = profile.role
       and membership.role_rank = profile.role_rank
      join public.clubs club
        on club.id = profile.club_id
       and club.archived_at is null
       and coalesce(club.status, 'active') = 'active'
      where conversation.id = target_conversation_id
        and (
          (
            conversation.type in ('team_staff', 'player_staff')
            and public.parent_chat_staff_can_access_team(
              profile.id,
              conversation.club_id,
              conversation.team_id
            )
          )
          or (
            conversation.type = 'club_staff'
            and public.is_staff_chat_club_wide_staff(profile.id, conversation.club_id)
          )
          or conversation.type in ('group', 'direct')
        )
    );
$$;

alter function app_private.parent_chat_parent_link_can_receive_notification(uuid, uuid, uuid) owner to postgres;
alter function app_private.coach_mobile_installation_has_current_context(uuid) owner to postgres;
alter function app_private.staff_chat_recipient_can_receive_notification(uuid, uuid) owner to postgres;
revoke all on function app_private.parent_chat_parent_link_can_receive_notification(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.coach_mobile_installation_has_current_context(uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.staff_chat_recipient_can_receive_notification(uuid, uuid)
from public, anon, authenticated, service_role;

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
    installation.parent_link_id,
    target_room.club_id,
    target_room.team_id,
    target_room.room_type
  from public.parent_mobile_push_installations installation
  where installation.club_id = target_room.club_id
    and installation.status = 'active'
    and installation.enabled
    and installation.expo_push_token is not null
    and installation.auth_user_id is distinct from new.sender_id
    and app_private.parent_chat_parent_link_can_receive_notification(
      target_room.id,
      installation.auth_user_id,
      installation.parent_link_id
    )
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
  where installation.club_id = target_room.club_id
    and installation.team_id = target_room.team_id
    and installation.context_id = 'team:' || target_room.team_id::text
    and installation.auth_user_id is distinct from new.sender_id
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
  where installation.club_id = target_conversation.club_id
    and installation.auth_user_id is distinct from new.sender_id
    and installation.user_profile_id is distinct from new.sender_id
    and app_private.coach_mobile_installation_has_current_context(installation.installation_id)
    and app_private.staff_chat_recipient_can_receive_notification(
      target_conversation.id,
      installation.user_profile_id
    )
    and (
      (
        target_conversation.type in ('team_staff', 'player_staff')
        and installation.team_id = target_conversation.team_id
        and installation.context_id = 'team:' || target_conversation.team_id::text
      )
      or (
        target_conversation.type = 'club_staff'
        and installation.team_id is null
        and installation.context_id = 'club:' || target_conversation.club_id::text
      )
      or target_conversation.type in ('group', 'direct')
    )
  on conflict (message_id, installation_id) do nothing;

  return new;
end;
$$;

alter function app_private.enqueue_parent_chat_mobile_notification_intents() owner to postgres;
alter function app_private.enqueue_staff_chat_mobile_notification_intents() owner to postgres;
revoke all on function app_private.enqueue_parent_chat_mobile_notification_intents()
from public, anon, authenticated, service_role;
revoke all on function app_private.enqueue_staff_chat_mobile_notification_intents()
from public, anon, authenticated, service_role;

drop trigger if exists enqueue_parent_chat_mobile_notification_intents
on public.parent_chat_messages;
create trigger enqueue_parent_chat_mobile_notification_intents
after insert on public.parent_chat_messages
for each row execute function app_private.enqueue_parent_chat_mobile_notification_intents();

drop trigger if exists enqueue_staff_chat_mobile_notification_intents
on public.staff_chat_messages;
create trigger enqueue_staff_chat_mobile_notification_intents
after insert on public.staff_chat_messages
for each row execute function app_private.enqueue_staff_chat_mobile_notification_intents();

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
              and installation.parent_link_id = intent.parent_link_id
              and installation.club_id = intent.club_id
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
              and installation.club_id = intent.club_id
              and installation.team_id = intent.team_id
              and installation.context_id = 'team:' || intent.team_id::text
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
     and installation.club_id = intent.club_id
    where intent.id = target_intent_id
      and app_private.coach_mobile_installation_has_current_context(installation.installation_id)
      and app_private.staff_chat_recipient_can_receive_notification(
        intent.conversation_id,
        intent.user_profile_id
      )
      and (
        (
          intent.conversation_type in ('team_staff', 'player_staff')
          and installation.team_id = intent.team_id
          and installation.context_id = 'team:' || intent.team_id::text
        )
        or (
          intent.conversation_type = 'club_staff'
          and installation.team_id is null
          and installation.context_id = 'club:' || intent.club_id::text
        )
        or intent.conversation_type in ('group', 'direct')
      )
  );
$$;

alter function app_private.parent_chat_mobile_notification_intent_is_current(bigint) owner to postgres;
alter function app_private.staff_chat_mobile_notification_intent_is_current(bigint) owner to postgres;
revoke all on function app_private.parent_chat_mobile_notification_intent_is_current(bigint)
from public, anon, authenticated, service_role;
revoke all on function app_private.staff_chat_mobile_notification_intent_is_current(bigint)
from public, anon, authenticated, service_role;

create or replace function public.claim_parent_chat_mobile_notification_intents(
  batch_size_value integer default 50
)
returns table (
  intent_id bigint,
  recipient_app text,
  installation_id uuid,
  auth_user_id uuid,
  parent_link_id uuid,
  user_profile_id uuid,
  club_id uuid,
  team_id uuid,
  context_id text,
  message_id uuid,
  room_id uuid,
  room_type text,
  expo_push_token text,
  detail_level text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.parent_chat_mobile_notification_intents%rowtype;
  claimed_count integer := 0;
begin
  update public.parent_chat_mobile_notification_intents intent
  set status = 'failed',
      available_at = timezone('utc', now()),
      locked_at = null,
      safe_error_code = 'claim_timeout',
      updated_at = timezone('utc', now())
  where intent.status = 'processing'
    and intent.locked_at < timezone('utc', now()) - interval '5 minutes';

  for candidate in
    select intent.*
    from public.parent_chat_mobile_notification_intents intent
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

    if not app_private.parent_chat_mobile_notification_intent_is_current(candidate.id) then
      update public.parent_chat_mobile_notification_intents intent
      set status = 'skipped',
          processed_at = timezone('utc', now()),
          safe_error_code = 'authority_stale',
          updated_at = timezone('utc', now())
      where intent.id = candidate.id;
      continue;
    end if;

    update public.parent_chat_mobile_notification_intents intent
    set status = 'processing',
        attempt_count = intent.attempt_count + 1,
        locked_at = timezone('utc', now()),
        safe_error_code = null,
        updated_at = timezone('utc', now())
    where intent.id = candidate.id;

    intent_id := candidate.id;
    recipient_app := candidate.recipient_app;
    installation_id := candidate.installation_id;
    auth_user_id := candidate.auth_user_id;
    parent_link_id := candidate.parent_link_id;
    user_profile_id := candidate.user_profile_id;
    club_id := candidate.club_id;
    team_id := candidate.team_id;
    message_id := candidate.message_id;
    room_id := candidate.room_id;
    room_type := candidate.room_type;

    if candidate.recipient_app = 'parent' then
      context_id := '';
      select installation.expo_push_token, installation.detail_level
      into expo_push_token, detail_level
      from public.parent_mobile_push_installations installation
      where installation.installation_id = candidate.installation_id;
    else
      select installation.expo_push_token, installation.detail_level, installation.context_id
      into expo_push_token, detail_level, context_id
      from public.coach_mobile_push_installations installation
      where installation.installation_id = candidate.installation_id;
    end if;

    claimed_count := claimed_count + 1;
    return next;
  end loop;
end;
$$;

create or replace function public.claim_staff_chat_mobile_notification_intents(
  batch_size_value integer default 50
)
returns table (
  intent_id bigint,
  installation_id uuid,
  auth_user_id uuid,
  user_profile_id uuid,
  club_id uuid,
  team_id uuid,
  context_id text,
  message_id uuid,
  conversation_id uuid,
  conversation_type text,
  expo_push_token text,
  detail_level text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.staff_chat_mobile_notification_intents%rowtype;
  claimed_count integer := 0;
begin
  update public.staff_chat_mobile_notification_intents intent
  set status = 'failed',
      available_at = timezone('utc', now()),
      locked_at = null,
      safe_error_code = 'claim_timeout',
      updated_at = timezone('utc', now())
  where intent.status = 'processing'
    and intent.locked_at < timezone('utc', now()) - interval '5 minutes';

  for candidate in
    select intent.*
    from public.staff_chat_mobile_notification_intents intent
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

    if not app_private.staff_chat_mobile_notification_intent_is_current(candidate.id) then
      update public.staff_chat_mobile_notification_intents intent
      set status = 'skipped',
          processed_at = timezone('utc', now()),
          safe_error_code = 'authority_stale',
          updated_at = timezone('utc', now())
      where intent.id = candidate.id;
      continue;
    end if;

    update public.staff_chat_mobile_notification_intents intent
    set status = 'processing',
        attempt_count = intent.attempt_count + 1,
        locked_at = timezone('utc', now()),
        safe_error_code = null,
        updated_at = timezone('utc', now())
    where intent.id = candidate.id;

    intent_id := candidate.id;
    installation_id := candidate.installation_id;
    auth_user_id := candidate.auth_user_id;
    user_profile_id := candidate.user_profile_id;
    club_id := candidate.club_id;
    team_id := candidate.team_id;
    message_id := candidate.message_id;
    conversation_id := candidate.conversation_id;
    conversation_type := candidate.conversation_type;

    select installation.expo_push_token, installation.detail_level, installation.context_id
    into expo_push_token, detail_level, context_id
    from public.coach_mobile_push_installations installation
    where installation.installation_id = candidate.installation_id;

    claimed_count := claimed_count + 1;
    return next;
  end loop;
end;
$$;

alter function public.claim_parent_chat_mobile_notification_intents(integer) owner to postgres;
alter function public.claim_staff_chat_mobile_notification_intents(integer) owner to postgres;
revoke all on function public.claim_parent_chat_mobile_notification_intents(integer)
from public, anon, authenticated;
revoke all on function public.claim_staff_chat_mobile_notification_intents(integer)
from public, anon, authenticated;
grant execute on function public.claim_parent_chat_mobile_notification_intents(integer) to service_role;
grant execute on function public.claim_staff_chat_mobile_notification_intents(integer) to service_role;

comment on table public.parent_chat_mobile_notification_intents is
  'Recipient and installation scoped Parent Chat notification outbox. No message body is stored.';
comment on table public.staff_chat_mobile_notification_intents is
  'Recipient and installation scoped Staff Chat notification outbox. No message body is stored.';
comment on function public.claim_parent_chat_mobile_notification_intents(integer) is
  'Claims only currently authorised Parent Chat recipients after revalidating room, Parent link or active Team, installation, sender exclusion, and preference.';
comment on function public.claim_staff_chat_mobile_notification_intents(integer) is
  'Claims only currently authorised Staff Chat recipients after revalidating membership, active Team context, installation, sender exclusion, and preference.';
