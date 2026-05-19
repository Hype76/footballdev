create or replace function public.update_match_day_score_as_scorer(
  parent_link_id_value uuid,
  match_day_id_value uuid,
  home_score_value integer,
  away_score_value integer,
  status_value text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_player_links%rowtype;
  match_row public.match_days%rowtype;
  next_status text;
  event_id_value uuid;
begin
  if auth.uid() is null then
    raise exception 'Login is required before updating the match.';
  end if;

  select *
  into link_row
  from public.parent_player_links
  where id = parent_link_id_value
    and auth_user_id = auth.uid()
    and status = 'active'
  limit 1;

  if link_row.id is null then
    raise exception 'This parent portal link could not be opened.';
  end if;

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value
    and club_id = link_row.club_id
    and (team_id is null or team_id = link_row.team_id)
    and exists (
      select 1
      from public.match_day_scorer_assignments assignment
      where assignment.match_day_id = match_day_id_value
        and assignment.parent_link_id = parent_link_id_value
        and assignment.auth_user_id = auth.uid()
    )
  limit 1;

  if match_row.id is null then
    raise exception 'Only selected scorers can update this match.';
  end if;

  next_status := coalesce(nullif(status_value, ''), match_row.status);

  if next_status not in ('scheduled', 'scorer_request', 'live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time', 'postponed', 'cancelled') then
    next_status := match_row.status;
  end if;

  update public.match_days
  set
    home_score = greatest(coalesce(home_score_value, 0), 0),
    away_score = greatest(coalesce(away_score_value, 0), 0),
    status = next_status,
    phase_started_at = case
      when next_status = 'live' and match_row.phase_started_at is null then now()
      else phase_started_at
    end,
    updated_at = now()
  where id = match_row.id;

  insert into public.match_day_events (
    match_day_id,
    club_id,
    team_id,
    event_type,
    team_side,
    home_score,
    away_score,
    notes,
    created_by,
    created_by_parent_link_id,
    created_by_name
  )
  values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    'score_correction',
    'club',
    greatest(coalesce(home_score_value, 0), 0),
    greatest(coalesce(away_score_value, 0), 0),
    'Score updated by parent scorer',
    auth.uid(),
    parent_link_id_value,
    coalesce(link_row.email, 'Parent scorer')
  )
  returning id into event_id_value;

  return event_id_value;
end;
$$;

grant execute on function public.update_match_day_score_as_scorer(uuid, uuid, integer, integer, text) to authenticated;
