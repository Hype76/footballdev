-- Chat inbox reads must remain read-only. Room and membership state is already
-- maintained by the parent link, team staff, squad decision, and match triggers.
-- Re-running the global reconciliation loop on every inbox read made a two-room
-- response take about two seconds and dirtied database buffers.

create or replace function public.get_parent_chat_rooms()
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
stable
security definer
set search_path = ''
as $$
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
  from public.parent_chat_rooms room
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
  where public.parent_chat_user_can_access_room(room.id, (select auth.uid()))
  order by coalesce(latest.created_at, room.updated_at) desc, room.created_at desc;
end;
$$;

create or replace function public.get_parent_portal_chat_notification_preferences(
  parent_link_id_value uuid,
  child_only_value boolean default false
)
returns table (
  room_id uuid,
  notifications_muted boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  from public.parent_chat_rooms room
  left join public.parent_chat_memberships membership
    on membership.room_id = room.id
   and membership.auth_user_id = actor_id
   and membership.active
  where public.parent_chat_user_can_access_room(room.id, actor_id)
    and (
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
$$;

create or replace function public.parent_portal_latest_chat_activity(
  parent_link_id_value uuid
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  latest_activity_at timestamptz;
begin
  perform 1
  from public.get_parent_portal_chat_context(parent_link_id_value)
  limit 1;

  select max(message.created_at)
  into latest_activity_at
  from public.parent_chat_rooms room
  join public.parent_chat_messages message
    on message.room_id = room.id
   and message.deleted_at is null
   and message.sender_id <> (select auth.uid())
  where public.parent_chat_room_matches_parent_link(
    room.id,
    parent_link_id_value,
    (select auth.uid())
  );

  return latest_activity_at;
end;
$$;

create or replace function public.get_staff_match_day_detail(
  target_match_day_id_value uuid,
  active_team_id_value uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  result jsonb;
begin
  if actor_id is null or active_team_id_value is null then
    raise exception 'Coach or manager access is required for Match Day.';
  end if;

  select
    to_jsonb(match_day)
    || jsonb_build_object(
      'teams', (
        select jsonb_build_object('name', team.name)
        from public.teams team
        where team.id = match_day.team_id
      ),
      'match_day_scorer_interest', coalesce((
        select jsonb_agg(
          to_jsonb(interest)
          || jsonb_build_object(
            'parent_player_links', case when parent_link.id is null then null else
              jsonb_build_object(
                'players', case when player.id is null then null else
                  jsonb_build_object('player_name', player.player_name)
                end
              )
            end
          )
        )
        from public.match_day_scorer_interest interest
        left join public.parent_player_links parent_link on parent_link.id = interest.parent_link_id
        left join public.players player on player.id = parent_link.player_id
        where interest.match_day_id = match_day.id
      ), '[]'::jsonb),
      'match_day_scorer_assignments', coalesce((
        select jsonb_agg(to_jsonb(assignment))
        from public.match_day_scorer_assignments assignment
        where assignment.match_day_id = match_day.id
      ), '[]'::jsonb),
      'match_day_role_assignments', coalesce((
        select jsonb_agg(
          to_jsonb(role_assignment)
          || jsonb_build_object(
            'parent_player_links', case when parent_link.id is null then null else
              jsonb_build_object(
                'email', parent_link.email,
                'auth_user_id', parent_link.auth_user_id,
                'players', case when player.id is null then null else
                  jsonb_build_object('player_name', player.player_name)
                end
              )
            end
          )
        )
        from public.match_day_role_assignments role_assignment
        left join public.parent_player_links parent_link on parent_link.id = role_assignment.parent_link_id
        left join public.players player on player.id = parent_link.player_id
        where role_assignment.match_day_id = match_day.id
      ), '[]'::jsonb),
      'match_day_player_availability', coalesce((
        select jsonb_agg(to_jsonb(availability))
        from public.match_day_player_availability availability
        where availability.match_day_id = match_day.id
      ), '[]'::jsonb),
      'match_day_player_squad_decisions', coalesce((
        select jsonb_agg(to_jsonb(decision))
        from public.match_day_player_squad_decisions decision
        where decision.match_day_id = match_day.id
      ), '[]'::jsonb),
      'match_day_player_availability_history', coalesce((
        select jsonb_agg(to_jsonb(history))
        from public.match_day_player_availability_history history
        where history.match_day_id = match_day.id
      ), '[]'::jsonb),
      'match_day_availability_requests', coalesce((
        select jsonb_agg(
          to_jsonb(request)
          || jsonb_build_object(
            'players', case when request_player.id is null then null else
              jsonb_build_object('player_name', request_player.player_name)
            end,
            'parent_player_links', case when parent_link.id is null then null else
              jsonb_build_object(
                'email', parent_link.email,
                'auth_user_id', parent_link.auth_user_id,
                'players', case when linked_player.id is null then null else
                  jsonb_build_object('player_name', linked_player.player_name)
                end
              )
            end
          )
        )
        from public.match_day_availability_requests request
        left join public.players request_player on request_player.id = request.player_id
        left join public.parent_player_links parent_link on parent_link.id = request.parent_link_id
        left join public.players linked_player on linked_player.id = parent_link.player_id
        where request.match_day_id = match_day.id
      ), '[]'::jsonb),
      'calendar_event_invites', coalesce((
        select jsonb_agg(
          to_jsonb(invite)
          || jsonb_build_object(
            'players', case when player.id is null then null else
              jsonb_build_object('player_name', player.player_name)
            end
          )
        )
        from public.calendar_event_invites invite
        left join public.players player on player.id = invite.player_id
        where invite.match_day_id = match_day.id
      ), '[]'::jsonb),
      'match_day_event_log', coalesce((
        select jsonb_agg(
          to_jsonb(event_log)
          || jsonb_build_object(
            'players', case when player.id is null then null else
              jsonb_build_object('player_name', player.player_name)
            end
          )
        )
        from public.match_day_event_log event_log
        left join public.players player on player.id = event_log.player_id
        where event_log.match_day_id = match_day.id
      ), '[]'::jsonb),
      'match_day_events', coalesce((
        select jsonb_agg(to_jsonb(event))
        from public.match_day_events event
        where event.match_day_id = match_day.id
      ), '[]'::jsonb),
      'match_day_shootout_kicks', coalesce((
        select jsonb_agg(to_jsonb(kick))
        from public.match_day_shootout_kicks kick
        where kick.match_day_id = match_day.id
      ), '[]'::jsonb),
      'match_day_final_reports', coalesce((
        select jsonb_agg(to_jsonb(report))
        from public.match_day_final_reports report
        where report.match_day_id = match_day.id
      ), '[]'::jsonb)
    )
  into result
  from public.match_days match_day
  where match_day.id = target_match_day_id_value
    and match_day.deleted_at is null
    and match_day.club_id = public.current_user_club_id()
    and (match_day.team_id is null or match_day.team_id = active_team_id_value)
    and public.can_read_match_day(match_day.team_id)
  limit 1;

  if result is null then
    raise exception 'This match day is not linked to your active Team.';
  end if;

  return result;
end;
$$;

revoke all on function public.get_staff_match_day_detail(uuid, uuid) from public, anon;
grant execute on function public.get_staff_match_day_detail(uuid, uuid) to authenticated, service_role;

comment on function public.get_parent_chat_rooms()
is 'Returns authorised Parent Chat rooms without mutating or reconciling room state during reads.';

comment on function public.get_parent_portal_chat_notification_preferences(uuid, boolean)
is 'Returns notification preferences from authorised room identifiers without loading full room and message payloads.';

comment on function public.parent_portal_latest_chat_activity(uuid)
is 'Returns latest authorised Parent Chat activity without mutating or reconciling room state during reads.';

comment on function public.get_staff_match_day_detail(uuid, uuid)
is 'Returns one explicitly authorised Match Day detail read model without repeated PostgREST row-policy expansion.';
