create function app_private.platform_list_match_day_support(
  club_id_value uuid,
  team_id_value uuid,
  offset_value integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.matchday_current_actor_is_platform_admin() is not true then
    raise exception using errcode = '42501', message = 'Active Platform Admin access is required.';
  end if;
  if not exists (
    select 1 from public.teams team join public.clubs club on club.id = team.club_id
    where team.id = team_id_value and team.club_id = club_id_value
      and team.archived_at is null and coalesce(team.status, 'active') = 'active'
      and club.archived_at is null and coalesce(club.status, 'active') = 'active'
  ) then
    raise exception using errcode = '42501', message = 'This team is not available in the selected club.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', fixture.id, 'opponent', fixture.opponent, 'matchDate', fixture.match_date,
      'isToday', public.match_day_local_date_is_today(fixture.id),
      'status', fixture.status, 'timerStatus', fixture.timer_status,
      'currentMatchPhase', fixture.current_match_phase, 'conclusionRule', fixture.match_conclusion_rule,
      'extraTimePeriodCount', fixture.extra_time_period_count,
      'homeScore', fixture.home_score, 'awayScore', fixture.away_score, 'homeAway', fixture.home_away,
      'shootoutCanFinish', case when fixture.current_match_phase = 'penalties'
        then public.match_day_shootout_can_finish(fixture.id) else false end,
      'updatedAt', fixture.updated_at
    ) order by fixture.is_scheduled, fixture.match_date, fixture.id)
    from (
      select match.*, match.status in ('scheduled', 'scorer_request') as is_scheduled
      from public.match_days match
      where match.club_id = club_id_value and match.team_id = team_id_value
        and match.deleted_at is null and match.previous_hidden_at is null and match.concluded_at is null
        and (match.status in ('live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time')
          or (match.status in ('scheduled', 'scorer_request') and public.match_day_local_date_is_today(match.id)))
      order by is_scheduled, match.match_date, match.id
      limit 51 offset greatest(coalesce(offset_value, 0), 0)
    ) fixture
  ), '[]'::jsonb);
end;
$$;

revoke all on function app_private.platform_list_match_day_support(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function app_private.platform_list_match_day_support(uuid, uuid, integer) to authenticated;

create function app_private.platform_apply_match_day_support_action(
  club_id_value uuid,
  team_id_value uuid,
  match_day_id_value uuid,
  expected_updated_at_value timestamptz,
  action_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  fixture public.match_days%rowtype;
begin
  if public.matchday_current_actor_is_platform_admin() is not true then
    raise exception using errcode = '42501', message = 'Active Platform Admin access is required.';
  end if;

  select match.* into fixture
  from public.match_days match
  join public.teams team on team.id = match.team_id and team.club_id = match.club_id
  join public.clubs club on club.id = match.club_id
  where match.id = match_day_id_value and match.club_id = club_id_value and match.team_id = team_id_value
    and match.deleted_at is null and match.previous_hidden_at is null
    and team.archived_at is null and coalesce(team.status, 'active') = 'active'
    and club.archived_at is null and coalesce(club.status, 'active') = 'active'
  for update of match nowait;

  if fixture.id is null then
    raise exception using errcode = '42501', message = 'This match is not available in the selected team.';
  end if;
  if expected_updated_at_value is null or fixture.updated_at is distinct from expected_updated_at_value then
    raise exception using errcode = '40001', message = 'The match changed. Refresh and review it before trying again.';
  end if;
  if fixture.concluded_at is not null or fixture.status in ('cancelled', 'postponed') then
    raise exception using errcode = '22023', message = 'This fixture is closed.';
  end if;

  if action_value = 'start' then
    return public.start_match_day(fixture.id);
  elsif action_value in ('pause', 'half_time', 'hydration', 'resume', 'full_time', 'conclude') then
    return public.set_match_day_timer_state(fixture.id, action_value);
  elsif action_value in (
    'normal_time_complete', 'start_extra_time', 'extra_time_half_time',
    'start_extra_time_second_half', 'complete_extra_time', 'start_penalties'
  ) then
    return public.set_match_day_extended_state(fixture.id, action_value);
  elsif action_value = 'end_shootout_without_result' then
    return public.end_match_day_without_shootout_result(fixture.id);
  end if;

  raise exception using errcode = '22023', message = 'Choose an available Match Day action.';
end;
$$;

revoke all on function app_private.platform_apply_match_day_support_action(uuid, uuid, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function app_private.platform_apply_match_day_support_action(uuid, uuid, uuid, timestamptz, text)
  to authenticated;

create function public.platform_list_match_day_support(
  club_id_value uuid, team_id_value uuid, offset_value integer default 0
)
returns jsonb language sql security invoker set search_path = ''
as $$ select app_private.platform_list_match_day_support(club_id_value, team_id_value, offset_value) $$;

create function public.platform_apply_match_day_support_action(
  club_id_value uuid, team_id_value uuid, match_day_id_value uuid, expected_updated_at_value timestamptz, action_value text
)
returns jsonb language sql security invoker set search_path = ''
as $$
  select app_private.platform_apply_match_day_support_action(
    club_id_value, team_id_value, match_day_id_value, expected_updated_at_value, action_value
  )
$$;

revoke all on function public.platform_list_match_day_support(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.platform_list_match_day_support(uuid, uuid, integer) to authenticated;
revoke all on function public.platform_apply_match_day_support_action(uuid, uuid, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.platform_apply_match_day_support_action(uuid, uuid, uuid, timestamptz, text)
  to authenticated;
