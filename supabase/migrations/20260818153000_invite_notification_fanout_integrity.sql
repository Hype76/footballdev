-- FP-INVITES-NOTIFICATIONS-69
-- Restore Parent recipient fan-out and make the Parent inbox independent of device count.

create or replace function public.event_player_eligible_recipients(
  club_id_value uuid,
  team_id_value uuid,
  player_ids_value uuid[]
)
returns table (
  player_id uuid,
  player_name text,
  recipient_email text,
  recipient_name text,
  recipient_type text,
  parent_link_id uuid
)
language sql
security definer
set search_path = ''
stable
as $$
  with selected_players as (
    select
      player.id,
      coalesce(nullif(btrim(player.player_name), ''), 'Player') as player_name,
      lower(btrim(coalesce(player.parent_email, ''))) as configured_email,
      lower(btrim(coalesce(player.contact_type, 'parent'))) as contact_type
    from public.player_team_memberships membership
    join public.players player
      on player.id = membership.player_id
      and player.club_id = membership.club_id
    where membership.club_id = club_id_value
      and membership.team_id = team_id_value
      and membership.status = 'active'
      and membership.ended_at is null
      and player.id = any(coalesce(player_ids_value, '{}'::uuid[]))
      and coalesce(player.status, 'active') = 'active'
      and player.archived_at is null
  ),
  active_parent_links as (
    select
      player.id as player_id,
      player.player_name,
      lower(btrim(link.email)) as recipient_email,
      coalesce(
        nullif(btrim(parent_auth.raw_user_meta_data ->> 'display_name'), ''),
        nullif(btrim(parent_auth.raw_user_meta_data ->> 'name'), ''),
        'Parent or guardian'
      ) as recipient_name,
      public.canonical_calendar_invite_recipient_type('parent') as recipient_type,
      link.id as parent_link_id,
      1 as priority
    from selected_players player
    join public.parent_player_links link
      on link.club_id = club_id_value
      and link.team_id = team_id_value
      and link.player_id = player.id
      and link.status = 'active'
      and link.auth_user_id is not null
    join auth.users parent_auth
      on parent_auth.id = link.auth_user_id
      and parent_auth.deleted_at is null
      and parent_auth.email_confirmed_at is not null
      and (parent_auth.banned_until is null or parent_auth.banned_until <= timezone('utc', now()))
      and lower(btrim(coalesce(parent_auth.email, ''))) = lower(btrim(coalesce(link.email, '')))
    where player.contact_type in ('parent', 'both')
      and btrim(coalesce(link.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  active_adult_players as (
    select
      player.id as player_id,
      player.player_name,
      lower(btrim(adult_auth.email)) as recipient_email,
      coalesce(
        nullif(btrim(adult_auth.raw_user_meta_data ->> 'display_name'), ''),
        nullif(btrim(adult_auth.raw_user_meta_data ->> 'name'), ''),
        player.player_name
      ) as recipient_name,
      public.canonical_calendar_invite_recipient_type('adult_player') as recipient_type,
      null::uuid as parent_link_id,
      2 as priority
    from selected_players player
    join public.adult_player_account_links adult_link
      on adult_link.club_id = club_id_value
      and adult_link.team_id = team_id_value
      and adult_link.player_id = player.id
      and adult_link.status = 'active'
      and adult_link.verified_at is not null
      and adult_link.revoked_at is null
    join auth.users adult_auth
      on adult_auth.id = adult_link.user_id
      and adult_auth.deleted_at is null
      and adult_auth.email_confirmed_at is not null
      and (adult_auth.banned_until is null or adult_auth.banned_until <= timezone('utc', now()))
    where player.contact_type in ('self', 'both')
      and lower(btrim(coalesce(adult_auth.email, ''))) = player.configured_email
      and btrim(coalesce(adult_auth.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  candidates as (
    select * from active_parent_links
    union all
    select * from active_adult_players
  )
  select distinct on (candidate.player_id, candidate.recipient_email)
    candidate.player_id,
    candidate.player_name,
    candidate.recipient_email,
    candidate.recipient_name,
    candidate.recipient_type,
    candidate.parent_link_id
  from candidates candidate
  where candidate.recipient_email <> ''
    and candidate.recipient_type is not null
  order by candidate.player_id, candidate.recipient_email, candidate.priority, candidate.parent_link_id nulls last;
$$;

revoke all on function public.event_player_eligible_recipients(uuid, uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.event_player_eligible_recipients(uuid, uuid, uuid[])
to service_role;

comment on function public.event_player_eligible_recipients(uuid, uuid, uuid[]) is
  'Resolves authorised Parent, guardian, and Adult Player recipients from active Team membership and active authentication authority without requiring a Coach profile.';

alter table public.parent_mobile_notification_events
  add column if not exists dedupe_key text;

alter table public.parent_mobile_notification_events
  drop constraint if exists parent_mobile_notification_events_intent_check;
alter table public.parent_mobile_notification_events
  add constraint parent_mobile_notification_events_intent_check
  check (intent_type in (
    'parent_message',
    'parent_poll',
    'matchday_update',
    'training_update',
    'parent_chat',
    'resource_shared',
    'poll_results'
  ));

create unique index if not exists parent_mobile_notification_events_dedupe_key
on public.parent_mobile_notification_events (dedupe_key);

revoke all on public.parent_mobile_notification_events from public, anon, authenticated;
grant select, insert, update, delete on public.parent_mobile_notification_events to service_role;

create or replace function app_private.enqueue_parent_chat_notification_inbox()
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

  insert into public.parent_mobile_notification_events (
    installation_id,
    auth_user_id,
    parent_link_id,
    club_id,
    team_id,
    intent_type,
    title,
    body,
    data,
    status,
    sent_at,
    dedupe_key
  )
  select
    null,
    link.auth_user_id,
    link.id,
    target_room.club_id,
    target_room.team_id,
    'parent_chat',
    case target_room.room_type
      when 'team' then 'Team Chat'
      when 'match_squad' then 'Match Squad Chat'
      else 'Chat with Coach'
    end,
    case target_room.room_type
      when 'team' then 'A new message is waiting in Team Chat.'
      when 'match_squad' then 'A new message is waiting in Match Squad Chat.'
      else 'A new message is waiting in Chat with Coach.'
    end,
    jsonb_build_object(
      'app', 'parent',
      'chatType', target_room.room_type,
      'messageId', new.id,
      'parentLinkId', link.id,
      'roomId', target_room.id,
      'route', 'chat',
      'teamId', target_room.team_id,
      'type', 'parent_chat'
    ),
    'sent',
    timezone('utc', now()),
    'parent_chat:' || link.id::text || ':' || new.id::text
  from public.parent_player_links link
  join auth.users parent_auth
    on parent_auth.id = link.auth_user_id
    and parent_auth.deleted_at is null
    and parent_auth.email_confirmed_at is not null
    and (parent_auth.banned_until is null or parent_auth.banned_until <= timezone('utc', now()))
  left join public.parent_communication_preferences preference
    on preference.auth_user_id = link.auth_user_id
  where link.club_id = target_room.club_id
    and link.status = 'active'
    and link.auth_user_id is not null
    and link.auth_user_id is distinct from new.sender_id
    and coalesce(preference.communication_channel, 'both') in ('app', 'both')
    and app_private.parent_chat_parent_link_can_receive_notification(
      target_room.id,
      link.auth_user_id,
      link.id
    )
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

alter function app_private.enqueue_parent_chat_notification_inbox() owner to postgres;
revoke all on function app_private.enqueue_parent_chat_notification_inbox()
from public, anon, authenticated, service_role;

drop trigger if exists enqueue_parent_chat_notification_inbox
on public.parent_chat_messages;
create trigger enqueue_parent_chat_notification_inbox
after insert on public.parent_chat_messages
for each row execute function app_private.enqueue_parent_chat_notification_inbox();

create or replace function app_private.enqueue_parent_poll_notification_inbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.audience <> 'parents' or new.status <> 'open' then
    return new;
  end if;

  insert into public.parent_mobile_notification_events (
    installation_id,
    auth_user_id,
    parent_link_id,
    club_id,
    team_id,
    intent_type,
    title,
    body,
    data,
    status,
    sent_at,
    dedupe_key
  )
  select
    null,
    link.auth_user_id,
    link.id,
    new.club_id,
    new.team_id,
    'parent_poll',
    'Football Player Parents',
    'A new Parent Poll is ready to answer.',
    jsonb_build_object(
      'app', 'parent',
      'parentLinkId', link.id,
      'pollId', new.id,
      'route', 'polls',
      'teamId', new.team_id,
      'type', 'parent_poll'
    ),
    'sent',
    timezone('utc', now()),
    'parent_poll:' || link.id::text || ':' || new.id::text
  from public.parent_player_links link
  join auth.users parent_auth
    on parent_auth.id = link.auth_user_id
    and parent_auth.deleted_at is null
    and parent_auth.email_confirmed_at is not null
    and (parent_auth.banned_until is null or parent_auth.banned_until <= timezone('utc', now()))
  left join public.parent_communication_preferences preference
    on preference.auth_user_id = link.auth_user_id
  where link.club_id = new.club_id
    and link.status = 'active'
    and link.auth_user_id is not null
    and (new.team_id is null or link.team_id = new.team_id)
    and coalesce(preference.communication_channel, 'both') in ('app', 'both')
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

alter function app_private.enqueue_parent_poll_notification_inbox() owner to postgres;
revoke all on function app_private.enqueue_parent_poll_notification_inbox()
from public, anon, authenticated, service_role;

drop trigger if exists enqueue_parent_poll_notification_inbox on public.polls;
create trigger enqueue_parent_poll_notification_inbox
after insert on public.polls
for each row execute function app_private.enqueue_parent_poll_notification_inbox();
