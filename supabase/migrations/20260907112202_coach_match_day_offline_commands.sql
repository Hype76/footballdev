create schema if not exists private;

create table private.coach_match_day_commands (
  id uuid primary key,
  match_day_id uuid not null references public.match_days(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('event', 'score', 'timer')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  result jsonb not null,
  result_updated_at timestamptz not null,
  notification_type text not null default '',
  event_id uuid,
  notification_attempts integer not null default 0,
  notification_claimed_at timestamptz,
  notification_completed_at timestamptz,
  notification_error text not null default ''
);
alter table private.coach_match_day_commands enable row level security;
revoke all on private.coach_match_day_commands from public, anon, authenticated;
create index coach_match_day_commands_pending_notifications on private.coach_match_day_commands(created_at)
  where notification_completed_at is null and notification_type <> '';

create or replace function public.apply_coach_match_day_command(
  command_id_value uuid, match_day_id_value uuid, kind_value text, payload_value jsonb,
  captured_at_value timestamptz, expected_updated_at_value timestamptz default null,
  previous_command_id_value uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  m public.match_days%rowtype;
  saved private.coach_match_day_commands%rowtype;
  previous private.coach_match_day_commands%rowtype;
  next_match public.match_days%rowtype;
  event_result jsonb;
  action text := payload_value->>'action';
  event_type text := payload_value->>'eventType';
  notification_type text := '';
  saved_event_id uuid;
  timer_result jsonb;
  result_payload jsonb;
  shift interval;
  shifted_start timestamptz;
  capture_time timestamptz := least(captured_at_value, now());
begin
  if actor is null then raise exception 'Login is required.' using errcode = '42501'; end if;
  select * into m from public.match_days where id = match_day_id_value for update;
  if m.id is null or m.deleted_at is not null or m.previous_hidden_at is not null then
    raise exception 'This fixture is unavailable. Your saved actions need review.';
  end if;
  if not coalesce(public.can_manage_match_day(m.team_id), false)
    or m.club_id is distinct from public.current_user_club_id()
    or public.current_user_role() in ('super_admin','admin','parent_portal','adult_player') then
    raise exception 'Current Coach or manager access to this team is required.' using errcode = '42501';
  end if;
  select * into saved from private.coach_match_day_commands where id = command_id_value;
  if found then
    if saved.actor_user_id <> actor or saved.match_day_id <> m.id or saved.kind <> kind_value
      or saved.payload is distinct from payload_value or saved.captured_at is distinct from captured_at_value then
      raise exception 'This saved action identifier is already in use.';
    end if;
    return saved.result;
  end if;
  if command_id_value is null or captured_at_value is null or captured_at_value > now() + interval '2 minutes'
    or captured_at_value < now() - interval '24 hours' or jsonb_typeof(payload_value) is distinct from 'object'
    or octet_length(payload_value::text) > 16000 then
    raise exception 'The saved action is invalid or over 24 hours old. Review it before continuing.';
  end if;
  if m.concluded_at is not null or m.status in ('cancelled','postponed') then
    raise exception 'This fixture has been closed. Your saved actions need review.';
  end if;
  if previous_command_id_value is not null then
    select * into previous from private.coach_match_day_commands where id = previous_command_id_value;
    if previous.id is null or previous.actor_user_id <> actor or previous.match_day_id <> m.id
      or previous.result_updated_at is distinct from m.updated_at or captured_at_value < previous.captured_at then
      raise exception 'The match changed on another device. Your saved actions are safe and need review.' using errcode = '40001';
    end if;
  elsif expected_updated_at_value is null or expected_updated_at_value is distinct from m.updated_at then
    raise exception 'The match changed on another device. Your saved actions are safe and need review.' using errcode = '40001';
  end if;
  if kind_value = 'event' then
    if event_type = 'goal' then
      event_result := public.record_match_day_goal_v3(m.id,null,payload_value->>'teamSide',payload_value->>'scorerName',payload_value->>'scorerShirtNumber',
        payload_value->>'assistName',payload_value->>'assistShirtNumber',(payload_value->>'minute')::integer,payload_value->>'notes',
        coalesce((payload_value->>'isPenaltyGoal')::boolean,false),command_id_value,coalesce((payload_value->>'isOwnGoal')::boolean,false),nullif(payload_value->>'stoppageMinute','')::integer);
    elsif event_type in ('yellow_card','red_card','substitution') then
      event_result := public.record_match_day_scorer_event_v1(match_day_id_value=>m.id,parent_link_id_value=>null,event_type_value=>event_type,
        team_side_value=>payload_value->>'teamSide',minute_value=>(payload_value->>'minute')::integer,
        stoppage_minute_value=>nullif(payload_value->>'stoppageMinute','')::integer,player_name_value=>payload_value->>'playerName',
        player_shirt_number_value=>payload_value->>'playerShirtNumber',player_on_name_value=>payload_value->>'playerOnName',
        player_on_shirt_number_value=>payload_value->>'playerOnShirtNumber',notes_value=>payload_value->>'notes',request_id_value=>command_id_value);
    else raise exception 'Unsupported saved match event.'; end if;
    saved_event_id := (event_result->>'id')::uuid;
    notification_type := event_type;
  elsif kind_value = 'score' then
    event_result := public.record_match_day_score_correction_v2(m.id,null,(payload_value->>'homeScore')::integer,(payload_value->>'awayScore')::integer,
      'Score corrected in the Coach app',command_id_value);
    saved_event_id := (event_result->>'id')::uuid;
    notification_type := 'score_correction';
  elsif kind_value = 'timer' then
    if action not in ('start','pause','hydration','half_time','resume','full_time') or action is null then raise exception 'This clock action needs an online connection.'; end if;
    if coalesce(m.timer_started_at,m.phase_started_at) is not null and capture_time < coalesce(m.timer_started_at,m.phase_started_at) then raise exception 'This saved clock action predates the current clock. Review it before continuing.'; end if;
    shift := now() - capture_time;
    -- Shift only inside this locked transaction so canonical timer calculations use the recorded time.
    -- No intermediate state is visible to another reader or scorer.
    if m.timer_status = 'running' then
      shifted_start := coalesce(m.timer_started_at,m.phase_started_at,capture_time) + shift;
      perform pg_catalog.set_config('app.match_day_lifecycle_authorized','true',true);
      update public.match_days set timer_started_at = shifted_start where id = m.id;
    end if;
    if action = 'start' then
      timer_result := public.start_match_day(m.id);
      notification_type := 'live';
    else
      timer_result := public.set_match_day_timer_state(m.id,action);
      notification_type := case when action in ('half_time','full_time') then action when action = 'resume' and m.status = 'half_time' then 'second_half' else '' end;
    end if;
    perform pg_catalog.set_config('app.match_day_lifecycle_authorized','true',true);
    update public.match_days set
      timer_started_at = case when timer_started_at = now() then capture_time when timer_started_at = shifted_start then m.timer_started_at else timer_started_at end,
      timer_paused_at = case when timer_paused_at = now() then capture_time else timer_paused_at end,
      phase_started_at = case when phase_started_at = now() then capture_time else phase_started_at end
    where id = m.id;
  else raise exception 'Unsupported saved Match Day action.'; end if;
  select * into next_match from public.match_days where id = m.id;
  result_payload := to_jsonb(next_match) || jsonb_build_object('savedEvent',event_result);
  insert into private.coach_match_day_commands(id,match_day_id,actor_user_id,kind,payload,captured_at,result,result_updated_at,notification_type,event_id)
    values(command_id_value,m.id,actor,kind_value,payload_value,captured_at_value,result_payload,next_match.updated_at,notification_type,saved_event_id);
  return result_payload;
end;
$$;
revoke all on function public.apply_coach_match_day_command(uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid) from public,anon;
grant execute on function public.apply_coach_match_day_command(uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid) to authenticated;

create or replace function public.claim_coach_match_day_command_notifications(command_id_value uuid default null, actor_user_id_value uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result_payload jsonb;
begin
  with selected as (
    select id from private.coach_match_day_commands
    where notification_type <> '' and notification_completed_at is null and notification_attempts < 5
      and created_at > now() - interval '4 hours'
      and (command_id_value is null or id = command_id_value)
      and (actor_user_id_value is null or actor_user_id = actor_user_id_value)
      and (notification_claimed_at is null or notification_claimed_at < now() - interval '2 minutes')
    order by created_at limit 5 for update skip locked
  ), claimed as (
    update private.coach_match_day_commands c set notification_claimed_at=now(),notification_attempts=notification_attempts+1
    from selected s where c.id=s.id returning c.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'match',result,'type',notification_type,'eventId',event_id) order by created_at),'[]'::jsonb) into result_payload from claimed;
  return result_payload;
end;
$$;
create or replace function public.complete_coach_match_day_command_notification(command_id_value uuid, error_value text default '')
returns void language sql security definer set search_path = '' as $$
  update private.coach_match_day_commands set notification_completed_at=case when coalesce(error_value,'')='' then now() else null end,
    notification_error=left(coalesce(error_value,''),500) where id=command_id_value;
$$;
revoke all on function public.claim_coach_match_day_command_notifications(uuid,uuid) from public,anon,authenticated;
revoke all on function public.complete_coach_match_day_command_notification(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_coach_match_day_command_notifications(uuid,uuid) to service_role;
grant execute on function public.complete_coach_match_day_command_notification(uuid,text) to service_role;
