create or replace function public.submit_match_day_availability_response(
  token_hash_value text,
  status_value text,
  volunteer_scorer_response_value text default null,
  volunteer_linesman_response_value text default null,
  volunteer_referee_response_value text default null
)
returns table (
  request_id uuid,
  player_name text,
  response_status text,
  responded_at timestamptz,
  volunteer_scorer_response text,
  volunteer_linesman_response text,
  volunteer_referee_response text,
  volunteer_responded_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_token_hash text := lower(trim(coalesce(token_hash_value, '')));
  normalized_status text := lower(trim(coalesce(status_value, '')));
  scorer_response text := lower(trim(coalesce(volunteer_scorer_response_value, '')));
  linesman_response text := lower(trim(coalesce(volunteer_linesman_response_value, '')));
  referee_response text := lower(trim(coalesce(volunteer_referee_response_value, '')));
  request_row public.match_day_availability_requests%rowtype;
  updated_row public.match_day_availability_requests%rowtype;
  match_row public.match_days%rowtype;
  link_row public.parent_player_links%rowtype;
  next_scorer_response text;
  next_linesman_response text;
  next_referee_response text;
  should_stamp_volunteer boolean := false;
begin
  if normalized_token_hash !~ '^[a-f0-9]{64}$' then
    return;
  end if;

  if normalized_status not in ('available', 'unavailable', 'maybe') then
    return;
  end if;

  if scorer_response not in ('yes', 'no') then
    scorer_response := null;
  end if;

  if linesman_response not in ('yes', 'no') then
    linesman_response := null;
  end if;

  if referee_response not in ('yes', 'no') then
    referee_response := null;
  end if;

  select availability.*
  into request_row
  from public.match_day_availability_requests as availability
  where availability.token_hash = normalized_token_hash
  limit 1;

  if request_row.id is null then
    return;
  end if;

  select match_day.*
  into match_row
  from public.match_days as match_day
  where match_day.id = request_row.match_day_id
    and match_day.club_id = request_row.club_id
  limit 1;

  if match_row.id is null then
    return;
  end if;

  if request_row.status = 'expired' or request_row.expires_at < timezone('utc', now()) then
    update public.match_day_availability_requests as availability
    set status = 'expired',
        updated_at = timezone('utc', now())
    where availability.id = request_row.id
      and availability.status = 'pending'
    returning availability.*
    into updated_row;

    if updated_row.id is null then
      updated_row := request_row;
    end if;

    request_id := updated_row.id;
    player_name := updated_row.player_name;
    response_status := 'expired';
    responded_at := updated_row.responded_at;
    volunteer_scorer_response := updated_row.volunteer_scorer_response;
    volunteer_linesman_response := updated_row.volunteer_linesman_response;
    volunteer_referee_response := updated_row.volunteer_referee_response;
    volunteer_responded_at := updated_row.volunteer_responded_at;
    return next;
    return;
  end if;

  next_scorer_response := case
    when coalesce(match_row.request_scorer, false) then coalesce(scorer_response, request_row.volunteer_scorer_response, 'no_response')
    else 'no_response'
  end;
  next_linesman_response := case
    when coalesce(match_row.request_linesman, false) then coalesce(linesman_response, request_row.volunteer_linesman_response, 'no_response')
    else 'no_response'
  end;
  next_referee_response := case
    when coalesce(match_row.request_referee, false) then coalesce(referee_response, request_row.volunteer_referee_response, 'no_response')
    else 'no_response'
  end;
  should_stamp_volunteer :=
    (coalesce(match_row.request_scorer, false) and scorer_response in ('yes', 'no'))
    or (coalesce(match_row.request_linesman, false) and linesman_response in ('yes', 'no'))
    or (coalesce(match_row.request_referee, false) and referee_response in ('yes', 'no'));

  update public.match_day_availability_requests as availability
  set status = normalized_status,
      responded_at = timezone('utc', now()),
      volunteer_scorer_response = next_scorer_response,
      volunteer_linesman_response = next_linesman_response,
      volunteer_referee_response = next_referee_response,
      volunteer_responded_at = case
        when should_stamp_volunteer then timezone('utc', now())
        else availability.volunteer_responded_at
      end,
      updated_at = timezone('utc', now())
  where availability.id = request_row.id
  returning availability.*
  into updated_row;

  if coalesce(match_row.request_scorer, false)
    and updated_row.parent_link_id is not null
    and next_scorer_response in ('yes', 'no') then
    select parent_link.*
    into link_row
    from public.parent_player_links as parent_link
    where parent_link.id = updated_row.parent_link_id
      and parent_link.status = 'active'
    limit 1;

    if link_row.id is not null and next_scorer_response = 'yes' then
      insert into public.match_day_scorer_interest (
        match_day_id,
        club_id,
        team_id,
        parent_link_id,
        auth_user_id,
        parent_name,
        parent_email,
        message,
        status
      )
      values (
        match_row.id,
        match_row.club_id,
        match_row.team_id,
        link_row.id,
        link_row.auth_user_id,
        coalesce(nullif(updated_row.recipient_name, ''), updated_row.recipient_email),
        updated_row.recipient_email,
        'Availability response volunteer',
        'interested'
      )
      on conflict (match_day_id, parent_link_id)
      do update
      set parent_name = excluded.parent_name,
          parent_email = excluded.parent_email,
          message = excluded.message,
          status = 'interested',
          updated_at = timezone('utc', now())
      where public.match_day_scorer_interest.status <> 'selected';
    elsif link_row.id is not null and next_scorer_response = 'no' then
      update public.match_day_scorer_interest as scorer_interest
      set status = 'declined',
          updated_at = timezone('utc', now())
      where scorer_interest.match_day_id = match_row.id
        and scorer_interest.parent_link_id = link_row.id
        and scorer_interest.status <> 'selected';
    end if;
  end if;

  request_id := updated_row.id;
  player_name := updated_row.player_name;
  response_status := updated_row.status;
  responded_at := updated_row.responded_at;
  volunteer_scorer_response := updated_row.volunteer_scorer_response;
  volunteer_linesman_response := updated_row.volunteer_linesman_response;
  volunteer_referee_response := updated_row.volunteer_referee_response;
  volunteer_responded_at := updated_row.volunteer_responded_at;
  return next;
end;
$$;

revoke all on function public.submit_match_day_availability_response(text, text, text, text, text) from public;
grant execute on function public.submit_match_day_availability_response(text, text, text, text, text) to anon;
grant execute on function public.submit_match_day_availability_response(text, text, text, text, text) to authenticated;

comment on function public.submit_match_day_availability_response(text, text, text, text, text) is
  'Stores a token-scoped Match Day availability response and requested volunteer role responses.';
