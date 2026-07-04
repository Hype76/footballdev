alter table public.match_day_availability_requests
  add column if not exists transport_needs_lift boolean not null default false,
  add column if not exists transport_can_offer_lift boolean not null default false,
  add column if not exists transport_seats_offered integer not null default 0,
  add column if not exists transport_responded_at timestamptz;

alter table public.match_day_availability_requests
  drop constraint if exists match_day_availability_transport_seats_check;

alter table public.match_day_availability_requests
  add constraint match_day_availability_transport_seats_check
  check (
    transport_seats_offered >= 0
    and (
      transport_can_offer_lift is true
      or transport_seats_offered = 0
    )
  );

drop function if exists public.get_match_day_availability_response_v2(text);

create or replace function public.get_match_day_availability_response_v2(token_hash_value text)
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
  current_availability_status text,
  current_availability_selected_by_name text,
  current_availability_selected_by_email text,
  current_availability_selected_at timestamptz,
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
  volunteer_responded_at timestamptz,
  transport_needs_lift boolean,
  transport_can_offer_lift boolean,
  transport_seats_offered integer,
  transport_responded_at timestamptz
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

  select request.*
  into request_row
  from public.match_day_availability_requests as request
  where request.token_hash = normalized_token_hash
  limit 1;

  if request_row.id is null then
    return;
  end if;

  if request_row.status = 'expired' or request_row.expires_at < timezone('utc', now()) then
    update public.match_day_availability_requests as request
    set status = 'expired',
        updated_at = timezone('utc', now())
    where request.id = request_row.id
      and request.status = 'pending'
    returning request.*
    into request_row;

    if request_row.id is null then
      select request.*
      into request_row
      from public.match_day_availability_requests as request
      where request.token_hash = normalized_token_hash
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
    coalesce(current_availability.status, nullif(request_row.status, 'pending'), 'pending') as current_availability_status,
    coalesce(current_availability.selected_by_name, '') as current_availability_selected_by_name,
    coalesce(current_availability.selected_by_email, '') as current_availability_selected_by_email,
    current_availability.selected_at as current_availability_selected_at,
    coalesce(team.name, '') as team_name,
    match_day.opponent,
    match_day.match_date,
    match_day.kickoff_time,
    match_day.arrival_time,
    match_day.venue_name,
    match_day.venue_address,
    coalesce(match_day.request_scorer, false),
    coalesce(match_day.request_linesman, false),
    coalesce(match_day.request_referee, false),
    coalesce(request_row.volunteer_scorer_response, 'no_response'),
    coalesce(request_row.volunteer_linesman_response, 'no_response'),
    coalesce(request_row.volunteer_referee_response, 'no_response'),
    request_row.volunteer_responded_at,
    coalesce(request_row.transport_needs_lift, false),
    coalesce(request_row.transport_can_offer_lift, false),
    coalesce(request_row.transport_seats_offered, 0),
    request_row.transport_responded_at
  from public.match_days as match_day
  left join public.teams as team
    on team.id = match_day.team_id
  left join public.match_day_player_availability as current_availability
    on current_availability.match_day_id = request_row.match_day_id
    and current_availability.player_id = request_row.player_id
  where match_day.id = request_row.match_day_id
    and match_day.club_id = request_row.club_id;
end;
$$;

drop function if exists public.confirm_match_day_availability(text, text);
drop function if exists public.submit_match_day_availability_response(text, text, text, text, text);

create or replace function public.submit_match_day_availability_response(
  token_hash_value text,
  status_value text,
  volunteer_scorer_response_value text default null,
  volunteer_linesman_response_value text default null,
  volunteer_referee_response_value text default null,
  transport_needs_lift_value boolean default null,
  transport_can_offer_lift_value boolean default null,
  transport_seats_offered_value integer default null
)
returns table (
  request_id uuid,
  player_name text,
  response_status text,
  responded_at timestamptz,
  volunteer_scorer_response text,
  volunteer_linesman_response text,
  volunteer_referee_response text,
  volunteer_responded_at timestamptz,
  transport_needs_lift boolean,
  transport_can_offer_lift boolean,
  transport_seats_offered integer,
  transport_responded_at timestamptz
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
  previous_current public.match_day_player_availability%rowtype;
  next_current public.match_day_player_availability%rowtype;
  next_scorer_response text;
  next_linesman_response text;
  next_referee_response text;
  next_transport_needs_lift boolean := false;
  next_transport_can_offer_lift boolean := false;
  next_transport_seats_offered integer := 0;
  has_transport_response boolean := false;
  should_stamp_volunteer boolean := false;
  should_update_availability boolean := false;
  actor_name text := '';
  actor_email text := '';
  queued_notification_id uuid;
  warning_message text := '';
begin
  if normalized_token_hash !~ '^[a-f0-9]{64}$' then
    return;
  end if;

  should_update_availability := normalized_status in ('available', 'unavailable', 'maybe');
  has_transport_response := transport_needs_lift_value is not null
    or transport_can_offer_lift_value is not null
    or transport_seats_offered_value is not null;

  if scorer_response not in ('yes', 'no') then
    scorer_response := null;
  end if;

  if linesman_response not in ('yes', 'no') then
    linesman_response := null;
  end if;

  if referee_response not in ('yes', 'no') then
    referee_response := null;
  end if;

  if not should_update_availability
    and scorer_response is null
    and linesman_response is null
    and referee_response is null
    and has_transport_response is false then
    return;
  end if;

  select request.*
  into request_row
  from public.match_day_availability_requests as request
  where request.token_hash = normalized_token_hash
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
    update public.match_day_availability_requests as request
    set status = 'expired',
        updated_at = timezone('utc', now())
    where request.id = request_row.id
      and request.status = 'pending'
    returning request.*
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
    transport_needs_lift := updated_row.transport_needs_lift;
    transport_can_offer_lift := updated_row.transport_can_offer_lift;
    transport_seats_offered := updated_row.transport_seats_offered;
    transport_responded_at := updated_row.transport_responded_at;
    return next;
    return;
  end if;

  if request_row.parent_link_id is not null then
    select parent_link.*
    into link_row
    from public.parent_player_links as parent_link
    where parent_link.id = request_row.parent_link_id
      and parent_link.club_id = request_row.club_id
      and parent_link.player_id = request_row.player_id
      and parent_link.status = 'active'
    limit 1;

    if link_row.id is null then
      return;
    end if;
  end if;

  actor_email := coalesce(nullif(request_row.recipient_email, ''), link_row.email, '');
  actor_name := coalesce(nullif(request_row.recipient_name, ''), nullif(actor_email, ''), 'Parent');

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

  next_transport_needs_lift := coalesce(transport_needs_lift_value, request_row.transport_needs_lift, false);
  next_transport_can_offer_lift := coalesce(transport_can_offer_lift_value, request_row.transport_can_offer_lift, false);
  next_transport_seats_offered := case
    when next_transport_can_offer_lift is true then greatest(coalesce(transport_seats_offered_value, request_row.transport_seats_offered, 0), 0)
    else 0
  end;

  should_stamp_volunteer :=
    (coalesce(match_row.request_scorer, false) and scorer_response in ('yes', 'no'))
    or (coalesce(match_row.request_linesman, false) and linesman_response in ('yes', 'no'))
    or (coalesce(match_row.request_referee, false) and referee_response in ('yes', 'no'));

  update public.match_day_availability_requests as request
  set status = case when should_update_availability then normalized_status else request.status end,
      responded_at = case when should_update_availability then timezone('utc', now()) else request.responded_at end,
      volunteer_scorer_response = next_scorer_response,
      volunteer_linesman_response = next_linesman_response,
      volunteer_referee_response = next_referee_response,
      volunteer_responded_at = case
        when should_stamp_volunteer then timezone('utc', now())
        else request.volunteer_responded_at
      end,
      transport_needs_lift = case when has_transport_response then next_transport_needs_lift else request.transport_needs_lift end,
      transport_can_offer_lift = case when has_transport_response then next_transport_can_offer_lift else request.transport_can_offer_lift end,
      transport_seats_offered = case when has_transport_response then next_transport_seats_offered else request.transport_seats_offered end,
      transport_responded_at = case
        when has_transport_response then timezone('utc', now())
        else request.transport_responded_at
      end,
      updated_at = timezone('utc', now())
  where request.id = request_row.id
  returning request.*
  into updated_row;

  if should_update_availability then
    select current_availability.*
    into previous_current
    from public.match_day_player_availability as current_availability
    where current_availability.match_day_id = request_row.match_day_id
      and current_availability.player_id = request_row.player_id
    limit 1;

    insert into public.match_day_player_availability (
      match_day_id,
      club_id,
      team_id,
      player_id,
      player_name,
      status,
      selected_by_parent_link_id,
      selected_by_request_id,
      selected_by_name,
      selected_by_email,
      selected_at,
      updated_at
    )
    values (
      request_row.match_day_id,
      request_row.club_id,
      request_row.team_id,
      request_row.player_id,
      request_row.player_name,
      normalized_status,
      request_row.parent_link_id,
      request_row.id,
      actor_name,
      actor_email,
      timezone('utc', now()),
      timezone('utc', now())
    )
    on conflict (match_day_id, player_id)
    do update
    set status = excluded.status,
        selected_by_parent_link_id = excluded.selected_by_parent_link_id,
        selected_by_request_id = excluded.selected_by_request_id,
        selected_by_name = excluded.selected_by_name,
        selected_by_email = excluded.selected_by_email,
        selected_at = excluded.selected_at,
        updated_at = timezone('utc', now())
    returning *
    into next_current;

    if previous_current.id is not null
      and previous_current.status <> normalized_status
      and coalesce(previous_current.selected_by_email, '') <> ''
      and coalesce(previous_current.selected_by_parent_link_id::text, '') <> coalesce(request_row.parent_link_id::text, '') then
      begin
        insert into public.scheduled_email_queue (
          club_id,
          team_id,
          created_by,
          created_by_email,
          to_email,
          subject,
          status,
          scheduled_at,
          payload
        )
        values (
          request_row.club_id,
          request_row.team_id,
          null,
          'match-day-system',
          previous_current.selected_by_email,
          concat(request_row.player_name, ' availability updated'),
          'scheduled',
          timezone('utc', now()) + interval '5 minutes',
          jsonb_build_object(
            'resendPayload', jsonb_build_object(
              'to', jsonb_build_array(previous_current.selected_by_email),
              'subject', concat(request_row.player_name, ' availability updated'),
              'html', concat(
                '<p>',
                request_row.player_name,
                ' availability was updated for ',
                match_row.opponent,
                '. The answer changed from ',
                previous_current.status,
                ' to ',
                normalized_status,
                '. Updated by ',
                actor_name,
                '.</p>'
              )
            ),
            'displayName', 'Football Player',
            'teamName', '',
            'clubName', '',
            'playerName', request_row.player_name,
            'parentName', previous_current.selected_by_name,
            'clubId', request_row.club_id,
            'teamId', request_row.team_id,
            'actorId', '',
            'actorEmail', 'match-day-system',
            'actorRole', 'system',
            'requiredFeature', 'parentEmails',
            'matchDayAvailabilityChange', jsonb_build_object(
              'matchDayId', request_row.match_day_id,
              'playerId', request_row.player_id,
              'previousStatus', previous_current.status,
              'nextStatus', normalized_status,
              'updatedBy', actor_name
            )
          )
        )
        returning id
        into queued_notification_id;
      exception when others then
        warning_message := 'Availability change notification could not be queued.';
        queued_notification_id := null;
      end;
    end if;

    insert into public.match_day_player_availability_history (
      match_day_id,
      club_id,
      team_id,
      player_id,
      request_id,
      parent_link_id,
      player_name,
      previous_status,
      status,
      selected_by_name,
      selected_by_email,
      notification_queue_id,
      notification_warning
    )
    values (
      request_row.match_day_id,
      request_row.club_id,
      request_row.team_id,
      request_row.player_id,
      request_row.id,
      request_row.parent_link_id,
      request_row.player_name,
      previous_current.status,
      normalized_status,
      actor_name,
      actor_email,
      queued_notification_id,
      warning_message
    );
  end if;

  if coalesce(match_row.request_scorer, false)
    and updated_row.parent_link_id is not null
    and next_scorer_response in ('yes', 'no') then
    if link_row.id is null then
      select parent_link.*
      into link_row
      from public.parent_player_links as parent_link
      where parent_link.id = updated_row.parent_link_id
        and parent_link.status = 'active'
      limit 1;
    end if;

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
        actor_name,
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
  transport_needs_lift := updated_row.transport_needs_lift;
  transport_can_offer_lift := updated_row.transport_can_offer_lift;
  transport_seats_offered := updated_row.transport_seats_offered;
  transport_responded_at := updated_row.transport_responded_at;
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
    null,
    null,
    null,
    null
  ) as response;
end;
$$;

revoke all on function public.get_match_day_availability_response_v2(text) from public;
revoke all on function public.submit_match_day_availability_response(text, text, text, text, text, boolean, boolean, integer) from public;
revoke all on function public.confirm_match_day_availability(text, text) from public;

grant execute on function public.get_match_day_availability_response_v2(text) to anon;
grant execute on function public.get_match_day_availability_response_v2(text) to authenticated;
grant execute on function public.submit_match_day_availability_response(text, text, text, text, text, boolean, boolean, integer) to anon;
grant execute on function public.submit_match_day_availability_response(text, text, text, text, text, boolean, boolean, integer) to authenticated;
grant execute on function public.confirm_match_day_availability(text, text) to anon;
grant execute on function public.confirm_match_day_availability(text, text) to authenticated;

comment on column public.match_day_availability_requests.transport_needs_lift is
  'Parent token response flag that this player may need transport help. Staff-only coordination signal.';

comment on column public.match_day_availability_requests.transport_can_offer_lift is
  'Parent token response flag that this parent can offer transport help. Staff-only coordination signal.';

comment on column public.match_day_availability_requests.transport_seats_offered is
  'Structured count of seats offered by the responding parent. Only meaningful when transport_can_offer_lift is true.';

comment on function public.submit_match_day_availability_response(text, text, text, text, text, boolean, boolean, integer) is
  'Stores a token-scoped Match Day response, shared player availability, requested volunteer role responses, and structured staff-only transport response signals.';
