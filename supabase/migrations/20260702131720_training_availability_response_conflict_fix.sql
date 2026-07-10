create or replace function public.submit_training_availability_response(
  token_hash_value text,
  status_value text,
  note_value text default ''
)
returns table (
  request_player_id uuid,
  request_id uuid,
  player_name text,
  response_status text,
  response_note text,
  responded_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  normalized_token_hash text := lower(trim(coalesce(token_hash_value, '')));
  normalized_status text := lower(trim(coalesce(status_value, '')));
  normalized_note text := left(trim(coalesce(note_value, '')), 1000);
  request_player_row public.training_availability_request_players%rowtype;
  link_row public.parent_player_links%rowtype;
  response_row public.training_availability_responses%rowtype;
  actor_name text := '';
  actor_email text := '';
begin
  if normalized_token_hash !~ '^[a-f0-9]{64}$' then
    return;
  end if;

  if normalized_status not in ('available', 'unavailable', 'maybe') then
    return;
  end if;

  select request_player.*
  into request_player_row
  from public.training_availability_request_players request_player
  where request_player.token_hash = normalized_token_hash
  limit 1;

  if request_player_row.id is null or request_player_row.status = 'cancelled' then
    return;
  end if;

  if request_player_row.parent_link_id is not null then
    select parent_link.*
    into link_row
    from public.parent_player_links parent_link
    where parent_link.id = request_player_row.parent_link_id
      and parent_link.club_id = request_player_row.club_id
      and parent_link.team_id = request_player_row.team_id
      and parent_link.player_id = request_player_row.player_id
      and parent_link.status = 'active'
    limit 1;

    if link_row.id is null then
      return;
    end if;
  end if;

  actor_email := coalesce(nullif(request_player_row.recipient_email, ''), link_row.email, '');
  actor_name := coalesce(nullif(request_player_row.recipient_name, ''), nullif(actor_email, ''), 'Parent');

  insert into public.training_availability_responses (
    request_player_id,
    request_id,
    club_id,
    team_id,
    calendar_event_id,
    player_id,
    parent_link_id,
    status,
    note,
    responded_by_name,
    responded_by_email,
    responded_at
  )
  values (
    request_player_row.id,
    request_player_row.request_id,
    request_player_row.club_id,
    request_player_row.team_id,
    request_player_row.calendar_event_id,
    request_player_row.player_id,
    request_player_row.parent_link_id,
    normalized_status,
    normalized_note,
    actor_name,
    actor_email,
    timezone('utc', now())
  )
  on conflict (request_id, player_id)
  do update
  set request_player_id = excluded.request_player_id,
      parent_link_id = excluded.parent_link_id,
      status = excluded.status,
      note = excluded.note,
      responded_by_name = excluded.responded_by_name,
      responded_by_email = excluded.responded_by_email,
      responded_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  returning *
  into response_row;

  update public.training_availability_request_players request_player
  set status = 'responded',
      responded_at = response_row.responded_at,
      updated_at = timezone('utc', now())
  where request_player.id = request_player_row.id;

  request_player_id := response_row.request_player_id;
  request_id := response_row.request_id;
  player_name := request_player_row.player_name;
  response_status := response_row.status;
  response_note := response_row.note;
  responded_at := response_row.responded_at;
  return next;
end;
$$;

revoke all on function public.submit_training_availability_response(text, text, text) from public;
grant execute on function public.submit_training_availability_response(text, text, text) to anon, authenticated;
