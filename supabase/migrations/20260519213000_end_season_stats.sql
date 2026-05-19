create or replace function public.get_end_season_stats(team_id_value uuid default null)
returns table (
  player_id uuid,
  player_name text,
  shirt_number text,
  team_id uuid,
  team_name text,
  goals integer,
  assists integer,
  motm_votes integer
)
language sql
stable
security definer
set search_path = public
as $$
  with staff_scope as (
    select
      public.current_user_club_id() as club_id,
      public.current_user_role_rank() as role_rank
  ),
  scoped_players as (
    select
      player.id,
      player.player_name,
      coalesce(player.shirt_number, '') as shirt_number,
      player.team_id,
      coalesce(team.name, '') as team_name
    from public.players player
    join staff_scope scope
      on scope.club_id = player.club_id
    left join public.teams team
      on team.id = player.team_id
    where auth.uid() is not null
      and scope.role_rank >= 50
      and coalesce(player.status, 'active') <> 'archived'
      and player.section = 'Squad'
      and (
        team_id_value is null
        or player.team_id = team_id_value
      )
  ),
  year_matches as (
    select match_day.*
    from public.match_days match_day
    join staff_scope scope
      on scope.club_id = match_day.club_id
    where match_day.match_date >= date_trunc('year', timezone('Europe/London', now()))::date
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
      and lower(trim(event.scorer_name)) = lower(trim(player.player_name))
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
      and lower(trim(event.assist_name)) = lower(trim(player.player_name))
    group by player.id
  ),
  motm_counts as (
    select
      player.id as player_id,
      count(vote.id)::integer as motm_votes
    from scoped_players player
    join year_matches match_day
      on match_day.motm_poll_id is not null
      and (match_day.team_id is null or match_day.team_id = player.team_id)
    join public.poll_votes vote
      on vote.poll_id = match_day.motm_poll_id
      and vote.option_id = player.id::text
    group by player.id
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
$$;

grant execute on function public.get_end_season_stats(uuid) to authenticated;
