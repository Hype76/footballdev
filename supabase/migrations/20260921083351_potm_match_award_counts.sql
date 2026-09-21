-- POTM is an award per completed Match Day. A tied highest vote produces a joint award.
CREATE OR REPLACE FUNCTION public.get_end_season_stats(team_id_value uuid DEFAULT NULL::uuid)
 RETURNS TABLE(player_id uuid, player_name text, shirt_number text, team_id uuid, team_name text, goals integer, assists integer, motm_votes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with staff_scope as (
    select
      public.current_user_club_id() as club_id,
      public.current_user_role() as role,
      public.current_user_role_rank() as role_rank
  ),
  allowed_scope as (
    select
      scope.club_id,
      scope.role,
      scope.role_rank,
      (
        scope.role = 'admin'
        or (
          scope.role_rank >= 20
          and team_id_value is not null
          and exists (
            select 1
            from public.team_staff staff
            where staff.team_id = team_id_value
              and staff.user_id = auth.uid()
          )
        )
      ) as can_read
    from staff_scope scope
  ),
  scoped_players as (
    select
      player.id,
      player.player_name,
      coalesce(player.shirt_number, '') as shirt_number,
      player.team_id,
      coalesce(team.name, '') as team_name
    from public.players player
    join allowed_scope scope
      on scope.club_id = player.club_id
    left join public.teams team
      on team.id = player.team_id
    where auth.uid() is not null
      and scope.can_read is true
      and coalesce(player.status, 'active') <> 'archived'
      and player.section = 'Squad'
      and player.archived_at is null
      and (
        team_id_value is null
        or player.team_id = team_id_value
      )
  ),
  year_matches as (
    select match_day.*
    from public.match_days match_day
    join allowed_scope scope
      on scope.club_id = match_day.club_id
    where auth.uid() is not null
      and scope.can_read is true
      and match_day.match_date >= date_trunc('year', timezone('Europe/London', now()))::date
      and match_day.match_date < (date_trunc('year', timezone('Europe/London', now())) + interval '1 year')::date
      and match_day.deleted_at is null
      and match_day.status not in ('cancelled', 'postponed')
      and (
        team_id_value is null
        or match_day.team_id = team_id_value
      )
  ),
  goal_counts as (
    select
      player.id as player_id,
      count(*)::integer as goals
    from scoped_players player
    join year_matches match_day
      on match_day.team_id is null or match_day.team_id = player.team_id
    join public.match_day_events event
      on event.match_day_id = match_day.id
      and event.event_type = 'goal'
      and event.team_side = 'club'
      and coalesce(event.event_status, 'active') = 'active'
      and event.voided_at is null
      and coalesce(event.is_own_goal, false) = false
      and lower(trim(regexp_replace(event.scorer_name, '^Other:\s*', '', 'i'))) = lower(trim(player.player_name))
    group by player.id
  ),
  assist_counts as (
    select
      player.id as player_id,
      count(*)::integer as assists
    from scoped_players player
    join year_matches match_day
      on match_day.team_id is null or match_day.team_id = player.team_id
    join public.match_day_events event
      on event.match_day_id = match_day.id
      and event.event_type = 'goal'
      and event.team_side = 'club'
      and coalesce(event.event_status, 'active') = 'active'
      and event.voided_at is null
      and coalesce(event.is_own_goal, false) = false
      and lower(trim(regexp_replace(event.assist_name, '^Other:\s*', '', 'i'))) = lower(trim(player.player_name))
    group by player.id
  ),
  motm_vote_totals as (
    select
      match_day.id as match_day_id,
      player.id as player_id,
      count(vote.id)::integer as vote_count
    from year_matches match_day
    join public.polls poll
      on poll.id = match_day.motm_poll_id
      and (
        poll.status = 'closed'
        or (
          poll.closes_at is not null
          and poll.closes_at <= timezone('utc', now())
        )
      )
    join public.poll_votes vote
      on vote.poll_id = match_day.motm_poll_id
    join scoped_players player
      on player.id::text = vote.option_id
      and (match_day.team_id is null or match_day.team_id = player.team_id)
    group by match_day.id, player.id
  ),
  motm_match_maximums as (
    select
      match_day_id,
      max(vote_count) as winning_vote_count
    from motm_vote_totals
    group by match_day_id
  ),
  motm_counts as (
    select
      totals.player_id,
      count(*)::integer as motm_votes
    from motm_vote_totals totals
    join motm_match_maximums maximums
      on maximums.match_day_id = totals.match_day_id
      and maximums.winning_vote_count = totals.vote_count
    group by totals.player_id
  )
  select
    player.id as player_id,
    player.player_name,
    player.shirt_number,
    player.team_id,
    player.team_name,
    coalesce(goal_counts.goals, 0) as goals,
    coalesce(assist_counts.assists, 0) as assists,
    coalesce(motm_counts.motm_votes, 0) as motm_votes
  from scoped_players player
  left join goal_counts
    on goal_counts.player_id = player.id
  left join assist_counts
    on assist_counts.player_id = player.id
  left join motm_counts
    on motm_counts.player_id = player.id
  order by player.team_name, player.player_name;
$function$;
