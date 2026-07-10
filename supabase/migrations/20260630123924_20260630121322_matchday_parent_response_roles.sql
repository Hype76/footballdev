alter table public.match_day_availability_requests
  add column if not exists parent_link_id uuid references public.parent_player_links (id) on delete set null,
  add column if not exists volunteer_scorer_response text not null default 'no_response',
  add column if not exists volunteer_linesman_response text not null default 'no_response',
  add column if not exists volunteer_referee_response text not null default 'no_response',
  add column if not exists volunteer_responded_at timestamptz;

alter table public.match_day_availability_requests
  drop constraint if exists match_day_availability_volunteer_scorer_response_check,
  drop constraint if exists match_day_availability_volunteer_linesman_response_check,
  drop constraint if exists match_day_availability_volunteer_referee_response_check;

alter table public.match_day_availability_requests
  add constraint match_day_availability_volunteer_scorer_response_check
    check (volunteer_scorer_response in ('no_response', 'yes', 'no')),
  add constraint match_day_availability_volunteer_linesman_response_check
    check (volunteer_linesman_response in ('no_response', 'yes', 'no')),
  add constraint match_day_availability_volunteer_referee_response_check
    check (volunteer_referee_response in ('no_response', 'yes', 'no'));

create index if not exists match_day_availability_parent_link_idx
on public.match_day_availability_requests (parent_link_id, match_day_id);

create or replace function public.get_match_day_availability_response(token_hash_value text)
returns table (
  request_id uuid,
  player_id uuid,
  player_name text,
  recipient_name text,
  recipient_email text,
  response_status text,
  responded_at timestamptz,
  expires_at timestamptz,
  match_day_id uuid,
  team_name text,
  opponent text,
  match_date date,
  kickoff_time time,
  arrival_time time,
  venue_name text,
  venue_address text,
  request_scorer boolean,
  request_linesman boolean,
  request_referee boolean,
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
  request_row public.match_day_availability_requests%rowtype;
begin
  if normalized_token_hash !~ '^[a-f0-9]{64}$' then
    return;
  end if;

  select *
  into request_row
  from public.match_day_availability_requests
  where token_hash = normalized_token_hash
  limit 1;

  if request_row.id is null then
    return;
  end if;

  if request_row.status = 'expired' or request_row.expires_at < timezone('utc', now()) then
    update public.match_day_availability_requests
    set status = 'expired',
        updated_at = timezone('utc', now())
    where id = request_row.id
      and status = 'pending'
    returning *
    into request_row;

    if request_row.id is null then
      select *
      into request_row
      from public.match_day_availability_requests
      where token_hash = normalized_token_hash
      limit 1;
    end if;
  end if;

  return query
  select
    request_row.id,
    request_row.player_id,
    request_row.player_name,
    request_row.recipient_name,
    request_row.recipient_email,
    request_row.status,
    request_row.responded_at,
    request_row.expires_at,
    match_day.id,
    coalesce(team.name, '') as team_name,
    match_day.opponent,
    match_day.match_date,
    match_day.kickoff_time,
    match_day.arrival_time,
    match_day.venue_name,
    match_day.venue_address,
    match_day.request_scorer,
    match_day.request_linesman,
    match_day.request_referee,
    request_row.volunteer_scorer_response,
    request_row.volunteer_linesman_response,
    request_row.volunteer_referee_response,
    request_row.volunteer_responded_at
  from public.match_days match_day
  left join public.teams team
    on team.id = match_day.team_id
  where match_day.id = request_row.match_day_id
    and match_day.club_id = request_row.club_id;
end;
$$;

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

  select *
  into request_row
  from public.match_day_availability_requests
  where token_hash = normalized_token_hash
  limit 1;

  if request_row.id is null then
    return;
  end if;

  select *
  into match_row
  from public.match_days
  where id = request_row.match_day_id
    and club_id = request_row.club_id
  limit 1;

  if match_row.id is null then
    return;
  end if;

  if request_row.status = 'expired' or request_row.expires_at < timezone('utc', now()) then
    update public.match_day_availability_requests
    set status = 'expired',
        updated_at = timezone('utc', now())
    where id = request_row.id
      and status = 'pending'
    returning *
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

  update public.match_day_availability_requests
  set status = normalized_status,
      responded_at = timezone('utc', now()),
      volunteer_scorer_response = next_scorer_response,
      volunteer_linesman_response = next_linesman_response,
      volunteer_referee_response = next_referee_response,
      volunteer_responded_at = case
        when should_stamp_volunteer then timezone('utc', now())
        else volunteer_responded_at
      end,
      updated_at = timezone('utc', now())
  where id = request_row.id
  returning *
  into updated_row;

  if coalesce(match_row.request_scorer, false)
    and updated_row.parent_link_id is not null
    and next_scorer_response in ('yes', 'no') then
    select *
    into link_row
    from public.parent_player_links
    where id = updated_row.parent_link_id
      and status = 'active'
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
      update public.match_day_scorer_interest
      set status = 'declined',
          updated_at = timezone('utc', now())
      where match_day_id = match_row.id
        and parent_link_id = link_row.id
        and status <> 'selected';
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

create or replace function public.confirm_match_day_availability(
  token_hash_value text,
  status_value text
)
returns table (
  request_id uuid,
  player_name text,
  response_status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    response.request_id,
    response.player_name,
    response.response_status
  from public.submit_match_day_availability_response(
    token_hash_value,
    status_value,
    null,
    null,
    null
  ) as response;
end;
$$;

drop function if exists public.get_parent_portal_match_days(uuid);

create function public.get_parent_portal_match_days(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  team_name text,
  opponent text,
  match_date date,
  kickoff_time time,
  arrival_time time,
  home_away text,
  venue_name text,
  venue_address text,
  notes text,
  scorer_request_message text,
  request_scorer boolean,
  request_linesman boolean,
  request_referee boolean,
  status text,
  home_score integer,
  away_score integer,
  created_at timestamptz,
  updated_at timestamptz,
  phase_started_at timestamptz,
  availability_status text,
  availability_responded_at timestamptz,
  volunteer_scorer_response text,
  volunteer_linesman_response text,
  volunteer_referee_response text,
  volunteer_responded_at timestamptz,
  has_interest boolean,
  is_scorer boolean,
  events jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with parent_link as (
    select *
    from public.parent_player_links
    where id = parent_link_id_value
      and auth_user_id = auth.uid()
      and status = 'active'
    limit 1
  )
  select
    match_day.id,
    match_day.club_id,
    match_day.team_id,
    coalesce(team.name, '') as team_name,
    match_day.opponent,
    match_day.match_date,
    match_day.kickoff_time,
    match_day.arrival_time,
    match_day.home_away,
    match_day.venue_name,
    match_day.venue_address,
    match_day.notes,
    match_day.scorer_request_message,
    match_day.request_scorer,
    match_day.request_linesman,
    match_day.request_referee,
    match_day.status,
    match_day.home_score,
    match_day.away_score,
    match_day.created_at,
    match_day.updated_at,
    match_day.phase_started_at,
    availability.status as availability_status,
    availability.responded_at as availability_responded_at,
    coalesce(availability.volunteer_scorer_response, 'no_response') as volunteer_scorer_response,
    coalesce(availability.volunteer_linesman_response, 'no_response') as volunteer_linesman_response,
    coalesce(availability.volunteer_referee_response, 'no_response') as volunteer_referee_response,
    availability.volunteer_responded_at,
    exists (
      select 1
      from public.match_day_scorer_interest interest
      where interest.match_day_id = match_day.id
        and interest.parent_link_id = parent_link_id_value
        and interest.status <> 'declined'
    ) as has_interest,
    exists (
      select 1
      from public.match_day_scorer_assignments assignment
      where assignment.match_day_id = match_day.id
        and assignment.parent_link_id = parent_link_id_value
        and assignment.auth_user_id = auth.uid()
    ) as is_scorer,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', event.id,
            'eventType', event.event_type,
            'teamSide', event.team_side,
            'minute', event.minute,
            'scorerName', event.scorer_name,
            'scorerInitials', event.scorer_initials,
            'scorerShirtNumber', event.scorer_shirt_number,
            'assistName', event.assist_name,
            'assistInitials', event.assist_initials,
            'assistShirtNumber', event.assist_shirt_number,
            'homeScore', event.home_score,
            'awayScore', event.away_score,
            'notes', event.notes,
            'createdByName', event.created_by_name,
            'createdAt', event.created_at
          )
          order by event.created_at desc
        )
        from public.match_day_events event
        where event.match_day_id = match_day.id
      ),
      '[]'::jsonb
    ) as events
  from public.match_days match_day
  join parent_link link
    on link.club_id = match_day.club_id
  left join public.teams team
    on team.id = match_day.team_id
  left join lateral (
    select request.*
    from public.match_day_availability_requests request
    where request.match_day_id = match_day.id
      and request.club_id = link.club_id
      and request.player_id = link.player_id
      and request.status <> 'expired'
      and (
        request.parent_link_id = link.id
        or lower(request.recipient_email) = lower(coalesce(link.email, ''))
      )
    order by request.created_at desc
    limit 1
  ) availability on true
  where auth.uid() is not null
    and match_day.parent_visible is true
    and match_day.parent_audience <> 'none'
    and match_day.status in ('scorer_request', 'live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time', 'scheduled')
    and match_day.previous_hidden_at is null
    and (
      (
        match_day.parent_audience = 'involved_players'
        and exists (
          select 1
          from public.match_day_availability_requests request
          where request.match_day_id = match_day.id
            and request.club_id = link.club_id
            and request.player_id = link.player_id
            and request.status <> 'expired'
        )
      )
      or (
        match_day.parent_audience = 'all_team_parents'
        and match_day.team_id is not null
        and match_day.team_id = link.team_id
      )
      or (
        match_day.parent_audience = 'all_club_parents'
        and match_day.club_id = link.club_id
      )
    )
    and (
      match_day.match_date is null
      or match_day.match_date >= (timezone('Europe/London', now())::date - 365)
    )
  order by match_day.match_date asc nulls last, match_day.kickoff_time asc nulls last, match_day.created_at desc;
$$;

revoke all on function public.get_match_day_availability_response(text) from public;
revoke all on function public.submit_match_day_availability_response(text, text, text, text, text) from public;
revoke all on function public.confirm_match_day_availability(text, text) from public;
revoke all on function public.get_parent_portal_match_days(uuid) from public;
revoke execute on function public.get_parent_portal_match_days(uuid) from anon;

grant execute on function public.get_match_day_availability_response(text) to anon;
grant execute on function public.get_match_day_availability_response(text) to authenticated;
grant execute on function public.submit_match_day_availability_response(text, text, text, text, text) to anon;
grant execute on function public.submit_match_day_availability_response(text, text, text, text, text) to authenticated;
grant execute on function public.confirm_match_day_availability(text, text) to anon;
grant execute on function public.confirm_match_day_availability(text, text) to authenticated;
grant execute on function public.get_parent_portal_match_days(uuid) to authenticated;
grant execute on function public.get_parent_portal_match_days(uuid) to service_role;

comment on column public.match_day_availability_requests.parent_link_id is
  'Optional parent portal link used to connect token responses to scorer volunteer selection.';

comment on column public.match_day_availability_requests.volunteer_scorer_response is
  'Parent response to the scorer volunteer request for this fixture.';

comment on column public.match_day_availability_requests.volunteer_linesman_response is
  'Parent response to the linesman volunteer request for this fixture.';

comment on column public.match_day_availability_requests.volunteer_referee_response is
  'Parent response to the referee volunteer request for this fixture.';

comment on function public.get_match_day_availability_response(text) is
  'Returns token-scoped Match Day availability and volunteer prompt context without requiring sign in.';

comment on function public.submit_match_day_availability_response(text, text, text, text, text) is
  'Stores a token-scoped Match Day availability response and requested volunteer role responses.';
