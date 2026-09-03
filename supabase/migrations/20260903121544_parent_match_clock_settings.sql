-- Include the saved clock settings in the existing parent-scoped match response.
-- Old clients accept these extra fields; current clients already normalize them.
drop function public.get_parent_portal_match_day_extended_state(uuid);

CREATE OR REPLACE FUNCTION public.get_parent_portal_match_day_extended_state(parent_link_id_value uuid)
 RETURNS TABLE(match_day_id uuid, match_conclusion_rule text, current_match_phase text, extra_time_half_minutes integer, extra_time_period_count integer, normal_time_home_score integer, normal_time_away_score integer, extra_time_home_score integer, extra_time_away_score integer, home_shootout_score integer, away_shootout_score integer, shootout_winner text, shootout_events jsonb, event_contexts jsonb, match_duration_minutes integer, match_clock_mode text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        'isOwnGoal', event.is_own_goal,
        'minute', event.minute,
        'matchPhase', event.match_phase,
        'phaseOrder', event.phase_order,
        'stoppageMinute', event.stoppage_minute,
        'eventSequence', event.event_sequence
      ))
      from public.match_day_events event
      where event.match_day_id = match_day.id
    ), '[]'::jsonb),
    match_day.match_duration_minutes,
    match_day.match_clock_mode
  from public.get_parent_portal_match_days(parent_link_id_value) visible
  join public.match_days match_day on match_day.id = visible.id
  where match_day.deleted_at is null;
$function$;

revoke all on function public.get_parent_portal_match_day_extended_state(uuid) from public, anon;
grant execute on function public.get_parent_portal_match_day_extended_state(uuid) to authenticated, service_role;
comment on function public.get_parent_portal_match_day_extended_state(uuid) is 'Parent-visible match context and saved clock settings, scoped by the canonical current parent fixture access.';
