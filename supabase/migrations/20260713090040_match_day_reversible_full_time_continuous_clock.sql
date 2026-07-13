alter table public.match_days
  add column if not exists match_clock_mode text not null default 'fixed',
  add column if not exists full_time_resume_status text,
  add column if not exists concluded_at timestamptz,
  add column if not exists concluded_by uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'match_days_match_clock_mode_check'
      and conrelid = 'public.match_days'::regclass
  ) then
    alter table public.match_days
      add constraint match_days_match_clock_mode_check
      check (match_clock_mode in ('fixed', 'continuous'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'match_days_full_time_resume_status_check'
      and conrelid = 'public.match_days'::regclass
  ) then
    alter table public.match_days
      add constraint match_days_full_time_resume_status_check
      check (
        full_time_resume_status is null
        or full_time_resume_status in ('live', 'second_half', 'extra_time', 'penalties')
      );
  end if;
end;
$$;

comment on column public.match_days.match_clock_mode is
  'Fixed uses the configured duration and period floor. Continuous counts elapsed time upwards without an automatic endpoint.';
comment on column public.match_days.full_time_resume_status is
  'Authoritative playing status restored when a reversible Full Time match resumes.';
comment on column public.match_days.concluded_at is
  'Set only by the authoritative conclusion action. A non-null value permanently closes the live Match Day lifecycle.';

-- Existing Full Time rows predate reversible Full Time and are already completed history.
update public.match_days
set concluded_at = coalesce(updated_at, created_at, now())
where status = 'full_time'
  and concluded_at is null;

create or replace function public.enforce_match_day_lifecycle_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  lifecycle_changed boolean;
  transition_authorized boolean := coalesce(
    pg_catalog.current_setting('app.match_day_lifecycle_authorized', true),
    ''
  ) = 'true';
begin
  lifecycle_changed := new.status is distinct from old.status
    or new.match_clock_mode is distinct from old.match_clock_mode
    or new.timer_status is distinct from old.timer_status
    or new.timer_started_at is distinct from old.timer_started_at
    or new.timer_paused_at is distinct from old.timer_paused_at
    or new.timer_elapsed_seconds is distinct from old.timer_elapsed_seconds
    or new.full_time_resume_status is distinct from old.full_time_resume_status
    or new.concluded_at is distinct from old.concluded_at
    or new.concluded_by is distinct from old.concluded_by;

  if not lifecycle_changed then
    return new;
  end if;

  if new.match_clock_mode is distinct from old.match_clock_mode
    and (
      coalesce(old.timer_status, 'not_started') <> 'not_started'
      or old.status not in ('scheduled', 'scorer_request')
    ) then
    raise exception 'Clock type cannot be changed after the match clock has started.';
  end if;

  if old.concluded_at is not null then
    raise exception 'A concluded match cannot be reopened or changed through Match Day lifecycle controls.';
  end if;

  if (
    new.concluded_at is distinct from old.concluded_at
    or new.concluded_by is distinct from old.concluded_by
    or new.full_time_resume_status is distinct from old.full_time_resume_status
    or old.status = 'full_time'
    or old.timer_status = 'full_time'
  ) and not transition_authorized then
    raise exception 'Use the authorised Match Day lifecycle action for this transition.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_match_day_lifecycle_transition() from public;
revoke execute on function public.enforce_match_day_lifecycle_transition() from anon, authenticated;

drop trigger if exists match_days_enforce_lifecycle_transition on public.match_days;

create trigger match_days_enforce_lifecycle_transition
before update of status, match_clock_mode, timer_status, timer_started_at, timer_paused_at, timer_elapsed_seconds,
  full_time_resume_status, concluded_at, concluded_by
on public.match_days
for each row
execute function public.enforce_match_day_lifecycle_transition();

create or replace function public.enforce_match_day_second_half_floor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(new.match_clock_mode, 'fixed') = 'fixed'
    and new.status = 'second_half'
    and (old.status = 'half_time' or old.timer_status = 'half_time') then
    new.timer_elapsed_seconds := greatest(
      coalesce(new.timer_elapsed_seconds, 0),
      (coalesce(new.match_duration_minutes, 90) / 2) * 60
    );
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_match_day_second_half_floor() from public;
revoke execute on function public.enforce_match_day_second_half_floor() from anon, authenticated;

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
  actor_user_id uuid := auth.uid();
  actor_name text := '';
  normalized_action text := lower(trim(coalesce(action_value, '')));
  now_value timestamptz := now();
  current_timer_status text;
  stored_elapsed_seconds integer;
  effective_elapsed_seconds integer;
  effective_started_at timestamptz;
  next_status text;
  next_phase_started_at timestamptz;
  next_timer_status text;
  next_timer_started_at timestamptz;
  next_timer_paused_at timestamptz;
  next_timer_elapsed_seconds integer;
  next_full_time_resume_status text;
  next_concluded_at timestamptz;
  next_concluded_by uuid;
  hydration_event_id uuid;
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

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null then
    raise exception 'This match day could not be found.';
  end if;

  if not public.can_manage_match_day(match_row.team_id)
    or (
      public.current_user_role() <> 'super_admin'
      and match_row.club_id <> public.current_user_club_id()
    ) then
    raise exception 'Coach or manager access is required to control this match clock.';
  end if;

  if match_row.concluded_at is not null then
    if normalized_action = 'conclude' then
      return jsonb_build_object(
        'id', match_row.id,
        'matchDayId', match_row.id,
        'status', match_row.status,
        'phaseStartedAt', match_row.phase_started_at,
        'timerStartedAt', match_row.timer_started_at,
        'timerPausedAt', match_row.timer_paused_at,
        'timerElapsedSeconds', match_row.timer_elapsed_seconds,
        'timerStatus', match_row.timer_status,
        'fullTimeResumeStatus', match_row.full_time_resume_status,
        'concludedAt', match_row.concluded_at,
        'concludedBy', match_row.concluded_by,
        'updatedAt', match_row.updated_at
      );
    end if;

    raise exception 'A concluded match cannot be resumed or changed through Match Day controls.';
  end if;

  actor_name := coalesce(nullif(auth.jwt() ->> 'email', ''), '');
  stored_elapsed_seconds := greatest(coalesce(match_row.timer_elapsed_seconds, 0), 0);
  current_timer_status := coalesce(nullif(match_row.timer_status, ''), 'not_started');

  if current_timer_status = 'not_started' and match_row.status in ('live', 'second_half', 'extra_time', 'penalties') then
    current_timer_status := 'running';
  elsif current_timer_status = 'not_started' and match_row.status = 'half_time' then
    current_timer_status := 'half_time';
  elsif current_timer_status = 'not_started' and match_row.status = 'full_time' then
    current_timer_status := 'full_time';
  end if;

  effective_elapsed_seconds := stored_elapsed_seconds;
  if current_timer_status = 'running' then
    effective_started_at := coalesce(match_row.timer_started_at, match_row.phase_started_at, match_row.updated_at, now_value);
    if effective_started_at <= now_value then
      effective_elapsed_seconds := effective_elapsed_seconds
        + greatest(floor(extract(epoch from (now_value - effective_started_at)))::integer, 0);
    end if;
  end if;

  next_status := match_row.status;
  next_phase_started_at := match_row.phase_started_at;
  next_timer_status := current_timer_status;
  next_timer_started_at := match_row.timer_started_at;
  next_timer_paused_at := match_row.timer_paused_at;
  next_timer_elapsed_seconds := stored_elapsed_seconds;
  next_full_time_resume_status := match_row.full_time_resume_status;
  next_concluded_at := match_row.concluded_at;
  next_concluded_by := match_row.concluded_by;

  if normalized_action = 'start' then
    if current_timer_status in ('paused', 'half_time', 'hydration', 'full_time') then
      raise exception 'Resume this match clock instead of starting it again.';
    end if;

    next_status := case
      when match_row.status in ('scheduled', 'scorer_request') then 'live'
      else match_row.status
    end;
    next_phase_started_at := coalesce(match_row.phase_started_at, now_value);
    next_timer_status := 'running';
    next_timer_started_at := coalesce(effective_started_at, match_row.timer_started_at, match_row.phase_started_at, now_value);
    next_timer_paused_at := null;
    next_timer_elapsed_seconds := stored_elapsed_seconds;
  elsif normalized_action = 'pause' then
    if current_timer_status = 'full_time' then
      raise exception 'Use Resume Match to continue from Full Time.';
    end if;

    if current_timer_status = 'paused' then
      next_timer_started_at := null;
      next_timer_paused_at := coalesce(match_row.timer_paused_at, now_value);
    elsif current_timer_status in ('half_time', 'hydration') then
      next_timer_started_at := null;
      next_timer_paused_at := coalesce(match_row.timer_paused_at, now_value);
    elsif current_timer_status = 'running' then
      next_timer_status := 'paused';
      next_timer_started_at := null;
      next_timer_paused_at := now_value;
      next_timer_elapsed_seconds := effective_elapsed_seconds;
    else
      raise exception 'Only a running match clock can be paused.';
    end if;
  elsif normalized_action = 'half_time' then
    if current_timer_status = 'full_time' then
      raise exception 'Use Resume Match to continue from Full Time.';
    end if;

    if current_timer_status not in ('running', 'half_time') then
      raise exception 'Half Time can only stop a running match clock.';
    end if;

    next_status := 'half_time';
    next_timer_status := 'half_time';
    next_timer_started_at := null;
    next_timer_paused_at := case
      when current_timer_status = 'half_time' then coalesce(match_row.timer_paused_at, now_value)
      else now_value
    end;
    next_timer_elapsed_seconds := case
      when current_timer_status = 'half_time' then stored_elapsed_seconds
      else effective_elapsed_seconds
    end;
  elsif normalized_action = 'hydration' then
    if current_timer_status not in ('running', 'hydration') then
      raise exception 'Hydration can only pause a running match clock.';
    end if;

    next_timer_status := 'hydration';
    next_timer_started_at := null;
    next_timer_paused_at := case
      when current_timer_status = 'hydration' then coalesce(match_row.timer_paused_at, now_value)
      else now_value
    end;
    next_timer_elapsed_seconds := case
      when current_timer_status = 'hydration' then stored_elapsed_seconds
      else effective_elapsed_seconds
    end;

    if current_timer_status <> 'hydration' then
      insert into public.match_day_events (
        match_day_id, club_id, team_id, event_type, team_side, minute,
        home_score, away_score, notes, created_by, created_by_name
      ) values (
        match_row.id, match_row.club_id, match_row.team_id, 'water_break', 'club',
        greatest(floor(next_timer_elapsed_seconds / 60)::integer + 1, 1),
        greatest(coalesce(match_row.home_score, 0), 0),
        greatest(coalesce(match_row.away_score, 0), 0),
        'Hydration pause', actor_user_id, actor_name
      )
      returning id into hydration_event_id;
    end if;
  elsif normalized_action = 'resume' then
    if current_timer_status = 'running' then
      next_timer_started_at := coalesce(effective_started_at, match_row.timer_started_at, now_value);
      next_timer_paused_at := null;
    elsif current_timer_status = 'full_time' then
      next_status := case
        when match_row.full_time_resume_status in ('live', 'second_half', 'extra_time', 'penalties')
          then match_row.full_time_resume_status
        when match_row.match_clock_mode = 'fixed'
          and stored_elapsed_seconds >= (coalesce(match_row.match_duration_minutes, 90) / 2) * 60
          then 'second_half'
        else 'live'
      end;
      next_phase_started_at := now_value;
      next_timer_status := 'running';
      next_timer_started_at := now_value;
      next_timer_paused_at := null;
      next_timer_elapsed_seconds := stored_elapsed_seconds;
      next_full_time_resume_status := null;
    elsif current_timer_status in ('paused', 'half_time', 'hydration') then
      next_status := case
        when match_row.status = 'half_time' or current_timer_status = 'half_time' then 'second_half'
        when match_row.status in ('scheduled', 'scorer_request') then 'live'
        else match_row.status
      end;
      next_phase_started_at := now_value;
      next_timer_status := 'running';
      next_timer_started_at := now_value;
      next_timer_paused_at := null;
      next_timer_elapsed_seconds := stored_elapsed_seconds;
    else
      raise exception 'Only a paused or Full Time match clock can be resumed.';
    end if;
  elsif normalized_action = 'full_time' then
    if current_timer_status = 'not_started' then
      raise exception 'Start the match clock before choosing Full Time.';
    end if;

    if current_timer_status <> 'full_time' then
      next_full_time_resume_status := case
        when match_row.status in ('live', 'second_half', 'extra_time', 'penalties') then match_row.status
        when match_row.status = 'half_time' then 'second_half'
        else 'live'
      end;
    end if;

    next_status := 'full_time';
    next_timer_status := 'full_time';
    next_timer_started_at := null;
    next_timer_paused_at := case
      when current_timer_status = 'full_time' then coalesce(match_row.timer_paused_at, now_value)
      else now_value
    end;
    next_timer_elapsed_seconds := case
      when current_timer_status = 'full_time' then stored_elapsed_seconds
      else effective_elapsed_seconds
    end;
  elsif normalized_action = 'conclude' then
    if match_row.status <> 'full_time' or current_timer_status <> 'full_time' then
      raise exception 'Choose Full Time before concluding this match.';
    end if;

    next_concluded_at := now_value;
    next_concluded_by := actor_user_id;
  end if;

  if next_timer_elapsed_seconds < 0 then
    raise exception 'Match clock elapsed time cannot be negative.';
  end if;

  perform pg_catalog.set_config('app.match_day_lifecycle_authorized', 'true', true);

  update public.match_days
  set
    status = next_status,
    phase_started_at = next_phase_started_at,
    timer_started_at = next_timer_started_at,
    timer_paused_at = next_timer_paused_at,
    timer_elapsed_seconds = next_timer_elapsed_seconds,
    timer_status = next_timer_status,
    full_time_resume_status = next_full_time_resume_status,
    concluded_at = next_concluded_at,
    concluded_by = next_concluded_by,
    updated_at = now_value
  where id = match_row.id
  returning * into updated_match_row;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    updated_match_row.club_id,
    updated_match_row.team_id,
    updated_match_row.id,
    actor_user_id,
    actor_name,
    coalesce(nullif(public.current_user_role(), ''), 'staff'),
    'match_day_updated',
    case when normalized_action = 'conclude' then 'Match concluded' else 'Timer state updated' end,
    jsonb_build_object(
      'status', match_row.status,
      'phaseStartedAt', match_row.phase_started_at,
      'timerStartedAt', match_row.timer_started_at,
      'timerPausedAt', match_row.timer_paused_at,
      'timerElapsedSeconds', stored_elapsed_seconds,
      'timerStatus', current_timer_status,
      'fullTimeResumeStatus', match_row.full_time_resume_status,
      'concludedAt', match_row.concluded_at
    ),
    jsonb_build_object(
      'status', updated_match_row.status,
      'phaseStartedAt', updated_match_row.phase_started_at,
      'timerStartedAt', updated_match_row.timer_started_at,
      'timerPausedAt', updated_match_row.timer_paused_at,
      'timerElapsedSeconds', updated_match_row.timer_elapsed_seconds,
      'timerStatus', updated_match_row.timer_status,
      'fullTimeResumeStatus', updated_match_row.full_time_resume_status,
      'concludedAt', updated_match_row.concluded_at
    ),
    jsonb_build_object(
      'action', normalized_action,
      'hydrationEventId', hydration_event_id,
      'clockMode', updated_match_row.match_clock_mode,
      'source', 'match_day_timer_rpc'
    )
  );

  return jsonb_build_object(
    'id', updated_match_row.id,
    'matchDayId', updated_match_row.id,
    'status', updated_match_row.status,
    'phaseStartedAt', updated_match_row.phase_started_at,
    'timerStartedAt', updated_match_row.timer_started_at,
    'timerPausedAt', updated_match_row.timer_paused_at,
    'timerElapsedSeconds', updated_match_row.timer_elapsed_seconds,
    'timerStatus', updated_match_row.timer_status,
    'fullTimeResumeStatus', updated_match_row.full_time_resume_status,
    'concludedAt', updated_match_row.concluded_at,
    'concludedBy', updated_match_row.concluded_by,
    'updatedAt', updated_match_row.updated_at
  );
end;
$$;

revoke all on function public.set_match_day_timer_state(uuid, text) from public;
revoke execute on function public.set_match_day_timer_state(uuid, text) from anon;
grant execute on function public.set_match_day_timer_state(uuid, text) to authenticated;
grant execute on function public.set_match_day_timer_state(uuid, text) to service_role;
