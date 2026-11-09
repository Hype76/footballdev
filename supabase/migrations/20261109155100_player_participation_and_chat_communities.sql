-- Club-managed player types and eligibility for the 1.1.2 pilot.
create table public.club_player_types (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  can_training boolean not null default false,
  can_friendly boolean not null default false,
  can_cup boolean not null default false,
  can_league boolean not null default false,
  chat_group text not null default 'none'
    check (chat_group in ('team', 'training', 'match', 'none')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_player_types_name_valid check (name = btrim(name) and char_length(name) between 2 and 40),
  constraint club_player_types_club_name_key unique (club_id, name)
);

create unique index club_player_types_name_ci_key
  on public.club_player_types (club_id, lower(name));

alter table public.club_player_types enable row level security;
revoke all on public.club_player_types from public, anon, authenticated;
grant select on public.club_player_types to authenticated;
grant select on public.club_player_types to service_role;
grant insert (club_id, name, can_training, can_friendly, can_cup, can_league, chat_group)
  on public.club_player_types to authenticated;
grant update (name, can_training, can_friendly, can_cup, can_league, chat_group)
  on public.club_player_types to authenticated;
grant delete on public.club_player_types to authenticated;

create policy club_player_types_read on public.club_player_types
  for select to authenticated
  using (club_id = public.current_user_club_id());
create policy club_player_types_insert on public.club_player_types
  for insert to authenticated
  with check (club_id = public.current_user_club_id()
    and exists (select 1 from public.users actor where actor.id = (select auth.uid())
      and actor.club_id = club_id and actor.role = 'admin' and actor.status = 'active'));
create policy club_player_types_update on public.club_player_types
  for update to authenticated
  using (club_id = public.current_user_club_id()
    and exists (select 1 from public.users actor where actor.id = (select auth.uid())
      and actor.club_id = club_id and actor.role = 'admin' and actor.status = 'active'))
  with check (club_id = public.current_user_club_id()
    and exists (select 1 from public.users actor where actor.id = (select auth.uid())
      and actor.club_id = club_id and actor.role = 'admin' and actor.status = 'active'));
create policy club_player_types_delete on public.club_player_types
  for delete to authenticated
  using (club_id = public.current_user_club_id() and not is_default
    and exists (select 1 from public.users actor where actor.id = (select auth.uid())
      and actor.club_id = club_id and actor.role = 'admin' and actor.status = 'active'));

insert into public.club_player_types
  (club_id, name, can_training, can_friendly, can_cup, can_league, chat_group, is_default)
select club.id, kind.name, kind.can_training, kind.can_friendly,
  kind.can_cup, kind.can_league, kind.chat_group, true
from public.clubs club
cross join (values
  ('Trial', true, true, true, true, 'team'),
  ('Squad', true, true, true, true, 'team'),
  ('Training-only', true, true, false, false, 'training'),
  ('Match-only', false, true, true, true, 'match')
) as kind(name, can_training, can_friendly, can_cup, can_league, chat_group)
on conflict (club_id, name) do nothing;

create function public.seed_club_player_types() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  insert into public.club_player_types
    (club_id, name, can_training, can_friendly, can_cup, can_league, chat_group, is_default)
  select new.id, kind.name, kind.can_training, kind.can_friendly,
    kind.can_cup, kind.can_league, kind.chat_group, true
  from (values
    ('Trial', true, true, true, true, 'team'),
    ('Squad', true, true, true, true, 'team'),
    ('Training-only', true, true, false, false, 'training'),
    ('Match-only', false, true, true, true, 'match')
  ) as kind(name, can_training, can_friendly, can_cup, can_league, chat_group);
  return new;
end;
$function$;
revoke all on function public.seed_club_player_types() from public, anon, authenticated;
create trigger seed_club_player_types_after_insert
  after insert on public.clubs for each row execute function public.seed_club_player_types();

create function public.guard_club_player_type() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op = 'UPDATE' and old.is_default then
    raise exception 'Default player types cannot be changed.';
  end if;
  if tg_op = 'DELETE' and old.is_default then
    raise exception 'Default player types cannot be deleted.';
  end if;
  if tg_op = 'UPDATE' and new.is_default then
    raise exception 'Default player types cannot be assigned.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end;
$function$;
revoke all on function public.guard_club_player_type() from public, anon, authenticated;
create trigger guard_club_player_type_before_change
  before insert or update or delete on public.club_player_types
  for each row execute function public.guard_club_player_type();

-- Keep the existing token, email, revocation and idempotency checks intact while
-- allowing the same active-player access flow for every club player type.
do $migration$
declare function_sql text;
begin
  select pg_get_functiondef('public.accept_parent_player_link(uuid)'::regprocedure)
    into function_sql;
  if position($find$lower(btrim(coalesce(player.section, ''))) in ('trial', 'squad')$find$ in function_sql) = 0
    or position('active Trial or Squad player' in function_sql) = 0 then
    raise exception 'Parent link acceptance definition changed; review the player type migration.';
  end if;
  function_sql := replace(function_sql,
    $find$lower(btrim(coalesce(player.section, ''))) in ('trial', 'squad')$find$,
    $replace$nullif(btrim(coalesce(player.section, '')), '') is not null$replace$);
  function_sql := replace(function_sql,
    'active Trial or Squad player', 'active player');
  execute function_sql;
end;
$migration$;

-- A selected player of any eligible type can appear in the full-time player poll.
do $migration$
declare function_sql text;
begin
  select pg_get_functiondef('public.create_match_day_motm_poll(uuid)'::regprocedure)
    into function_sql;
  if position($find$and player.section = 'Squad';$find$ in function_sql) = 0 then
    raise exception 'Player of the Match poll scope changed; review the player type migration.';
  end if;
  function_sql := replace(function_sql,
    $find$and player.section = 'Squad';$find$,
    $replace$and exists (
      select 1 from public.club_player_types player_type
      where player_type.club_id = player.club_id and player_type.name = player.section
        and (case lower(coalesce(match_row.fixture_type, ''))
          when 'friendly' then player_type.can_friendly
          when 'cup' then player_type.can_cup
          when 'tournament' then player_type.can_cup
          else player_type.can_league end));$replace$);
  execute function_sql;
end;
$migration$;
comment on function public.accept_parent_player_link(uuid) is
  'Accepts active player Parent app access for the intended signed-in email while retaining family-link idempotency.';

alter table public.players drop constraint players_section_check;
alter table public.players add constraint players_section_check
  check (section = btrim(section) and char_length(section) between 2 and 40);
alter table public.players add constraint players_club_section_key
  foreign key (club_id, section) references public.club_player_types (club_id, name)
  on update cascade on delete restrict;
alter table public.evaluations drop constraint evaluations_section_check;
alter table public.evaluations add constraint evaluations_section_check
  check (section = btrim(section) and char_length(section) between 2 and 40);

create function private.player_type_allows_event(player_id_value uuid, source_type_value text, event_id_value uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists (
    select 1 from public.players player
    join public.club_player_types player_type
      on player_type.club_id = player.club_id and player_type.name = player.section
    where player.id = player_id_value
      and player.archived_at is null and coalesce(player.status, 'active') <> 'archived'
      and (
        (source_type_value = 'match-day' and exists (
          select 1 from public.match_days fixture
          where fixture.id = event_id_value and fixture.club_id = player.club_id
            and fixture.team_id = player.team_id
            and (case lower(coalesce(fixture.fixture_type, ''))
              when 'friendly' then player_type.can_friendly
              when 'cup' then player_type.can_cup
              when 'tournament' then player_type.can_cup
              when 'league' then player_type.can_league
              else player_type.can_league end)))
        or (source_type_value = 'session' and exists (
          select 1 from public.assessment_sessions session
          where session.id = event_id_value and session.club_id = player.club_id
            and session.team_id = player.team_id
            and (case lower(coalesce(session.session_type, 'training'))
              when 'training' then player_type.can_training
              when 'match' then player_type.can_league
              else false end)))
        or (source_type_value = 'calendar' and exists (
          select 1 from public.calendar_events event
          where event.id = event_id_value and event.club_id = player.club_id
            and event.team_id = player.team_id
            and (case lower(coalesce(event.event_type, 'general'))
              when 'training' then player_type.can_training
              when 'match' then player_type.can_league
              when 'tournament' then player_type.can_cup
              else true end)))
      )
  );
$function$;
revoke all on function private.player_type_allows_event(uuid, text, uuid)
  from public, anon, authenticated;

alter function public.apply_event_player_changes(text, uuid, uuid[], text, uuid, boolean, boolean)
  rename to apply_event_player_changes_type_internal_20261109;
revoke all on function public.apply_event_player_changes_type_internal_20261109(text, uuid, uuid[], text, uuid, boolean, boolean)
  from public, anon, authenticated;
create function public.apply_event_player_changes(
  source_type_value text, event_id_value uuid, selected_player_ids_value uuid[] default '{}'::uuid[],
  communication_mode_value text default 'none', request_token_value uuid default null,
  confirm_selected_removals_value boolean default false,
  confirm_resend_all_value boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare added_player record;
begin
  for added_player in
    select jsonb_array_elements_text(result.payload -> 'addedPlayerIds')::uuid as id
    from public.preview_event_player_changes(source_type_value, event_id_value, selected_player_ids_value) as result(payload)
  loop
    if not private.player_type_allows_event(added_player.id, source_type_value, event_id_value) then
      raise exception 'A selected player type is not eligible for this event.' using errcode = '23514';
    end if;
  end loop;
  return public.apply_event_player_changes_type_internal_20261109(
    source_type_value, event_id_value, selected_player_ids_value, communication_mode_value,
    request_token_value, confirm_selected_removals_value, confirm_resend_all_value);
end;
$function$;
revoke all on function public.apply_event_player_changes(text, uuid, uuid[], text, uuid, boolean, boolean)
  from public, anon;
grant execute on function public.apply_event_player_changes(text, uuid, uuid[], text, uuid, boolean, boolean)
  to authenticated, service_role;

create function private.guard_session_player_type() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if not private.player_type_allows_event(new.player_id, 'session', new.session_id) then
    raise exception 'This player type is not eligible for the session.' using errcode = '23514';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_session_player_type() from public, anon, authenticated;
create trigger guard_session_player_type_before_insert
  before insert or update of player_id, session_id on public.assessment_session_players
  for each row execute function private.guard_session_player_type();

create function private.guard_match_squad_player_type() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if new.status = 'selected' and not private.player_type_allows_event(new.player_id, 'match-day', new.match_day_id) then
    raise exception 'This player type is not eligible for the fixture.' using errcode = '23514';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_match_squad_player_type() from public, anon, authenticated;
create trigger guard_match_squad_player_type_before_selection
  before insert or update of status, player_id, match_day_id on public.match_day_player_squad_decisions
  for each row when (new.status = 'selected')
  execute function private.guard_match_squad_player_type();

alter table public.parent_chat_rooms drop constraint parent_chat_rooms_type_check;
alter table public.parent_chat_rooms add constraint parent_chat_rooms_type_check
  check (room_type in ('parent_staff', 'team', 'team_training', 'team_match', 'match_squad'));
alter table public.parent_chat_rooms drop constraint parent_chat_rooms_scope_check;
alter table public.parent_chat_rooms add constraint parent_chat_rooms_scope_check check (
  (room_type = 'parent_staff' and player_id is not null and match_day_id is null)
  or (room_type in ('team', 'team_training', 'team_match') and player_id is null and match_day_id is null)
  or (room_type = 'match_squad' and player_id is null and match_day_id is not null)
);
create unique index parent_chat_rooms_new_community_key
  on public.parent_chat_rooms (club_id, team_id, room_type)
  where room_type in ('team_training', 'team_match');

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
          room.room_type in ('team', 'team_training', 'team_match')
          and exists (
            select 1
            from public.parent_player_links link
            join public.players player on player.id = link.player_id
            where link.auth_user_id = target_user_id
              and link.status = 'active'
              and link.club_id = room.club_id
              and coalesce(link.team_id, player.team_id) = room.team_id
              and coalesce(player.status, 'active') <> 'archived'
              and (room.room_type = case (
                select player_type.chat_group from public.club_player_types player_type
                where player_type.club_id = player.club_id and player_type.name = player.section
              ) when 'training' then 'team_training' when 'match' then 'team_match'
                when 'team' then 'team' else '' end)
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
$function$;


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
          or (room.room_type = case (
            select player_type.chat_group from public.club_player_types player_type
            where player_type.club_id = player.club_id and player_type.name = player.section
          ) when 'training' then 'team_training' when 'match' then 'team_match'
            when 'team' then 'team' else '' end)
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
$function$;


CREATE OR REPLACE FUNCTION public.parent_chat_reconcile_room(target_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
          or (target_room.room_type = case (
            select player_type.chat_group from public.club_player_types player_type
            where player_type.club_id = player.club_id and player_type.name = player.section
          ) when 'training' then 'team_training' when 'match' then 'team_match'
            when 'team' then 'team' else '' end)
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
          or (target_room.room_type = case (
            select player_type.chat_group from public.club_player_types player_type
            where player_type.club_id = player.club_id and player_type.name = player.section
          ) when 'training' then 'team_training' when 'match' then 'team_match'
            when 'team' then 'team' else '' end)
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
$function$;


CREATE OR REPLACE FUNCTION public.parent_chat_ensure_rooms_for_current_user()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        and (select player_type.chat_group from public.club_player_types player_type
          where player_type.club_id = player.club_id and player_type.name = player.section) = 'team'
    )
  on conflict (club_id, team_id) where room_type = 'team'
  do nothing;

  insert into public.parent_chat_rooms (club_id, team_id, room_type, title)
  select team.club_id, team.id, kind.room_type, team.name || kind.title_suffix
  from public.teams team
  cross join (values
    ('team_training', ' Training-only Chat'),
    ('team_match', ' Match-only Chat')
  ) as kind(room_type, title_suffix)
  where public.parent_chat_staff_can_access_team(
      (select auth.uid()), team.club_id, team.id
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
        and (kind.room_type = case (
          select player_type.chat_group from public.club_player_types player_type
          where player_type.club_id = player.club_id and player_type.name = player.section
        ) when 'training' then 'team_training' when 'match' then 'team_match' else '' end)
    )
  on conflict (club_id, team_id, room_type) where room_type in ('team_training', 'team_match')
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
$function$;


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
    or room.room_type in ('parent_staff', 'team_training', 'team_match')
  )
  order by latest.created_at desc nulls last, room.id;
end;
$function$;


CREATE OR REPLACE FUNCTION private.mobile_parent_chat_room_summaries(active_team_id_value uuid DEFAULT NULL::uuid)
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
$function$;


CREATE OR REPLACE FUNCTION private.match_day_event_participants(match_id uuid)
 RETURNS TABLE(id uuid, player_name text, shirt_number text, team_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with fixture as (select m.* from public.match_days m where m.id=match_id and m.deleted_at is null),
  policy as (select f.*,
    not exists(select 1 from public.match_day_player_squad_decisions d where d.match_day_id=f.id)
    and not exists(select 1 from public.match_day_event_log l where l.match_day_id=f.id
      and (l.event_type in ('player_squad_decision_changed','player_selected','player_deselected')
        or l.event_type like '%player%remov%' or l.event_type like '%squad%'))
    and not exists(select 1 from public.event_player_removal_commands r where r.match_day_id=f.id)
    as unconfigured from fixture f)
  select p.id,p.player_name,coalesce(p.shirt_number,''),p.team_id
  from policy f join public.players p on p.club_id=f.club_id and p.team_id=f.team_id
  join public.club_player_types player_type on player_type.club_id=p.club_id and player_type.name=p.section
  where p.archived_at is null and coalesce(p.status,'active')='active'
    and (p.section <> 'Trial' or public.can_use_plan_feature(f.club_id,'trialPlayers'))
    and (case lower(coalesce(f.fixture_type, ''))
      when 'friendly' then player_type.can_friendly
      when 'cup' then player_type.can_cup
      when 'tournament' then player_type.can_cup
      when 'league' then player_type.can_league
      else player_type.can_league end)
    and nullif(trim(p.player_name),'') is not null
    and (f.unconfigured or exists(select 1 from public.match_day_player_squad_decisions d
      where d.match_day_id=f.id and d.club_id=f.club_id and d.team_id=f.team_id
        and d.player_id=p.id and d.status='selected'))
  order by lower(p.player_name),p.id;
$function$;


CREATE OR REPLACE FUNCTION private.match_day_substitution_participants(match_id uuid)
 RETURNS TABLE(id uuid, player_name text, shirt_number text, team_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.id,p.player_name,coalesce(p.shirt_number,''),p.team_id
  from public.match_days f join public.players p on p.club_id=f.club_id and p.team_id=f.team_id
  join public.club_player_types player_type on player_type.club_id=p.club_id and player_type.name=p.section
  where f.id=match_id and f.deleted_at is null
    and p.archived_at is null and coalesce(p.status,'active')='active'
    and (p.section <> 'Trial' or public.can_use_plan_feature(f.club_id,'trialPlayers'))
    and (case lower(coalesce(f.fixture_type, ''))
      when 'friendly' then player_type.can_friendly
      when 'cup' then player_type.can_cup
      when 'tournament' then player_type.can_cup
      when 'league' then player_type.can_league
      else player_type.can_league end)
    and nullif(trim(p.player_name),'') is not null
  order by lower(p.player_name),p.id;
$function$;


CREATE OR REPLACE FUNCTION public.get_parent_portal_match_day_players(parent_link_id_value uuid)
 RETURNS TABLE(id uuid, player_name text, shirt_number text, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with parent_link as (
    select
      link.club_id,
      coalesce(link.team_id, linked_player.team_id) as team_id
    from public.parent_player_links link
    left join public.players linked_player
      on linked_player.id = link.player_id
    where link.id = parent_link_id_value
      and link.auth_user_id = auth.uid()
      and link.status = 'active'
    limit 1
  )
  select
    player.id,
    player.player_name,
    coalesce(player.shirt_number, '') as shirt_number,
    coalesce(player.status, 'active') as status
  from public.players player
  join parent_link link
    on link.club_id = player.club_id
    and (
      link.team_id is null
      or player.team_id = link.team_id
    )
  join public.club_player_types player_type
    on player_type.club_id = player.club_id and player_type.name = player.section
  where auth.uid() is not null
    and coalesce(player.status, 'active') <> 'archived'
    and (player_type.can_friendly or player_type.can_cup or player_type.can_league)
  order by player.player_name asc;
$function$;


insert into public.parent_chat_rooms (club_id, team_id, room_type, title)
select team.club_id, team.id, kind.room_type, team.name || kind.title_suffix
from public.teams team
cross join (values
  ('team_training', ' Training-only Chat', 'training'),
  ('team_match', ' Match-only Chat', 'match')
) as kind(room_type, title_suffix, chat_group)
where exists (
  select 1 from public.players player
  where player.club_id = team.club_id and player.team_id = team.id
    and (select player_type.chat_group from public.club_player_types player_type
      where player_type.club_id = player.club_id and player_type.name = player.section) = kind.chat_group
    and player.archived_at is null and coalesce(player.status, 'active') <> 'archived'
)
on conflict (club_id, team_id, room_type) where room_type in ('team_training', 'team_match')
do nothing;

create function public.parent_chat_sync_player_type() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare room_record record;
begin
  if current_setting('app.demo_reset_skip_communication_sync', true) = 'on' then
    return new;
  end if;
  for room_record in
    select room.id from public.parent_chat_rooms room
    where room.club_id in (old.club_id, new.club_id)
      and room.team_id in (old.team_id, new.team_id)
      and room.room_type in ('parent_staff', 'team', 'team_training', 'team_match')
      and (room.room_type <> 'parent_staff' or room.player_id = new.id)
  loop
    perform public.parent_chat_reconcile_room(room_record.id);
  end loop;
  return new;
end;
$function$;
revoke all on function public.parent_chat_sync_player_type() from public, anon, authenticated;
create trigger parent_chat_sync_player_type_after_update
  after update of section, team_id, status, archived_at on public.players
  for each row when (old.section is distinct from new.section
    or old.team_id is distinct from new.team_id
    or old.status is distinct from new.status
    or old.archived_at is distinct from new.archived_at)
  execute function public.parent_chat_sync_player_type();

create function public.parent_chat_sync_type_rules() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare room_record record;
begin
  if old.chat_group is not distinct from new.chat_group then return new; end if;
  for room_record in
    select room.id from public.parent_chat_rooms room
    where room.club_id = new.club_id
      and room.team_id in (select distinct player.team_id from public.players player
        where player.club_id = new.club_id and player.section = new.name)
      and room.room_type in ('team', 'team_training', 'team_match')
  loop
    perform public.parent_chat_reconcile_room(room_record.id);
  end loop;
  return new;
end;
$function$;
revoke all on function public.parent_chat_sync_type_rules() from public, anon, authenticated;
create trigger parent_chat_sync_type_rules_after_update
  after update of chat_group on public.club_player_types
  for each row execute function public.parent_chat_sync_type_rules();

-- The two season-report functions have extensive existing aggregation logic.
-- Replace only their player scope, retaining their date and permission rules.
do $migration$
declare function_name text; function_sql text;
begin
  foreach function_name in array array[
    'public.get_end_season_stats(uuid)',
    'app_private.end_season_stats_range(uuid,date,date)'
  ] loop
    select pg_get_functiondef(function_name::regprocedure) into function_sql;
    if position($find$(player.section='Squad' or (player.section='Trial' and public.can_use_plan_feature(player.club_id,'trialPlayers')))$find$ in function_sql) = 0 then
      raise exception 'Season-report player scope changed in %; review this migration.', function_name;
    end if;
    function_sql := replace(function_sql,
      $find$(player.section='Squad' or (player.section='Trial' and public.can_use_plan_feature(player.club_id,'trialPlayers')))$find$,
      $replace$(player.section <> 'Trial' or public.can_use_plan_feature(player.club_id,'trialPlayers'))
        and exists (select 1 from public.club_player_types player_type
          where player_type.club_id = player.club_id and player_type.name = player.section
            and (player_type.can_friendly or player_type.can_cup or player_type.can_league))$replace$);
    execute function_sql;
  end loop;
end;
$migration$;
