create or replace function private.mobile_accessible_parent_chat_rooms(active_team_id_value uuid, room_status_value text, target_room_id_value uuid)
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
      and (room_status_value is null or room.status = room_status_value)
      and (target_room_id_value is null or room.id = target_room_id_value)
  )
  select room.* from candidates room
  where public.parent_chat_user_can_access_room(room.id, (select auth.uid()));
$$;
revoke all on function private.mobile_accessible_parent_chat_rooms(uuid,text,uuid) from public, anon, authenticated;

create function private.coach_parent_chat_room_summaries(active_team_id_value uuid, room_status_value text, target_room_id_value uuid)
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
  from private.mobile_accessible_parent_chat_rooms(active_team_id_value, room_status_value, target_room_id_value) room
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
      room.room_type in ('team', 'team_training', 'team_match')
      and (room.room_type = case (
        select player_type.chat_group from public.club_player_types player_type
        where player_type.club_id = player.club_id and player_type.name = player.section
      ) when 'training' then 'team_training' when 'match' then 'team_match'
        when 'team' then 'team' else '' end)
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
revoke all on function private.coach_parent_chat_room_summaries(uuid,text,uuid) from public, anon, authenticated;

-- Scope the room list before building summaries. Existing Parent Chat functions keep their current behaviour.
create function public.get_coach_parent_chat_rooms(
  active_team_id_value uuid, room_status_value text, target_room_id_value uuid default null
)
RETURNS TABLE(id uuid, room_type text, status text, title text, club_id uuid, club_name text, team_id uuid, team_name text, player_id uuid, player_name text, match_day_id uuid, opponent text, match_date date, kickoff_time time without time zone, kickoff_time_tbc boolean, meet_time time without time zone, venue_name text, fixture_status text, child_names text[], latest_message text, latest_message_at timestamp with time zone, unread_count bigint, can_post boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.parent_chat_staff_can_access_team((select auth.uid()), (select public.current_user_club_id()), active_team_id_value) then
    raise insufficient_privilege using message = 'The active Team is not available for Parent Chat.';
  end if;
  if room_status_value is null or room_status_value not in ('active', 'closed') then
    raise invalid_parameter_value using message = 'Choose the active or closed room list.';
  end if;

  return query
  select * from private.coach_parent_chat_room_summaries(active_team_id_value, room_status_value, target_room_id_value);
end;
$$;
revoke all on function public.get_coach_parent_chat_rooms(uuid,text,uuid) from public, anon;
grant execute on function public.get_coach_parent_chat_rooms(uuid,text,uuid) to authenticated, service_role;

create function public.get_coach_parent_chat_unread(active_team_id_value uuid)
returns table(id uuid, team_id uuid, unread_count bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.parent_chat_staff_can_access_team((select auth.uid()), (select public.current_user_club_id()), active_team_id_value) then
    raise insufficient_privilege using message = 'The active Team is not available for Parent Chat.';
  end if;

  return query
  select room.id, room.team_id, count(message.room_id)
  from private.mobile_accessible_parent_chat_rooms(active_team_id_value, null, null) room
  left join public.parent_chat_memberships member
    on member.room_id = room.id and member.auth_user_id = (select auth.uid())
  left join public.parent_chat_messages message
    on message.room_id = room.id and message.sender_id <> (select auth.uid())
    and message.deleted_at is null and message.created_at > coalesce(member.last_read_at, '-infinity'::timestamptz)
  group by room.id, room.team_id;
end;
$$;
revoke all on function public.get_coach_parent_chat_unread(uuid) from public, anon;
grant execute on function public.get_coach_parent_chat_unread(uuid) to authenticated, service_role;
