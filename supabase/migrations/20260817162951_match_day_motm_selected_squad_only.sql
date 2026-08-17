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
    jsonb_build_object('teamId', match_row.team_id, 'matchDayId', match_row.id, 'pollType', 'awards')
  );

  return poll_id_value;
end;
$$;

alter function public.create_match_day_motm_poll(uuid) owner to postgres;
revoke all on function public.create_match_day_motm_poll(uuid)
  from public, anon, authenticated, service_role;

with expanded_options as (
  select
    match_day.id as match_day_id,
    poll.id as poll_id,
    option_row.value as option_value,
    option_row.ordinality,
    exists (
      select 1
      from public.match_day_player_squad_decisions decision
      join public.players player
        on player.id = decision.player_id
        and player.club_id = decision.club_id
        and player.team_id = decision.team_id
      where decision.match_day_id = match_day.id
        and decision.club_id = match_day.club_id
        and decision.team_id = match_day.team_id
        and decision.status = 'selected'
        and player.archived_at is null
        and coalesce(player.status, 'active') <> 'archived'
        and player.section = 'Squad'
        and player.id::text = coalesce(option_row.value ->> 'playerId', option_row.value ->> 'id')
    ) as is_selected_player,
    exists (
      select 1
      from public.poll_votes vote
      where vote.poll_id = poll.id
        and vote.option_id = coalesce(option_row.value ->> 'id', option_row.value ->> 'playerId')
    ) as has_recorded_vote
  from public.match_days match_day
  join public.polls poll
    on poll.id = match_day.motm_poll_id
    and poll.status = 'open'
    and poll.poll_type = 'awards'
    and lower(poll.title) = 'player of the match'
  cross join lateral jsonb_array_elements(coalesce(poll.options, '[]'::jsonb))
    with ordinality as option_row(value, ordinality)
), scored_options as (
  select
    expanded_options.*,
    count(*) filter (where is_selected_player) over (partition by poll_id) as selected_player_count
  from expanded_options
), rebuilt_polls as (
  select
    poll_id,
    coalesce(
      jsonb_agg(option_value order by ordinality) filter (
        where (
          selected_player_count > 0
          and (is_selected_player or has_recorded_vote)
        ) or (
          selected_player_count = 0
          and (
            has_recorded_vote
            or not (coalesce(option_value ->> 'label', '') ilike 'FP TEST%')
          )
        )
      ),
      '[]'::jsonb
    ) as reconciled_options
  from scored_options
  group by poll_id
)
update public.polls poll
set options = rebuilt.reconciled_options,
    updated_at = timezone('utc', now())
from rebuilt_polls rebuilt
where poll.id = rebuilt.poll_id
  and poll.options is distinct from rebuilt.reconciled_options;
