create or replace function public.respond_parent_portal_match_day_invitation(
  parent_link_id_value uuid,
  request_id_value uuid,
  response_kind_value text,
  role_type_value text,
  response_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_row public.parent_player_links%rowtype;
  request_row public.match_day_availability_requests%rowtype;
  match_row public.match_days%rowtype;
  response_row record;
  normalized_kind text := lower(trim(coalesce(response_kind_value, '')));
  normalized_role text := lower(trim(coalesce(role_type_value, '')));
  normalized_response text := lower(trim(coalesce(response_value, '')));
  owns_contact_offer boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Login is required before changing this response.';
  end if;

  select link.*
  into link_row
  from public.parent_player_links link
  where link.id = parent_link_id_value
    and link.auth_user_id = auth.uid()
    and link.status = 'active'
  limit 1;

  if link_row.id is null then
    raise exception 'This parent portal link is not available.';
  end if;

  select request.*
  into request_row
  from public.match_day_availability_requests request
  where request.id = request_id_value
    and request.club_id = link_row.club_id
    and request.team_id = link_row.team_id
    and request.player_id = link_row.player_id
  for update;

  if request_row.id is null then
    raise exception 'This invitation is not available for this player.';
  end if;

  owns_contact_offer := request_row.parent_link_id = link_row.id or (
    request_row.parent_link_id is null
    and coalesce(link_row.email, '') <> ''
    and lower(request_row.recipient_email) = lower(link_row.email)
  );

  select match_day.*
  into match_row
  from public.match_days match_day
  where match_day.id = request_row.match_day_id
    and match_day.club_id = link_row.club_id
    and (match_day.team_id is null or match_day.team_id = link_row.team_id)
    and match_day.parent_visible is true
    and match_day.parent_audience <> 'none'
  limit 1;

  if match_row.id is null then
    raise exception 'This fixture is not available in the Parent Portal.';
  end if;

  if request_row.status = 'expired' or request_row.expires_at <= now() then
    raise exception 'The response deadline has passed.';
  end if;

  if match_row.status in ('cancelled', 'postponed', 'full_time')
    or match_row.concluded_at is not null
    or (match_row.match_date is not null and match_row.match_date < timezone('Europe/London', now())::date) then
    raise exception 'This fixture has closed and responses cannot be changed.';
  end if;

  if normalized_kind = 'attendance' then
    if normalized_response not in ('available', 'unavailable', 'maybe') then
      raise exception 'Choose a valid attendance response.';
    end if;
  elsif normalized_kind = 'role' then
    if owns_contact_offer is false then
      raise exception 'This Match Day role offer belongs to another parent contact.';
    end if;

    if normalized_role not in ('scorer', 'linesman', 'referee') or normalized_response not in ('yes', 'no') then
      raise exception 'Choose a valid Match Day role response.';
    end if;

    if (normalized_role = 'scorer' and coalesce(match_row.request_scorer, false) is false)
      or (normalized_role = 'linesman' and coalesce(match_row.request_linesman, false) is false)
      or (normalized_role = 'referee' and coalesce(match_row.request_referee, false) is false) then
      raise exception 'This Match Day role was not offered.';
    end if;

    if exists (
      select 1
      from public.match_day_role_assignments assignment
      where assignment.match_day_id = match_row.id
        and assignment.role = normalized_role
    ) then
      raise exception 'Coaches have completed the selection for this role.';
    end if;
  else
    raise exception 'Choose a valid response type.';
  end if;

  select response.*
  into response_row
  from public.submit_match_day_availability_response(
    request_row.token_hash,
    case when normalized_kind = 'attendance' then normalized_response else '' end,
    case when normalized_kind = 'role' and normalized_role = 'scorer' then normalized_response else null end,
    case when normalized_kind = 'role' and normalized_role = 'linesman' then normalized_response else null end,
    case when normalized_kind = 'role' and normalized_role = 'referee' then normalized_response else null end,
    null,
    null,
    null
  ) response
  limit 1;

  if response_row.request_id is null then
    raise exception 'The response could not be saved.';
  end if;

  return jsonb_build_object(
    'requestId', response_row.request_id,
    'responseKind', normalized_kind,
    'roleType', nullif(normalized_role, ''),
    'responseState', normalized_response,
    'respondedAt', coalesce(response_row.responded_at, response_row.volunteer_responded_at)
  );
end;
$$;

create or replace function public.respond_parent_portal_training_invitation(
  parent_link_id_value uuid,
  request_player_id_value uuid,
  response_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_row public.parent_player_links%rowtype;
  request_player_row public.training_availability_request_players%rowtype;
  request_row public.training_availability_requests%rowtype;
  event_row public.calendar_events%rowtype;
  response_row public.training_availability_responses%rowtype;
  normalized_response text := lower(btrim(coalesce(response_value, '')));
  actor_name text;
  response_changed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Login is required before changing this response.';
  end if;
  if normalized_response not in ('available', 'unavailable', 'maybe') then
    raise exception 'Choose a valid training attendance response.';
  end if;
  select link.* into link_row
  from public.parent_player_links link
  where link.id = parent_link_id_value;
  if link_row.id is null
    or not public.current_user_can_access_parent_link(link_row.id, link_row.player_id)
    or not exists (select 1 from public.players player where player.id = link_row.player_id and player.team_id = link_row.team_id)
    or not exists (select 1 from public.clubs club where club.id = link_row.club_id and coalesce(club.status, 'active') = 'active') then
    raise exception using errcode = '42501', message = 'This parent portal link is not available.';
  end if;

  select request_player.* into request_player_row
  from public.training_availability_request_players request_player
  where request_player.id = request_player_id_value
    and request_player.club_id = link_row.club_id
    and request_player.team_id = link_row.team_id
    and request_player.player_id = link_row.player_id;
  if request_player_row.id is null then
    raise exception using errcode = '42501', message = 'This invitation is not available for this player.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat('reusable_rsvp:training:', request_player_row.request_id::text, ':', request_player_row.player_id::text), 0
  ));
  select request.* into request_row
  from public.training_availability_requests request
  where request.id = request_player_row.request_id
    and request.club_id = link_row.club_id and request.team_id = link_row.team_id
  for update;
  select event.* into event_row
  from public.calendar_events event
  where event.id = request_player_row.calendar_event_id
    and event.id = request_row.calendar_event_id
    and event.club_id = link_row.club_id and event.team_id = link_row.team_id
    and event.event_type = 'training'
  for update;
  select request_player.* into request_player_row
  from public.training_availability_request_players request_player
  where request_player.id = request_player_id_value
  for update;

  if request_row.id is null or event_row.id is null then
    raise exception 'This training invitation is not available.';
  end if;
  if request_row.status in ('cancelled', 'expired')
    or request_player_row.status in ('cancelled', 'expired')
    or event_row.cancelled_at is not null
    or request_row.occurrence_starts_at <= now()
    or coalesce(request_player_row.response_deadline_at, request_row.occurrence_starts_at) < now() then
    raise exception 'This training response window has closed.';
  end if;

  select response.* into response_row
  from public.training_availability_responses response
  where response.request_id = request_row.id and response.player_id = link_row.player_id
  for update;
  select coalesce(nullif(btrim(actor.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(actor.raw_user_meta_data ->> 'name'), ''), 'Parent') into actor_name
  from auth.users actor where actor.id = auth.uid();
  actor_name := coalesce(actor_name, 'Parent');

  if response_row.id is null then
    insert into public.training_availability_responses (
      request_player_id, request_id, club_id, team_id, calendar_event_id, player_id,
      parent_link_id, status, note, responded_by_name, responded_by_email, responded_at
    ) values (
      request_player_row.id, request_row.id, link_row.club_id, link_row.team_id,
      event_row.id, link_row.player_id, link_row.id, normalized_response, '',
      actor_name, coalesce(link_row.email, ''), timezone('utc', now())
    ) returning * into response_row;
    response_changed := true;
  elsif response_row.status is distinct from normalized_response then
    update public.training_availability_responses response
    set request_player_id = request_player_row.id, parent_link_id = link_row.id,
        status = normalized_response, note = '', responded_by_name = actor_name,
        responded_by_email = coalesce(link_row.email, ''), responded_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where response.id = response_row.id
    returning * into response_row;
    response_changed := true;
  end if;

  update public.training_availability_request_players recipient
  set status = 'responded', responded_at = response_row.responded_at, updated_at = timezone('utc', now())
  where recipient.request_id = request_row.id and recipient.player_id = link_row.player_id
    and recipient.club_id = link_row.club_id and recipient.team_id = link_row.team_id
    and recipient.calendar_event_id = event_row.id and recipient.status not in ('cancelled', 'expired');

  return jsonb_build_object('requestPlayerId', request_player_row.id,
    'responseState', response_row.status, 'respondedAt', response_row.responded_at, 'changed', response_changed);
end;
$$;

create or replace function public.accept_event_player_availability_on_behalf(
  event_type_value text,
  event_id_value uuid,
  player_id_value uuid,
  occurrence_date_value date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_event_type text := lower(btrim(coalesce(event_type_value, '')));
  actor_id uuid := auth.uid();
  actor_profile public.users%rowtype;
  actor_name text := '';
  actor_email text := '';
  response_time timestamptz := timezone('utc', now());
  player_row public.players%rowtype;
  match_row public.match_days%rowtype;
  current_match_response public.match_day_player_availability%rowtype;
  calendar_event_row public.calendar_events%rowtype;
  training_request_row public.training_availability_requests%rowtype;
  training_request_player_row public.training_availability_request_players%rowtype;
  current_training_response public.training_availability_responses%rowtype;
  previous_status text := 'pending';
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Sign in as authorised team staff to accept on behalf of a player.';
  end if;

  select profile.*
  into actor_profile
  from public.users profile
  where profile.id = actor_id
    and coalesce(profile.status, 'active') = 'active'
  limit 1;

  if actor_profile.id is null
    or actor_profile.role = 'parent_portal'
    or coalesce(actor_profile.role_rank, 0) < 20 then
    raise exception using
      errcode = '42501',
      message = 'Authorised team staff access is required.';
  end if;

  actor_name := coalesce(
    nullif(btrim(actor_profile.name), ''),
    nullif(btrim(actor_profile.username), ''),
    nullif(btrim(actor_profile.email), ''),
    'Team staff'
  );
  actor_email := coalesce(nullif(lower(btrim(actor_profile.email)), ''), '');

  if normalized_event_type = 'match' then
    select match_day.*
    into match_row
    from public.match_days match_day
    where match_day.id = event_id_value
      and match_day.deleted_at is null
      and coalesce(match_day.status, 'scheduled') not in ('cancelled', 'full_time', 'postponed')
    for update;

    if match_row.id is null then
      raise exception 'This Match Day fixture is not available for responses.';
    end if;

    if not public.can_manage_match_day(match_row.team_id)
      or (
        actor_profile.role <> 'super_admin'
        and actor_profile.club_id is distinct from match_row.club_id
      ) then
      raise exception using
        errcode = '42501',
        message = 'You cannot manage this Match Day fixture.';
    end if;

    select player.*
    into player_row
    from public.players player
    where player.id = player_id_value
      and player.club_id = match_row.club_id
      and player.team_id = match_row.team_id
      and coalesce(player.status, 'active') <> 'archived'
    limit 1;

    if player_row.id is null then
      raise exception using
        errcode = '42501',
        message = 'This player is outside the fixture team scope.';
    end if;

    if not exists (
      select 1
      from public.match_day_availability_requests request
      where request.match_day_id = match_row.id
        and request.club_id = match_row.club_id
        and request.team_id = match_row.team_id
        and request.player_id = player_row.id
        and coalesce(request.status, 'pending') not in ('cancelled', 'expired')
        and request.sent_at is not null
        and request.expires_at >= response_time
        and request.token_revoked_at is null
    ) and not exists (
      select 1 from public.match_day_player_squad_decisions decision
      where decision.match_day_id = match_row.id
        and decision.club_id = match_row.club_id
        and decision.team_id = match_row.team_id
        and decision.player_id = player_row.id
        and decision.status = 'selected'
    ) and not exists (
      select 1 from public.calendar_event_invites invite
      where invite.match_day_id = match_row.id
        and invite.club_id = match_row.club_id
        and invite.team_id = match_row.team_id
        and invite.player_id = player_row.id
        and invite.invite_status <> 'cancelled'
    ) then
      raise exception 'This player is not attached to this Match Day fixture.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        concat('staff_availability:match:', match_row.id::text, ':', player_row.id::text),
        0
      )
    );

    select availability.*
    into current_match_response
    from public.match_day_player_availability availability
    where availability.match_day_id = match_row.id
      and availability.player_id = player_row.id
    for update;

    previous_status := coalesce(nullif(current_match_response.status, ''), 'pending');

    if previous_status = 'available' then
      return jsonb_build_object(
        'changed', false,
        'eventId', match_row.id,
        'eventType', 'match',
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'responseStatus', 'available',
        'respondedAt', current_match_response.selected_at,
        'source', 'staff_on_behalf'
      );
    end if;

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
      match_row.id,
      match_row.club_id,
      match_row.team_id,
      player_row.id,
      coalesce(nullif(player_row.player_name, ''), 'Player'),
      'available',
      null,
      null,
      actor_name,
      actor_email,
      response_time,
      response_time
    )
    on conflict (match_day_id, player_id)
    do update
    set status = 'available',
        player_name = excluded.player_name,
        selected_by_parent_link_id = null,
        selected_by_request_id = null,
        selected_by_name = excluded.selected_by_name,
        selected_by_email = excluded.selected_by_email,
        selected_at = excluded.selected_at,
        updated_at = excluded.updated_at;

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
      selected_by_email
    )
    values (
      match_row.id,
      match_row.club_id,
      match_row.team_id,
      player_row.id,
      null,
      null,
      coalesce(nullif(player_row.player_name, ''), 'Player'),
      previous_status,
      'available',
      actor_name,
      actor_email
    );

    insert into public.match_day_event_log (
      club_id,
      team_id,
      match_day_id,
      player_id,
      actor_user_id,
      actor_display_name,
      actor_role,
      event_type,
      event_label,
      previous_value,
      new_value,
      metadata,
      created_at
    )
    values (
      match_row.club_id,
      match_row.team_id,
      match_row.id,
      player_row.id,
      actor_id,
      actor_name,
      coalesce(nullif(actor_profile.role_label, ''), actor_profile.role, 'staff'),
      'player_availability_changed',
      'Staff accepted on behalf of player',
      jsonb_build_object('availabilityStatus', previous_status),
      jsonb_build_object('availabilityStatus', 'available'),
      jsonb_build_object('source', 'staff_on_behalf'),
      response_time
    );

    insert into public.audit_logs (
      club_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata,
      created_at
    )
    values (
      match_row.club_id,
      actor_id,
      'event_player_availability_accepted_on_behalf',
      'match_day',
      match_row.id,
      jsonb_build_object(
        'eventId', match_row.id,
        'eventType', 'match',
        'teamId', match_row.team_id,
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'newStatus', 'available',
        'source', 'staff_on_behalf'
      ),
      response_time
    );

    return jsonb_build_object(
      'changed', true,
      'eventId', match_row.id,
      'eventType', 'match',
      'playerId', player_row.id,
      'previousStatus', previous_status,
      'responseStatus', 'available',
      'respondedAt', response_time,
      'source', 'staff_on_behalf'
    );
  end if;

  if normalized_event_type = 'training' then
    if occurrence_date_value is null then
      raise exception 'Choose a training occurrence before accepting on behalf of a player.';
    end if;

    select event.*
    into calendar_event_row
    from public.calendar_events event
    where event.id = event_id_value
      and event.event_type = 'training'
      and event.team_id is not null
      and event.cancelled_at is null
    limit 1;

    if calendar_event_row.id is null then
      raise exception 'This training event is not available for responses.';
    end if;

    if not public.current_user_can_access_team(calendar_event_row.club_id, calendar_event_row.team_id)
      or (
        actor_profile.role <> 'super_admin'
        and actor_profile.club_id is distinct from calendar_event_row.club_id
      ) then
      raise exception using
        errcode = '42501',
        message = 'You cannot manage this training event.';
    end if;

    select player.*
    into player_row
    from public.players player
    where player.id = player_id_value
      and player.club_id = calendar_event_row.club_id
      and player.team_id = calendar_event_row.team_id
      and coalesce(player.status, 'active') <> 'archived'
    limit 1;

    if player_row.id is null then
      raise exception using
        errcode = '42501',
        message = 'This player is outside the training team scope.';
    end if;

    select request.*
    into training_request_row
    from public.training_availability_requests request
    where request.calendar_event_id = calendar_event_row.id
      and request.club_id = calendar_event_row.club_id
      and request.team_id = calendar_event_row.team_id
      and request.occurrence_date = occurrence_date_value
      and request.status <> 'cancelled'
      and request.occurrence_starts_at > response_time
    order by request.created_at desc
    limit 1
    for update;

    if training_request_row.id is null then
      raise exception 'This training response window is not active.';
    end if;

    select request_player.*
    into training_request_player_row
    from public.training_availability_request_players request_player
    where request_player.request_id = training_request_row.id
      and request_player.calendar_event_id = calendar_event_row.id
      and request_player.club_id = calendar_event_row.club_id
      and request_player.team_id = calendar_event_row.team_id
      and request_player.player_id = player_row.id
      and request_player.status not in ('cancelled', 'expired')
    order by request_player.created_at desc
    limit 1
    for update;

    if training_request_player_row.id is null then
      raise exception 'This player does not have an active training availability invitation.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        concat('staff_availability:training:', training_request_row.id::text, ':', player_row.id::text),
        0
      )
    );

    select response.*
    into current_training_response
    from public.training_availability_responses response
    where response.request_id = training_request_row.id
      and response.player_id = player_row.id
    for update;

    previous_status := coalesce(nullif(current_training_response.status, ''), 'pending');

    if previous_status = 'available' then
      return jsonb_build_object(
        'changed', false,
        'eventId', calendar_event_row.id,
        'eventType', 'training',
        'occurrenceDate', occurrence_date_value,
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'responseStatus', 'available',
        'respondedAt', current_training_response.responded_at,
        'source', 'staff_on_behalf'
      );
    end if;

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
      responded_at,
      updated_at
    )
    values (
      training_request_player_row.id,
      training_request_row.id,
      calendar_event_row.club_id,
      calendar_event_row.team_id,
      calendar_event_row.id,
      player_row.id,
      null,
      'available',
      '',
      actor_name,
      actor_email,
      response_time,
      response_time
    )
    on conflict (request_id, player_id)
    do update
    set request_player_id = excluded.request_player_id,
        parent_link_id = null,
        status = 'available',
        note = '',
        responded_by_name = excluded.responded_by_name,
        responded_by_email = excluded.responded_by_email,
        responded_at = excluded.responded_at,
        updated_at = excluded.updated_at;

    update public.training_availability_request_players request_player
    set status = 'responded',
        responded_at = response_time,
        updated_at = response_time
    where request_player.id = training_request_player_row.id;

    insert into public.audit_logs (
      club_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata,
      created_at
    )
    values (
      calendar_event_row.club_id,
      actor_id,
      'event_player_availability_accepted_on_behalf',
      'calendar_event',
      calendar_event_row.id,
      jsonb_build_object(
        'eventId', calendar_event_row.id,
        'eventType', 'training',
        'occurrenceDate', occurrence_date_value,
        'teamId', calendar_event_row.team_id,
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'newStatus', 'available',
        'source', 'staff_on_behalf'
      ),
      response_time
    );

    return jsonb_build_object(
      'changed', true,
      'eventId', calendar_event_row.id,
      'eventType', 'training',
      'occurrenceDate', occurrence_date_value,
      'playerId', player_row.id,
      'previousStatus', previous_status,
      'responseStatus', 'available',
      'respondedAt', response_time,
      'source', 'staff_on_behalf'
    );
  end if;

  raise exception 'Accept on behalf supports Match Day and training invitations only.';
end;
$$;

create or replace function public.mark_event_player_unavailable_on_behalf(
  event_type_value text,
  event_id_value uuid,
  player_id_value uuid,
  occurrence_date_value date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_event_type text := lower(btrim(coalesce(event_type_value, '')));
  actor_id uuid := auth.uid();
  actor_profile public.users%rowtype;
  actor_name text := '';
  actor_email text := '';
  response_time timestamptz := timezone('utc', now());
  player_row public.players%rowtype;
  match_row public.match_days%rowtype;
  current_match_response public.match_day_player_availability%rowtype;
  calendar_event_row public.calendar_events%rowtype;
  training_request_row public.training_availability_requests%rowtype;
  training_request_player_row public.training_availability_request_players%rowtype;
  current_training_response public.training_availability_responses%rowtype;
  previous_status text := 'pending';
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Sign in as authorised team staff to mark a player unavailable.';
  end if;

  select profile.*
  into actor_profile
  from public.users profile
  where profile.id = actor_id
    and coalesce(profile.status, 'active') = 'active'
  limit 1;

  if actor_profile.id is null
    or actor_profile.role = 'parent_portal'
    or coalesce(actor_profile.role_rank, 0) < 20 then
    raise exception using
      errcode = '42501',
      message = 'Authorised team staff access is required.';
  end if;

  actor_name := coalesce(
    nullif(btrim(actor_profile.name), ''),
    nullif(btrim(actor_profile.username), ''),
    nullif(btrim(actor_profile.email), ''),
    'Team staff'
  );
  actor_email := coalesce(nullif(lower(btrim(actor_profile.email)), ''), '');

  if normalized_event_type = 'match' then
    select fixture.*
    into match_row
    from public.match_days fixture
    where fixture.id = event_id_value
      and fixture.deleted_at is null
      and coalesce(fixture.status, 'scheduled') not in ('cancelled', 'full_time', 'postponed')
    for update;

    if match_row.id is null then
      raise exception 'This Match Day fixture is not available for responses.';
    end if;

    if not public.can_manage_match_day(match_row.team_id)
      or (
        actor_profile.role <> 'super_admin'
        and actor_profile.club_id is distinct from match_row.club_id
      ) then
      raise exception using
        errcode = '42501',
        message = 'You cannot manage this Match Day fixture.';
    end if;

    select player.*
    into player_row
    from public.players player
    where player.id = player_id_value
      and player.club_id = match_row.club_id
      and player.team_id = match_row.team_id
      and coalesce(player.status, 'active') <> 'archived'
    limit 1;

    if player_row.id is null then
      raise exception using
        errcode = '42501',
        message = 'This player is outside the fixture team scope.';
    end if;

    if not exists (
      select 1
      from public.match_day_availability_requests request
      where request.match_day_id = match_row.id
        and request.club_id = match_row.club_id
        and request.team_id = match_row.team_id
        and request.player_id = player_row.id
        and coalesce(request.status, 'pending') not in ('cancelled', 'expired')
        and request.sent_at is not null
        and request.expires_at >= response_time
        and request.token_revoked_at is null
    ) then
      raise exception 'This player does not have an active Match Day availability invitation.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        concat('staff_availability:match:', match_row.id::text, ':', player_row.id::text),
        0
      )
    );

    select availability.*
    into current_match_response
    from public.match_day_player_availability availability
    where availability.match_day_id = match_row.id
      and availability.player_id = player_row.id
    for update;

    previous_status := coalesce(nullif(current_match_response.status, ''), 'pending');

    if previous_status = 'unavailable' then
      return jsonb_build_object(
        'changed', false,
        'eventId', match_row.id,
        'eventType', 'match',
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'responseStatus', 'unavailable',
        'respondedAt', current_match_response.selected_at,
        'source', 'staff_on_behalf'
      );
    end if;

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
      match_row.id,
      match_row.club_id,
      match_row.team_id,
      player_row.id,
      coalesce(nullif(player_row.player_name, ''), 'Player'),
      'unavailable',
      null,
      null,
      actor_name,
      actor_email,
      response_time,
      response_time
    )
    on conflict (match_day_id, player_id)
    do update
    set status = 'unavailable',
        player_name = excluded.player_name,
        selected_by_parent_link_id = null,
        selected_by_request_id = null,
        selected_by_name = excluded.selected_by_name,
        selected_by_email = excluded.selected_by_email,
        selected_at = excluded.selected_at,
        updated_at = excluded.updated_at;

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
      selected_by_email
    )
    values (
      match_row.id,
      match_row.club_id,
      match_row.team_id,
      player_row.id,
      null,
      null,
      coalesce(nullif(player_row.player_name, ''), 'Player'),
      previous_status,
      'unavailable',
      actor_name,
      actor_email
    );

    insert into public.match_day_event_log (
      club_id,
      team_id,
      match_day_id,
      player_id,
      actor_user_id,
      actor_display_name,
      actor_role,
      event_type,
      event_label,
      previous_value,
      new_value,
      metadata,
      created_at
    )
    values (
      match_row.club_id,
      match_row.team_id,
      match_row.id,
      player_row.id,
      actor_id,
      actor_name,
      coalesce(nullif(actor_profile.role_label, ''), actor_profile.role, 'staff'),
      'player_availability_changed',
      'Staff marked player unavailable',
      jsonb_build_object('availabilityStatus', previous_status),
      jsonb_build_object('availabilityStatus', 'unavailable'),
      jsonb_build_object('source', 'staff_on_behalf'),
      response_time
    );

    insert into public.audit_logs (
      club_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata,
      created_at
    )
    values (
      match_row.club_id,
      actor_id,
      'event_player_availability_marked_unavailable_on_behalf',
      'match_day',
      match_row.id,
      jsonb_build_object(
        'eventId', match_row.id,
        'eventType', 'match',
        'teamId', match_row.team_id,
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'newStatus', 'unavailable',
        'source', 'staff_on_behalf'
      ),
      response_time
    );

    return jsonb_build_object(
      'changed', true,
      'eventId', match_row.id,
      'eventType', 'match',
      'playerId', player_row.id,
      'previousStatus', previous_status,
      'responseStatus', 'unavailable',
      'respondedAt', response_time,
      'source', 'staff_on_behalf'
    );
  end if;

  if normalized_event_type = 'training' then
    if occurrence_date_value is null then
      raise exception 'Choose a training occurrence before marking a player unavailable.';
    end if;

    select event.*
    into calendar_event_row
    from public.calendar_events event
    where event.id = event_id_value
      and event.event_type = 'training'
      and event.team_id is not null
      and event.cancelled_at is null
    limit 1;

    if calendar_event_row.id is null then
      raise exception 'This training event is not available for responses.';
    end if;

    if not public.current_user_can_access_team(calendar_event_row.club_id, calendar_event_row.team_id)
      or (
        actor_profile.role <> 'super_admin'
        and actor_profile.club_id is distinct from calendar_event_row.club_id
      ) then
      raise exception using
        errcode = '42501',
        message = 'You cannot manage this training event.';
    end if;

    select player.*
    into player_row
    from public.players player
    where player.id = player_id_value
      and player.club_id = calendar_event_row.club_id
      and player.team_id = calendar_event_row.team_id
      and coalesce(player.status, 'active') <> 'archived'
    limit 1;

    if player_row.id is null then
      raise exception using
        errcode = '42501',
        message = 'This player is outside the training team scope.';
    end if;

    select request.*
    into training_request_row
    from public.training_availability_requests request
    where request.calendar_event_id = calendar_event_row.id
      and request.club_id = calendar_event_row.club_id
      and request.team_id = calendar_event_row.team_id
      and request.occurrence_date = occurrence_date_value
      and request.status <> 'cancelled'
      and request.occurrence_starts_at > response_time
    order by request.created_at desc
    limit 1
    for update;

    if training_request_row.id is null then
      raise exception 'This training response window is not active.';
    end if;

    select request_player.*
    into training_request_player_row
    from public.training_availability_request_players request_player
    where request_player.request_id = training_request_row.id
      and request_player.calendar_event_id = calendar_event_row.id
      and request_player.club_id = calendar_event_row.club_id
      and request_player.team_id = calendar_event_row.team_id
      and request_player.player_id = player_row.id
      and request_player.status not in ('cancelled', 'expired')
    order by request_player.created_at desc
    limit 1
    for update;

    if training_request_player_row.id is null then
      raise exception 'This player does not have an active training availability invitation.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        concat('staff_availability:training:', training_request_row.id::text, ':', player_row.id::text),
        0
      )
    );

    select response.*
    into current_training_response
    from public.training_availability_responses response
    where response.request_id = training_request_row.id
      and response.player_id = player_row.id
    for update;

    previous_status := coalesce(nullif(current_training_response.status, ''), 'pending');

    if previous_status = 'unavailable' then
      return jsonb_build_object(
        'changed', false,
        'eventId', calendar_event_row.id,
        'eventType', 'training',
        'occurrenceDate', occurrence_date_value,
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'responseStatus', 'unavailable',
        'respondedAt', current_training_response.responded_at,
        'source', 'staff_on_behalf'
      );
    end if;

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
      responded_at,
      updated_at
    )
    values (
      training_request_player_row.id,
      training_request_row.id,
      calendar_event_row.club_id,
      calendar_event_row.team_id,
      calendar_event_row.id,
      player_row.id,
      null,
      'unavailable',
      '',
      actor_name,
      actor_email,
      response_time,
      response_time
    )
    on conflict (request_id, player_id)
    do update
    set request_player_id = excluded.request_player_id,
        parent_link_id = null,
        status = 'unavailable',
        note = '',
        responded_by_name = excluded.responded_by_name,
        responded_by_email = excluded.responded_by_email,
        responded_at = excluded.responded_at,
        updated_at = excluded.updated_at;

    update public.training_availability_request_players request_player
    set status = 'responded',
        responded_at = response_time,
        updated_at = response_time
    where request_player.id = training_request_player_row.id;

    insert into public.audit_logs (
      club_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata,
      created_at
    )
    values (
      calendar_event_row.club_id,
      actor_id,
      'event_player_availability_marked_unavailable_on_behalf',
      'calendar_event',
      calendar_event_row.id,
      jsonb_build_object(
        'eventId', calendar_event_row.id,
        'eventType', 'training',
        'occurrenceDate', occurrence_date_value,
        'teamId', calendar_event_row.team_id,
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'newStatus', 'unavailable',
        'source', 'staff_on_behalf'
      ),
      response_time
    );

    return jsonb_build_object(
      'changed', true,
      'eventId', calendar_event_row.id,
      'eventType', 'training',
      'occurrenceDate', occurrence_date_value,
      'playerId', player_row.id,
      'previousStatus', previous_status,
      'responseStatus', 'unavailable',
      'respondedAt', response_time,
      'source', 'staff_on_behalf'
    );
  end if;

  raise exception 'Mark unavailable supports Match Day and training invitations only.';
end;
$$;

create or replace function public.submit_own_training_coach_attendance(
  attendance_id_value uuid,
  status_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_status text := lower(btrim(coalesce(status_value, '')));
  attendance_row public.training_coach_attendance%rowtype;
  previous_status text;
  response_time timestamptz := timezone('utc', now());
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Sign in to respond to this training invitation.';
  end if;
  if normalized_status not in ('available', 'unavailable') then
    raise exception 'Choose Attending or Not attending.';
  end if;

  select attendance.* into attendance_row
  from public.training_coach_attendance attendance
  where attendance.id = attendance_id_value
    and attendance.coach_user_id = actor_id
  for update;

  if attendance_row.id is null then
    raise exception using errcode = '42501', message = 'This training invitation is not assigned to your Coach account.';
  end if;
  if attendance_row.occurrence_starts_at <= response_time
    or not exists (
      select 1 from public.training_availability_requests request
      join public.calendar_events event on event.id = request.calendar_event_id
      where request.id = attendance_row.request_id
        and request.status <> 'cancelled'
        and event.event_type = 'training'
        and event.cancelled_at is null
    ) then
    raise exception 'This training invitation is no longer open.';
  end if;
  if not exists (
    select 1
    from public.users app_user
    join public.team_staff assignment
      on assignment.user_id = app_user.id
     and assignment.team_id = attendance_row.team_id
     and coalesce(assignment.role_rank, 0) >= 20
    where app_user.id = actor_id
      and app_user.club_id = attendance_row.club_id
      and coalesce(app_user.status, 'active') = 'active'
      and app_user.role in ('assistant_coach', 'coach', 'manager', 'head_manager', 'admin')
  ) then
    raise exception using errcode = '42501', message = 'Active Team Coach access is required.';
  end if;

  previous_status := attendance_row.status;
  if previous_status = normalized_status then
    return jsonb_build_object(
      'attendanceId', attendance_row.id,
      'changed', false,
      'previousStatus', previous_status,
      'respondedAt', attendance_row.responded_at,
      'status', normalized_status
    );
  end if;

  update public.training_coach_attendance
  set status = normalized_status,
      responded_at = response_time,
      updated_at = response_time
  where id = attendance_row.id;

  insert into public.audit_logs (
    club_id, actor_id, action, entity_type, entity_id, metadata, created_at
  ) values (
    attendance_row.club_id,
    actor_id,
    'training_coach_attendance_updated',
    'calendar_event',
    attendance_row.calendar_event_id,
    jsonb_build_object(
      'attendanceId', attendance_row.id,
      'occurrenceDate', attendance_row.occurrence_date,
      'previousStatus', previous_status,
      'newStatus', normalized_status,
      'teamId', attendance_row.team_id
    ),
    response_time
  );

  return jsonb_build_object(
    'attendanceId', attendance_row.id,
    'changed', true,
    'previousStatus', previous_status,
    'respondedAt', response_time,
    'status', normalized_status
  );
end;
$$;

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
set search_path = ''
as $$
#variable_conflict use_column
declare
  normalized_token_hash text := lower(btrim(coalesce(token_hash_value, '')));
  normalized_status text := lower(btrim(coalesce(status_value, '')));
  scorer_response text := lower(btrim(coalesce(volunteer_scorer_response_value, '')));
  linesman_response text := lower(btrim(coalesce(volunteer_linesman_response_value, '')));
  referee_response text := lower(btrim(coalesce(volunteer_referee_response_value, '')));
  request_row public.match_day_availability_requests%rowtype;
  current_response public.match_day_player_availability%rowtype;
  legacy_result record;
  availability_changed boolean := false;
  volunteer_changed boolean := false;
  transport_changed boolean := false;
  next_transport_needs_lift boolean := false;
  next_transport_can_offer_lift boolean := false;
  next_transport_seats_offered integer := 0;
begin
  if scorer_response not in ('yes', 'no') then scorer_response := null; end if;
  if linesman_response not in ('yes', 'no') then linesman_response := null; end if;
  if referee_response not in ('yes', 'no') then referee_response := null; end if;

  if normalized_status not in ('available', 'unavailable', 'maybe')
    and scorer_response is null
    and linesman_response is null
    and referee_response is null
    and transport_needs_lift_value is null
    and transport_can_offer_lift_value is null
    and transport_seats_offered_value is null then
    return;
  end if;

  if not public.is_match_day_action_token_current_internal(normalized_token_hash) then
    return;
  end if;

  select request.*
  into request_row
  from public.match_day_availability_requests request
  where request.token_hash = normalized_token_hash
  limit 1;

  if request_row.id is null then return; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      concat('reusable_rsvp:match:', request_row.match_day_id::text, ':', request_row.player_id::text),
      0
    )
  );

  if not public.is_match_day_action_token_current_internal(normalized_token_hash) then
    return;
  end if;

  select availability.*
  into current_response
  from public.match_day_player_availability availability
  where availability.match_day_id = request_row.match_day_id
    and availability.player_id = request_row.player_id
    and availability.club_id = request_row.club_id
    and availability.team_id = request_row.team_id
  for update;

  availability_changed := normalized_status in ('available', 'unavailable', 'maybe')
    and coalesce(current_response.status, 'pending') is distinct from normalized_status;

  volunteer_changed :=
    (scorer_response is not null and coalesce(request_row.volunteer_scorer_response, 'no_response') is distinct from scorer_response)
    or (linesman_response is not null and coalesce(request_row.volunteer_linesman_response, 'no_response') is distinct from linesman_response)
    or (referee_response is not null and coalesce(request_row.volunteer_referee_response, 'no_response') is distinct from referee_response);

  next_transport_needs_lift := coalesce(transport_needs_lift_value, request_row.transport_needs_lift, false);
  next_transport_can_offer_lift := coalesce(transport_can_offer_lift_value, request_row.transport_can_offer_lift, false);
  next_transport_seats_offered := case
    when next_transport_can_offer_lift then greatest(coalesce(transport_seats_offered_value, request_row.transport_seats_offered, 0), 0)
    else 0
  end;

  transport_changed :=
    (transport_needs_lift_value is not null or transport_can_offer_lift_value is not null or transport_seats_offered_value is not null)
    and (
      coalesce(request_row.transport_needs_lift, false) is distinct from next_transport_needs_lift
      or coalesce(request_row.transport_can_offer_lift, false) is distinct from next_transport_can_offer_lift
      or coalesce(request_row.transport_seats_offered, 0) is distinct from next_transport_seats_offered
    );

  if not availability_changed and not volunteer_changed and not transport_changed then
    request_id := request_row.id;
    player_name := request_row.player_name;
    response_status := coalesce(current_response.status, nullif(request_row.status, 'pending'), request_row.status);
    responded_at := coalesce(current_response.selected_at, request_row.responded_at);
    volunteer_scorer_response := coalesce(request_row.volunteer_scorer_response, 'no_response');
    volunteer_linesman_response := coalesce(request_row.volunteer_linesman_response, 'no_response');
    volunteer_referee_response := coalesce(request_row.volunteer_referee_response, 'no_response');
    volunteer_responded_at := request_row.volunteer_responded_at;
    transport_needs_lift := coalesce(request_row.transport_needs_lift, false);
    transport_can_offer_lift := coalesce(request_row.transport_can_offer_lift, false);
    transport_seats_offered := coalesce(request_row.transport_seats_offered, 0);
    transport_responded_at := request_row.transport_responded_at;
    return next;
    return;
  end if;

  select *
  into legacy_result
  from public.submit_match_day_availability_response_26a_legacy(
    normalized_token_hash,
    case when availability_changed then normalized_status else null end,
    case when scorer_response is not null and coalesce(request_row.volunteer_scorer_response, 'no_response') is distinct from scorer_response then scorer_response else null end,
    case when linesman_response is not null and coalesce(request_row.volunteer_linesman_response, 'no_response') is distinct from linesman_response then linesman_response else null end,
    case when referee_response is not null and coalesce(request_row.volunteer_referee_response, 'no_response') is distinct from referee_response then referee_response else null end,
    case when transport_changed then next_transport_needs_lift else null end,
    case when transport_changed then next_transport_can_offer_lift else null end,
    case when transport_changed then next_transport_seats_offered else null end
  );

  if legacy_result.request_id is null then return; end if;

  request_id := legacy_result.request_id;
  player_name := legacy_result.player_name;
  response_status := case when availability_changed then legacy_result.response_status else coalesce(current_response.status, legacy_result.response_status) end;
  responded_at := case when availability_changed then legacy_result.responded_at else coalesce(current_response.selected_at, legacy_result.responded_at) end;
  volunteer_scorer_response := legacy_result.volunteer_scorer_response;
  volunteer_linesman_response := legacy_result.volunteer_linesman_response;
  volunteer_referee_response := legacy_result.volunteer_referee_response;
  volunteer_responded_at := legacy_result.volunteer_responded_at;
  transport_needs_lift := legacy_result.transport_needs_lift;
  transport_can_offer_lift := legacy_result.transport_can_offer_lift;
  transport_seats_offered := legacy_result.transport_seats_offered;
  transport_responded_at := legacy_result.transport_responded_at;
  return next;
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
  if normalized_status not in ('available', 'unavailable', 'maybe') then return; end if;
  if not public.is_training_availability_token_current_internal(normalized_token_hash) then return; end if;

  select recipient.*
  into request_player_row
  from public.training_availability_request_players recipient
  where recipient.token_hash = normalized_token_hash
  limit 1;

  if request_player_row.id is null then return; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      concat('reusable_rsvp:training:', request_player_row.request_id::text, ':', request_player_row.player_id::text),
      0
    )
  );

  if not public.is_training_availability_token_current_internal(normalized_token_hash) then return; end if;

  select recipient.*
  into request_player_row
  from public.training_availability_request_players recipient
  where recipient.token_hash = normalized_token_hash
  for update;

  select response.*
  into response_row
  from public.training_availability_responses response
  where response.request_id = request_player_row.request_id
    and response.player_id = request_player_row.player_id
    and response.club_id = request_player_row.club_id
    and response.team_id = request_player_row.team_id
    and response.calendar_event_id = request_player_row.calendar_event_id
  for update;

  actor_email := coalesce(request_player_row.recipient_email, '');
  actor_name := coalesce(nullif(request_player_row.recipient_name, ''), nullif(actor_email, ''), 'Parent');

  if response_row.id is null then
    insert into public.training_availability_responses (
      request_player_id, request_id, club_id, team_id, calendar_event_id, player_id,
      parent_link_id, status, note, responded_by_name, responded_by_email, responded_at
    ) values (
      request_player_row.id, request_player_row.request_id, request_player_row.club_id,
      request_player_row.team_id, request_player_row.calendar_event_id, request_player_row.player_id,
      request_player_row.parent_link_id, normalized_status, normalized_note,
      actor_name, actor_email, timezone('utc', now())
    )
    returning * into response_row;
  elsif response_row.status is distinct from normalized_status
    or coalesce(response_row.note, '') is distinct from normalized_note then
    update public.training_availability_responses response
    set request_player_id = request_player_row.id,
        parent_link_id = request_player_row.parent_link_id,
        status = normalized_status,
        note = normalized_note,
        responded_by_name = actor_name,
        responded_by_email = actor_email,
        responded_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where response.id = response_row.id
    returning * into response_row;
  end if;

  update public.training_availability_request_players recipient
  set status = 'responded',
      responded_at = response_row.responded_at,
      updated_at = timezone('utc', now())
  where recipient.request_id = request_player_row.request_id
    and recipient.player_id = request_player_row.player_id
    and recipient.club_id = request_player_row.club_id
    and recipient.team_id = request_player_row.team_id
    and recipient.calendar_event_id = request_player_row.calendar_event_id
    and recipient.status not in ('cancelled', 'expired');

  request_player_id := request_player_row.id;
  request_id := response_row.request_id;
  player_name := request_player_row.player_name;
  response_status := response_row.status;
  response_note := response_row.note;
  responded_at := response_row.responded_at;
  return next;
end;
$$;
