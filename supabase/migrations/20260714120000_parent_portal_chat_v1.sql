-- Deployment: apply this migration before releasing the matching web candidate.
-- Repair: reapplying is safe for existing objects and reconciles current authoritative relationships.
-- Rollback: preserve room and message history. Disable writes or ship a forward repair migration instead of dropping data.

create table if not exists public.parent_chat_rooms (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid references public.players (id) on delete cascade,
  match_day_id uuid references public.match_days (id) on delete cascade,
  room_type text not null,
  title text not null default '',
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint parent_chat_rooms_type_check
    check (room_type in ('parent_staff', 'team', 'match_squad')),
  constraint parent_chat_rooms_status_check
    check (status in ('active', 'closed', 'archived')),
  constraint parent_chat_rooms_scope_check check (
    (room_type = 'parent_staff' and player_id is not null and match_day_id is null)
    or (room_type = 'team' and player_id is null and match_day_id is null)
    or (room_type = 'match_squad' and player_id is null and match_day_id is not null)
  )
);

create unique index if not exists parent_chat_rooms_parent_staff_key
on public.parent_chat_rooms (club_id, team_id, player_id)
where room_type = 'parent_staff';

create unique index if not exists parent_chat_rooms_team_key
on public.parent_chat_rooms (club_id, team_id)
where room_type = 'team';

create unique index if not exists parent_chat_rooms_match_squad_key
on public.parent_chat_rooms (club_id, team_id, match_day_id)
where room_type = 'match_squad';

create index if not exists parent_chat_rooms_list_idx
on public.parent_chat_rooms (club_id, team_id, status, updated_at desc);

create table if not exists public.parent_chat_memberships (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.parent_chat_rooms (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  member_kind text not null,
  active boolean not null default true,
  joined_at timestamptz not null default timezone('utc', now()),
  left_at timestamptz,
  last_read_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint parent_chat_memberships_kind_check check (member_kind in ('parent', 'staff')),
  constraint parent_chat_memberships_room_user_key unique (room_id, auth_user_id)
);

create index if not exists parent_chat_memberships_user_active_idx
on public.parent_chat_memberships (auth_user_id, active, room_id);

create table if not exists public.parent_chat_membership_audit (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.parent_chat_rooms (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  member_kind text not null,
  action text not null,
  reason text not null default 'authoritative_relationship_reconciliation',
  created_at timestamptz not null default timezone('utc', now()),
  constraint parent_chat_membership_audit_kind_check check (member_kind in ('parent', 'staff')),
  constraint parent_chat_membership_audit_action_check check (action in ('joined', 'removed'))
);

create index if not exists parent_chat_membership_audit_room_created_idx
on public.parent_chat_membership_audit (room_id, created_at desc);

create table if not exists public.parent_chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.parent_chat_rooms (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete restrict,
  sender_kind text not null,
  sender_name text not null default '',
  sender_role text not null default '',
  body text not null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint parent_chat_messages_sender_kind_check check (sender_kind in ('parent', 'staff')),
  constraint parent_chat_messages_body_check check (char_length(btrim(body)) between 1 and 2000)
);

create index if not exists parent_chat_messages_room_created_idx
on public.parent_chat_messages (room_id, created_at);

alter table public.parent_chat_rooms enable row level security;
alter table public.parent_chat_rooms force row level security;
alter table public.parent_chat_memberships enable row level security;
alter table public.parent_chat_memberships force row level security;
alter table public.parent_chat_membership_audit enable row level security;
alter table public.parent_chat_membership_audit force row level security;
alter table public.parent_chat_messages enable row level security;
alter table public.parent_chat_messages force row level security;

create or replace function public.parent_chat_staff_can_access_team(
  target_user_id uuid,
  target_club_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null
    and target_club_id is not null
    and target_team_id is not null
    and exists (
      select 1
      from public.users staff
      where staff.id = target_user_id
        and staff.club_id = target_club_id
        and coalesce(staff.status, 'active') = 'active'
        and staff.role not in ('parent_portal', 'super_admin')
        and coalesce(staff.role_rank, 0) >= 20
        and (
          coalesce(staff.role_rank, 0) >= 50
          or exists (
            select 1
            from public.team_staff assignment
            where assignment.user_id = staff.id
              and assignment.team_id = target_team_id
          )
        )
    )
    and exists (
      select 1
      from public.teams team
      where team.id = target_team_id
        and team.club_id = target_club_id
    );
$$;

create or replace function public.parent_chat_parent_can_access_room(
  target_room_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.parent_chat_user_can_access_room(
  target_room_id uuid,
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
$$;

create or replace function public.parent_chat_user_can_post_room(
  target_room_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.parent_chat_reconcile_room(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.parent_chat_rooms%rowtype;
begin
  select * into target_room
  from public.parent_chat_rooms room
  where room.id = target_room_id;

  if target_room.id is null then
    return;
  end if;

  with desired as (
    select distinct candidate.auth_user_id,
      case
        when public.parent_chat_staff_can_access_team(
          candidate.auth_user_id,
          target_room.club_id,
          target_room.team_id
        ) then 'staff'
        else 'parent'
      end as member_kind
    from (
      select staff.id as auth_user_id
      from public.users staff
      where public.parent_chat_staff_can_access_team(
        staff.id,
        target_room.club_id,
        target_room.team_id
      )
      union
      select link.auth_user_id
      from public.parent_player_links link
      join public.players player on player.id = link.player_id
      where link.auth_user_id is not null
        and link.status = 'active'
        and link.club_id = target_room.club_id
        and coalesce(link.team_id, player.team_id) = target_room.team_id
        and coalesce(player.status, 'active') <> 'archived'
        and (
          (target_room.room_type = 'parent_staff' and link.player_id = target_room.player_id)
          or target_room.room_type = 'team'
          or (
            target_room.room_type = 'match_squad'
            and exists (
              select 1
              from public.match_day_player_squad_decisions decision
              where decision.match_day_id = target_room.match_day_id
                and decision.club_id = target_room.club_id
                and decision.team_id = target_room.team_id
                and decision.player_id = link.player_id
                and decision.status = 'selected'
            )
          )
        )
    ) candidate
  )
  insert into public.parent_chat_membership_audit (
    room_id,
    club_id,
    auth_user_id,
    member_kind,
    action
  )
  select
    target_room.id,
    target_room.club_id,
    desired.auth_user_id,
    desired.member_kind,
    'joined'
  from desired
  left join public.parent_chat_memberships existing
    on existing.room_id = target_room.id
    and existing.auth_user_id = desired.auth_user_id
  where coalesce(existing.active, false) = false;

  with desired as (
    select distinct candidate.auth_user_id,
      case
        when public.parent_chat_staff_can_access_team(
          candidate.auth_user_id,
          target_room.club_id,
          target_room.team_id
        ) then 'staff'
        else 'parent'
      end as member_kind
    from (
      select staff.id as auth_user_id
      from public.users staff
      where public.parent_chat_staff_can_access_team(
        staff.id,
        target_room.club_id,
        target_room.team_id
      )
      union
      select link.auth_user_id
      from public.parent_player_links link
      join public.players player on player.id = link.player_id
      where link.auth_user_id is not null
        and link.status = 'active'
        and link.club_id = target_room.club_id
        and coalesce(link.team_id, player.team_id) = target_room.team_id
        and coalesce(player.status, 'active') <> 'archived'
        and (
          (target_room.room_type = 'parent_staff' and link.player_id = target_room.player_id)
          or target_room.room_type = 'team'
          or (
            target_room.room_type = 'match_squad'
            and exists (
              select 1
              from public.match_day_player_squad_decisions decision
              where decision.match_day_id = target_room.match_day_id
                and decision.club_id = target_room.club_id
                and decision.team_id = target_room.team_id
                and decision.player_id = link.player_id
                and decision.status = 'selected'
            )
          )
        )
    ) candidate
  )
  insert into public.parent_chat_memberships (
    room_id,
    club_id,
    auth_user_id,
    member_kind,
    active,
    left_at,
    updated_at
  )
  select
    target_room.id,
    target_room.club_id,
    desired.auth_user_id,
    desired.member_kind,
    true,
    null,
    timezone('utc', now())
  from desired
  on conflict (room_id, auth_user_id)
  do update set
    member_kind = excluded.member_kind,
    active = true,
    left_at = null,
    updated_at = timezone('utc', now());

  insert into public.parent_chat_membership_audit (
    room_id,
    club_id,
    auth_user_id,
    member_kind,
    action
  )
  select
    target_room.id,
    target_room.club_id,
    existing.auth_user_id,
    existing.member_kind,
    'removed'
  from public.parent_chat_memberships existing
  where existing.room_id = target_room.id
    and existing.active = true
    and not public.parent_chat_user_can_access_room(target_room.id, existing.auth_user_id);

  update public.parent_chat_memberships existing
  set
    active = false,
    left_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where existing.room_id = target_room.id
    and existing.active = true
    and not public.parent_chat_user_can_access_room(target_room.id, existing.auth_user_id);
end;
$$;

create or replace function public.parent_chat_ensure_rooms_for_current_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_record record;
begin
  if (select auth.uid()) is null then
    raise exception 'Login is required.';
  end if;

  insert into public.parent_chat_rooms (
    club_id,
    team_id,
    player_id,
    room_type,
    title
  )
  select distinct
    link.club_id,
    coalesce(link.team_id, player.team_id),
    link.player_id,
    'parent_staff',
    'Chat with Staff'
  from public.parent_player_links link
  join public.players player on player.id = link.player_id
  where link.status = 'active'
    and link.auth_user_id is not null
    and coalesce(link.team_id, player.team_id) is not null
    and coalesce(player.status, 'active') <> 'archived'
    and (
      link.auth_user_id = (select auth.uid())
      or public.parent_chat_staff_can_access_team(
        (select auth.uid()),
        link.club_id,
        coalesce(link.team_id, player.team_id)
      )
    )
  on conflict (club_id, team_id, player_id) where room_type = 'parent_staff'
  do nothing;

  insert into public.parent_chat_rooms (
    club_id,
    team_id,
    room_type,
    title
  )
  select distinct
    team.club_id,
    team.id,
    'team',
    team.name || ' Team Chat'
  from public.teams team
  where public.parent_chat_staff_can_access_team(
      (select auth.uid()),
      team.club_id,
      team.id
    )
    or exists (
      select 1
      from public.parent_player_links link
      join public.players player on player.id = link.player_id
      where link.auth_user_id = (select auth.uid())
        and link.status = 'active'
        and link.club_id = team.club_id
        and coalesce(link.team_id, player.team_id) = team.id
        and coalesce(player.status, 'active') <> 'archived'
    )
  on conflict (club_id, team_id) where room_type = 'team'
  do nothing;

  insert into public.parent_chat_rooms (
    club_id,
    team_id,
    match_day_id,
    room_type,
    title,
    status
  )
  select distinct
    fixture.club_id,
    fixture.team_id,
    fixture.id,
    'match_squad',
    'Match Squad Chat',
    case
      when fixture.previous_hidden_at is not null then 'archived'
      when fixture.status in ('scheduled', 'scorer_request', 'live', 'half_time') then 'active'
      else 'closed'
    end
  from public.match_days fixture
  join public.match_day_player_squad_decisions decision
    on decision.match_day_id = fixture.id
    and decision.club_id = fixture.club_id
    and decision.team_id = fixture.team_id
    and decision.status = 'selected'
  where fixture.team_id is not null
    and (
      public.parent_chat_staff_can_access_team(
        (select auth.uid()),
        fixture.club_id,
        fixture.team_id
      )
      or exists (
        select 1
        from public.parent_player_links link
        where link.auth_user_id = (select auth.uid())
          and link.status = 'active'
          and link.club_id = fixture.club_id
          and link.player_id = decision.player_id
      )
    )
  on conflict (club_id, team_id, match_day_id) where room_type = 'match_squad'
  do update set
    status = excluded.status,
    updated_at = timezone('utc', now());

  for room_record in
    select room.id
    from public.parent_chat_rooms room
    where public.parent_chat_user_can_access_room(room.id, (select auth.uid()))
  loop
    perform public.parent_chat_reconcile_room(room_record.id);
  end loop;
end;
$$;

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
security definer
set search_path = ''
as $$
begin
  perform public.parent_chat_ensure_rooms_for_current_user();

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

create or replace function public.get_parent_chat_messages(target_room_id uuid)
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
  if not public.parent_chat_user_can_access_room(target_room_id, (select auth.uid())) then
    raise exception 'This Chat room is not available.';
  end if;

  return query
  select
    message.id,
    message.room_id,
    message.sender_id,
    message.sender_kind,
    message.sender_name,
    message.sender_role,
    case when message.deleted_at is null then message.body else '' end,
    message.deleted_at,
    message.created_at,
    message.updated_at,
    message.sender_id = (select auth.uid())
      or exists (
        select 1
        from public.parent_chat_rooms room
        join public.users staff on staff.id = (select auth.uid())
        where room.id = target_room_id
          and public.parent_chat_staff_can_access_team(staff.id, room.club_id, room.team_id)
          and coalesce(staff.role_rank, 0) >= 50
      )
  from public.parent_chat_messages message
  where message.room_id = target_room_id
  order by message.created_at;
end;
$$;

create or replace function public.send_parent_chat_message(
  target_room_id uuid,
  body_value text
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
  new_message_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Login is required.';
  end if;

  if char_length(normalized_body) < 1 or char_length(normalized_body) > 2000 then
    raise exception 'Chat messages must contain between 1 and 2000 characters.';
  end if;

  if not public.parent_chat_user_can_post_room(target_room_id, (select auth.uid())) then
    raise exception 'This Chat room is not available for new messages.';
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
    body
  )
  values (
    room_record.id,
    room_record.club_id,
    (select auth.uid()),
    sender_kind_value,
    sender_name_value,
    sender_role_value,
    normalized_body
  )
  returning id into new_message_id;

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

create or replace function public.mark_parent_chat_room_read(target_room_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  read_timestamp timestamptz := timezone('utc', now());
  room_record public.parent_chat_rooms%rowtype;
  member_kind_value text;
begin
  if not public.parent_chat_user_can_access_room(target_room_id, (select auth.uid())) then
    raise exception 'This Chat room is not available.';
  end if;

  select * into room_record
  from public.parent_chat_rooms room
  where room.id = target_room_id;

  member_kind_value := case
    when public.parent_chat_staff_can_access_team(
      (select auth.uid()),
      room_record.club_id,
      room_record.team_id
    ) then 'staff'
    else 'parent'
  end;

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
    member_kind_value,
    true,
    read_timestamp,
    read_timestamp
  )
  on conflict (room_id, auth_user_id)
  do update set
    active = true,
    member_kind = excluded.member_kind,
    last_read_at = excluded.last_read_at,
    left_at = null,
    updated_at = excluded.updated_at;

  return read_timestamp;
end;
$$;

create or replace function public.delete_parent_chat_message(target_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_record public.parent_chat_messages%rowtype;
  room_record public.parent_chat_rooms%rowtype;
  is_moderator boolean := false;
begin
  select * into message_record
  from public.parent_chat_messages message
  where message.id = target_message_id;

  if message_record.id is null then
    raise exception 'This Chat message is not available.';
  end if;

  if not public.parent_chat_user_can_access_room(message_record.room_id, (select auth.uid())) then
    raise exception 'This Chat message is not available.';
  end if;

  select * into room_record
  from public.parent_chat_rooms room
  where room.id = message_record.room_id;

  select exists (
    select 1
    from public.users staff
    where staff.id = (select auth.uid())
      and public.parent_chat_staff_can_access_team(
        staff.id,
        room_record.club_id,
        room_record.team_id
      )
      and coalesce(staff.role_rank, 0) >= 50
  ) into is_moderator;

  if message_record.sender_id <> (select auth.uid()) and not is_moderator then
    raise exception 'Only the sender or authorised team moderation staff can remove this message.';
  end if;

  update public.parent_chat_messages
  set
    deleted_at = coalesce(deleted_at, timezone('utc', now())),
    deleted_by = coalesce(deleted_by, (select auth.uid())),
    updated_at = timezone('utc', now())
  where id = target_message_id;
end;
$$;

create or replace function public.parent_chat_sync_parent_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_record public.parent_player_links%rowtype;
  resolved_team_id uuid;
  room_record record;
begin
  link_record := case when tg_op = 'DELETE' then old else new end;

  select coalesce(link_record.team_id, player.team_id)
  into resolved_team_id
  from public.players player
  where player.id = link_record.player_id;

  if tg_op <> 'DELETE'
    and new.status = 'active'
    and new.auth_user_id is not null
    and resolved_team_id is not null then
    insert into public.parent_chat_rooms (
      club_id,
      team_id,
      player_id,
      room_type,
      title
    ) values (
      new.club_id,
      resolved_team_id,
      new.player_id,
      'parent_staff',
      'Chat with Staff'
    )
    on conflict (club_id, team_id, player_id) where room_type = 'parent_staff'
    do nothing;

    insert into public.parent_chat_rooms (
      club_id,
      team_id,
      room_type,
      title
    )
    select
      team.club_id,
      team.id,
      'team',
      team.name || ' Team Chat'
    from public.teams team
    where team.id = resolved_team_id
      and team.club_id = new.club_id
    on conflict (club_id, team_id) where room_type = 'team'
    do nothing;
  end if;

  for room_record in
    select room.id
    from public.parent_chat_rooms room
    where room.club_id = link_record.club_id
      and room.team_id = resolved_team_id
      and (
        room.room_type <> 'parent_staff'
        or room.player_id = link_record.player_id
      )
  loop
    perform public.parent_chat_reconcile_room(room_record.id);
  end loop;

  return coalesce(new, old);
end;
$$;

create or replace function public.parent_chat_sync_team_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_team_id uuid := case when tg_op = 'DELETE' then old.team_id else new.team_id end;
  room_record record;
begin
  insert into public.parent_chat_rooms (
    club_id,
    team_id,
    room_type,
    title
  )
  select
    team.club_id,
    team.id,
    'team',
    team.name || ' Team Chat'
  from public.teams team
  where team.id = resolved_team_id
  on conflict (club_id, team_id) where room_type = 'team'
  do nothing;

  for room_record in
    select room.id
    from public.parent_chat_rooms room
    where room.team_id = resolved_team_id
  loop
    perform public.parent_chat_reconcile_room(room_record.id);
  end loop;

  return coalesce(new, old);
end;
$$;

create or replace function public.parent_chat_sync_squad_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision_record public.match_day_player_squad_decisions%rowtype;
  room_id_value uuid;
begin
  decision_record := case when tg_op = 'DELETE' then old else new end;

  if tg_op <> 'DELETE' and new.status = 'selected' then
    insert into public.parent_chat_rooms (
      club_id,
      team_id,
      match_day_id,
      room_type,
      title,
      status
    )
    select
      fixture.club_id,
      fixture.team_id,
      fixture.id,
      'match_squad',
      'Match Squad Chat',
      case
        when fixture.previous_hidden_at is not null then 'archived'
        when fixture.status in ('scheduled', 'scorer_request', 'live', 'half_time') then 'active'
        else 'closed'
      end
    from public.match_days fixture
    where fixture.id = new.match_day_id
      and fixture.club_id = new.club_id
      and fixture.team_id = new.team_id
    on conflict (club_id, team_id, match_day_id) where room_type = 'match_squad'
    do update set
      status = excluded.status,
      updated_at = timezone('utc', now())
    returning id into room_id_value;
  else
    select room.id into room_id_value
    from public.parent_chat_rooms room
    where room.room_type = 'match_squad'
      and room.club_id = decision_record.club_id
      and room.team_id = decision_record.team_id
      and room.match_day_id = decision_record.match_day_id;
  end if;

  if room_id_value is not null then
    perform public.parent_chat_reconcile_room(room_id_value);
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.parent_chat_sync_match_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.parent_chat_rooms room
  set
    status = case
      when new.previous_hidden_at is not null then 'archived'
      when new.status in ('scheduled', 'scorer_request', 'live', 'half_time') then 'active'
      else 'closed'
    end,
    updated_at = timezone('utc', now())
  where room.room_type = 'match_squad'
    and room.match_day_id = new.id
    and room.club_id = new.club_id
    and room.team_id = new.team_id;

  return new;
end;
$$;

drop trigger if exists parent_chat_parent_link_sync on public.parent_player_links;
create trigger parent_chat_parent_link_sync
after insert or update of status, auth_user_id, team_id, player_id or delete
on public.parent_player_links
for each row execute function public.parent_chat_sync_parent_link();

drop trigger if exists parent_chat_team_staff_sync on public.team_staff;
create trigger parent_chat_team_staff_sync
after insert or update of team_id, user_id or delete
on public.team_staff
for each row execute function public.parent_chat_sync_team_staff();

drop trigger if exists parent_chat_squad_decision_sync on public.match_day_player_squad_decisions;
create trigger parent_chat_squad_decision_sync
after insert or update of status, player_id or delete
on public.match_day_player_squad_decisions
for each row execute function public.parent_chat_sync_squad_decision();

drop trigger if exists parent_chat_match_day_sync on public.match_days;
create trigger parent_chat_match_day_sync
after update of status, previous_hidden_at
on public.match_days
for each row execute function public.parent_chat_sync_match_day();

insert into public.parent_chat_rooms (
  club_id,
  team_id,
  room_type,
  title
)
select team.club_id, team.id, 'team', team.name || ' Team Chat'
from public.teams team
on conflict (club_id, team_id) where room_type = 'team'
do nothing;

insert into public.parent_chat_rooms (
  club_id,
  team_id,
  player_id,
  room_type,
  title
)
select distinct
  link.club_id,
  coalesce(link.team_id, player.team_id),
  link.player_id,
  'parent_staff',
  'Chat with Staff'
from public.parent_player_links link
join public.players player on player.id = link.player_id
where link.status = 'active'
  and link.auth_user_id is not null
  and coalesce(link.team_id, player.team_id) is not null
  and coalesce(player.status, 'active') <> 'archived'
on conflict (club_id, team_id, player_id) where room_type = 'parent_staff'
do nothing;

insert into public.parent_chat_rooms (
  club_id,
  team_id,
  match_day_id,
  room_type,
  title,
  status
)
select distinct
  fixture.club_id,
  fixture.team_id,
  fixture.id,
  'match_squad',
  'Match Squad Chat',
  case
    when fixture.previous_hidden_at is not null then 'archived'
    when fixture.status in ('scheduled', 'scorer_request', 'live', 'half_time') then 'active'
    else 'closed'
  end
from public.match_days fixture
join public.match_day_player_squad_decisions decision
  on decision.match_day_id = fixture.id
  and decision.club_id = fixture.club_id
  and decision.team_id = fixture.team_id
  and decision.status = 'selected'
where fixture.team_id is not null
on conflict (club_id, team_id, match_day_id) where room_type = 'match_squad'
do nothing;

do $$
declare
  room_record record;
begin
  for room_record in select id from public.parent_chat_rooms loop
    perform public.parent_chat_reconcile_room(room_record.id);
  end loop;
end;
$$;

drop policy if exists parent_chat_rooms_select_authorised on public.parent_chat_rooms;
create policy parent_chat_rooms_select_authorised
on public.parent_chat_rooms
for select
to authenticated
using (public.parent_chat_user_can_access_room(id, (select auth.uid())));

drop policy if exists parent_chat_memberships_select_authorised on public.parent_chat_memberships;
create policy parent_chat_memberships_select_authorised
on public.parent_chat_memberships
for select
to authenticated
using (
  auth_user_id = (select auth.uid())
  or exists (
    select 1
    from public.parent_chat_rooms room
    where room.id = parent_chat_memberships.room_id
      and public.parent_chat_staff_can_access_team(
        (select auth.uid()),
        room.club_id,
        room.team_id
      )
  )
);

drop policy if exists parent_chat_membership_audit_staff_select on public.parent_chat_membership_audit;
create policy parent_chat_membership_audit_staff_select
on public.parent_chat_membership_audit
for select
to authenticated
using (
  exists (
    select 1
    from public.parent_chat_rooms room
    where room.id = parent_chat_membership_audit.room_id
      and public.parent_chat_staff_can_access_team(
        (select auth.uid()),
        room.club_id,
        room.team_id
      )
  )
);

drop policy if exists parent_chat_messages_select_authorised on public.parent_chat_messages;
create policy parent_chat_messages_select_authorised
on public.parent_chat_messages
for select
to authenticated
using (public.parent_chat_user_can_access_room(room_id, (select auth.uid())));

drop policy if exists parent_chat_messages_insert_authorised on public.parent_chat_messages;
create policy parent_chat_messages_insert_authorised
on public.parent_chat_messages
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and public.parent_chat_user_can_post_room(room_id, (select auth.uid()))
  and exists (
    select 1
    from public.parent_chat_rooms room
    where room.id = parent_chat_messages.room_id
      and room.club_id = parent_chat_messages.club_id
      and parent_chat_messages.sender_kind = case
        when public.parent_chat_staff_can_access_team(
          (select auth.uid()),
          room.club_id,
          room.team_id
        ) then 'staff'
        else 'parent'
      end
  )
  and deleted_at is null
  and deleted_by is null
);

drop policy if exists parent_chat_messages_update_owner_or_moderator on public.parent_chat_messages;
create policy parent_chat_messages_update_owner_or_moderator
on public.parent_chat_messages
for update
to authenticated
using (
  public.parent_chat_user_can_access_room(room_id, (select auth.uid()))
  and (
    sender_id = (select auth.uid())
    or exists (
      select 1
      from public.parent_chat_rooms room
      join public.users staff on staff.id = (select auth.uid())
      where room.id = parent_chat_messages.room_id
        and public.parent_chat_staff_can_access_team(staff.id, room.club_id, room.team_id)
        and coalesce(staff.role_rank, 0) >= 50
    )
  )
)
with check (
  public.parent_chat_user_can_access_room(room_id, (select auth.uid()))
  and club_id = (
    select room.club_id
    from public.parent_chat_rooms room
    where room.id = parent_chat_messages.room_id
  )
);

revoke all on public.parent_chat_rooms from public, anon, authenticated;
revoke all on public.parent_chat_memberships from public, anon, authenticated;
revoke all on public.parent_chat_membership_audit from public, anon, authenticated;
revoke all on public.parent_chat_messages from public, anon, authenticated;

grant select on public.parent_chat_rooms to authenticated;
grant select on public.parent_chat_memberships to authenticated;
grant select on public.parent_chat_membership_audit to authenticated;
grant select on public.parent_chat_messages to authenticated;
grant all on public.parent_chat_rooms to service_role;
grant all on public.parent_chat_memberships to service_role;
grant all on public.parent_chat_membership_audit to service_role;
grant all on public.parent_chat_messages to service_role;

revoke all on function public.parent_chat_staff_can_access_team(uuid, uuid, uuid) from public;
revoke all on function public.parent_chat_parent_can_access_room(uuid, uuid) from public;
revoke all on function public.parent_chat_user_can_access_room(uuid, uuid) from public;
revoke all on function public.parent_chat_user_can_post_room(uuid, uuid) from public;
revoke all on function public.parent_chat_reconcile_room(uuid) from public;
revoke all on function public.parent_chat_ensure_rooms_for_current_user() from public;
revoke all on function public.get_parent_chat_rooms() from public;
revoke all on function public.get_parent_chat_messages(uuid) from public;
revoke all on function public.send_parent_chat_message(uuid, text) from public;
revoke all on function public.mark_parent_chat_room_read(uuid) from public;
revoke all on function public.delete_parent_chat_message(uuid) from public;

revoke execute on function public.parent_chat_staff_can_access_team(uuid, uuid, uuid) from anon;
revoke execute on function public.parent_chat_parent_can_access_room(uuid, uuid) from anon;
revoke execute on function public.parent_chat_user_can_access_room(uuid, uuid) from anon;
revoke execute on function public.parent_chat_user_can_post_room(uuid, uuid) from anon;
revoke execute on function public.parent_chat_reconcile_room(uuid) from anon, authenticated;
revoke execute on function public.parent_chat_ensure_rooms_for_current_user() from anon;
revoke execute on function public.get_parent_chat_rooms() from anon;
revoke execute on function public.get_parent_chat_messages(uuid) from anon;
revoke execute on function public.send_parent_chat_message(uuid, text) from anon;
revoke execute on function public.mark_parent_chat_room_read(uuid) from anon;
revoke execute on function public.delete_parent_chat_message(uuid) from anon;

grant execute on function public.parent_chat_staff_can_access_team(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.parent_chat_parent_can_access_room(uuid, uuid) to authenticated, service_role;
grant execute on function public.parent_chat_user_can_access_room(uuid, uuid) to authenticated, service_role;
grant execute on function public.parent_chat_user_can_post_room(uuid, uuid) to authenticated, service_role;
grant execute on function public.parent_chat_reconcile_room(uuid) to service_role;
grant execute on function public.parent_chat_ensure_rooms_for_current_user() to authenticated, service_role;
grant execute on function public.get_parent_chat_rooms() to authenticated, service_role;
grant execute on function public.get_parent_chat_messages(uuid) to authenticated, service_role;
grant execute on function public.send_parent_chat_message(uuid, text) to authenticated, service_role;
grant execute on function public.mark_parent_chat_room_read(uuid) to authenticated, service_role;
grant execute on function public.delete_parent_chat_message(uuid) to authenticated, service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'parent_chat_messages'
  ) then
    alter publication supabase_realtime add table public.parent_chat_messages;
  end if;
end;
$$;

comment on table public.parent_chat_rooms is
  'Controlled parent and staff rooms. Current authoritative relationships, not stored membership rows, grant access.';

comment on function public.parent_chat_user_can_access_room(uuid, uuid) is
  'Fail-closed current access check for club, team, child, parent link, staff assignment, and selected squad scope.';

comment on function public.parent_chat_sync_squad_decision() is
  'Creates Match Squad Chat only from the authoritative saved selected squad decision and silently removes future access after deselection.';
