alter table public.match_days
  drop constraint if exists match_days_motm_poll_expiry_hours_check;

alter table public.match_days
  alter column motm_poll_expiry_hours type numeric(8, 4)
    using motm_poll_expiry_hours::numeric,
  alter column motm_poll_expiry_hours set default 2;

alter table public.match_days
  add constraint match_days_motm_poll_expiry_hours_check
  check (motm_poll_expiry_hours between (1.0 / 60.0) and 720);

comment on column public.match_days.motm_poll_expiry_hours is
  'Player of the Match poll duration in decimal hours. The UI accepts DD:HH:MM from one minute to 30 days.';

create or replace function public.create_match_day_motm_poll(target_match_day_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  option_rows jsonb;
  poll_id_value uuid;
  audit_actor_id uuid;
begin
  if target_match_day_id is null then
    return null;
  end if;

  select match_day.*
  into match_row
  from public.match_days match_day
  where match_day.id = target_match_day_id
  for update;

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
        'label', btrim(concat(
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
  from public.match_day_player_squad_decisions decision
  join public.players player
    on player.id = decision.player_id
    and player.club_id = decision.club_id
    and player.team_id = decision.team_id
  where decision.match_day_id = match_row.id
    and decision.club_id = match_row.club_id
    and decision.team_id = match_row.team_id
    and decision.status = 'selected'
    and player.archived_at is null
    and coalesce(player.status, 'active') <> 'archived'
    and player.section = 'Squad';

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
    notify_results_on_close,
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
    timezone('utc', now()) + make_interval(
      mins => greatest(round(coalesce(match_row.motm_poll_expiry_hours, 2) * 60)::integer, 1)
    ),
    false,
    1,
    true,
    false,
    false,
    false,
    match_row.motm_notify_results_on_close,
    match_row.created_by,
    coalesce(match_row.created_by_name, 'Match Day')
  )
  returning id into poll_id_value;

  update public.match_days match_day
  set motm_poll_id = poll_id_value,
      updated_at = timezone('utc', now())
  where match_day.id = match_row.id;

  audit_actor_id := coalesce((select auth.uid()), match_row.created_by);

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    match_row.club_id,
    audit_actor_id,
    'match_day_poll_created',
    'poll',
    poll_id_value,
    jsonb_build_object(
      'teamId', match_row.team_id,
      'matchDayId', match_row.id,
      'pollType', 'awards',
      'notifyResultsOnClose', match_row.motm_notify_results_on_close,
      'expiryMinutes', greatest(round(coalesce(match_row.motm_poll_expiry_hours, 2) * 60)::integer, 1)
    )
  );

  return poll_id_value;
end;
$$;

alter function public.create_match_day_motm_poll(uuid) owner to postgres;
revoke all on function public.create_match_day_motm_poll(uuid)
  from public, anon, authenticated, service_role;
