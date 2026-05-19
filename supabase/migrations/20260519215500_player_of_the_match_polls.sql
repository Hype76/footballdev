create or replace function public.create_match_day_motm_poll(target_match_day_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.match_days%rowtype;
  option_rows jsonb;
  poll_id_value uuid;
begin
  select *
  into match_row
  from public.match_days
  where id = target_match_day_id
  limit 1;

  if match_row.id is null then
    return null;
  end if;

  if match_row.status <> 'full_time'
    or match_row.enable_motm_poll is false
    or match_row.motm_poll_id is not null then
    return match_row.motm_poll_id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', player.id::text,
        'label', trim(concat(
          coalesce(nullif(player.player_name, ''), 'Player'),
          case when nullif(player.shirt_number, '') is null then '' else ' #' || player.shirt_number end
        )),
        'playerId', player.id::text
      )
      order by player.player_name
    ),
    '[]'::jsonb
  )
  into option_rows
  from public.players player
  where player.club_id = match_row.club_id
    and player.archived_at is null
    and (
      match_row.team_id is null
      or player.team_id = match_row.team_id
      or exists (
        select 1
        from public.player_team_assignments assignment
        where assignment.player_id = player.id
          and assignment.team_id = match_row.team_id
          and assignment.archived_at is null
      )
    );

  if jsonb_array_length(option_rows) = 0 then
    return null;
  end if;

  insert into public.polls (
    club_id,
    team_id,
    title,
    description,
    audience,
    poll_type,
    options,
    status,
    closes_at,
    allow_multiple,
    max_choices,
    allow_own_child_votes,
    allow_vote_changes,
    hide_votes,
    allow_comments,
    created_by,
    created_by_name
  )
  values (
    match_row.club_id,
    match_row.team_id,
    'Player of the Match',
    'Vote for your Player of the Match: ' || coalesce(match_row.opponent, 'Match Day'),
    'parents',
    'awards',
    option_rows,
    'open',
    timezone('utc', now()) + make_interval(hours => greatest(coalesce(match_row.motm_poll_expiry_hours, 2), 1)),
    false,
    1,
    true,
    false,
    false,
    false,
    match_row.created_by,
    coalesce(match_row.created_by_name, 'Match Day')
  )
  returning id into poll_id_value;

  update public.match_days
  set motm_poll_id = poll_id_value,
      updated_at = now()
  where id = match_row.id
    and motm_poll_id is null;

  return poll_id_value;
end;
$$;

grant execute on function public.create_match_day_motm_poll(uuid) to authenticated;

update public.polls
set title = 'Player of the Match',
    description = replace(coalesce(description, ''), 'Man of the Match', 'Player of the Match'),
    allow_own_child_votes = true,
    updated_at = now()
where title = 'Man of the Match'
  or description ilike '%Man of the Match%';
