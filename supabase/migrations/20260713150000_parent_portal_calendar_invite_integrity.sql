create or replace function public.get_parent_portal_invitation_state(parent_link_id_value uuid)
returns table (
  invitation_id text,
  invitation_type text,
  source_record_id uuid,
  source_type text,
  source_event_type text,
  event_id uuid,
  event_type text,
  event_title text,
  event_start timestamptz,
  event_end timestamptz,
  event_location text,
  team_name text,
  child_id uuid,
  child_name text,
  parent_link_id uuid,
  role_type text,
  invitation_state text,
  response_state text,
  selection_state text,
  can_respond boolean,
  can_change_response boolean,
  lock_reason text,
  response_deadline timestamptz,
  last_responded_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with parent_link as (
    select link.*
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = auth.uid()
      and link.status = 'active'
    limit 1
  ),
  calendar_items as (
    select
      concat('calendar_attendance:', invite.id) as invitation_id,
      'calendar_attendance'::text as invitation_type,
      invite.id as source_record_id,
      case when event.id is not null then 'calendar_event' else 'assessment_session' end::text as source_type,
      case when event.id is not null then 'calendar_event' else 'assessment_session' end::text as source_event_type,
      coalesce(event.id, session.id) as event_id,
      coalesce(nullif(event.event_type, ''), nullif(session.session_type, ''), 'general')::text as event_type,
      coalesce(nullif(event.title, ''), nullif(session.title, ''), 'Club event')::text as event_title,
      coalesce(
        event.starts_at,
        timezone('Europe/London', session.session_date + coalesce(session.start_time, time '00:00'))
      ) as event_start,
      coalesce(
        event.ends_at,
        timezone('Europe/London', session.session_date + coalesce(session.end_time, session.start_time, time '00:00'))
      ) as event_end,
      coalesce(nullif(event.location, ''), nullif(session.location, ''), '')::text as event_location,
      coalesce(nullif(team.name, ''), nullif(session.team, ''), '')::text as team_name,
      invite.player_id as child_id,
      coalesce(nullif(player.player_name, ''), 'Linked child')::text as child_name,
      link.id as parent_link_id,
      null::text as role_type,
      case
        when invite.invite_status = 'cancelled' or event.cancelled_at is not null then 'cancelled'
        when coalesce(
          event.starts_at,
          timezone('Europe/London', session.session_date + coalesce(session.start_time, time '00:00'))
        ) <= now() then 'closed'
        else 'active'
      end::text as invitation_state,
      'not_required'::text as response_state,
      'not_applicable'::text as selection_state,
      false as can_respond,
      false as can_change_response,
      case
        when invite.invite_status = 'cancelled' or event.cancelled_at is not null then 'This event has been cancelled.'
        when coalesce(
          event.starts_at,
          timezone('Europe/London', session.session_date + coalesce(session.start_time, time '00:00'))
        ) <= now() then 'This event has closed.'
        else 'The club shared this event for information. No response is required.'
      end::text as lock_reason,
      null::timestamptz as response_deadline,
      invite.responded_at as last_responded_at
    from parent_link link
    join public.calendar_event_invites invite
      on invite.club_id = link.club_id
      and invite.team_id = link.team_id
      and invite.player_id = link.player_id
    join public.players player
      on player.id = link.player_id
      and player.club_id = link.club_id
    left join public.teams team
      on team.id = invite.team_id
    left join public.calendar_events event
      on event.id = invite.calendar_event_id
      and event.club_id = invite.club_id
      and event.team_id = invite.team_id
    left join public.assessment_sessions session
      on session.id = invite.assessment_session_id
      and session.club_id = invite.club_id
      and session.team_id = invite.team_id
    where (
      event.id is null
      or (event.parent_visible is true and event.parent_audience = 'involved_players')
    )
      and coalesce(
        event.starts_at,
        timezone('Europe/London', session.session_date + coalesce(session.start_time, time '00:00'))
      ) >= now() - interval '30 days'
  ),
  training_items as (
    select
      concat('training_attendance:', request_player.id) as invitation_id,
      'training_attendance'::text as invitation_type,
      request_player.id as source_record_id,
      'training_availability'::text as source_type,
      'calendar_event'::text as source_event_type,
      request.calendar_event_id as event_id,
      'training'::text as event_type,
      coalesce(nullif(event.title, ''), 'Training')::text as event_title,
      request.occurrence_starts_at as event_start,
      request.occurrence_ends_at as event_end,
      coalesce(event.location, '')::text as event_location,
      coalesce(team.name, '')::text as team_name,
      request_player.player_id as child_id,
      coalesce(nullif(request_player.player_name, ''), nullif(player.player_name, ''), 'Linked child')::text as child_name,
      link.id as parent_link_id,
      null::text as role_type,
      case
        when request.status = 'cancelled' or request_player.status = 'cancelled' or event.cancelled_at is not null then 'cancelled'
        when request_player.status = 'expired' then 'expired'
        when request.occurrence_starts_at <= now() then 'closed'
        else 'active'
      end::text as invitation_state,
      coalesce(response.status, 'awaiting_response')::text as response_state,
      'not_applicable'::text as selection_state,
      (
        (request_player.parent_link_id = link.id or (
          request_player.parent_link_id is null
          and coalesce(link.email, '') <> ''
          and lower(request_player.recipient_email) = lower(link.email)
        ))
        and request.status <> 'cancelled'
        and request_player.status not in ('cancelled', 'expired')
        and event.cancelled_at is null
        and request.occurrence_starts_at > now()
      ) as can_respond,
      (
        (request_player.parent_link_id = link.id or (
          request_player.parent_link_id is null
          and coalesce(link.email, '') <> ''
          and lower(request_player.recipient_email) = lower(link.email)
        ))
        and request.status <> 'cancelled'
        and request_player.status not in ('cancelled', 'expired')
        and event.cancelled_at is null
        and request.occurrence_starts_at > now()
      ) as can_change_response,
      case
        when request.status = 'cancelled' or request_player.status = 'cancelled' or event.cancelled_at is not null then 'This training session has been cancelled.'
        when request_player.status = 'expired' or request.occurrence_starts_at <= now() then 'The response window has closed.'
        when not (
          request_player.parent_link_id = link.id or (
            request_player.parent_link_id is null
            and coalesce(link.email, '') <> ''
            and lower(request_player.recipient_email) = lower(link.email)
          )
        ) then 'This response belongs to another parent contact for the child.'
        else ''
      end::text as lock_reason,
      request.occurrence_starts_at as response_deadline,
      response.responded_at as last_responded_at
    from parent_link link
    join public.training_availability_request_players request_player
      on request_player.club_id = link.club_id
      and request_player.team_id = link.team_id
      and request_player.player_id = link.player_id
    join public.training_availability_requests request
      on request.id = request_player.request_id
      and request.club_id = link.club_id
      and request.team_id = link.team_id
    join public.calendar_events event
      on event.id = request.calendar_event_id
      and event.club_id = request.club_id
      and event.team_id = request.team_id
    join public.players player
      on player.id = link.player_id
      and player.club_id = link.club_id
    left join public.teams team
      on team.id = request.team_id
    left join public.training_availability_responses response
      on response.request_player_id = request_player.id
    where request.occurrence_starts_at >= now() - interval '30 days'
  ),
  match_scope as (
    select
      match_day.*,
      link.id as link_id,
      link.team_id as link_team_id,
      link.player_id as link_player_id,
      link.email as link_email,
      coalesce(player.player_name, 'Linked child')::text as link_player_name,
      coalesce(team.name, '')::text as link_team_name,
      current_availability.status as current_availability_status,
      current_availability.selected_at as current_availability_responded_at
    from parent_link link
    join public.match_days match_day
      on match_day.club_id = link.club_id
    join public.players player
      on player.id = link.player_id
      and player.club_id = link.club_id
    left join public.teams team
      on team.id = match_day.team_id
    left join public.match_day_player_availability current_availability
      on current_availability.match_day_id = match_day.id
      and current_availability.player_id = link.player_id
    where match_day.parent_visible is true
      and match_day.parent_audience <> 'none'
      and match_day.previous_hidden_at is null
      and (
        (match_day.parent_audience = 'involved_players' and exists (
          select 1
          from public.match_day_availability_requests visible_request
          where visible_request.match_day_id = match_day.id
            and visible_request.club_id = link.club_id
            and visible_request.player_id = link.player_id
        ))
        or (match_day.parent_audience = 'all_team_parents' and match_day.team_id = link.team_id)
        or match_day.parent_audience = 'all_club_parents'
      )
      and (match_day.match_date is null or match_day.match_date >= timezone('Europe/London', now())::date - 30)
  ),
  match_attendance_items as (
    select
      concat('match_attendance:', coalesce(request.id::text, concat(match_day.id::text, ':', match_day.link_player_id::text))) as invitation_id,
      'match_attendance'::text as invitation_type,
      request.id as source_record_id,
      'match_day'::text as source_type,
      'match_day'::text as source_event_type,
      match_day.id as event_id,
      'match_day'::text as event_type,
      concat('Match Day vs ', coalesce(nullif(match_day.opponent, ''), 'opponent'))::text as event_title,
      case
        when match_day.match_date is null then null
        else timezone('Europe/London', match_day.match_date + coalesce(match_day.kickoff_time, time '00:00'))
      end as event_start,
      case
        when match_day.match_date is null then null
        else timezone('Europe/London', match_day.match_date + coalesce(match_day.kickoff_time, time '00:00')) + interval '2 hours'
      end as event_end,
      coalesce(nullif(match_day.venue_address, ''), nullif(match_day.venue_name, ''), '')::text as event_location,
      match_day.link_team_name as team_name,
      match_day.link_player_id as child_id,
      match_day.link_player_name as child_name,
      match_day.link_id as parent_link_id,
      null::text as role_type,
      case
        when match_day.status in ('cancelled', 'postponed') then 'cancelled'
        when match_day.concluded_at is not null or match_day.status = 'full_time' then 'closed'
        when request.id is null then 'shared'
        when request.status = 'expired' or request.expires_at <= now() then 'expired'
        else 'active'
      end::text as invitation_state,
      case
        when request.id is null then 'not_required'
        else coalesce(match_day.current_availability_status, nullif(request.status, 'pending'), 'awaiting_response')
      end::text as response_state,
      'not_applicable'::text as selection_state,
      (
        request.is_owned is true
        and request.status <> 'expired'
        and request.expires_at > now()
        and match_day.status not in ('cancelled', 'postponed', 'full_time')
        and match_day.concluded_at is null
      ) as can_respond,
      (
        request.is_owned is true
        and request.status <> 'expired'
        and request.expires_at > now()
        and match_day.status not in ('cancelled', 'postponed', 'full_time')
        and match_day.concluded_at is null
      ) as can_change_response,
      case
        when match_day.status in ('cancelled', 'postponed') then 'This fixture is not active.'
        when match_day.concluded_at is not null or match_day.status = 'full_time' then 'This fixture has concluded.'
        when request.id is null then 'No attendance response was requested for this fixture.'
        when request.status = 'expired' or request.expires_at <= now() then 'The response deadline has passed.'
        when request.is_owned is false then 'This response belongs to another parent contact for the child.'
        else ''
      end::text as lock_reason,
      request.expires_at as response_deadline,
      coalesce(match_day.current_availability_responded_at, request.responded_at) as last_responded_at
    from match_scope match_day
    left join lateral (
      select
        availability_request.*,
        (
          availability_request.parent_link_id = match_day.link_id or (
            availability_request.parent_link_id is null
            and coalesce(match_day.link_email, '') <> ''
            and lower(availability_request.recipient_email) = lower(match_day.link_email)
          )
        ) as is_owned
      from public.match_day_availability_requests availability_request
      where availability_request.match_day_id = match_day.id
        and availability_request.club_id = match_day.club_id
        and availability_request.team_id = match_day.link_team_id
        and availability_request.player_id = match_day.link_player_id
      order by
        case when (
          availability_request.parent_link_id = match_day.link_id or (
            availability_request.parent_link_id is null
            and coalesce(match_day.link_email, '') <> ''
            and lower(availability_request.recipient_email) = lower(match_day.link_email)
          )
        ) then 0 else 1 end,
        availability_request.updated_at desc,
        availability_request.created_at desc
      limit 1
    ) request on true
  ),
  match_role_items as (
    select
      concat('match_role:', request.id, ':', role_offer.role_type) as invitation_id,
      'match_role'::text as invitation_type,
      request.id as source_record_id,
      'match_day'::text as source_type,
      'match_day'::text as source_event_type,
      match_day.id as event_id,
      'match_day'::text as event_type,
      concat('Match Day vs ', coalesce(nullif(match_day.opponent, ''), 'opponent'))::text as event_title,
      case
        when match_day.match_date is null then null
        else timezone('Europe/London', match_day.match_date + coalesce(match_day.kickoff_time, time '00:00'))
      end as event_start,
      case
        when match_day.match_date is null then null
        else timezone('Europe/London', match_day.match_date + coalesce(match_day.kickoff_time, time '00:00')) + interval '2 hours'
      end as event_end,
      coalesce(nullif(match_day.venue_address, ''), nullif(match_day.venue_name, ''), '')::text as event_location,
      match_day.link_team_name as team_name,
      match_day.link_player_id as child_id,
      match_day.link_player_name as child_name,
      match_day.link_id as parent_link_id,
      role_offer.role_type,
      case
        when match_day.status in ('cancelled', 'postponed') then 'cancelled'
        when match_day.concluded_at is not null or match_day.status = 'full_time' then 'closed'
        when assignment.id is not null then 'closed'
        when request.status = 'expired' or request.expires_at <= now() then 'expired'
        else 'offered'
      end::text as invitation_state,
      case
        when role_offer.response_value = 'yes' then 'accepted'
        when role_offer.response_value = 'no' then 'declined'
        else 'awaiting_response'
      end::text as response_state,
      case
        when assignment.parent_link_id = match_day.link_id then 'selected'
        when assignment.id is not null then 'selected_elsewhere'
        else 'not_selected'
      end::text as selection_state,
      (
        request.status <> 'expired'
        and request.expires_at > now()
        and assignment.id is null
        and match_day.status not in ('cancelled', 'postponed', 'full_time')
        and match_day.concluded_at is null
      ) as can_respond,
      (
        request.status <> 'expired'
        and request.expires_at > now()
        and assignment.id is null
        and match_day.status not in ('cancelled', 'postponed', 'full_time')
        and match_day.concluded_at is null
      ) as can_change_response,
      case
        when match_day.status in ('cancelled', 'postponed') then 'This fixture is not active.'
        when match_day.concluded_at is not null or match_day.status = 'full_time' then 'This fixture has concluded.'
        when assignment.parent_link_id = match_day.link_id then 'Staff have selected you for this role. Contact the team if this needs to change.'
        when assignment.id is not null then 'Another volunteer has been selected for this role.'
        when request.status = 'expired' or request.expires_at <= now() then 'The response deadline has passed.'
        else ''
      end::text as lock_reason,
      request.expires_at as response_deadline,
      request.volunteer_responded_at as last_responded_at
    from match_scope match_day
    join lateral (
      select availability_request.*
      from public.match_day_availability_requests availability_request
      where availability_request.match_day_id = match_day.id
        and availability_request.club_id = match_day.club_id
        and availability_request.team_id = match_day.link_team_id
        and availability_request.player_id = match_day.link_player_id
        and (
          availability_request.parent_link_id = match_day.link_id or (
            availability_request.parent_link_id is null
            and coalesce(match_day.link_email, '') <> ''
            and lower(availability_request.recipient_email) = lower(match_day.link_email)
          )
        )
      order by availability_request.updated_at desc, availability_request.created_at desc
      limit 1
    ) request on true
    cross join lateral (
      values
        ('scorer'::text, match_day.request_scorer, request.volunteer_scorer_response),
        ('linesman'::text, match_day.request_linesman, request.volunteer_linesman_response),
        ('referee'::text, match_day.request_referee, request.volunteer_referee_response)
    ) role_offer(role_type, is_requested, response_value)
    left join public.match_day_role_assignments assignment
      on assignment.match_day_id = match_day.id
      and assignment.role = role_offer.role_type
    where match_day.team_id = match_day.link_team_id
      and role_offer.is_requested is true
  )
  select * from calendar_items
  union all
  select * from training_items
  union all
  select * from match_attendance_items
  union all
  select * from match_role_items
  order by event_start asc nulls last, event_title, invitation_type, role_type nulls first;
$$;

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
set search_path = public
as $$
declare
  link_row public.parent_player_links%rowtype;
  request_row public.match_day_availability_requests%rowtype;
  match_row public.match_days%rowtype;
  response_row record;
  normalized_kind text := lower(trim(coalesce(response_kind_value, '')));
  normalized_role text := lower(trim(coalesce(role_type_value, '')));
  normalized_response text := lower(trim(coalesce(response_value, '')));
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
    and (
      request.parent_link_id = link_row.id or (
        request.parent_link_id is null
        and coalesce(link_row.email, '') <> ''
        and lower(request.recipient_email) = lower(link_row.email)
      )
    )
  for update;

  if request_row.id is null then
    raise exception 'This invitation does not belong to this parent and child.';
  end if;

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
      raise exception 'Staff have completed the selection for this role.';
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
set search_path = public
as $$
declare
  link_row public.parent_player_links%rowtype;
  request_player_row public.training_availability_request_players%rowtype;
  request_row public.training_availability_requests%rowtype;
  event_row public.calendar_events%rowtype;
  response_row record;
  normalized_response text := lower(trim(coalesce(response_value, '')));
begin
  if auth.uid() is null then
    raise exception 'Login is required before changing this response.';
  end if;

  if normalized_response not in ('available', 'unavailable', 'maybe') then
    raise exception 'Choose a valid training attendance response.';
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

  select request_player.*
  into request_player_row
  from public.training_availability_request_players request_player
  where request_player.id = request_player_id_value
    and request_player.club_id = link_row.club_id
    and request_player.team_id = link_row.team_id
    and request_player.player_id = link_row.player_id
    and (
      request_player.parent_link_id = link_row.id or (
        request_player.parent_link_id is null
        and coalesce(link_row.email, '') <> ''
        and lower(request_player.recipient_email) = lower(link_row.email)
      )
    )
  for update;

  if request_player_row.id is null then
    raise exception 'This invitation does not belong to this parent and child.';
  end if;

  select request.*
  into request_row
  from public.training_availability_requests request
  where request.id = request_player_row.request_id
    and request.club_id = link_row.club_id
    and request.team_id = link_row.team_id
  limit 1;

  select event.*
  into event_row
  from public.calendar_events event
  where event.id = request_player_row.calendar_event_id
    and event.club_id = link_row.club_id
    and event.team_id = link_row.team_id
  limit 1;

  if request_row.id is null or event_row.id is null then
    raise exception 'This training invitation is not available.';
  end if;

  if request_row.status = 'cancelled'
    or request_player_row.status in ('cancelled', 'expired')
    or event_row.cancelled_at is not null
    or request_row.occurrence_starts_at <= now() then
    raise exception 'This training response window has closed.';
  end if;

  select response.*
  into response_row
  from public.submit_training_availability_response(
    request_player_row.token_hash,
    normalized_response,
    ''
  ) response
  limit 1;

  if response_row.request_player_id is null then
    raise exception 'The training response could not be saved.';
  end if;

  return jsonb_build_object(
    'requestPlayerId', response_row.request_player_id,
    'responseState', response_row.response_status,
    'respondedAt', response_row.responded_at
  );
end;
$$;

revoke all on function public.get_parent_portal_invitation_state(uuid) from public;
revoke execute on function public.get_parent_portal_invitation_state(uuid) from anon;
grant execute on function public.get_parent_portal_invitation_state(uuid) to authenticated, service_role;

revoke all on function public.respond_parent_portal_match_day_invitation(uuid, uuid, text, text, text) from public;
revoke execute on function public.respond_parent_portal_match_day_invitation(uuid, uuid, text, text, text) from anon;
grant execute on function public.respond_parent_portal_match_day_invitation(uuid, uuid, text, text, text) to authenticated, service_role;

revoke all on function public.respond_parent_portal_training_invitation(uuid, uuid, text) from public;
revoke execute on function public.respond_parent_portal_training_invitation(uuid, uuid, text) from anon;
grant execute on function public.respond_parent_portal_training_invitation(uuid, uuid, text) to authenticated, service_role;

comment on function public.get_parent_portal_invitation_state(uuid) is
  'Authenticated parent-facing invitation read model across calendar, training availability, Match Day attendance, and Match Day role offers.';

comment on function public.respond_parent_portal_match_day_invitation(uuid, uuid, text, text, text) is
  'Allows an authenticated linked parent to change only their active Match Day attendance or role-offer response.';

comment on function public.respond_parent_portal_training_invitation(uuid, uuid, text) is
  'Allows an authenticated linked parent to change only their active Training Availability response.';
