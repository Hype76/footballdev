-- Apply the fixture-date rule to direct clock controls as well as the Start Match action.
do $migration$
declare
  definition text := pg_get_functiondef('public.set_match_day_timer_state(uuid,text)'::regprocedure);
  marker text := '  timer_result := public.apply_match_day_timer_action(';
begin
  if position(marker in definition) = 0 then
    raise exception 'Match clock validation marker missing';
  end if;
  execute replace(definition, marker, $check$  if normalized_action = 'start'
    and public.match_day_local_date_is_today(match_row.id) is not true then
    raise exception 'This match can only be started on the fixture date.';
  end if;

$check$ || marker);
end;
$migration$;

-- Reuse the live fixture editor and its validation. Historical editing leaves
-- the result, match clock, participation and existing invitations intact.
do $migration$
declare
  definition text := pg_get_functiondef('public.update_match_day_fixture_for_team(uuid,uuid,jsonb)'::regprocedure);
  state_marker text := '    and match_day.status in (''scheduled'', ''scorer_request'', ''postponed'')';
  validation_marker text := '  if opponent_value = ''''';
  type_marker text := '    or fixture_type_value not in (''friendly'', ''league'', ''cup'', ''tournament'')';
begin
  if position(state_marker in definition) = 0 or position(validation_marker in definition) = 0
    or position(type_marker in definition) = 0 or position('fixture_type = fixture_type_value,' in definition) = 0 then
    raise exception 'Fixture editing validation marker missing';
  end if;
  definition := replace(definition, state_marker, $state$    and (
      (match_day.concluded_at is null and match_day.status in ('scheduled', 'scorer_request', 'postponed'))
      or (match_day.concluded_at is not null and match_day.previous_hidden_at is null
        and p_fixture -> 'concludedEdit' = 'true'::jsonb)
    )$state$);
  definition := replace(definition, validation_marker, $check$  if match_row.concluded_at is not null then
    if nullif(p_fixture ->> 'expectedUpdatedAt', '')::timestamptz is distinct from match_row.updated_at then
      raise exception using errcode = '40001', message = 'This match changed. Refresh it before saving.';
    end if;
    if match_date_value > timezone('Europe/London', now())::date then
      raise exception using errcode = '22023', message = 'A concluded match date cannot be in the future.';
    end if;
    conclusion_rule_value := match_row.match_conclusion_rule;
    match_duration_minutes_value := match_row.match_duration_minutes;
    extra_time_half_minutes_value := match_row.extra_time_half_minutes;
    extra_time_period_count_value := match_row.extra_time_period_count;
    p_fixture := p_fixture - 'carpoolEnabled';
  end if;

$check$ || validation_marker);
  definition := replace(definition, type_marker, $type$    or (fixture_type_value not in ('friendly', 'league', 'cup', 'tournament')
      and not (match_row.concluded_at is not null and match_row.fixture_type is null and fixture_type_value = ''))$type$);
  execute replace(definition, 'fixture_type = fixture_type_value,', 'fixture_type = nullif(fixture_type_value, ''''),');
end;
$migration$;

comment on function public.update_match_day_fixture_for_team(uuid, uuid, jsonb) is
  'Updates authorised Team fixture details before kick-off or, with a current snapshot, after conclusion.';

create function public.delete_match_day_fixture_for_team(p_match_day_id uuid, p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  fixture public.match_days%rowtype;
  deleted_at_value timestamptz := now();
begin
  select * into fixture
  from public.match_days
  where id = p_match_day_id and team_id = p_team_id
  for update;

  if fixture.id is null
    or coalesce(public.current_user_role(), '') in ('admin', 'super_admin', 'parent_portal', 'adult_player')
    or not app_private.actor_can_manage_team_resource(actor_id, fixture.club_id, p_team_id, 20)
    or not exists (
      select 1 from public.team_staff assignment
      where assignment.team_id = p_team_id and assignment.user_id = actor_id and assignment.role_rank >= 30
    ) then
    raise exception using errcode = '42501', message = 'An assigned Coach or Manager is required to delete this match.';
  end if;

  if fixture.deleted_at is not null then
    return jsonb_build_object('matchDayId', fixture.id, 'deleted', true, 'deletedAt', fixture.deleted_at);
  end if;

  if (fixture.timer_status in ('running', 'paused', 'half_time', 'hydration')
    or fixture.status in ('live', 'half_time', 'second_half', 'extra_time', 'penalties'))
    and (fixture.match_date is null or fixture.match_date >= timezone('Europe/London', now())::date) then
    raise exception using errcode = '55000', message = 'Finish the active match before deleting it.';
  end if;

  if exists (
    select 1 from public.calendar_event_notification_commands command
    where command.match_day_id = fixture.id and command.completed_at is null
  ) or exists (
    select 1 from public.calendar_event_notification_events event
    where event.match_day_id = fixture.id and event.status in ('pending', 'queued', 'processing')
  ) or exists (
    select 1 from public.match_day_notification_events event
    where event.match_day_id = fixture.id and event.status in ('pending', 'queued', 'processing')
  ) then
    raise exception using errcode = '55000', message = 'Wait for the match notifications to finish before deleting it.';
  end if;

  update public.match_days
  set deleted_at = deleted_at_value, deleted_by = actor_id, updated_at = deleted_at_value
  where id = fixture.id;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name, actor_role,
    event_type, event_label, previous_value, new_value
  ) values (
    fixture.club_id, fixture.team_id, fixture.id, actor_id,
    coalesce(auth.jwt() ->> 'name', auth.jwt() ->> 'email', ''),
    public.current_user_role(), 'match_day_updated', 'Match deleted',
    jsonb_build_object('status', fixture.status), jsonb_build_object('deletedAt', deleted_at_value)
  );

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    fixture.club_id, actor_id, 'match_day_fixture_deleted', 'match_day', fixture.id,
    jsonb_build_object('teamId', fixture.team_id, 'status', fixture.status, 'deletedAt', deleted_at_value)
  );

  return jsonb_build_object('matchDayId', fixture.id, 'deleted', true, 'deletedAt', deleted_at_value);
end;
$function$;

revoke all on function public.delete_match_day_fixture_for_team(uuid, uuid) from public, anon, service_role;
grant execute on function public.delete_match_day_fixture_for_team(uuid, uuid) to authenticated;

comment on function public.delete_match_day_fixture_for_team(uuid, uuid) is
  'Removes a fixture for its assigned Coach or Manager while retaining match history and audit evidence.';
