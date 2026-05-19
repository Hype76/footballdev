alter table public.match_days
add column if not exists enable_motm_poll boolean not null default true,
add column if not exists motm_poll_expiry_hours integer not null default 2,
add column if not exists motm_poll_id uuid references public.polls (id) on delete set null;

alter table public.match_days
drop constraint if exists match_days_motm_poll_expiry_hours_check;

alter table public.match_days
add constraint match_days_motm_poll_expiry_hours_check
check (motm_poll_expiry_hours between 1 and 72);

create unique index if not exists match_days_motm_poll_id_key
on public.match_days (motm_poll_id)
where motm_poll_id is not null;

create or replace function public.create_match_day_motm_poll(target_match_day_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.match_days%rowtype;
  poll_id_value uuid;
  option_rows jsonb;
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
        'label', coalesce(nullif(player.shirt_number, ''), '') ||
          case when nullif(player.shirt_number, '') is null then '' else ' - ' end ||
          player.player_name,
        'value', player.player_name,
        'playerId', player.id::text
      )
      order by player.player_name
    ),
    '[]'::jsonb
  )
  into option_rows
  from public.players player
  where player.club_id = match_row.club_id
    and (match_row.team_id is null or player.team_id = match_row.team_id)
    and coalesce(player.status, 'active') <> 'archived'
    and player.section = 'Squad';

  if jsonb_array_length(option_rows) < 2 then
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
    'Man of the Match',
    'Vote for your Man of the Match: ' || coalesce(match_row.opponent, 'Match Day'),
    'parents',
    'awards',
    option_rows,
    'open',
    timezone('utc', now()) + make_interval(hours => greatest(coalesce(match_row.motm_poll_expiry_hours, 2), 1)),
    false,
    1,
    false,
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

create or replace function public.create_match_day_motm_poll_on_full_time()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'full_time'
    and old.status is distinct from new.status
    and new.enable_motm_poll is true
    and new.motm_poll_id is null then
    perform public.create_match_day_motm_poll(new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists create_match_day_motm_poll_on_full_time on public.match_days;

create trigger create_match_day_motm_poll_on_full_time
after update of status on public.match_days
for each row
execute function public.create_match_day_motm_poll_on_full_time();
