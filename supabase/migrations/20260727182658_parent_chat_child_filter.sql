-- Deployment: apply this migration before releasing the matching web candidate.
-- Existing Parent Chat and staff workspace RPCs remain unchanged.
-- Existing Parent-global Chat view rows are retained for forward repair evidence.
-- Rollback: keep the data and ship a forward repair migration.

alter table public.parent_portal_view_states
drop constraint if exists parent_portal_view_states_scope_identity_check;

alter table public.parent_portal_view_states
add constraint parent_portal_view_states_scope_identity_check check (
  (
    scope_type = 'child'
    and parent_link_id is not null
    and player_id is not null
  )
  or (
    scope_type = 'parent_global'
    and parent_link_id is null
    and player_id is null
    and category_key = 'chat'
  )
);

insert into public.parent_portal_view_states (
  auth_user_id,
  parent_link_id,
  player_id,
  scope_type,
  category_key,
  last_viewed_at,
  created_at,
  updated_at
)
select
  parent_link.auth_user_id,
  parent_link.id,
  parent_link.player_id,
  'child',
  'chat',
  coalesce(global_state.last_viewed_at, statement_timestamp()),
  statement_timestamp(),
  statement_timestamp()
from public.parent_player_links parent_link
join public.players player
  on player.id = parent_link.player_id
 and player.club_id = parent_link.club_id
 and coalesce(player.status, 'active') <> 'archived'
 and player.archived_at is null
left join public.parent_portal_view_states global_state
  on global_state.auth_user_id = parent_link.auth_user_id
 and global_state.scope_type = 'parent_global'
 and global_state.category_key = 'chat'
 and global_state.parent_link_id is null
where parent_link.auth_user_id is not null
  and parent_link.status = 'active'
on conflict (auth_user_id, parent_link_id, category_key)
  where scope_type = 'child'
do nothing;

create or replace function public.parent_chat_room_matches_parent_link(
  target_room_id uuid,
  target_parent_link_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null
    and exists (
      select 1
      from public.parent_player_links parent_link
      join public.players player
        on player.id = parent_link.player_id
       and player.club_id = parent_link.club_id
       and coalesce(player.status, 'active') <> 'archived'
       and player.archived_at is null
      join public.parent_chat_rooms room
        on room.id = target_room_id
       and room.club_id = parent_link.club_id
       and room.team_id = coalesce(parent_link.team_id, player.team_id)
       and room.status in ('active', 'closed')
      where parent_link.id = target_parent_link_id
        and parent_link.auth_user_id = target_user_id
        and parent_link.status = 'active'
        and (
          (
            room.room_type = 'parent_staff'
            and room.player_id = parent_link.player_id
          )
          or room.room_type = 'team'
          or (
            room.room_type = 'match_squad'
            and exists (
              select 1
              from public.match_day_player_squad_decisions decision
              where decision.match_day_id = room.match_day_id
                and decision.club_id = room.club_id
                and decision.team_id = room.team_id
                and decision.player_id = parent_link.player_id
                and decision.status = 'selected'
            )
          )
        )
    );
$$;

revoke all on function public.parent_chat_room_matches_parent_link(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.parent_chat_room_matches_parent_link(uuid, uuid, uuid)
to service_role;

create or replace function public.get_parent_portal_chat_context(
  parent_link_id_value uuid
)
returns table (
  parent_link_id uuid,
  player_id uuid,
  child_filter_available boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  target_link public.parent_player_links%rowtype;
  resolved_team_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Parent authentication is required.';
  end if;

  select parent_link.*
  into target_link
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = parent_link.club_id
   and coalesce(player.status, 'active') <> 'archived'
   and player.archived_at is null
  where parent_link.id = parent_link_id_value
    and parent_link.auth_user_id = auth.uid()
    and parent_link.status = 'active'
  limit 1;

  resolved_team_id := coalesce(
    target_link.team_id,
    (
      select player.team_id
      from public.players player
      where player.id = target_link.player_id
    )
  );

  if target_link.id is null or resolved_team_id is null then
    raise exception 'Parent access is not available for this child.';
  end if;

  return query
  select
    target_link.id,
    target_link.player_id,
    public.parent_chat_staff_can_access_team(
      auth.uid(),
      target_link.club_id,
      resolved_team_id
    );
end;
$$;

revoke all on function public.get_parent_portal_chat_context(uuid)
from public, anon;
grant execute on function public.get_parent_portal_chat_context(uuid)
to authenticated, service_role;

create or replace function public.get_parent_portal_chat_rooms(
  parent_link_id_value uuid,
  child_only_value boolean default false
)
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
set search_path = ''
as $$
#variable_conflict use_column
declare
  target_link public.parent_player_links%rowtype;
  selected_child_name text;
begin
  if auth.uid() is null then
    raise exception 'Parent authentication is required.';
  end if;

  select parent_link.*
  into target_link
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = parent_link.club_id
   and coalesce(player.status, 'active') <> 'archived'
   and player.archived_at is null
  where parent_link.id = parent_link_id_value
    and parent_link.auth_user_id = auth.uid()
    and parent_link.status = 'active'
  limit 1;

  select player.player_name
  into selected_child_name
  from public.players player
  where player.id = target_link.player_id;

  if target_link.id is null then
    raise exception 'Parent access is not available for this child.';
  end if;

  return query
  select
    room.id,
    room.room_type,
    room.status,
    room.title,
    room.club_id,
    room.club_name,
    room.team_id,
    room.team_name,
    room.player_id,
    room.player_name,
    room.match_day_id,
    room.opponent,
    room.match_date,
    room.kickoff_time,
    room.kickoff_time_tbc,
    room.meet_time,
    room.venue_name,
    room.fixture_status,
    case
      when child_only_value then array[selected_child_name]::text[]
      else room.child_names
    end,
    room.latest_message,
    room.latest_message_at,
    room.unread_count,
    room.can_post
  from public.get_parent_chat_rooms() room
  where not child_only_value
     or public.parent_chat_room_matches_parent_link(
       room.id,
       target_link.id,
       auth.uid()
     )
  order by room.latest_message_at desc nulls last, room.id;
end;
$$;

revoke all on function public.get_parent_portal_chat_rooms(uuid, boolean)
from public, anon;
grant execute on function public.get_parent_portal_chat_rooms(uuid, boolean)
to authenticated, service_role;

create or replace function public.get_parent_portal_chat_messages(
  parent_link_id_value uuid,
  target_room_id uuid,
  child_only_value boolean default false
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

  return query
  select *
  from public.get_parent_chat_messages(target_room_id);
end;
$$;

revoke all on function public.get_parent_portal_chat_messages(uuid, uuid, boolean)
from public, anon;
grant execute on function public.get_parent_portal_chat_messages(uuid, uuid, boolean)
to authenticated, service_role;

create or replace function public.send_parent_portal_chat_message(
  parent_link_id_value uuid,
  target_room_id uuid,
  body_value text,
  child_only_value boolean default false
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

  return public.send_parent_chat_message(target_room_id, body_value);
end;
$$;

revoke all on function public.send_parent_portal_chat_message(uuid, uuid, text, boolean)
from public, anon;
grant execute on function public.send_parent_portal_chat_message(uuid, uuid, text, boolean)
to authenticated, service_role;

create or replace function public.mark_parent_portal_chat_room_read(
  parent_link_id_value uuid,
  target_room_id uuid,
  child_only_value boolean default false
)
returns timestamptz
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

  return public.mark_parent_chat_room_read(target_room_id);
end;
$$;

revoke all on function public.mark_parent_portal_chat_room_read(uuid, uuid, boolean)
from public, anon;
grant execute on function public.mark_parent_portal_chat_room_read(uuid, uuid, boolean)
to authenticated, service_role;

create or replace function public.delete_parent_portal_chat_message(
  parent_link_id_value uuid,
  target_message_id uuid,
  child_only_value boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room_id uuid;
begin
  perform 1
  from public.get_parent_portal_chat_context(parent_link_id_value)
  limit 1;

  select message.room_id
  into target_room_id
  from public.parent_chat_messages message
  where message.id = target_message_id;

  if target_room_id is null then
    raise exception 'This Chat message is not available.';
  end if;

  if child_only_value
    and not public.parent_chat_room_matches_parent_link(
      target_room_id,
      parent_link_id_value,
      auth.uid()
    ) then
    raise exception 'This Chat message is not available for the selected child.';
  end if;

  perform public.delete_parent_chat_message(target_message_id);
end;
$$;

revoke all on function public.delete_parent_portal_chat_message(uuid, uuid, boolean)
from public, anon;
grant execute on function public.delete_parent_portal_chat_message(uuid, uuid, boolean)
to authenticated, service_role;

create or replace function public.parent_portal_latest_chat_activity(
  parent_link_id_value uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest_activity_at timestamptz;
begin
  perform 1
  from public.get_parent_portal_chat_context(parent_link_id_value)
  limit 1;

  perform public.parent_chat_ensure_rooms_for_current_user();

  select max(message.created_at)
  into latest_activity_at
  from public.parent_chat_rooms room
  join public.parent_chat_messages message
    on message.room_id = room.id
   and message.deleted_at is null
   and message.sender_id <> auth.uid()
  where public.parent_chat_room_matches_parent_link(
    room.id,
    parent_link_id_value,
    auth.uid()
  );

  return latest_activity_at;
end;
$$;

revoke all on function public.parent_portal_latest_chat_activity(uuid)
from public, anon, authenticated;
grant execute on function public.parent_portal_latest_chat_activity(uuid)
to service_role;

create or replace function public.get_parent_portal_activity_state(
  parent_link_id_value uuid
)
returns table (
  category_key text,
  scope_type text,
  parent_link_id uuid,
  player_id uuid,
  latest_activity_at timestamptz,
  last_viewed_at timestamptz,
  is_new boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  target_link public.parent_player_links%rowtype;
  baseline_at timestamptz := statement_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Parent authentication is required.';
  end if;

  select parent_link.*
  into target_link
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = parent_link.club_id
   and coalesce(player.status, 'active') <> 'archived'
   and player.archived_at is null
  where parent_link.id = parent_link_id_value
    and parent_link.auth_user_id = auth.uid()
    and parent_link.status = 'active'
  limit 1;

  if target_link.id is null then
    raise exception 'Parent access is not available for this child.';
  end if;

  insert into public.parent_portal_view_states (
    auth_user_id,
    parent_link_id,
    player_id,
    scope_type,
    category_key,
    last_viewed_at,
    created_at,
    updated_at
  )
  select
    auth.uid(),
    target_link.id,
    target_link.player_id,
    'child',
    category.category_key,
    baseline_at,
    baseline_at,
    baseline_at
  from (
    values
      ('calendar'::text),
      ('invites'::text),
      ('matches'::text),
      ('results'::text),
      ('resources'::text),
      ('chat'::text),
      ('polls'::text)
  ) category(category_key)
  on conflict (auth_user_id, parent_link_id, category_key)
    where scope_type = 'child'
  do nothing;

  return query
  with registry(category_key) as (
    values
      ('calendar'::text),
      ('invites'::text),
      ('matches'::text),
      ('results'::text),
      ('resources'::text),
      ('chat'::text),
      ('polls'::text)
  ),
  resolved as (
    select
      registry.category_key,
      case
        when registry.category_key = 'chat'
          then public.parent_portal_latest_chat_activity(target_link.id)
        else public.parent_portal_latest_category_activity(
          target_link.id,
          registry.category_key
        )
      end as latest_activity_at
    from registry
  )
  select
    resolved.category_key,
    'child'::text,
    target_link.id,
    target_link.player_id,
    resolved.latest_activity_at,
    view_state.last_viewed_at,
    resolved.latest_activity_at is not null
      and resolved.latest_activity_at > view_state.last_viewed_at
  from resolved
  join public.parent_portal_view_states view_state
    on view_state.auth_user_id = auth.uid()
   and view_state.category_key = resolved.category_key
   and view_state.scope_type = 'child'
   and view_state.parent_link_id = target_link.id
  order by array_position(
    array['calendar', 'invites', 'matches', 'results', 'resources', 'chat', 'polls']::text[],
    resolved.category_key
  );
end;
$$;

revoke all on function public.get_parent_portal_activity_state(uuid)
from public, anon;
grant execute on function public.get_parent_portal_activity_state(uuid)
to authenticated, service_role;

create or replace function public.mark_parent_portal_category_viewed(
  parent_link_id_value uuid,
  category_key_value text,
  observed_activity_at_value timestamptz
)
returns table (
  category_key text,
  scope_type text,
  parent_link_id uuid,
  player_id uuid,
  latest_activity_at timestamptz,
  last_viewed_at timestamptz,
  is_new boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  target_link public.parent_player_links%rowtype;
  authoritative_latest_activity_at timestamptz;
  bounded_viewed_at timestamptz;
  saved_view_state public.parent_portal_view_states%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Parent authentication is required.';
  end if;

  if category_key_value not in (
    'calendar',
    'invites',
    'matches',
    'results',
    'resources',
    'chat',
    'polls'
  ) then
    raise exception 'Parent Portal activity category is not supported.';
  end if;

  select parent_link.*
  into target_link
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = parent_link.club_id
   and coalesce(player.status, 'active') <> 'archived'
   and player.archived_at is null
  where parent_link.id = parent_link_id_value
    and parent_link.auth_user_id = auth.uid()
    and parent_link.status = 'active'
  limit 1;

  if target_link.id is null then
    raise exception 'Parent access is not available for this child.';
  end if;

  perform 1
  from public.get_parent_portal_activity_state(target_link.id)
  limit 1;

  authoritative_latest_activity_at := case
    when category_key_value = 'chat'
      then public.parent_portal_latest_chat_activity(target_link.id)
    else public.parent_portal_latest_category_activity(
      target_link.id,
      category_key_value
    )
  end;

  if authoritative_latest_activity_at is null then
    raise exception 'There is no current activity to mark as viewed.';
  end if;

  if observed_activity_at_value is null then
    raise exception 'A successfully loaded activity cursor is required.';
  end if;

  bounded_viewed_at := least(
    observed_activity_at_value,
    authoritative_latest_activity_at
  );

  update public.parent_portal_view_states view_state
  set
    last_viewed_at = greatest(view_state.last_viewed_at, bounded_viewed_at),
    updated_at = statement_timestamp()
  where view_state.auth_user_id = auth.uid()
    and view_state.scope_type = 'child'
    and view_state.category_key = category_key_value
    and view_state.parent_link_id = target_link.id
  returning view_state.*
  into saved_view_state;

  if saved_view_state.id is null then
    raise exception 'Parent Portal viewed state could not be saved.';
  end if;

  return query
  select
    category_key_value,
    'child'::text,
    saved_view_state.parent_link_id,
    saved_view_state.player_id,
    authoritative_latest_activity_at,
    saved_view_state.last_viewed_at,
    authoritative_latest_activity_at > saved_view_state.last_viewed_at;
end;
$$;

revoke all on function public.mark_parent_portal_category_viewed(uuid, text, timestamptz)
from public, anon;
grant execute on function public.mark_parent_portal_category_viewed(uuid, text, timestamptz)
to authenticated, service_role;

create or replace function public.mark_parent_portal_chat_viewed(
  parent_link_id_value uuid,
  target_room_id uuid,
  observed_activity_at_value timestamptz
)
returns table (
  category_key text,
  scope_type text,
  parent_link_id uuid,
  player_id uuid,
  latest_activity_at timestamptz,
  last_viewed_at timestamptz,
  is_new boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.parent_chat_room_matches_parent_link(
    target_room_id,
    parent_link_id_value,
    auth.uid()
  ) then
    raise exception 'This Chat room is not available for the selected child.';
  end if;

  return query
  select *
  from public.mark_parent_portal_category_viewed(
    parent_link_id_value,
    'chat',
    observed_activity_at_value
  );
end;
$$;

revoke all on function public.mark_parent_portal_chat_viewed(uuid, uuid, timestamptz)
from public, anon;
grant execute on function public.mark_parent_portal_chat_viewed(uuid, uuid, timestamptz)
to authenticated, service_role;

comment on function public.get_parent_portal_chat_context(uuid) is
  'Confirms the selected active Parent link and whether the same authenticated user also has active staff authority for that child team.';

comment on function public.get_parent_portal_chat_rooms(uuid, boolean) is
  'Returns the existing authorised Parent Chat union or a server-filtered selected-child view for an explicit Parent Portal context.';

comment on function public.parent_chat_room_matches_parent_link(uuid, uuid, uuid) is
  'Defines selected-child relevance for direct child, team and selected match Parent Chat rooms without using email identity.';

comment on table public.parent_portal_view_states is
  'Server-synchronised Parent Portal category view state. All active categories, including Chat, are isolated by active Parent link. Retained Parent-global Chat rows are legacy evidence only.';
