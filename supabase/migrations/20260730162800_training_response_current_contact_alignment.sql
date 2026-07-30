create or replace function public.is_training_availability_token_current_internal(token_hash_value text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.training_availability_request_players request_player
    join public.training_availability_requests request
      on request.id = request_player.request_id
      and request.calendar_event_id = request_player.calendar_event_id
      and request.club_id = request_player.club_id
      and request.team_id = request_player.team_id
    join public.calendar_events event
      on event.id = request.calendar_event_id
      and event.club_id = request.club_id
      and event.team_id = request.team_id
    join public.players player
      on player.id = request_player.player_id
      and player.club_id = request_player.club_id
      and player.team_id = request_player.team_id
    where request_player.token_hash = lower(btrim(coalesce(token_hash_value, '')))
      and lower(btrim(coalesce(token_hash_value, ''))) ~ '^[a-f0-9]{64}$'
      and lower(coalesce(request_player.status, '')) not in ('cancelled', 'expired')
      and lower(coalesce(request.status, '')) not in ('cancelled', 'expired')
      and event.cancelled_at is null
      and lower(coalesce(player.status, 'active')) <> 'archived'
      and (
        (
          request_player.parent_link_id is not null
          and exists (
            select 1
            from public.parent_player_links parent_link
            where parent_link.id = request_player.parent_link_id
              and parent_link.club_id = request_player.club_id
              and parent_link.team_id = request_player.team_id
              and parent_link.player_id = request_player.player_id
              and parent_link.status = 'active'
              and lower(btrim(coalesce(parent_link.email, '')))
                = lower(btrim(request_player.recipient_email))
          )
        )
        or (
          request_player.parent_link_id is null
          and request_player.recipient_type = 'player'
          and player.contact_type = 'self'
          and lower(btrim(coalesce(player.parent_email, '')))
            = lower(btrim(request_player.recipient_email))
        )
        or (
          request_player.parent_link_id is null
          and request_player.recipient_type = 'parent'
          and coalesce(player.contact_type, 'parent') <> 'self'
          and lower(btrim(coalesce(player.parent_email, '')))
            = lower(btrim(request_player.recipient_email))
          and not exists (
            select 1
            from public.parent_player_links active_parent_link
            where active_parent_link.club_id = request_player.club_id
              and active_parent_link.team_id = request_player.team_id
              and active_parent_link.player_id = request_player.player_id
              and active_parent_link.status = 'active'
          )
        )
      )
  )
$$;

create or replace function public.get_training_availability_response(token_hash_value text)
returns table (
  request_player_id uuid,
  request_id uuid,
  calendar_event_id uuid,
  player_id uuid,
  player_name text,
  recipient_name text,
  recipient_email text,
  response_status text,
  response_note text,
  responded_at timestamptz,
  team_name text,
  event_title text,
  occurrence_date date,
  occurrence_starts_at timestamptz,
  occurrence_ends_at timestamptz,
  location text,
  notes text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_token_hash text := lower(btrim(coalesce(token_hash_value, '')));
  request_player_row public.training_availability_request_players%rowtype;
begin
  if not public.is_training_availability_token_current_internal(normalized_token_hash) then
    return;
  end if;

  select request_player.*
  into request_player_row
  from public.training_availability_request_players request_player
  where request_player.token_hash = normalized_token_hash
  limit 1;

  return query
  select
    request_player_row.id,
    request_player_row.request_id,
    request_player_row.calendar_event_id,
    request_player_row.player_id,
    request_player_row.player_name,
    request_player_row.recipient_name,
    request_player_row.recipient_email,
    response.status,
    coalesce(response.note, ''),
    response.responded_at,
    coalesce(team.name, '') as team_name,
    event.title,
    request.occurrence_date,
    request.occurrence_starts_at,
    request.occurrence_ends_at,
    event.location,
    event.notes
  from public.training_availability_requests request
  join public.calendar_events event
    on event.id = request.calendar_event_id
  left join public.teams team
    on team.id = request.team_id
  left join public.training_availability_responses response
    on response.request_player_id = request_player_row.id
  where request.id = request_player_row.request_id;
end;
$$;

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
set search_path = ''
as $$
#variable_conflict use_column
declare
  normalized_token_hash text := lower(btrim(coalesce(token_hash_value, '')));
  normalized_status text := lower(btrim(coalesce(status_value, '')));
  normalized_note text := left(btrim(coalesce(note_value, '')), 1000);
  request_player_row public.training_availability_request_players%rowtype;
  response_row public.training_availability_responses%rowtype;
  actor_name text := '';
  actor_email text := '';
begin
  if normalized_status not in ('available', 'unavailable', 'maybe') then
    return;
  end if;

  if not public.is_training_availability_token_current_internal(normalized_token_hash) then
    return;
  end if;

  select request_player.*
  into request_player_row
  from public.training_availability_request_players request_player
  where request_player.token_hash = normalized_token_hash
  limit 1;

  actor_email := coalesce(request_player_row.recipient_email, '');
  actor_name := coalesce(
    nullif(request_player_row.recipient_name, ''),
    nullif(actor_email, ''),
    'Parent'
  );

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

revoke all on function public.is_training_availability_token_current_internal(text) from public, anon, authenticated;
grant execute on function public.is_training_availability_token_current_internal(text) to service_role;

revoke all on function public.get_training_availability_response(text) from public;
revoke all on function public.submit_training_availability_response(text, text, text) from public;
grant execute on function public.get_training_availability_response(text) to anon, authenticated;
grant execute on function public.submit_training_availability_response(text, text, text) to anon, authenticated;

comment on function public.is_training_availability_token_current_internal(text) is
  'Validates training response tokens against the current server-resolved player or parent contact.';
