alter table public.clubs
  add column if not exists timezone_name text not null default 'Europe/London';

comment on column public.clubs.timezone_name is
  'IANA timezone used for server-authoritative fixture-date boundaries.';

alter table public.match_day_events
  add column if not exists request_id uuid;

create unique index if not exists match_day_events_match_request_key
on public.match_day_events (match_day_id, request_id)
where request_id is not null;

comment on column public.match_day_events.request_id is
  'Client-generated idempotency key for transactional Match Day writes.';

create unique index if not exists match_day_scorer_assignments_match_key
on public.match_day_scorer_assignments (match_day_id);

create table if not exists public.match_day_push_operations (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null references public.match_days (id) on delete cascade,
  operation_key text not null,
  notification_type text not null,
  event_id uuid references public.match_day_events (id) on delete set null,
  actor_user_id uuid references auth.users (id) on delete set null,
  status text not null default 'processing',
  last_error text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  constraint match_day_push_operations_key_length_check check (
    char_length(operation_key) between 1 and 240
  ),
  constraint match_day_push_operations_status_check check (
    status in ('processing', 'completed', 'failed')
  )
);

create unique index if not exists match_day_push_operations_operation_key_key
on public.match_day_push_operations (operation_key);

create index if not exists match_day_push_operations_match_created_idx
on public.match_day_push_operations (match_day_id, created_at desc);

alter table public.match_day_push_operations enable row level security;
alter table public.match_day_push_operations force row level security;
revoke all on public.match_day_push_operations from public, anon, authenticated;
grant all on public.match_day_push_operations to service_role;

create or replace function public.match_day_local_date_is_today(
  target_match_day_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.match_days match_day
    join public.clubs club on club.id = match_day.club_id
    where match_day.id = target_match_day_id
      and match_day.match_date is not null
      and match_day.match_date = timezone(
        coalesce(nullif(trim(club.timezone_name), ''), 'Europe/London'),
        statement_timestamp()
      )::date
  );
$$;

revoke all on function public.match_day_local_date_is_today(uuid) from public, anon, authenticated;
grant execute on function public.match_day_local_date_is_today(uuid) to service_role;

create or replace function public.current_user_is_match_day_scorer(
  target_match_day_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_user_has_match_day_scorer_assignment(target_match_day_id)
    and public.match_day_local_date_is_today(target_match_day_id)
    and exists (
      select 1
      from public.match_days match_day
      where match_day.id = target_match_day_id
        and match_day.deleted_at is null
        and match_day.concluded_at is null
        and match_day.status not in ('cancelled', 'postponed')
    );
$$;

revoke all on function public.current_user_is_match_day_scorer(uuid) from public, anon;
grant execute on function public.current_user_is_match_day_scorer(uuid) to authenticated, service_role;

comment on function public.current_user_is_match_day_scorer(uuid) is
  'Canonical mutable parent scorer authority. Exact dual assignment, active parent scope, open lifecycle, and the fixture local date are all required.';

create or replace function public.get_parent_scorer_game_mode_match_ids(
  parent_link_id_value uuid
)
returns table (match_day_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select match_day.id
  from public.match_days match_day
  join public.clubs club on club.id = match_day.club_id
  join public.match_day_role_assignments role_assignment
    on role_assignment.match_day_id = match_day.id
   and role_assignment.role = 'scorer'
   and role_assignment.parent_link_id = parent_link_id_value
   and role_assignment.auth_user_id = (select auth.uid())
   and role_assignment.club_id = match_day.club_id
   and role_assignment.team_id = match_day.team_id
  join public.match_day_scorer_assignments legacy_assignment
    on legacy_assignment.match_day_id = match_day.id
   and legacy_assignment.parent_link_id = role_assignment.parent_link_id
   and legacy_assignment.auth_user_id = role_assignment.auth_user_id
   and legacy_assignment.club_id = role_assignment.club_id
   and legacy_assignment.team_id = role_assignment.team_id
  join public.parent_player_links parent_link
    on parent_link.id = role_assignment.parent_link_id
   and parent_link.auth_user_id = role_assignment.auth_user_id
   and parent_link.club_id = match_day.club_id
   and parent_link.team_id = match_day.team_id
   and parent_link.status = 'active'
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = match_day.club_id
   and player.team_id = match_day.team_id
   and coalesce(player.status, 'active') <> 'archived'
  where match_day.deleted_at is null
    and match_day.concluded_at is null
    and match_day.status not in ('cancelled', 'postponed')
    and match_day.match_date = timezone(
      coalesce(nullif(trim(club.timezone_name), ''), 'Europe/London'),
      statement_timestamp()
    )::date;
$$;

revoke all on function public.get_parent_scorer_game_mode_match_ids(uuid) from public, anon;
grant execute on function public.get_parent_scorer_game_mode_match_ids(uuid) to authenticated, service_role;

create or replace function public.enforce_match_day_gameplay_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  score_changed boolean;
  gameplay_changed boolean;
  direct_lifecycle_change boolean;
begin
  score_changed := new.home_score is distinct from old.home_score
    or new.away_score is distinct from old.away_score
    or new.home_shootout_score is distinct from old.home_shootout_score
    or new.away_shootout_score is distinct from old.away_shootout_score
    or new.shootout_winner is distinct from old.shootout_winner;

  gameplay_changed := score_changed
    or new.phase_started_at is distinct from old.phase_started_at
    or new.timer_started_at is distinct from old.timer_started_at
    or new.timer_paused_at is distinct from old.timer_paused_at
    or new.timer_elapsed_seconds is distinct from old.timer_elapsed_seconds
    or new.timer_status is distinct from old.timer_status
    or new.full_time_resume_status is distinct from old.full_time_resume_status
    or new.concluded_at is distinct from old.concluded_at
    or new.concluded_by is distinct from old.concluded_by
    or new.current_match_phase is distinct from old.current_match_phase
    or new.normal_time_home_score is distinct from old.normal_time_home_score
    or new.normal_time_away_score is distinct from old.normal_time_away_score
    or new.extra_time_home_score is distinct from old.extra_time_home_score
    or new.extra_time_away_score is distinct from old.extra_time_away_score;

  direct_lifecycle_change := new.status is distinct from old.status
    and not (
      new.status in ('cancelled', 'postponed')
      or (
        old.status in ('scheduled', 'scorer_request')
        and new.status in ('scheduled', 'scorer_request')
      )
    );

  if old.concluded_at is not null and (gameplay_changed or new.status is distinct from old.status) then
    raise exception 'A concluded match is read only.';
  end if;

  if score_changed and (
    coalesce(old.timer_status, 'not_started') = 'not_started'
    or old.status in ('scheduled', 'scorer_request', 'cancelled', 'postponed')
  ) then
    raise exception 'Start the match before changing the score.';
  end if;

  if current_user in ('anon', 'authenticated')
    and (gameplay_changed or direct_lifecycle_change) then
    raise exception 'Use an authorised Match Day action for live score, phase, or clock changes.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_match_day_gameplay_write() from public, anon, authenticated;

drop trigger if exists match_days_enforce_gameplay_write on public.match_days;
create trigger match_days_enforce_gameplay_write
before update of
  status, home_score, away_score, phase_started_at, timer_started_at,
  timer_paused_at, timer_elapsed_seconds, timer_status, full_time_resume_status,
  concluded_at, concluded_by, current_match_phase, normal_time_home_score,
  normal_time_away_score, extra_time_home_score, extra_time_away_score,
  home_shootout_score, away_shootout_score, shootout_winner
on public.match_days
for each row
execute function public.enforce_match_day_gameplay_write();

create or replace function public.enforce_match_day_event_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  target_match_day_id uuid := coalesce(new.match_day_id, old.match_day_id);
  match_row public.match_days%rowtype;
begin
  select * into match_row
  from public.match_days
  where id = target_match_day_id;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if match_row.concluded_at is not null
    or match_row.status in ('full_time', 'cancelled', 'postponed') then
    raise exception 'Completed or closed matches are read only.';
  end if;

  if coalesce(match_row.timer_status, 'not_started') = 'not_started'
    or match_row.status in ('scheduled', 'scorer_request') then
    raise exception 'Start the match before recording or changing an event.';
  end if;

  if current_user in ('anon', 'authenticated') then
    raise exception 'Use an authorised Match Day action for event changes.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_match_day_event_write() from public, anon, authenticated;

drop trigger if exists match_day_events_enforce_write on public.match_day_events;
create trigger match_day_events_enforce_write
before insert or update or delete on public.match_day_events
for each row
execute function public.enforce_match_day_event_write();

drop policy if exists match_day_events_staff_insert_scoped on public.match_day_events;
drop policy if exists match_day_events_scorer_insert_scoped on public.match_day_events;
revoke insert, update, delete on public.match_day_events from anon, authenticated;
grant select on public.match_day_events to authenticated;
grant all on public.match_day_events to service_role;

create or replace function public.resolve_match_day_mutation_actor(
  match_day_id_value uuid,
  parent_link_id_value uuid default null
)
returns table (
  actor_user_id uuid,
  actor_name text,
  actor_role text,
  actor_parent_link_id uuid
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with candidates as (
    select
      staff_user.id as actor_user_id,
      coalesce(nullif(trim(staff_user.name), ''), staff_user.email, '') as actor_name,
      coalesce(nullif(trim(staff_user.role), ''), 'staff') as actor_role,
      null::uuid as actor_parent_link_id,
      1 as priority
    from public.users staff_user
    join public.match_days match_day on match_day.id = match_day_id_value
    where staff_user.id = (select auth.uid())
      and public.can_manage_match_day(match_day.team_id)

    union all

    select
      parent_link.auth_user_id,
      coalesce(
        nullif(trim(auth.jwt() ->> 'name'), ''),
        nullif(trim(auth.jwt() ->> 'email'), ''),
        parent_link.email,
        ''
      ),
      'scorer_parent',
      parent_link.id,
      2
    from public.match_days match_day
    join public.match_day_role_assignments role_assignment
      on role_assignment.match_day_id = match_day.id
     and role_assignment.role = 'scorer'
     and role_assignment.parent_link_id = parent_link_id_value
     and role_assignment.auth_user_id = (select auth.uid())
     and role_assignment.club_id = match_day.club_id
     and role_assignment.team_id = match_day.team_id
    join public.match_day_scorer_assignments legacy_assignment
      on legacy_assignment.match_day_id = match_day.id
     and legacy_assignment.parent_link_id = role_assignment.parent_link_id
     and legacy_assignment.auth_user_id = role_assignment.auth_user_id
     and legacy_assignment.club_id = role_assignment.club_id
     and legacy_assignment.team_id = role_assignment.team_id
    join public.parent_player_links parent_link
      on parent_link.id = role_assignment.parent_link_id
     and parent_link.auth_user_id = role_assignment.auth_user_id
     and parent_link.status = 'active'
    where match_day.id = match_day_id_value
      and public.current_user_is_match_day_scorer(match_day.id)
  )
  select
    candidates.actor_user_id,
    candidates.actor_name,
    candidates.actor_role,
    candidates.actor_parent_link_id
  from candidates
  order by candidates.priority
  limit 1;
$$;

revoke all on function public.resolve_match_day_mutation_actor(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_match_day_mutation_actor(uuid, uuid) to service_role;

create or replace function public.record_match_day_goal_v2(
  match_day_id_value uuid,
  parent_link_id_value uuid,
  team_side_value text,
  scorer_name_value text,
  scorer_shirt_number_value text,
  assist_name_value text,
  assist_shirt_number_value text,
  minute_value integer,
  notes_value text,
  is_penalty_goal_value boolean,
  request_id_value uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  match_row public.match_days%rowtype;
  actor_record record;
  normalized_team_side text := trim(coalesce(team_side_value, 'club'));
  next_home_score integer;
  next_away_score integer;
  event_row public.match_day_events%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Login is required before adding a goal.';
  end if;

  if request_id_value is null then
    raise exception 'A request id is required before adding a goal.';
  end if;

  if normalized_team_side not in ('club', 'opponent') then
    raise exception 'Choose who scored the goal.';
  end if;

  if minute_value is not null and (minute_value < 0 or minute_value > 130) then
    raise exception 'Minute must be between 0 and 130.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if match_row.concluded_at is not null
    or match_row.status not in ('live', 'half_time', 'second_half', 'extra_time', 'penalties')
    or coalesce(match_row.timer_status, 'not_started') in ('not_started', 'full_time') then
    raise exception 'Start or resume the match before recording a goal.';
  end if;

  select * into actor_record
  from public.resolve_match_day_mutation_actor(match_row.id, parent_link_id_value);

  if actor_record.actor_user_id is null then
    raise exception 'You cannot record goals for this match.';
  end if;

  select * into event_row
  from public.match_day_events
  where match_day_id = match_day_id_value
    and request_id = request_id_value;

  if event_row.id is not null then
    return to_jsonb(event_row);
  end if;

  next_home_score := greatest(coalesce(match_row.home_score, 0), 0);
  next_away_score := greatest(coalesce(match_row.away_score, 0), 0);

  if normalized_team_side = 'club' then
    if match_row.home_away = 'away' then
      next_away_score := next_away_score + 1;
    else
      next_home_score := next_home_score + 1;
    end if;
  elsif match_row.home_away = 'away' then
    next_home_score := next_home_score + 1;
  else
    next_away_score := next_away_score + 1;
  end if;

  update public.match_days
  set home_score = next_home_score,
      away_score = next_away_score,
      updated_at = now()
  where id = match_row.id;

  insert into public.match_day_events (
    match_day_id, club_id, team_id, event_type, team_side, minute,
    scorer_name, scorer_initials, scorer_shirt_number,
    assist_name, assist_initials, assist_shirt_number,
    home_score, away_score, notes, created_by,
    created_by_parent_link_id, created_by_name, is_penalty_goal,
    match_phase, phase_order, request_id
  ) values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    'goal',
    normalized_team_side,
    minute_value,
    trim(coalesce(scorer_name_value, '')),
    public.get_initials_from_full_name(scorer_name_value),
    trim(coalesce(scorer_shirt_number_value, '')),
    trim(coalesce(assist_name_value, '')),
    public.get_initials_from_full_name(assist_name_value),
    trim(coalesce(assist_shirt_number_value, '')),
    next_home_score,
    next_away_score,
    trim(coalesce(notes_value, '')),
    actor_record.actor_user_id,
    actor_record.actor_parent_link_id,
    actor_record.actor_name,
    coalesce(is_penalty_goal_value, false),
    match_row.current_match_phase,
    public.match_day_phase_order(match_row.current_match_phase),
    request_id_value
  )
  returning * into event_row;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id,
    match_row.team_id,
    match_row.id,
    actor_record.actor_user_id,
    actor_record.actor_name,
    actor_record.actor_role,
    'scorer_updated',
    'Goal added',
    jsonb_build_object('homeScore', match_row.home_score, 'awayScore', match_row.away_score),
    jsonb_build_object('homeScore', next_home_score, 'awayScore', next_away_score),
    jsonb_build_object(
      'matchEventId', event_row.id,
      'parentLinkId', actor_record.actor_parent_link_id,
      'requestId', request_id_value,
      'source', 'match_day_goal_v2'
    )
  );

  return to_jsonb(event_row);
end;
$$;

revoke all on function public.record_match_day_goal_v2(uuid, uuid, text, text, text, text, text, integer, text, boolean, uuid) from public, anon;
grant execute on function public.record_match_day_goal_v2(uuid, uuid, text, text, text, text, text, integer, text, boolean, uuid) to authenticated, service_role;

create or replace function public.record_match_day_score_correction_v2(
  match_day_id_value uuid,
  parent_link_id_value uuid,
  home_score_value integer,
  away_score_value integer,
  notes_value text,
  request_id_value uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  match_row public.match_days%rowtype;
  actor_record record;
  next_home_score integer := greatest(coalesce(home_score_value, 0), 0);
  next_away_score integer := greatest(coalesce(away_score_value, 0), 0);
  event_row public.match_day_events%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Login is required before updating the match score.';
  end if;

  if request_id_value is null then
    raise exception 'A request id is required before updating the match score.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if match_row.concluded_at is not null
    or match_row.status not in ('live', 'half_time', 'second_half', 'extra_time', 'penalties')
    or coalesce(match_row.timer_status, 'not_started') in ('not_started', 'full_time') then
    raise exception 'Start or resume the match before correcting the score.';
  end if;

  select * into actor_record
  from public.resolve_match_day_mutation_actor(match_row.id, parent_link_id_value);

  if actor_record.actor_user_id is null then
    raise exception 'You cannot update the score for this match.';
  end if;

  select * into event_row
  from public.match_day_events
  where match_day_id = match_day_id_value
    and request_id = request_id_value;

  if event_row.id is not null then
    return to_jsonb(event_row);
  end if;

  update public.match_days
  set home_score = next_home_score,
      away_score = next_away_score,
      updated_at = now()
  where id = match_row.id;

  insert into public.match_day_events (
    match_day_id, club_id, team_id, event_type, team_side,
    home_score, away_score, notes, created_by,
    created_by_parent_link_id, created_by_name,
    match_phase, phase_order, request_id
  ) values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    'score_correction',
    'club',
    next_home_score,
    next_away_score,
    coalesce(nullif(trim(notes_value), ''), 'Score corrected'),
    actor_record.actor_user_id,
    actor_record.actor_parent_link_id,
    actor_record.actor_name,
    match_row.current_match_phase,
    public.match_day_phase_order(match_row.current_match_phase),
    request_id_value
  )
  returning * into event_row;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id,
    match_row.team_id,
    match_row.id,
    actor_record.actor_user_id,
    actor_record.actor_name,
    actor_record.actor_role,
    'scorer_updated',
    'Score corrected',
    jsonb_build_object('homeScore', match_row.home_score, 'awayScore', match_row.away_score),
    jsonb_build_object('homeScore', next_home_score, 'awayScore', next_away_score),
    jsonb_build_object(
      'matchEventId', event_row.id,
      'parentLinkId', actor_record.actor_parent_link_id,
      'requestId', request_id_value,
      'source', 'match_day_score_correction_v2'
    )
  );

  return to_jsonb(event_row);
end;
$$;

revoke all on function public.record_match_day_score_correction_v2(uuid, uuid, integer, integer, text, uuid) from public, anon;
grant execute on function public.record_match_day_score_correction_v2(uuid, uuid, integer, integer, text, uuid) to authenticated, service_role;

create or replace function public.record_match_day_staff_event_v2(
  match_day_id_value uuid,
  event_type_value text,
  team_side_value text,
  minute_value integer,
  player_name_value text,
  player_shirt_number_value text,
  player_on_name_value text,
  player_on_shirt_number_value text,
  notes_value text,
  request_id_value uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  match_row public.match_days%rowtype;
  staff_user public.users%rowtype;
  normalized_event_type text := trim(coalesce(event_type_value, ''));
  normalized_team_side text := trim(coalesce(team_side_value, 'club'));
  event_row public.match_day_events%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Login is required before adding a match event.';
  end if;

  if request_id_value is null then
    raise exception 'A request id is required before adding a match event.';
  end if;

  if normalized_event_type not in ('yellow_card', 'red_card', 'substitution', 'water_break') then
    raise exception 'Choose a supported Match Day event type.';
  end if;

  if normalized_team_side not in ('club', 'opponent') then
    raise exception 'Choose which team the event belongs to.';
  end if;

  if minute_value is not null and (minute_value < 0 or minute_value > 130) then
    raise exception 'Minute must be between 0 and 130.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if match_row.concluded_at is not null
    or match_row.status not in ('live', 'half_time', 'second_half', 'extra_time', 'penalties')
    or coalesce(match_row.timer_status, 'not_started') in ('not_started', 'full_time') then
    raise exception 'Start or resume the match before recording an event.';
  end if;

  if not public.can_manage_match_day(match_row.team_id) then
    raise exception 'You cannot add events for this match.';
  end if;

  select * into staff_user
  from public.users
  where id = auth.uid();

  select * into event_row
  from public.match_day_events
  where match_day_id = match_day_id_value
    and request_id = request_id_value;

  if event_row.id is not null then
    return to_jsonb(event_row);
  end if;

  insert into public.match_day_events (
    match_day_id, club_id, team_id, event_type, team_side, minute,
    scorer_name, scorer_initials, scorer_shirt_number,
    assist_name, assist_initials, assist_shirt_number,
    home_score, away_score, notes, created_by, created_by_name,
    match_phase, phase_order, request_id
  ) values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    normalized_event_type,
    normalized_team_side,
    minute_value,
    trim(coalesce(player_name_value, '')),
    public.get_initials_from_full_name(player_name_value),
    trim(coalesce(player_shirt_number_value, '')),
    case when normalized_event_type = 'substitution' then trim(coalesce(player_on_name_value, '')) else '' end,
    case when normalized_event_type = 'substitution' then public.get_initials_from_full_name(player_on_name_value) else '' end,
    case when normalized_event_type = 'substitution' then trim(coalesce(player_on_shirt_number_value, '')) else '' end,
    greatest(coalesce(match_row.home_score, 0), 0),
    greatest(coalesce(match_row.away_score, 0), 0),
    trim(coalesce(notes_value, '')),
    staff_user.id,
    coalesce(nullif(trim(staff_user.name), ''), staff_user.email, ''),
    match_row.current_match_phase,
    public.match_day_phase_order(match_row.current_match_phase),
    request_id_value
  )
  returning * into event_row;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id,
    match_row.team_id,
    match_row.id,
    staff_user.id,
    coalesce(nullif(trim(staff_user.name), ''), staff_user.email, ''),
    coalesce(nullif(trim(staff_user.role), ''), 'staff'),
    normalized_event_type,
    initcap(replace(normalized_event_type, '_', ' ')),
    null,
    jsonb_build_object(
      'eventType', normalized_event_type,
      'teamSide', normalized_team_side,
      'minute', minute_value,
      'playerName', trim(coalesce(player_name_value, ''))
    ),
    jsonb_build_object(
      'matchEventId', event_row.id,
      'requestId', request_id_value,
      'source', 'match_day_staff_event_v2'
    )
  );

  return to_jsonb(event_row);
end;
$$;

revoke all on function public.record_match_day_staff_event_v2(uuid, text, text, integer, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.record_match_day_staff_event_v2(uuid, text, text, integer, text, text, text, text, text, uuid) to authenticated, service_role;

create or replace function public.sync_match_day_scorer_assignment(
  match_day_id_value uuid,
  parent_link_id_value uuid,
  assigned_by_value uuid,
  assigned_by_name_value text,
  selected_value boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  match_row public.match_days%rowtype;
  parent_link_row public.parent_player_links%rowtype;
  role_assignment_row public.match_day_role_assignments%rowtype;
begin
  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if match_row.concluded_at is not null
    or match_row.status in ('cancelled', 'postponed', 'full_time') then
    raise exception 'The scorer cannot be changed for a closed match.';
  end if;

  if selected_value is false then
    delete from public.match_day_role_assignments
    where match_day_id = match_row.id
      and role = 'scorer'
      and parent_link_id = parent_link_id_value;

    delete from public.match_day_scorer_assignments
    where match_day_id = match_row.id
      and parent_link_id = parent_link_id_value;

    return jsonb_build_object(
      'matchDayId', match_row.id,
      'parentLinkId', parent_link_id_value,
      'selected', false
    );
  end if;

  select * into parent_link_row
  from public.parent_player_links parent_link
  where parent_link.id = parent_link_id_value
    and parent_link.club_id = match_row.club_id
    and parent_link.team_id = match_row.team_id
    and parent_link.status = 'active'
    and parent_link.auth_user_id is not null
  for update;

  if parent_link_row.id is null then
    raise exception 'Choose an active parent linked to this fixture team.';
  end if;

  insert into public.match_day_role_assignments (
    match_day_id, club_id, team_id, role, parent_link_id, auth_user_id,
    assigned_by, assigned_by_name, created_at, updated_at
  ) values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    'scorer',
    parent_link_row.id,
    parent_link_row.auth_user_id,
    assigned_by_value,
    trim(coalesce(assigned_by_name_value, '')),
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict (match_day_id, role)
  do update set
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    parent_link_id = excluded.parent_link_id,
    auth_user_id = excluded.auth_user_id,
    assigned_by = excluded.assigned_by,
    assigned_by_name = excluded.assigned_by_name,
    updated_at = excluded.updated_at
  returning * into role_assignment_row;

  insert into public.match_day_scorer_assignments (
    match_day_id, club_id, team_id, parent_link_id, auth_user_id,
    assigned_by, assigned_by_name, created_at
  ) values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    parent_link_row.id,
    parent_link_row.auth_user_id,
    assigned_by_value,
    trim(coalesce(assigned_by_name_value, '')),
    timezone('utc', now())
  )
  on conflict (match_day_id)
  do update set
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    parent_link_id = excluded.parent_link_id,
    auth_user_id = excluded.auth_user_id,
    assigned_by = excluded.assigned_by,
    assigned_by_name = excluded.assigned_by_name,
    created_at = excluded.created_at;

  return jsonb_build_object(
    'matchDayId', match_row.id,
    'parentLinkId', parent_link_row.id,
    'authUserId', parent_link_row.auth_user_id,
    'roleAssignmentId', role_assignment_row.id,
    'selected', true,
    'updatedAt', role_assignment_row.updated_at
  );
end;
$$;

revoke all on function public.sync_match_day_scorer_assignment(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.sync_match_day_scorer_assignment(uuid, uuid, uuid, text, boolean) to service_role;

create or replace function public.authorize_match_day_push(
  actor_user_id_value uuid,
  match_day_id_value uuid,
  parent_link_id_value uuid,
  notification_type_value text,
  event_id_value uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  match_row public.match_days%rowtype;
  actor_user public.users%rowtype;
  normalized_type text := trim(coalesce(notification_type_value, ''));
  is_staff_allowed boolean := false;
  is_parent_scorer_allowed boolean := false;
  event_row public.match_day_events%rowtype;
  target_parent_link_ids uuid[] := array[]::uuid[];
  scorer_assignment public.match_day_role_assignments%rowtype;
  operation_key_value text;
begin
  if normalized_type not in (
    'goal', 'score_correction', 'live', 'half_time', 'second_half', 'extra_time',
    'penalties', 'full_time', 'scorer_selected', 'scorer_request'
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'unsupported_type');
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
    and deleted_at is null;

  if match_row.id is null
    or match_row.status in ('cancelled', 'postponed') then
    return jsonb_build_object('allowed', false, 'reason', 'closed_match');
  end if;

  if match_row.concluded_at is not null and normalized_type <> 'full_time' then
    return jsonb_build_object('allowed', false, 'reason', 'concluded_match');
  end if;

  select * into actor_user
  from public.users
  where id = actor_user_id_value;

  is_staff_allowed := actor_user.id is not null
    and actor_user.role <> 'parent_portal'
    and actor_user.club_id = match_row.club_id
    and coalesce(actor_user.role_rank, 0) >= 20
    and (
      actor_user.role = 'super_admin'
      or coalesce(actor_user.role_rank, 0) >= 50
      or exists (
        select 1
        from public.team_staff staff_scope
        where staff_scope.team_id = match_row.team_id
          and staff_scope.user_id = actor_user.id
      )
    );

  is_parent_scorer_allowed := normalized_type in (
      'goal', 'score_correction', 'live', 'half_time', 'second_half',
      'extra_time', 'penalties', 'full_time'
    )
    and exists (
      select 1
      from public.match_day_role_assignments role_assignment
      join public.match_day_scorer_assignments legacy_assignment
        on legacy_assignment.match_day_id = role_assignment.match_day_id
       and legacy_assignment.parent_link_id = role_assignment.parent_link_id
       and legacy_assignment.auth_user_id = role_assignment.auth_user_id
       and legacy_assignment.club_id = role_assignment.club_id
       and legacy_assignment.team_id = role_assignment.team_id
      join public.parent_player_links parent_link
        on parent_link.id = role_assignment.parent_link_id
       and parent_link.auth_user_id = role_assignment.auth_user_id
       and parent_link.club_id = role_assignment.club_id
       and parent_link.team_id = role_assignment.team_id
       and parent_link.status = 'active'
      join public.players player
        on player.id = parent_link.player_id
       and player.club_id = role_assignment.club_id
       and player.team_id = role_assignment.team_id
       and coalesce(player.status, 'active') <> 'archived'
      join public.clubs club on club.id = role_assignment.club_id
      where role_assignment.match_day_id = match_row.id
        and role_assignment.role = 'scorer'
        and role_assignment.parent_link_id = parent_link_id_value
        and role_assignment.auth_user_id = actor_user_id_value
        and match_row.match_date = timezone(
          coalesce(nullif(trim(club.timezone_name), ''), 'Europe/London'),
          statement_timestamp()
        )::date
    );

  if not is_staff_allowed and not is_parent_scorer_allowed then
    return jsonb_build_object('allowed', false, 'reason', 'actor_scope');
  end if;

  if normalized_type in ('goal', 'score_correction') then
    if match_row.status not in ('live', 'half_time', 'second_half', 'extra_time', 'penalties')
      or coalesce(match_row.timer_status, 'not_started') in ('not_started', 'full_time')
      or event_id_value is null then
      return jsonb_build_object('allowed', false, 'reason', 'gameplay_state');
    end if;

    select * into event_row
    from public.match_day_events
    where id = event_id_value
      and match_day_id = match_row.id
      and event_type = normalized_type;

    if event_row.id is null then
      return jsonb_build_object('allowed', false, 'reason', 'event_scope');
    end if;
  elsif normalized_type = 'scorer_request' then
    if match_row.status not in ('scheduled', 'scorer_request')
      or match_row.request_scorer is not true then
      return jsonb_build_object('allowed', false, 'reason', 'request_state');
    end if;
  elsif normalized_type = 'scorer_selected' then
    select * into scorer_assignment
    from public.match_day_role_assignments
    where match_day_id = match_row.id
      and role = 'scorer';

    if scorer_assignment.id is null then
      return jsonb_build_object('allowed', false, 'reason', 'missing_scorer');
    end if;
  elsif normalized_type in ('live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time') then
    if match_row.status <> normalized_type then
      return jsonb_build_object('allowed', false, 'reason', 'lifecycle_state');
    end if;
  end if;

  if normalized_type = 'scorer_selected' then
    target_parent_link_ids := array[scorer_assignment.parent_link_id];
    operation_key_value := concat(
      'match-day:', match_row.id, ':scorer-selected:', scorer_assignment.parent_link_id,
      ':', scorer_assignment.updated_at::text
    );
  else
    select coalesce(array_agg(distinct parent_link.id), array[]::uuid[])
    into target_parent_link_ids
    from public.parent_player_links parent_link
    join public.players player
      on player.id = parent_link.player_id
     and player.club_id = parent_link.club_id
     and player.team_id = parent_link.team_id
     and coalesce(player.status, 'active') <> 'archived'
    where parent_link.club_id = match_row.club_id
      and parent_link.team_id = match_row.team_id
      and parent_link.status = 'active'
      and parent_link.auth_user_id is not null;

    operation_key_value := case
      when event_row.id is not null then
        concat('match-day:', match_row.id, ':', normalized_type, ':', event_row.id)
      else
        concat(
          'match-day:', match_row.id, ':', normalized_type, ':',
          coalesce(match_row.notification_revision, 1), ':',
          coalesce(match_row.current_match_phase, 'pre_match'), ':',
          match_row.updated_at::text
        )
    end;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'targetParentLinkIds', to_jsonb(target_parent_link_ids),
    'operationKey', operation_key_value
  );
end;
$$;

revoke all on function public.authorize_match_day_push(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.authorize_match_day_push(uuid, uuid, uuid, text, uuid) to service_role;

create or replace function public.claim_match_day_push_operation(
  match_day_id_value uuid,
  operation_key_value text,
  notification_type_value text,
  event_id_value uuid,
  actor_user_id_value uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inserted_id uuid;
  existing_status text;
begin
  if match_day_id_value is null
    or nullif(trim(coalesce(operation_key_value, '')), '') is null then
    return false;
  end if;

  insert into public.match_day_push_operations (
    match_day_id, operation_key, notification_type, event_id, actor_user_id
  ) values (
    match_day_id_value,
    trim(operation_key_value),
    trim(coalesce(notification_type_value, '')),
    event_id_value,
    actor_user_id_value
  )
  on conflict (operation_key) do nothing
  returning id into inserted_id;

  if inserted_id is not null then
    return true;
  end if;

  select operation.status
  into existing_status
  from public.match_day_push_operations operation
  where operation.operation_key = trim(operation_key_value)
  for update;

  if existing_status = 'failed' then
    update public.match_day_push_operations
    set status = 'processing',
        last_error = '',
        actor_user_id = actor_user_id_value,
        event_id = event_id_value,
        updated_at = timezone('utc', now()),
        completed_at = null
    where operation_key = trim(operation_key_value);

    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.claim_match_day_push_operation(uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_match_day_push_operation(uuid, text, text, uuid, uuid) to service_role;

create or replace function public.complete_match_day_push_operation(
  operation_key_value text,
  succeeded_value boolean,
  error_message_value text default ''
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.match_day_push_operations
  set status = case when succeeded_value then 'completed' else 'failed' end,
      last_error = case
        when succeeded_value then ''
        else left(trim(coalesce(error_message_value, 'Push delivery failed.')), 500)
      end,
      updated_at = timezone('utc', now()),
      completed_at = case when succeeded_value then timezone('utc', now()) else null end
  where operation_key = trim(coalesce(operation_key_value, ''))
    and status = 'processing';

  return found;
end;
$$;

revoke all on function public.complete_match_day_push_operation(text, boolean, text) from public, anon, authenticated;
grant execute on function public.complete_match_day_push_operation(text, boolean, text) to service_role;
