-- Synthetic schema plus canonical production read/authority definitions at 9f3eefd2.

create role anon;
create role authenticated;
create role service_role;
create schema auth;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table public.clubs (id uuid primary key, name text not null);
create table public.teams (id uuid primary key, club_id uuid not null, name text not null);
create table public.players (
  id uuid primary key,
  club_id uuid not null,
  team_id uuid,
  player_name text not null,
  status text not null default 'active',
  archived_at timestamptz
);
create table public.match_days (
  id uuid primary key,
  club_id uuid not null,
  team_id uuid,
  opponent text not null default '',
  match_date date,
  kickoff_time time,
  kickoff_time_tbc boolean not null default false,
  arrival_time time,
  venue_name text not null default '',
  status text not null default 'scheduled',
  deleted_at timestamptz
);
create table public.parent_player_links (
  id uuid primary key,
  player_id uuid not null,
  auth_user_id uuid not null,
  status text not null default 'active',
  club_id uuid not null,
  team_id uuid,
  email text not null default '',
  created_at timestamptz not null default statement_timestamp()
);
create table public.parent_chat_rooms (
  id uuid primary key,
  room_type text not null,
  status text not null default 'active',
  title text not null default '',
  club_id uuid not null,
  team_id uuid not null,
  player_id uuid,
  match_day_id uuid,
  updated_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp()
);
create table public.parent_chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  sender_id uuid not null,
  body text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp()
);
create table public.parent_chat_memberships (
  room_id uuid not null,
  auth_user_id uuid not null,
  active boolean not null default true,
  notifications_muted boolean not null default false,
  last_read_at timestamptz,
  unique (room_id, auth_user_id)
);
create table public.match_day_scorer_interest (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null, parent_link_id uuid
);
create table public.match_day_scorer_assignments (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null
);
create table public.match_day_role_assignments (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null, parent_link_id uuid
);
create table public.match_day_player_availability (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null
);
create table public.match_day_player_squad_decisions (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null, player_id uuid not null, status text not null
);
create table public.match_day_player_availability_history (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null
);
create table public.match_day_availability_requests (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null, player_id uuid, parent_link_id uuid
);
create table public.calendar_event_invites (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null, player_id uuid
);
create table public.match_day_event_log (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null, player_id uuid
);
create table public.match_day_events (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null
);
create table public.match_day_shootout_kicks (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null
);
create table public.match_day_final_reports (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null
);


alter table public.clubs add column status text default 'active', add column archived_at timestamptz;
alter table public.teams add column status text default 'active', add column archived_at timestamptz;
alter table public.match_days add column previous_hidden_at timestamptz;
alter table public.match_day_player_squad_decisions add column club_id uuid, add column team_id uuid;
alter table public.match_day_availability_requests add column club_id uuid, add column team_id uuid, add column created_at timestamptz default now();
create table public.users(id uuid primary key, club_id uuid, role text, role_rank integer, status text default 'active');
create table public.platform_admins(id uuid primary key, status text default 'active');
create table public.user_club_memberships(auth_user_id uuid, club_id uuid, role text, role_rank integer);
create table public.team_staff(user_id uuid, team_id uuid);
create table public.training_availability_requests(id uuid primary key default gen_random_uuid(), club_id uuid, team_id uuid);
create table public.training_availability_request_players(id uuid primary key default gen_random_uuid(), club_id uuid, team_id uuid, calendar_event_id uuid, created_at timestamptz default now());
create table public.training_availability_responses(id uuid primary key default gen_random_uuid(), club_id uuid, team_id uuid, responded_at timestamptz default now());
CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select u.role
  from public.users u
  where u.id = (select auth.uid())
    and u.status = 'active'
    and (
      (
        u.role = 'super_admin'
        and exists (
          select 1
          from public.platform_admins pa
          where pa.id = u.id
            and pa.status = 'active'
        )
      )
      or (
        u.role <> 'super_admin'
        and u.club_id is not null
        and exists (
          select 1
            from public.user_club_memberships m
            where m.auth_user_id = u.id
              and m.club_id = u.club_id
              and m.role = u.role
              and m.role_rank = u.role_rank
        )
        and exists (
          select 1
          from public.clubs c
          where c.id = u.club_id
            and coalesce(c.status, 'active') = 'active'
        )
      )
    )
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_club_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select u.club_id
  from public.users u
  where u.id = (select auth.uid())
    and u.status = 'active'
    and (
      (
        u.role = 'super_admin'
        and exists (
          select 1
          from public.platform_admins pa
          where pa.id = u.id
            and pa.status = 'active'
        )
      )
      or (
        u.role <> 'super_admin'
        and u.club_id is not null
        and exists (
          select 1
            from public.user_club_memberships m
            where m.auth_user_id = u.id
              and m.club_id = u.club_id
              and m.role = u.role
              and m.role_rank = u.role_rank
        )
        and exists (
          select 1
          from public.clubs c
          where c.id = u.club_id
            and coalesce(c.status, 'active') = 'active'
        )
      )
    )
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_has_active_authority()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists (
    select 1
    from public.users u
    where u.id = (select auth.uid())
      and u.status = 'active'
      and (
        (
          u.role = 'super_admin'
          and exists (
            select 1
            from public.platform_admins pa
            where pa.id = u.id
              and pa.status = 'active'
          )
        )
        or (
          u.role <> 'super_admin'
          and u.club_id is not null
          and exists (
            select 1
            from public.user_club_memberships m
            where m.auth_user_id = u.id
              and m.club_id = u.club_id
              and m.role = u.role
              and m.role_rank = u.role_rank
          )
          and exists (
            select 1
            from public.clubs c
            where c.id = u.club_id
              and coalesce(c.status, 'active') = 'active'
          )
        )
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_role_rank()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(u.role_rank, 0)
  from public.users u
  where u.id = (select auth.uid())
    and u.status = 'active'
    and (
      (
        u.role = 'super_admin'
        and exists (
          select 1
          from public.platform_admins pa
          where pa.id = u.id
            and pa.status = 'active'
        )
      )
      or (
        u.role <> 'super_admin'
        and u.club_id is not null
        and exists (
          select 1
            from public.user_club_memberships m
            where m.auth_user_id = u.id
              and m.club_id = u.club_id
              and m.role = u.role
              and m.role_rank = u.role_rank
        )
        and exists (
          select 1
          from public.clubs c
          where c.id = u.club_id
            and coalesce(c.status, 'active') = 'active'
        )
      )
    )
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_has_active_team_assignment(target_club_id uuid, target_team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.current_user_has_active_authority()
    and public.current_user_role() not in ('admin', 'parent_portal', 'super_admin')
    and public.current_user_role_rank() >= 20
    and public.current_user_club_id() = target_club_id
    and target_team_id is not null
    and exists (
      select 1
      from public.teams team
      join public.team_staff assignment
        on assignment.team_id = team.id
       and assignment.user_id = (select auth.uid())
      where team.id = target_team_id
        and team.club_id = target_club_id
        and coalesce(team.status, 'active') = 'active'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_has_club_wide_authority(target_club_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.current_user_has_active_authority()
    and public.current_user_role() = 'admin'
    and public.current_user_club_id() = target_club_id;
$function$
;

CREATE OR REPLACE FUNCTION public.parent_chat_parent_can_access_room(target_room_id uuid, target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.parent_chat_rooms room
    where room.id = target_room_id
      and room.status in ('active', 'closed')
      and (
        (
          room.room_type = 'parent_staff'
          and exists (
            select 1
            from public.parent_player_links link
            join public.players player on player.id = link.player_id
            where link.auth_user_id = target_user_id
              and link.status = 'active'
              and link.club_id = room.club_id
              and link.player_id = room.player_id
              and coalesce(link.team_id, player.team_id) = room.team_id
              and coalesce(player.status, 'active') <> 'archived'
          )
        )
        or (
          room.room_type = 'team'
          and exists (
            select 1
            from public.parent_player_links link
            join public.players player on player.id = link.player_id
            where link.auth_user_id = target_user_id
              and link.status = 'active'
              and link.club_id = room.club_id
              and coalesce(link.team_id, player.team_id) = room.team_id
              and coalesce(player.status, 'active') <> 'archived'
          )
        )
        or (
          room.room_type = 'match_squad'
          and exists (
            select 1
            from public.parent_player_links link
            join public.players player on player.id = link.player_id
            join public.match_day_player_squad_decisions decision
              on decision.match_day_id = room.match_day_id
              and decision.club_id = room.club_id
              and decision.team_id = room.team_id
              and decision.player_id = link.player_id
              and decision.status = 'selected'
            where link.auth_user_id = target_user_id
              and link.status = 'active'
              and link.club_id = room.club_id
              and coalesce(link.team_id, player.team_id) = room.team_id
              and coalesce(player.status, 'active') <> 'archived'
          )
        )
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_can_access_team(target_club_id uuid, target_team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.current_user_role() = 'super_admin'
    or (
      exists (
        select 1
        from public.teams team
        join public.clubs club on club.id = team.club_id
        where team.id = target_team_id
          and team.club_id = target_club_id
          and team.archived_at is null
          and coalesce(team.status, 'active') = 'active'
          and club.archived_at is null
          and coalesce(club.status, 'active') = 'active'
      )
      and (
        public.current_user_has_club_wide_authority(target_club_id)
        or public.current_user_has_active_team_assignment(target_club_id, target_team_id)
      )
    );
$function$
;

CREATE OR REPLACE FUNCTION public.parent_chat_staff_can_access_team(target_user_id uuid, target_club_id uuid, target_team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select target_user_id is not null
    and target_club_id is not null
    and target_team_id is not null
    and exists (
      select 1
      from public.users staff
      join public.user_club_memberships membership
        on membership.auth_user_id = staff.id
       and membership.club_id = staff.club_id
       and membership.role = staff.role
       and membership.role_rank = staff.role_rank
      join public.team_staff assignment
        on assignment.user_id = staff.id
       and assignment.team_id = target_team_id
      join public.teams team
        on team.id = assignment.team_id
       and team.club_id = target_club_id
       and team.archived_at is null
       and coalesce(team.status, 'active') = 'active'
      join public.clubs club
        on club.id = team.club_id
       and club.archived_at is null
       and coalesce(club.status, 'active') = 'active'
      where staff.id = target_user_id
        and staff.club_id = target_club_id
        and coalesce(staff.status, 'active') = 'active'
        and staff.role not in ('parent_portal', 'super_admin')
        and coalesce(staff.role_rank, 0) >= 20
    );
$function$
;

CREATE OR REPLACE FUNCTION public.parent_chat_user_can_access_room(target_room_id uuid, target_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select target_user_id is not null
    and exists (
      select 1
      from public.parent_chat_rooms room
      where room.id = target_room_id
        and room.status in ('active', 'closed')
        and (
          public.parent_chat_parent_can_access_room(room.id, target_user_id)
          or public.parent_chat_staff_can_access_team(
            target_user_id,
            room.club_id,
            room.team_id
          )
        )
    );
$function$
;

CREATE OR REPLACE FUNCTION public.parent_chat_user_can_post_room(target_room_id uuid, target_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.parent_chat_user_can_access_room(target_room_id, target_user_id)
    and exists (
      select 1
      from public.parent_chat_rooms room
      where room.id = target_room_id
        and room.status = 'active'
        and (
          room.room_type <> 'match_squad'
          or exists (
            select 1
            from public.match_days fixture
            where fixture.id = room.match_day_id
              and fixture.club_id = room.club_id
              and fixture.team_id = room.team_id
              and fixture.previous_hidden_at is null
              and fixture.status in ('scheduled', 'scorer_request', 'live', 'half_time')
          )
        )
    );
$function$
;

CREATE OR REPLACE FUNCTION public.training_availability_user_can_view(target_club_id uuid, target_team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.current_user_can_access_team(target_club_id, target_team_id);
$function$
;

CREATE OR REPLACE FUNCTION public.parent_chat_room_matches_parent_link(target_room_id uuid, target_parent_link_id uuid, target_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_parent_chat_rooms()
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
$function$
;

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
  from public.get_parent_chat_rooms() room
  where room.team_id = active_team_id_value;
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_parent_portal_chat_rooms(parent_link_id_value uuid, child_only_value boolean DEFAULT false)
 RETURNS TABLE(id uuid, room_type text, status text, title text, club_id uuid, club_name text, team_id uuid, team_name text, player_id uuid, player_name text, match_day_id uuid, opponent text, match_date date, kickoff_time time without time zone, kickoff_time_tbc boolean, meet_time time without time zone, venue_name text, fixture_status text, child_names text[], latest_message text, latest_message_at timestamp with time zone, unread_count bigint, can_post boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  target_link public.parent_player_links%rowtype;
  selected_child_name text;
  history_cutoff timestamptz;
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

  history_cutoff := date_trunc('day', target_link.created_at);

  select player.player_name
  into selected_child_name
  from public.players player
  where player.id = target_link.player_id;

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
    coalesce(latest.body, ''),
    latest.created_at,
    coalesce(unread.total, 0),
    room.can_post
  from public.get_parent_chat_rooms() room
  left join lateral (
    select message.body, message.created_at
    from public.parent_chat_messages message
    where message.room_id = room.id
      and message.deleted_at is null
      and message.created_at >= history_cutoff
    order by message.created_at desc
    limit 1
  ) latest on true
  left join lateral (
    select count(*)::bigint as total
    from public.parent_chat_messages message
    left join public.parent_chat_memberships membership
      on membership.room_id = room.id
      and membership.auth_user_id = auth.uid()
    where message.room_id = room.id
      and message.sender_id <> auth.uid()
      and message.deleted_at is null
      and message.created_at >= history_cutoff
      and message.created_at > greatest(
        coalesce(membership.last_read_at, '-infinity'::timestamptz),
        history_cutoff
      )
  ) unread on true
  where (
    not child_only_value
    or public.parent_chat_room_matches_parent_link(
      room.id,
      target_link.id,
      auth.uid()
    )
  )
  and (
    latest.created_at is not null
    or room.room_type = 'parent_staff'
  )
  order by latest.created_at desc nulls last, room.id;
end;
$function$
;
alter table public.match_day_availability_requests enable row level security;
create policy match_day_availability_staff_select_exact_team on public.match_day_availability_requests for select to authenticated using(public.current_user_can_access_team(club_id,team_id));

alter table public.training_availability_request_players enable row level security;
create policy training_availability_request_players_select_staff on public.training_availability_request_players for select to authenticated using(public.current_user_can_access_team(club_id,team_id));

alter table public.training_availability_requests enable row level security;
create policy training_availability_requests_select_staff on public.training_availability_requests for select to authenticated using(public.current_user_can_access_team(club_id,team_id));

alter table public.training_availability_responses enable row level security;
create policy training_availability_responses_select_staff on public.training_availability_responses for select to authenticated using(public.current_user_can_access_team(club_id,team_id));

grant usage on schema auth to authenticated;
grant select on all tables in schema public to authenticated;
