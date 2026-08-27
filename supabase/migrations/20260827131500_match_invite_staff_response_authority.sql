-- FP-MATCH-INVITE-MOBILE-114
-- Repair staff availability actions to use the canonical actionable request records.
-- Function replacement only. No customer rows are inserted, updated, deleted, or backfilled.

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

revoke all on function public.accept_event_player_availability_on_behalf(text, uuid, uuid, date)
from public, anon;

grant execute on function public.accept_event_player_availability_on_behalf(text, uuid, uuid, date)
to authenticated, service_role;

comment on function public.accept_event_player_availability_on_behalf(text, uuid, uuid, date) is
  'Allows authorised in-scope staff to record an idempotent Available response without impersonating a parent. Audit metadata records source staff_on_behalf.';

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

revoke all on function public.mark_event_player_unavailable_on_behalf(text, uuid, uuid, date)
from public, anon;

grant execute on function public.mark_event_player_unavailable_on_behalf(text, uuid, uuid, date)
to authenticated, service_role;

comment on function public.mark_event_player_unavailable_on_behalf(text, uuid, uuid, date) is
  'Allows authorised in-scope staff to record an idempotent Unavailable response without impersonating a parent. Existing match squad decisions remain unchanged.';
