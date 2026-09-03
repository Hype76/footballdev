-- Reuse the existing authority checks once per Team, rather than once per
-- availability row. No mutation policies or business records are changed.
create schema if not exists private;

create or replace function private.mobile_authorized_team_scope()
returns table (club_id uuid, team_id uuid)
language sql stable security definer set search_path = ''
as $$
  select team.club_id, team.id
  from public.teams team
  where (select auth.uid()) is not null
    and ((select public.current_user_role()) = 'super_admin'
      or team.club_id = (select public.current_user_club_id()))
    and public.current_user_can_access_team(team.club_id, team.id);
$$;
revoke all on function private.mobile_authorized_team_scope() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.mobile_authorized_team_scope() to authenticated;

drop policy if exists match_day_availability_staff_select_exact_team on public.match_day_availability_requests;
create policy match_day_availability_staff_select_exact_team on public.match_day_availability_requests
for select to authenticated
using (
  (select public.current_user_role()) = 'super_admin'
  or (club_id, team_id) in (select scope.club_id, scope.team_id from private.mobile_authorized_team_scope() scope)
);

drop policy if exists training_availability_request_players_select_staff on public.training_availability_request_players;
create policy training_availability_request_players_select_staff on public.training_availability_request_players
for select to authenticated
using (
  (select public.current_user_role()) = 'super_admin'
  or (club_id, team_id) in (select scope.club_id, scope.team_id from private.mobile_authorized_team_scope() scope)
);

drop policy if exists training_availability_requests_select_staff on public.training_availability_requests;
create policy training_availability_requests_select_staff on public.training_availability_requests
for select to authenticated
using (
  (select public.current_user_role()) = 'super_admin'
  or (club_id, team_id) in (select scope.club_id, scope.team_id from private.mobile_authorized_team_scope() scope)
);

drop policy if exists training_availability_responses_select_staff on public.training_availability_responses;
create policy training_availability_responses_select_staff on public.training_availability_responses
for select to authenticated
using (
  (select public.current_user_role()) = 'super_admin'
  or (club_id, team_id) in (select scope.club_id, scope.team_id from private.mobile_authorized_team_scope() scope)
);

create index if not exists mobile_match_requests_team_created_idx
  on public.match_day_availability_requests (club_id, team_id, created_at desc);
create index if not exists mobile_training_players_team_created_idx
  on public.training_availability_request_players (club_id, team_id, created_at desc);
create index if not exists mobile_training_players_calendar_idx
  on public.training_availability_request_players (club_id, calendar_event_id);
create index if not exists mobile_training_responses_team_responded_idx
  on public.training_availability_responses (club_id, team_id, responded_at desc);

-- Candidate scopes are only a prefilter. The canonical room predicate still
-- decides access, including archived children and match squad selection.
create or replace function private.mobile_accessible_parent_chat_rooms(active_team_id_value uuid default null)
returns setof public.parent_chat_rooms
language sql stable security definer set search_path = ''
as $$
  with scopes as materialized (
    select team.club_id, team.id as team_id
    from public.teams team
    where (active_team_id_value is null or team.id = active_team_id_value)
      and team.club_id = (select public.current_user_club_id())
      and public.parent_chat_staff_can_access_team((select auth.uid()), team.club_id, team.id)
    union
    select link.club_id, coalesce(link.team_id, player.team_id)
    from public.parent_player_links link
    join public.players player on player.id = link.player_id
    where link.auth_user_id = (select auth.uid()) and link.status = 'active'
      and (active_team_id_value is null or coalesce(link.team_id, player.team_id) = active_team_id_value)
  ), candidates as materialized (
    select room.* from public.parent_chat_rooms room
    where (room.club_id, room.team_id) in (select club_id, team_id from scopes)
      and room.status in ('active', 'closed')
  )
  select room.* from candidates room
  where public.parent_chat_user_can_access_room(room.id, (select auth.uid()));
$$;
revoke all on function private.mobile_accessible_parent_chat_rooms(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.mobile_parent_chat_room_summaries(active_team_id_value uuid default null)
 RETURNS TABLE(id uuid, room_type text, status text, title text, club_id uuid, club_name text, team_id uuid, team_name text, player_id uuid, player_name text, match_day_id uuid, opponent text, match_date date, kickoff_time time without time zone, kickoff_time_tbc boolean, meet_time time without time zone, venue_name text, fixture_status text, child_names text[], latest_message text, latest_message_at timestamp with time zone, unread_count bigint, can_post boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return query
  select
    room.id,
    room.room_type,
    room.status,
    room.title,
    room.club_id,
    club.name,
    room.team_id,
    team.name,
    room.player_id,
    scoped_player.player_name,
    room.match_day_id,
    fixture.opponent,
    fixture.match_date,
    fixture.kickoff_time,
    coalesce(fixture.kickoff_time_tbc, false),
    fixture.arrival_time,
    fixture.venue_name,
    fixture.status,
    coalesce(context.children, '{}'::text[]),
    coalesce(latest.body, ''),
    latest.created_at,
    coalesce(unread.total, 0),
    public.parent_chat_user_can_post_room(room.id, (select auth.uid()))
  from private.mobile_accessible_parent_chat_rooms(active_team_id_value) room
  join public.clubs club on club.id = room.club_id
  join public.teams team on team.id = room.team_id
  left join public.players scoped_player on scoped_player.id = room.player_id
  left join public.match_days fixture on fixture.id = room.match_day_id
  left join lateral (
    select array_agg(distinct player.player_name order by player.player_name) as children
    from public.players player
    where (
      room.room_type = 'parent_staff'
      and player.id = room.player_id
    )
    or (
      room.room_type = 'team'
      and exists (
        select 1
        from public.parent_player_links link
        where link.player_id = player.id
          and link.auth_user_id = (select auth.uid())
          and link.status = 'active'
          and link.club_id = room.club_id
          and coalesce(link.team_id, player.team_id) = room.team_id
      )
    )
    or (
      room.room_type = 'match_squad'
      and exists (
        select 1
        from public.match_day_player_squad_decisions decision
        where decision.match_day_id = room.match_day_id
          and decision.player_id = player.id
          and decision.status = 'selected'
          and (
            public.parent_chat_staff_can_access_team(
              (select auth.uid()),
              room.club_id,
              room.team_id
            )
            or exists (
              select 1
              from public.parent_player_links link
              where link.player_id = player.id
                and link.auth_user_id = (select auth.uid())
                and link.status = 'active'
            )
          )
      )
    )
  ) context on true
  left join lateral (
    select message.body, message.created_at
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
      and membership.auth_user_id = (select auth.uid())
    where message.room_id = room.id
      and message.sender_id <> (select auth.uid())
      and message.deleted_at is null
      and message.created_at > coalesce(membership.last_read_at, '-infinity'::timestamptz)
  ) unread on true
  order by coalesce(latest.created_at, room.updated_at) desc, room.created_at desc;
end;
$function$
;
revoke all on function private.mobile_parent_chat_room_summaries(uuid) from public, anon, authenticated;

create or replace function public.get_parent_chat_rooms()
 RETURNS TABLE(id uuid, room_type text, status text, title text, club_id uuid, club_name text, team_id uuid, team_name text, player_id uuid, player_name text, match_day_id uuid, opponent text, match_date date, kickoff_time time without time zone, kickoff_time_tbc boolean, meet_time time without time zone, venue_name text, fixture_status text, child_names text[], latest_message text, latest_message_at timestamp with time zone, unread_count bigint, can_post boolean)
language sql stable security definer set search_path = ''
as $$ select * from private.mobile_parent_chat_room_summaries(null); $$;
revoke all on function public.get_parent_chat_rooms() from public, anon;
grant execute on function public.get_parent_chat_rooms() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_parent_chat_rooms(active_team_id_value uuid)
 RETURNS TABLE(id uuid, room_type text, status text, title text, club_id uuid, club_name text, team_id uuid, team_name text, player_id uuid, player_name text, match_day_id uuid, opponent text, match_date date, kickoff_time time without time zone, kickoff_time_tbc boolean, meet_time time without time zone, venue_name text, fixture_status text, child_names text[], latest_message text, latest_message_at timestamp with time zone, unread_count bigint, can_post boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  from private.mobile_parent_chat_room_summaries(active_team_id_value) room;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_parent_portal_chat_notification_preferences(parent_link_id_value uuid, child_only_value boolean DEFAULT false)
 RETURNS TABLE(room_id uuid, notifications_muted boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  actor_id uuid := (select auth.uid());
  target_link public.parent_player_links%rowtype;
  history_cutoff timestamptz;
begin
  if actor_id is null then
    raise exception 'Parent authentication is required.';
  end if;

  select link.*
  into target_link
  from public.parent_player_links link
  join public.players player
    on player.id = link.player_id
   and player.club_id = link.club_id
   and coalesce(player.status, 'active') <> 'archived'
   and player.archived_at is null
  where link.id = parent_link_id_value
    and link.auth_user_id = actor_id
    and link.status = 'active'
  limit 1;

  if target_link.id is null then
    raise exception 'Parent access is not available for this child.';
  end if;

  history_cutoff := date_trunc('day', target_link.created_at);

  return query
  select
    room.id,
    coalesce(membership.notifications_muted, false)
  from private.mobile_accessible_parent_chat_rooms(null) room
  left join public.parent_chat_memberships membership
    on membership.room_id = room.id
   and membership.auth_user_id = actor_id
   and membership.active
  where (
      not child_only_value
      or public.parent_chat_room_matches_parent_link(
        room.id,
        target_link.id,
        actor_id
      )
    )
    and (
      room.room_type = 'parent_staff'
      or exists (
        select 1
        from public.parent_chat_messages message
        where message.room_id = room.id
          and message.deleted_at is null
          and message.created_at >= history_cutoff
      )
    );
end;
$function$
;

create or replace function public.get_parent_portal_chat_rooms_with_preferences(
  parent_link_id_value uuid, child_only_value boolean default false
)
 RETURNS TABLE(id uuid, room_type text, status text, title text, club_id uuid, club_name text, team_id uuid, team_name text, player_id uuid, player_name text, match_day_id uuid, opponent text, match_date date, kickoff_time time without time zone, kickoff_time_tbc boolean, meet_time time without time zone, venue_name text, fixture_status text, child_names text[], latest_message text, latest_message_at timestamp with time zone, unread_count bigint, can_post boolean, notifications_muted boolean)
language sql stable security definer set search_path = ''
as $$
  select room.*, coalesce(membership.notifications_muted, false)
  from public.get_parent_portal_chat_rooms(parent_link_id_value, child_only_value) room
  left join public.parent_chat_memberships membership
    on membership.room_id = room.id
    and membership.auth_user_id = (select auth.uid())
    and membership.active;
$$;
revoke all on function public.get_parent_portal_chat_rooms_with_preferences(uuid, boolean) from public, anon;
grant execute on function public.get_parent_portal_chat_rooms_with_preferences(uuid, boolean) to authenticated, service_role;
