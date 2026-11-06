-- Let a coach stop an accidentally started shootout without inventing a winner.
-- Recorded kicks remain in the audit trail as voided corrections.
create or replace function public.end_match_day_without_shootout_result(match_day_id_value uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  updated_row public.match_days%rowtype;
  actor_id uuid := auth.uid();
  actor_name text;
  actor_role text;
  voided_kicks integer := 0;
begin
  if actor_id is null then
    raise exception 'Login is required before ending this match.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;
  if match_row.concluded_at is not null
    or match_row.status <> 'penalties'
    or match_row.current_match_phase <> 'penalties' then
    raise exception 'Only an active penalty shootout can be ended this way.';
  end if;
  if not public.can_manage_match_day(match_row.team_id)
    or (public.current_user_role() <> 'super_admin'
      and match_row.club_id is distinct from public.current_user_club_id()) then
    raise exception 'Current coach or manager access is required to end this shootout.';
  end if;

  actor_name := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), 'Match Day coach');
  actor_role := coalesce(nullif(public.current_user_role(), ''), 'staff');

  update public.match_day_shootout_kicks
  set event_status = 'voided',
      voided_at = now(),
      voided_by = actor_id,
      voided_by_name = actor_name,
      void_reason = 'Shootout ended without a result'
  where match_day_id = match_row.id and event_status = 'active';
  get diagnostics voided_kicks = row_count;

  perform public.apply_match_day_timer_action(
    match_row.id, 'full_time', actor_id, actor_name, actor_role, null
  );

  perform pg_catalog.set_config('app.match_day_lifecycle_authorized', 'true', true);
  update public.match_days
  set current_match_phase = 'full_time',
      match_conclusion_rule = case
        when match_row.match_conclusion_rule = 'straight_to_penalties' then 'normal_time'
        else 'extra_time'
      end,
      home_shootout_score = 0,
      away_shootout_score = 0,
      shootout_winner = null,
      full_time_resume_status = case
        when match_row.match_conclusion_rule = 'straight_to_penalties' then 'second_half'
        else 'extra_time'
      end,
      updated_at = now()
  where id = match_row.id
  returning * into updated_row;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id, match_row.team_id, match_row.id, actor_id, actor_name,
    actor_role, 'match_day_updated', 'Shootout ended without result',
    jsonb_build_object('status', match_row.status, 'phase', match_row.current_match_phase,
      'homeShootoutScore', match_row.home_shootout_score, 'awayShootoutScore', match_row.away_shootout_score),
    jsonb_build_object('status', updated_row.status, 'phase', updated_row.current_match_phase,
      'homeShootoutScore', 0, 'awayShootoutScore', 0),
    jsonb_build_object('voidedKicks', voided_kicks, 'source', 'coach_shootout_exit')
  );

  return jsonb_build_object('id', updated_row.id, 'status', updated_row.status,
    'currentMatchPhase', updated_row.current_match_phase,
    'voidedKicks', voided_kicks);
end;
$$;

revoke all on function public.end_match_day_without_shootout_result(uuid) from public, anon;
grant execute on function public.end_match_day_without_shootout_result(uuid) to authenticated, service_role;

-- Enable sharing when parents are added after fixture creation.
create or replace function public.enable_match_day_parent_sharing(match_day_id_value uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  updated_row public.match_days%rowtype;
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception 'Login is required before sharing this fixture.';
  end if;
  select * into match_row from public.match_days
  where id = match_day_id_value for update;
  if match_row.id is null or match_row.deleted_at is not null
    or match_row.status not in ('scheduled', 'scorer_request') then
    raise exception 'Parents can only be added before the fixture starts.';
  end if;
  if not public.can_manage_match_day(match_row.team_id)
    or (public.current_user_role() <> 'super_admin'
      and match_row.club_id is distinct from public.current_user_club_id()) then
    raise exception 'Current coach or manager access is required to add parents.';
  end if;
  if match_row.parent_visible is true and match_row.parent_audience <> 'none' then
    return jsonb_build_object('id', match_row.id, 'parentVisible', true,
      'parentAudience', match_row.parent_audience);
  end if;
  update public.match_days
  set parent_visible = true, parent_audience = 'involved_players', updated_at = now()
  where id = match_row.id returning * into updated_row;
  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id, match_row.team_id, match_row.id, actor_id,
    coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() ->> 'email', ''), 'Match Day coach'),
    coalesce(nullif(public.current_user_role(), ''), 'staff'),
    'match_day_updated', 'Fixture shared with parents',
    jsonb_build_object('parentVisible', match_row.parent_visible, 'parentAudience', match_row.parent_audience),
    jsonb_build_object('parentVisible', true, 'parentAudience', 'involved_players'),
    jsonb_build_object('source', 'coach_mobile_fixture_edit')
  );
  return jsonb_build_object('id', updated_row.id, 'parentVisible', true,
    'parentAudience', updated_row.parent_audience);
end;
$$;

revoke all on function public.enable_match_day_parent_sharing(uuid) from public, anon;
grant execute on function public.enable_match_day_parent_sharing(uuid) to authenticated, service_role;
