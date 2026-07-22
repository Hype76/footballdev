-- FP-V1-GAMEDAY-EXTENDED-OPS-12A
-- Adds explicit match conclusion rules, extra-time phases, penalty-goal
-- classification, and a shootout ledger that never changes regulation goals.

alter table public.match_days
  add column if not exists match_conclusion_rule text not null default 'normal_time',
  add column if not exists current_match_phase text not null default 'pre_match',
  add column if not exists extra_time_half_minutes integer not null default 15,
  add column if not exists extra_time_period_count integer not null default 2,
  add column if not exists normal_time_home_score integer,
  add column if not exists normal_time_away_score integer,
  add column if not exists extra_time_home_score integer,
  add column if not exists extra_time_away_score integer,
  add column if not exists home_shootout_score integer not null default 0,
  add column if not exists away_shootout_score integer not null default 0,
  add column if not exists shootout_winner text;

update public.match_days
set current_match_phase = case status
  when 'live' then 'first_half'
  when 'half_time' then 'half_time'
  when 'second_half' then 'second_half'
  when 'extra_time' then 'extra_time_first_half'
  when 'penalties' then 'penalties'
  when 'full_time' then 'full_time'
  else 'pre_match'
end
where current_match_phase = 'pre_match'
  and deleted_at is null
  and status not in ('scheduled', 'scorer_request', 'postponed', 'cancelled');

alter table public.match_days
  drop constraint if exists match_days_conclusion_rule_check,
  drop constraint if exists match_days_current_phase_check,
  drop constraint if exists match_days_extra_time_half_minutes_check,
  drop constraint if exists match_days_extra_time_period_count_check,
  drop constraint if exists match_days_phase_score_snapshots_check,
  drop constraint if exists match_days_shootout_score_check,
  drop constraint if exists match_days_shootout_winner_check;

alter table public.match_days
  add constraint match_days_conclusion_rule_check check (
    match_conclusion_rule in ('normal_time', 'extra_time', 'extra_time_then_penalties', 'straight_to_penalties')
  ),
  add constraint match_days_current_phase_check check (
    current_match_phase in (
      'pre_match', 'first_half', 'half_time', 'second_half', 'normal_time_complete',
      'extra_time_first_half', 'extra_time_half_time', 'extra_time_second_half',
      'extra_time_complete', 'penalties', 'full_time'
    )
  ),
  add constraint match_days_extra_time_half_minutes_check check (
    extra_time_half_minutes between 5 and 30
  ),
  add constraint match_days_extra_time_period_count_check check (
    extra_time_period_count in (1, 2)
  ),
  add constraint match_days_phase_score_snapshots_check check (
    (normal_time_home_score is null or normal_time_home_score >= 0)
    and (normal_time_away_score is null or normal_time_away_score >= 0)
    and (extra_time_home_score is null or extra_time_home_score >= 0)
    and (extra_time_away_score is null or extra_time_away_score >= 0)
  ),
  add constraint match_days_shootout_score_check check (
    home_shootout_score >= 0 and away_shootout_score >= 0
  ),
  add constraint match_days_shootout_winner_check check (
    shootout_winner is null or shootout_winner in ('home', 'away')
  );

comment on column public.match_days.match_conclusion_rule is
  'Authoritative normal-time, extra-time, and penalty-shootout route for this fixture.';
comment on column public.match_days.current_match_phase is
  'Explicit phase within the configured Match Day conclusion route.';
comment on column public.match_days.extra_time_half_minutes is
  'Configured length of each extra-time period. Regulation duration remains unchanged.';
comment on column public.match_days.extra_time_period_count is
  'Configured number of extra-time periods. One or two periods are supported.';
comment on column public.match_days.normal_time_home_score is
  'Home score snapshot when normal time finishes.';
comment on column public.match_days.normal_time_away_score is
  'Away score snapshot when normal time finishes.';
comment on column public.match_days.extra_time_home_score is
  'Home score snapshot when extra time finishes.';
comment on column public.match_days.extra_time_away_score is
  'Away score snapshot when extra time finishes.';
comment on column public.match_days.home_shootout_score is
  'Penalty shootout score for the home side. Never included in regulation home_score.';
comment on column public.match_days.away_shootout_score is
  'Penalty shootout score for the away side. Never included in regulation away_score.';

create or replace function public.protect_match_day_regulation_score_during_shootout()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.current_match_phase = 'penalties'
    and (new.home_score is distinct from old.home_score or new.away_score is distinct from old.away_score) then
    raise exception 'Regulation score cannot change during a penalty shootout.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_match_day_regulation_score_during_shootout_trigger on public.match_days;
create trigger protect_match_day_regulation_score_during_shootout_trigger
before update of home_score, away_score on public.match_days
for each row execute function public.protect_match_day_regulation_score_during_shootout();

revoke all on function public.protect_match_day_regulation_score_during_shootout() from public, anon, authenticated;
grant execute on function public.protect_match_day_regulation_score_during_shootout() to service_role;

create or replace function public.match_day_phase_order(phase_value text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case lower(trim(coalesce(phase_value, '')))
    when 'pre_match' then 0
    when 'first_half' then 10
    when 'half_time' then 20
    when 'second_half' then 30
    when 'normal_time_complete' then 40
    when 'extra_time_first_half' then 50
    when 'extra_time_half_time' then 60
    when 'extra_time_second_half' then 70
    when 'extra_time_complete' then 75
    when 'penalties' then 80
    when 'full_time' then 90
    else 0
  end;
$$;

revoke all on function public.match_day_phase_order(text) from public, anon;
grant execute on function public.match_day_phase_order(text) to authenticated, service_role;

create sequence if not exists public.match_day_event_sequence_seq;
revoke all on sequence public.match_day_event_sequence_seq from public, anon, authenticated;
grant usage, select on sequence public.match_day_event_sequence_seq to authenticated, service_role;

alter table public.match_day_events
  add column if not exists is_penalty_goal boolean not null default false,
  add column if not exists match_phase text not null default 'pre_match',
  add column if not exists phase_order integer not null default 0,
  add column if not exists stoppage_minute integer,
  add column if not exists event_sequence bigint not null default nextval('public.match_day_event_sequence_seq');

alter table public.match_day_events
  drop constraint if exists match_day_events_match_phase_check,
  drop constraint if exists match_day_events_phase_order_check,
  drop constraint if exists match_day_events_stoppage_minute_check;

alter table public.match_day_events
  add constraint match_day_events_match_phase_check check (
    match_phase in (
      'pre_match', 'first_half', 'half_time', 'second_half', 'normal_time_complete',
      'extra_time_first_half', 'extra_time_half_time', 'extra_time_second_half',
      'extra_time_complete', 'penalties', 'full_time'
    )
  ),
  add constraint match_day_events_phase_order_check check (phase_order between 0 and 100),
  add constraint match_day_events_stoppage_minute_check check (
    stoppage_minute is null or stoppage_minute between 0 and 30
  );

create or replace function public.set_match_day_event_extended_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_phase text;
begin
  if new.event_sequence is null or new.event_sequence <= 0 then
    new.event_sequence := nextval('public.match_day_event_sequence_seq');
  end if;

  select match_day.current_match_phase
  into resolved_phase
  from public.match_days match_day
  where match_day.id = new.match_day_id;

  new.match_phase := coalesce(nullif(resolved_phase, ''), 'pre_match');
  if new.match_phase = 'penalties' and new.event_type = 'goal' then
    raise exception 'Use the penalty shootout ledger instead of a normal goal during the shootout.' using errcode = '22023';
  end if;

  new.phase_order := public.match_day_phase_order(new.match_phase);
  new.stoppage_minute := case when new.stoppage_minute is null then null else greatest(new.stoppage_minute, 0) end;
  return new;
end;
$$;

revoke all on function public.set_match_day_event_extended_context() from public, anon, authenticated, service_role;

drop trigger if exists set_match_day_event_extended_context on public.match_day_events;
create trigger set_match_day_event_extended_context
before insert on public.match_day_events
for each row execute function public.set_match_day_event_extended_context();

create table if not exists public.match_day_shootout_kicks (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null references public.match_days (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  team_side text not null,
  outcome text not null,
  kick_number integer not null,
  player_name text not null default '',
  notes text not null default '',
  home_shootout_score integer not null default 0,
  away_shootout_score integer not null default 0,
  event_status text not null default 'active',
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  voided_by_name text not null default '',
  void_reason text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_by_parent_link_id uuid references public.parent_player_links (id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  constraint match_day_shootout_kicks_team_side_check check (team_side in ('club', 'opponent')),
  constraint match_day_shootout_kicks_outcome_check check (outcome in ('scored', 'missed')),
  constraint match_day_shootout_kicks_number_check check (kick_number > 0),
  constraint match_day_shootout_kicks_score_check check (home_shootout_score >= 0 and away_shootout_score >= 0),
  constraint match_day_shootout_kicks_event_status_check check (event_status in ('active', 'voided')),
  constraint match_day_shootout_kicks_player_name_length_check check (char_length(player_name) <= 160),
  constraint match_day_shootout_kicks_notes_length_check check (char_length(notes) <= 240)
);

create index if not exists match_day_shootout_kicks_match_order_idx
on public.match_day_shootout_kicks (match_day_id, created_at, id);

alter table public.match_day_shootout_kicks enable row level security;
revoke all on public.match_day_shootout_kicks from public, anon, authenticated;
grant select on public.match_day_shootout_kicks to authenticated;
grant all on public.match_day_shootout_kicks to service_role;

drop policy if exists match_day_shootout_kicks_staff_select_scoped on public.match_day_shootout_kicks;
create policy match_day_shootout_kicks_staff_select_scoped
on public.match_day_shootout_kicks
for select
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.can_read_match_day(team_id)
);

create or replace function public.match_day_shootout_can_finish(match_day_id_value uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  with summary as (
    select
      count(*) filter (where kick.team_side = 'club')::integer as club_kicks,
      count(*) filter (where kick.team_side = 'opponent')::integer as opponent_kicks,
      count(*) filter (where kick.team_side = 'club' and kick.outcome = 'scored')::integer as club_goals,
      count(*) filter (where kick.team_side = 'opponent' and kick.outcome = 'scored')::integer as opponent_goals
    from public.match_day_shootout_kicks kick
    where kick.match_day_id = match_day_id_value
      and kick.event_status = 'active'
  )
  select case
    when club_kicks < 5 or opponent_kicks < 5 then
      club_goals > opponent_goals + greatest(5 - opponent_kicks, 0)
      or opponent_goals > club_goals + greatest(5 - club_kicks, 0)
    else club_kicks = opponent_kicks and club_goals <> opponent_goals
  end
  from summary;
$$;

revoke all on function public.match_day_shootout_can_finish(uuid) from public, anon, authenticated;
grant execute on function public.match_day_shootout_can_finish(uuid) to service_role;

create or replace function public.set_match_day_extended_state(
  match_day_id_value uuid,
  action_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  updated_match_row public.match_days%rowtype;
  actor_user_id uuid := auth.uid();
  actor_name text := '';
  actor_role text := '';
  actor_parent_link_id uuid;
  normalized_action text := lower(trim(coalesce(action_value, '')));
  is_staff_actor boolean := false;
  is_scorer_actor boolean := false;
  now_value timestamptz := now();
  effective_elapsed_seconds integer := 0;
  next_status text;
  next_phase text;
  next_timer_status text;
  next_timer_started_at timestamptz;
  next_timer_paused_at timestamptz;
  next_timer_elapsed_seconds integer;
begin
  if actor_user_id is null then
    raise exception 'Login is required before controlling extended match operations.';
  end if;

  if normalized_action not in (
    'normal_time_complete', 'start_extra_time', 'extra_time_half_time',
    'start_extra_time_second_half', 'complete_extra_time', 'start_penalties'
  ) then
    raise exception 'Choose a supported extended match action.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if match_row.concluded_at is not null then
    raise exception 'A concluded match cannot be changed.';
  end if;

  is_staff_actor := public.can_manage_match_day(match_row.team_id)
    and (public.current_user_role() = 'super_admin' or match_row.club_id = public.current_user_club_id());
  is_scorer_actor := public.current_user_is_match_day_scorer(match_row.id);

  if not is_staff_actor and not is_scorer_actor then
    raise exception 'Current coach, manager, or selected scorer access is required for extended match operations.';
  end if;

  if is_scorer_actor then
    select assignment.parent_link_id
    into actor_parent_link_id
    from public.match_day_role_assignments assignment
    where assignment.match_day_id = match_row.id
      and assignment.role = 'scorer'
      and assignment.auth_user_id = actor_user_id
      and assignment.club_id = match_row.club_id
      and assignment.team_id = match_row.team_id
    limit 1;
    actor_role := 'scorer_parent';
  else
    actor_role := coalesce(nullif(public.current_user_role(), ''), 'staff');
  end if;

  actor_name := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), 'Match Day operator');
  effective_elapsed_seconds := greatest(coalesce(match_row.timer_elapsed_seconds, 0), 0);
  if match_row.timer_status = 'running' then
    effective_elapsed_seconds := effective_elapsed_seconds + greatest(
      floor(extract(epoch from (now_value - coalesce(match_row.timer_started_at, match_row.phase_started_at, now_value))))::integer,
      0
    );
  end if;

  next_status := match_row.status;
  next_phase := match_row.current_match_phase;
  next_timer_status := match_row.timer_status;
  next_timer_started_at := match_row.timer_started_at;
  next_timer_paused_at := match_row.timer_paused_at;
  next_timer_elapsed_seconds := greatest(coalesce(match_row.timer_elapsed_seconds, 0), 0);

  if normalized_action = 'normal_time_complete' then
    if match_row.match_conclusion_rule = 'normal_time' then
      raise exception 'This fixture finishes through the Full Time action.';
    end if;
    if match_row.current_match_phase not in ('first_half', 'second_half')
      or match_row.status not in ('live', 'second_half') then
      raise exception 'Normal time can only finish from active regulation play.';
    end if;
    next_phase := 'normal_time_complete';
    next_timer_status := 'paused';
    next_timer_started_at := null;
    next_timer_paused_at := now_value;
    next_timer_elapsed_seconds := effective_elapsed_seconds;
  elsif normalized_action = 'start_extra_time' then
    if match_row.match_conclusion_rule not in ('extra_time', 'extra_time_then_penalties')
      or match_row.current_match_phase <> 'normal_time_complete' then
      raise exception 'Extra time is not available from the current match phase.';
    end if;
    next_status := 'extra_time';
    next_phase := 'extra_time_first_half';
    next_timer_status := 'running';
    next_timer_started_at := now_value;
    next_timer_paused_at := null;
  elsif normalized_action = 'extra_time_half_time' then
    if match_row.extra_time_period_count <> 2
      or match_row.current_match_phase <> 'extra_time_first_half'
      or match_row.status <> 'extra_time'
      or match_row.timer_status not in ('running', 'paused', 'hydration') then
      raise exception 'Extra time half time is not available from the current match phase.';
    end if;
    next_phase := 'extra_time_half_time';
    next_timer_status := 'half_time';
    next_timer_started_at := null;
    next_timer_paused_at := now_value;
    next_timer_elapsed_seconds := effective_elapsed_seconds;
  elsif normalized_action = 'start_extra_time_second_half' then
    if match_row.current_match_phase <> 'extra_time_half_time'
      or match_row.status <> 'extra_time' then
      raise exception 'The second extra-time period is not available from the current match phase.';
    end if;
    next_phase := 'extra_time_second_half';
    next_timer_status := 'running';
    next_timer_started_at := now_value;
    next_timer_paused_at := null;
  elsif normalized_action = 'complete_extra_time' then
    if ((match_row.extra_time_period_count = 1 and match_row.current_match_phase <> 'extra_time_first_half')
      or (match_row.extra_time_period_count = 2 and match_row.current_match_phase <> 'extra_time_second_half'))
      or match_row.status <> 'extra_time'
      or match_row.timer_status not in ('running', 'paused', 'hydration') then
      raise exception 'Extra time can only finish from its configured final period.';
    end if;
    next_phase := 'extra_time_complete';
    next_timer_status := 'paused';
    next_timer_started_at := null;
    next_timer_paused_at := now_value;
    next_timer_elapsed_seconds := effective_elapsed_seconds;
  elsif normalized_action = 'start_penalties' then
    if match_row.match_conclusion_rule = 'straight_to_penalties'
      and match_row.current_match_phase <> 'normal_time_complete' then
      raise exception 'Straight penalties can only start after normal time.';
    elsif match_row.match_conclusion_rule = 'extra_time_then_penalties'
      and match_row.current_match_phase <> 'extra_time_complete' then
      raise exception 'Penalties can only start after extra time.';
    elsif match_row.match_conclusion_rule not in ('straight_to_penalties', 'extra_time_then_penalties') then
      raise exception 'This fixture is not configured for penalties.';
    end if;
    next_status := 'penalties';
    next_phase := 'penalties';
    next_timer_status := 'paused';
    next_timer_started_at := null;
    next_timer_paused_at := coalesce(match_row.timer_paused_at, now_value);
    next_timer_elapsed_seconds := effective_elapsed_seconds;
  end if;

  perform pg_catalog.set_config('app.match_day_lifecycle_authorized', 'true', true);

  update public.match_days
  set status = next_status,
      current_match_phase = next_phase,
      normal_time_home_score = case when normalized_action = 'normal_time_complete' then home_score else normal_time_home_score end,
      normal_time_away_score = case when normalized_action = 'normal_time_complete' then away_score else normal_time_away_score end,
      extra_time_home_score = case when normalized_action = 'complete_extra_time' then home_score else extra_time_home_score end,
      extra_time_away_score = case when normalized_action = 'complete_extra_time' then away_score else extra_time_away_score end,
      phase_started_at = case when next_phase is distinct from match_row.current_match_phase then now_value else phase_started_at end,
      timer_status = next_timer_status,
      timer_started_at = next_timer_started_at,
      timer_paused_at = next_timer_paused_at,
      timer_elapsed_seconds = next_timer_elapsed_seconds,
      updated_at = now_value
  where id = match_row.id
  returning * into updated_match_row;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    updated_match_row.club_id, updated_match_row.team_id, updated_match_row.id,
    actor_user_id, actor_name, actor_role, 'match_day_updated', 'Extended match phase updated',
    jsonb_build_object('status', match_row.status, 'phase', match_row.current_match_phase, 'timerStatus', match_row.timer_status),
    jsonb_build_object('status', updated_match_row.status, 'phase', updated_match_row.current_match_phase, 'timerStatus', updated_match_row.timer_status),
    jsonb_build_object('action', normalized_action, 'parentLinkId', actor_parent_link_id, 'source', 'match_day_extended_state_rpc')
  );

  return jsonb_build_object(
    'id', updated_match_row.id,
    'matchDayId', updated_match_row.id,
    'status', updated_match_row.status,
    'currentMatchPhase', updated_match_row.current_match_phase,
    'conclusionRule', updated_match_row.match_conclusion_rule,
    'extraTimeHalfMinutes', updated_match_row.extra_time_half_minutes,
    'extraTimePeriodCount', updated_match_row.extra_time_period_count,
    'normalTimeHomeScore', updated_match_row.normal_time_home_score,
    'normalTimeAwayScore', updated_match_row.normal_time_away_score,
    'extraTimeHomeScore', updated_match_row.extra_time_home_score,
    'extraTimeAwayScore', updated_match_row.extra_time_away_score,
    'phaseStartedAt', updated_match_row.phase_started_at,
    'timerStartedAt', updated_match_row.timer_started_at,
    'timerPausedAt', updated_match_row.timer_paused_at,
    'timerElapsedSeconds', updated_match_row.timer_elapsed_seconds,
    'timerStatus', updated_match_row.timer_status,
    'homeShootoutScore', updated_match_row.home_shootout_score,
    'awayShootoutScore', updated_match_row.away_shootout_score,
    'shootoutWinner', updated_match_row.shootout_winner,
    'updatedAt', updated_match_row.updated_at
  );
end;
$$;

revoke all on function public.set_match_day_extended_state(uuid, text) from public, anon;
grant execute on function public.set_match_day_extended_state(uuid, text) to authenticated, service_role;

create or replace function public.set_match_day_timer_state(
  match_day_id_value uuid,
  action_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  updated_match_row public.match_days%rowtype;
  timer_result jsonb;
  actor_user_id uuid := auth.uid();
  actor_name text := '';
  actor_role text := '';
  scorer_parent_link_id uuid;
  normalized_action text := lower(trim(coalesce(action_value, '')));
  is_staff_actor boolean := false;
  is_scorer_actor boolean := false;
  next_phase text;
begin
  if actor_user_id is null then
    raise exception 'Login is required before controlling this match clock.';
  end if;

  if normalized_action = 'water_break' then
    normalized_action := 'hydration';
  end if;

  if normalized_action not in ('start', 'pause', 'half_time', 'hydration', 'resume', 'full_time', 'conclude') then
    raise exception 'Choose a supported match clock action.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  is_staff_actor := public.can_manage_match_day(match_row.team_id)
    and (public.current_user_role() = 'super_admin' or match_row.club_id = public.current_user_club_id());
  is_scorer_actor := public.current_user_is_match_day_scorer(match_row.id);

  if not is_staff_actor and not is_scorer_actor then
    if match_row.concluded_at is not null
      and normalized_action = 'conclude'
      and public.current_user_has_match_day_scorer_assignment(match_row.id) then
      is_scorer_actor := true;
    else
      raise exception 'Current coach, manager, or selected scorer access is required to control this match clock.';
    end if;
  end if;

  if is_scorer_actor then
    select assignment.parent_link_id
    into scorer_parent_link_id
    from public.match_day_role_assignments assignment
    where assignment.match_day_id = match_row.id
      and assignment.role = 'scorer'
      and assignment.auth_user_id = actor_user_id
      and assignment.club_id = match_row.club_id
      and assignment.team_id = match_row.team_id
    limit 1;
    actor_role := 'scorer_parent';
  else
    actor_role := coalesce(nullif(public.current_user_role(), ''), 'staff');
  end if;

  actor_name := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), '');

  if match_row.concluded_at is not null and normalized_action = 'conclude' then
    return jsonb_build_object(
      'id', match_row.id, 'matchDayId', match_row.id, 'status', match_row.status,
      'currentMatchPhase', match_row.current_match_phase, 'timerStatus', match_row.timer_status,
      'concludedAt', match_row.concluded_at, 'concludedBy', match_row.concluded_by,
      'alreadyConcluded', true
    );
  end if;

  if normalized_action = 'start'
    and (coalesce(match_row.timer_status, 'not_started') = 'running' or match_row.status in ('live', 'second_half', 'extra_time', 'penalties')) then
    return jsonb_build_object(
      'id', match_row.id, 'matchDayId', match_row.id, 'status', match_row.status,
      'currentMatchPhase', match_row.current_match_phase, 'timerStatus', match_row.timer_status,
      'alreadyStarted', true
    );
  end if;

  if normalized_action = 'full_time' then
    if match_row.match_conclusion_rule = 'extra_time'
      and match_row.current_match_phase <> 'extra_time_complete' then
      raise exception 'Complete both extra-time periods before Full Time.';
    elsif match_row.match_conclusion_rule in ('extra_time_then_penalties', 'straight_to_penalties') then
      if match_row.current_match_phase <> 'penalties'
        or match_row.home_shootout_score = match_row.away_shootout_score
        or not public.match_day_shootout_can_finish(match_row.id) then
        raise exception 'Complete the penalty shootout with a clear winner before Full Time.';
      end if;
    end if;
  end if;

  timer_result := public.apply_match_day_timer_action(
    match_row.id,
    normalized_action,
    actor_user_id,
    actor_name,
    actor_role,
    scorer_parent_link_id
  );

  next_phase := match_row.current_match_phase;
  if normalized_action = 'start' then
    next_phase := 'first_half';
  elsif normalized_action = 'half_time' and match_row.current_match_phase = 'first_half' then
    next_phase := 'half_time';
  elsif normalized_action = 'resume' and match_row.current_match_phase = 'half_time' then
    next_phase := 'second_half';
  elsif normalized_action = 'resume' and match_row.current_match_phase = 'extra_time_half_time' then
    next_phase := 'extra_time_second_half';
  elsif normalized_action = 'resume' and match_row.current_match_phase = 'full_time' then
    next_phase := case match_row.full_time_resume_status
      when 'extra_time' then 'extra_time_second_half'
      when 'penalties' then 'penalties'
      else 'second_half'
    end;
  elsif normalized_action = 'full_time' then
    next_phase := 'full_time';
  end if;

  perform pg_catalog.set_config('app.match_day_lifecycle_authorized', 'true', true);
  update public.match_days
  set current_match_phase = next_phase,
      normal_time_home_score = case
        when normalized_action = 'full_time' and match_conclusion_rule = 'normal_time' then home_score
        else normal_time_home_score
      end,
      normal_time_away_score = case
        when normalized_action = 'full_time' and match_conclusion_rule = 'normal_time' then away_score
        else normal_time_away_score
      end,
      shootout_winner = case
        when normalized_action = 'full_time' and current_match_phase = 'penalties'
          then case when home_shootout_score > away_shootout_score then 'home' else 'away' end
        when normalized_action = 'resume' and next_phase = 'penalties' then null
        else shootout_winner
      end,
      updated_at = case when next_phase is distinct from match_row.current_match_phase then now() else updated_at end
  where id = match_row.id
  returning * into updated_match_row;

  return timer_result || jsonb_build_object(
    'currentMatchPhase', updated_match_row.current_match_phase,
    'conclusionRule', updated_match_row.match_conclusion_rule,
    'extraTimeHalfMinutes', updated_match_row.extra_time_half_minutes,
    'extraTimePeriodCount', updated_match_row.extra_time_period_count,
    'normalTimeHomeScore', updated_match_row.normal_time_home_score,
    'normalTimeAwayScore', updated_match_row.normal_time_away_score,
    'extraTimeHomeScore', updated_match_row.extra_time_home_score,
    'extraTimeAwayScore', updated_match_row.extra_time_away_score,
    'homeShootoutScore', updated_match_row.home_shootout_score,
    'awayShootoutScore', updated_match_row.away_shootout_score,
    'shootoutWinner', updated_match_row.shootout_winner
  );
end;
$$;

revoke all on function public.set_match_day_timer_state(uuid, text) from public, anon;
grant execute on function public.set_match_day_timer_state(uuid, text) to authenticated, service_role;

create or replace function public.record_match_day_shootout_kick(
  match_day_id_value uuid,
  team_side_value text,
  outcome_value text,
  player_name_value text default '',
  notes_value text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  kick_row public.match_day_shootout_kicks%rowtype;
  actor_user_id uuid := auth.uid();
  actor_name text := '';
  actor_role text := '';
  actor_parent_link_id uuid;
  normalized_team_side text := lower(trim(coalesce(team_side_value, '')));
  normalized_outcome text := lower(trim(coalesce(outcome_value, '')));
  normalized_player_name text := trim(coalesce(player_name_value, ''));
  normalized_notes text := trim(coalesce(notes_value, ''));
  next_home_score integer;
  next_away_score integer;
  next_kick_number integer;
  is_staff_actor boolean := false;
  is_scorer_actor boolean := false;
begin
  if actor_user_id is null then
    raise exception 'Login is required before recording a shootout kick.';
  end if;
  if normalized_team_side not in ('club', 'opponent') then
    raise exception 'Choose our team or the opponent for this shootout kick.';
  end if;
  if normalized_outcome not in ('scored', 'missed') then
    raise exception 'Choose scored or missed for this shootout kick.';
  end if;
  if char_length(normalized_player_name) > 160 or char_length(normalized_notes) > 240 then
    raise exception 'Keep the shootout player and note details concise.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;
  if match_row.concluded_at is not null or match_row.current_match_phase <> 'penalties' or match_row.status <> 'penalties' then
    raise exception 'Shootout kicks can only be recorded during the active penalty shootout.';
  end if;
  if public.match_day_shootout_can_finish(match_row.id) then
    raise exception 'The penalty shootout already has a decisive result.';
  end if;

  is_staff_actor := public.can_manage_match_day(match_row.team_id)
    and (public.current_user_role() = 'super_admin' or match_row.club_id = public.current_user_club_id());
  is_scorer_actor := public.current_user_is_match_day_scorer(match_row.id);
  if not is_staff_actor and not is_scorer_actor then
    raise exception 'Current coach, manager, or selected scorer access is required to record a shootout kick.';
  end if;

  if is_scorer_actor then
    select assignment.parent_link_id
    into actor_parent_link_id
    from public.match_day_role_assignments assignment
    where assignment.match_day_id = match_row.id
      and assignment.role = 'scorer'
      and assignment.auth_user_id = actor_user_id
      and assignment.club_id = match_row.club_id
      and assignment.team_id = match_row.team_id
    limit 1;
    actor_role := 'scorer_parent';
  else
    actor_role := coalesce(nullif(public.current_user_role(), ''), 'staff');
  end if;

  actor_name := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), 'Match Day operator');
  next_home_score := match_row.home_shootout_score;
  next_away_score := match_row.away_shootout_score;

  if normalized_outcome = 'scored' then
    if (normalized_team_side = 'club' and match_row.home_away <> 'away')
      or (normalized_team_side = 'opponent' and match_row.home_away = 'away') then
      next_home_score := next_home_score + 1;
    else
      next_away_score := next_away_score + 1;
    end if;
  end if;

  select count(*)::integer + 1
  into next_kick_number
  from public.match_day_shootout_kicks kick
  where kick.match_day_id = match_row.id
    and kick.team_side = normalized_team_side
    and kick.event_status = 'active';

  insert into public.match_day_shootout_kicks (
    match_day_id, club_id, team_id, team_side, outcome, kick_number,
    player_name, notes, home_shootout_score, away_shootout_score,
    created_by, created_by_parent_link_id, created_by_name
  ) values (
    match_row.id, match_row.club_id, match_row.team_id, normalized_team_side, normalized_outcome,
    next_kick_number, normalized_player_name, normalized_notes, next_home_score, next_away_score,
    actor_user_id, actor_parent_link_id, actor_name
  ) returning * into kick_row;

  update public.match_days
  set home_shootout_score = next_home_score,
      away_shootout_score = next_away_score,
      shootout_winner = null,
      updated_at = now()
  where id = match_row.id;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id, match_row.team_id, match_row.id, actor_user_id, actor_name,
    actor_role, 'match_day_updated', 'Shootout kick recorded',
    jsonb_build_object('homeShootoutScore', match_row.home_shootout_score, 'awayShootoutScore', match_row.away_shootout_score),
    jsonb_build_object('homeShootoutScore', next_home_score, 'awayShootoutScore', next_away_score),
    jsonb_build_object('shootoutKickId', kick_row.id, 'teamSide', normalized_team_side, 'outcome', normalized_outcome, 'source', 'match_day_shootout_rpc')
  );

  return jsonb_build_object(
    'id', kick_row.id,
    'matchDayId', kick_row.match_day_id,
    'teamSide', kick_row.team_side,
    'outcome', kick_row.outcome,
    'kickNumber', kick_row.kick_number,
    'playerName', kick_row.player_name,
    'notes', kick_row.notes,
    'homeShootoutScore', next_home_score,
    'awayShootoutScore', next_away_score,
    'createdByName', kick_row.created_by_name,
    'createdAt', kick_row.created_at
  );
end;
$$;

revoke all on function public.record_match_day_shootout_kick(uuid, text, text, text, text) from public, anon;
grant execute on function public.record_match_day_shootout_kick(uuid, text, text, text, text) to authenticated, service_role;

create or replace function public.void_match_day_shootout_kick(
  match_day_id_value uuid,
  kick_id_value uuid,
  reason_value text default 'Corrected shootout kick'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  kick_row public.match_day_shootout_kicks%rowtype;
  actor_user_id uuid := auth.uid();
  actor_name text := '';
  actor_role text := '';
  actor_parent_link_id uuid;
  normalized_reason text := trim(coalesce(reason_value, ''));
  club_goals integer := 0;
  opponent_goals integer := 0;
  next_home_score integer := 0;
  next_away_score integer := 0;
  is_staff_actor boolean := false;
  is_scorer_actor boolean := false;
begin
  if actor_user_id is null then
    raise exception 'Login is required before correcting a shootout kick.';
  end if;
  if normalized_reason = '' or char_length(normalized_reason) > 240 then
    raise exception 'Add a concise correction reason.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;
  if match_row.concluded_at is not null or match_row.current_match_phase <> 'penalties' then
    raise exception 'Shootout kicks can only be corrected during the active shootout.';
  end if;

  select * into kick_row
  from public.match_day_shootout_kicks
  where id = kick_id_value
    and match_day_id = match_row.id
  for update;

  if kick_row.id is null or kick_row.event_status <> 'active' then
    raise exception 'This active shootout kick could not be found.';
  end if;
  if exists (
    select 1
    from public.match_day_shootout_kicks later_kick
    where later_kick.match_day_id = match_row.id
      and later_kick.event_status = 'active'
      and (later_kick.created_at, later_kick.id) > (kick_row.created_at, kick_row.id)
  ) then
    raise exception 'Only the latest active shootout kick can be corrected.';
  end if;

  is_staff_actor := public.can_manage_match_day(match_row.team_id)
    and (public.current_user_role() = 'super_admin' or match_row.club_id = public.current_user_club_id());
  is_scorer_actor := public.current_user_is_match_day_scorer(match_row.id);
  if not is_staff_actor and not is_scorer_actor then
    raise exception 'Current coach, manager, or selected scorer access is required to correct a shootout kick.';
  end if;

  if is_scorer_actor then
    select assignment.parent_link_id
    into actor_parent_link_id
    from public.match_day_role_assignments assignment
    where assignment.match_day_id = match_row.id
      and assignment.role = 'scorer'
      and assignment.auth_user_id = actor_user_id
      and assignment.club_id = match_row.club_id
      and assignment.team_id = match_row.team_id
    limit 1;
    actor_role := 'scorer_parent';
  else
    actor_role := coalesce(nullif(public.current_user_role(), ''), 'staff');
  end if;

  actor_name := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), 'Match Day operator');

  update public.match_day_shootout_kicks
  set event_status = 'voided',
      voided_at = now(),
      voided_by = actor_user_id,
      voided_by_name = actor_name,
      void_reason = normalized_reason
  where id = kick_row.id;

  select
    count(*) filter (where kick.team_side = 'club' and kick.outcome = 'scored')::integer,
    count(*) filter (where kick.team_side = 'opponent' and kick.outcome = 'scored')::integer
  into club_goals, opponent_goals
  from public.match_day_shootout_kicks kick
  where kick.match_day_id = match_row.id
    and kick.event_status = 'active';

  if match_row.home_away = 'away' then
    next_home_score := opponent_goals;
    next_away_score := club_goals;
  else
    next_home_score := club_goals;
    next_away_score := opponent_goals;
  end if;

  update public.match_days
  set home_shootout_score = next_home_score,
      away_shootout_score = next_away_score,
      shootout_winner = null,
      updated_at = now()
  where id = match_row.id;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id, match_row.team_id, match_row.id, actor_user_id, actor_name,
    actor_role, 'match_day_updated', 'Shootout kick voided',
    jsonb_build_object('homeShootoutScore', match_row.home_shootout_score, 'awayShootoutScore', match_row.away_shootout_score),
    jsonb_build_object('homeShootoutScore', next_home_score, 'awayShootoutScore', next_away_score),
    jsonb_build_object('shootoutKickId', kick_row.id, 'reason', normalized_reason, 'parentLinkId', actor_parent_link_id, 'source', 'match_day_shootout_void_rpc')
  );

  return jsonb_build_object(
    'id', kick_row.id,
    'matchDayId', match_row.id,
    'eventStatus', 'voided',
    'voidReason', normalized_reason,
    'homeShootoutScore', next_home_score,
    'awayShootoutScore', next_away_score
  );
end;
$$;

revoke all on function public.void_match_day_shootout_kick(uuid, uuid, text) from public, anon;
grant execute on function public.void_match_day_shootout_kick(uuid, uuid, text) to authenticated, service_role;

create or replace function public.add_match_day_goal_as_scorer(
  parent_link_id_value uuid,
  match_day_id_value uuid,
  team_side_value text,
  scorer_name_value text,
  scorer_shirt_number_value text,
  assist_name_value text,
  assist_shirt_number_value text,
  minute_value integer,
  notes_value text,
  is_penalty_goal_value boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id_value uuid;
  match_phase_value text;
begin
  event_id_value := public.add_match_day_goal_as_scorer(
    parent_link_id_value,
    match_day_id_value,
    team_side_value,
    scorer_name_value,
    scorer_shirt_number_value,
    assist_name_value,
    assist_shirt_number_value,
    minute_value,
    notes_value
  );

  select match_day.current_match_phase
  into match_phase_value
  from public.match_days match_day
  where match_day.id = match_day_id_value;

  update public.match_day_events
  set is_penalty_goal = coalesce(is_penalty_goal_value, false),
      match_phase = coalesce(nullif(match_phase_value, ''), match_phase),
      phase_order = public.match_day_phase_order(coalesce(nullif(match_phase_value, ''), match_phase))
  where id = event_id_value
    and match_day_id = match_day_id_value
    and event_type = 'goal';

  return event_id_value;
end;
$$;

revoke all on function public.add_match_day_goal_as_scorer(uuid, uuid, text, text, text, text, text, integer, text, boolean) from public, anon;
grant execute on function public.add_match_day_goal_as_scorer(uuid, uuid, text, text, text, text, text, integer, text, boolean) to authenticated, service_role;

create or replace function public.get_parent_portal_match_day_extended_state(parent_link_id_value uuid)
returns table (
  match_day_id uuid,
  match_conclusion_rule text,
  current_match_phase text,
  extra_time_half_minutes integer,
  extra_time_period_count integer,
  normal_time_home_score integer,
  normal_time_away_score integer,
  extra_time_home_score integer,
  extra_time_away_score integer,
  home_shootout_score integer,
  away_shootout_score integer,
  shootout_winner text,
  shootout_events jsonb,
  event_contexts jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    visible.id,
    match_day.match_conclusion_rule,
    match_day.current_match_phase,
    match_day.extra_time_half_minutes,
    match_day.extra_time_period_count,
    match_day.normal_time_home_score,
    match_day.normal_time_away_score,
    match_day.extra_time_home_score,
    match_day.extra_time_away_score,
    match_day.home_shootout_score,
    match_day.away_shootout_score,
    match_day.shootout_winner,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', kick.id,
        'matchDayId', kick.match_day_id,
        'teamSide', kick.team_side,
        'outcome', kick.outcome,
        'kickNumber', kick.kick_number,
        'playerName', kick.player_name,
        'notes', kick.notes,
        'eventStatus', kick.event_status,
        'voidedAt', kick.voided_at,
        'voidedByName', kick.voided_by_name,
        'voidReason', kick.void_reason,
        'homeShootoutScore', kick.home_shootout_score,
        'awayShootoutScore', kick.away_shootout_score,
        'createdAt', kick.created_at
      ) order by kick.created_at, kick.id)
      from public.match_day_shootout_kicks kick
      where kick.match_day_id = match_day.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event.id,
        'isPenaltyGoal', event.is_penalty_goal,
        'matchPhase', event.match_phase,
        'phaseOrder', event.phase_order,
        'stoppageMinute', event.stoppage_minute,
        'eventSequence', event.event_sequence
      ))
      from public.match_day_events event
      where event.match_day_id = match_day.id
    ), '[]'::jsonb)
  from public.get_parent_portal_match_days(parent_link_id_value) visible
  join public.match_days match_day on match_day.id = visible.id
  where match_day.deleted_at is null;
$$;

revoke all on function public.get_parent_portal_match_day_extended_state(uuid) from public, anon;
grant execute on function public.get_parent_portal_match_day_extended_state(uuid) to authenticated, service_role;

comment on function public.set_match_day_extended_state(uuid, text) is
  'Scoped staff and accepted-scorer state machine for normal-time completion, explicit extra-time periods, and penalty-shootout entry.';
comment on function public.record_match_day_shootout_kick(uuid, text, text, text, text) is
  'Records one authorised shootout kick in a separate ledger and updates only shootout scores.';
comment on function public.get_parent_portal_match_day_extended_state(uuid) is
  'Returns extended match state only for fixtures already authorised by the parent portal match feed.';
