-- FP-PUBLIC-RELEASE-AUDIT-74
-- Player contact details are the email delivery authority. A verified Parent
-- account remains required for Parent inbox routing and push delivery.

alter table public.parent_mobile_notification_events
  drop constraint if exists parent_mobile_notification_events_intent_check;
alter table public.parent_mobile_notification_events
  add constraint parent_mobile_notification_events_intent_check
  check (intent_type in (
    'parent_message',
    'parent_poll',
    'matchday_update',
    'training_update',
    'parent_chat',
    'resource_shared',
    'poll_results'
  ));

create or replace function public.event_player_eligible_recipients(
  club_id_value uuid,
  team_id_value uuid,
  player_ids_value uuid[]
)
returns table (
  player_id uuid,
  player_name text,
  recipient_email text,
  recipient_name text,
  recipient_type text,
  parent_link_id uuid
)
language sql
security definer
set search_path = ''
stable
as $$
  with selected_players as (
    select
      player.id,
      coalesce(nullif(btrim(player.player_name), ''), 'Player') as player_name,
      lower(btrim(coalesce(player.parent_email, ''))) as configured_email,
      coalesce(nullif(btrim(player.parent_name), ''), player.player_name, 'Player contact') as configured_name,
      case
        when jsonb_typeof(coalesce(player.parent_contacts, '[]'::jsonb)) = 'array'
          then coalesce(player.parent_contacts, '[]'::jsonb)
        else '[]'::jsonb
      end as parent_contacts,
      lower(btrim(coalesce(player.contact_type, 'parent'))) as contact_type
    from public.player_team_memberships membership
    join public.players player
      on player.id = membership.player_id
      and player.club_id = membership.club_id
    where membership.club_id = club_id_value
      and membership.team_id = team_id_value
      and membership.status = 'active'
      and membership.ended_at is null
      and player.id = any(coalesce(player_ids_value, '{}'::uuid[]))
      and coalesce(player.status, 'active') = 'active'
      and player.archived_at is null
  ),
  configured_parent_contacts as (
    select
      player.id as player_id,
      player.player_name,
      lower(btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))) as recipient_email,
      coalesce(
        nullif(btrim(coalesce(contact.value ->> 'name', contact.value ->> 'parentName', '')), ''),
        player.configured_name,
        'Parent or guardian'
      ) as recipient_name,
      1 as priority
    from selected_players player
    cross join lateral jsonb_array_elements(player.parent_contacts) contact(value)
    where player.contact_type in ('parent', 'both')
      and lower(btrim(coalesce(contact.value ->> 'type', contact.value ->> 'contactType', 'parent'))) <> 'self'
      and btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))
        ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  fallback_parent_contacts as (
    select
      player.id as player_id,
      player.player_name,
      player.configured_email as recipient_email,
      player.configured_name as recipient_name,
      2 as priority
    from selected_players player
    where player.contact_type in ('parent', 'both')
      and player.configured_email ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  parent_email_candidates as (
    select * from configured_parent_contacts
    union all
    select * from fallback_parent_contacts
  ),
  resolved_parent_contacts as (
    select distinct on (candidate.player_id, candidate.recipient_email)
      candidate.player_id,
      candidate.player_name,
      candidate.recipient_email,
      coalesce(
        nullif(btrim(parent_authority.recipient_name), ''),
        nullif(btrim(candidate.recipient_name), ''),
        'Parent or guardian'
      ) as recipient_name,
      public.canonical_calendar_invite_recipient_type('parent') as recipient_type,
      parent_authority.parent_link_id,
      candidate.priority
    from parent_email_candidates candidate
    left join lateral (
      select
        link.id as parent_link_id,
        coalesce(
          nullif(btrim(parent_auth.raw_user_meta_data ->> 'display_name'), ''),
          nullif(btrim(parent_auth.raw_user_meta_data ->> 'name'), '')
        ) as recipient_name
      from public.parent_player_links link
      join auth.users parent_auth
        on parent_auth.id = link.auth_user_id
        and parent_auth.deleted_at is null
        and parent_auth.email_confirmed_at is not null
        and (parent_auth.banned_until is null or parent_auth.banned_until <= timezone('utc', now()))
        and lower(btrim(coalesce(parent_auth.email, ''))) = candidate.recipient_email
      where link.club_id = club_id_value
        and link.team_id = team_id_value
        and link.player_id = candidate.player_id
        and link.status = 'active'
        and link.auth_user_id is not null
        and lower(btrim(coalesce(link.email, ''))) = candidate.recipient_email
      order by link.id
      limit 1
    ) parent_authority on true
    where candidate.recipient_email <> ''
    order by candidate.player_id, candidate.recipient_email, candidate.priority
  ),
  active_adult_players as (
    select
      player.id as player_id,
      player.player_name,
      lower(btrim(adult_auth.email)) as recipient_email,
      coalesce(
        nullif(btrim(adult_auth.raw_user_meta_data ->> 'display_name'), ''),
        nullif(btrim(adult_auth.raw_user_meta_data ->> 'name'), ''),
        player.player_name
      ) as recipient_name,
      public.canonical_calendar_invite_recipient_type('adult_player') as recipient_type,
      null::uuid as parent_link_id,
      3 as priority
    from selected_players player
    join public.adult_player_account_links adult_link
      on adult_link.club_id = club_id_value
      and adult_link.team_id = team_id_value
      and adult_link.player_id = player.id
      and adult_link.status = 'active'
      and adult_link.verified_at is not null
      and adult_link.revoked_at is null
    join auth.users adult_auth
      on adult_auth.id = adult_link.user_id
      and adult_auth.deleted_at is null
      and adult_auth.email_confirmed_at is not null
      and (adult_auth.banned_until is null or adult_auth.banned_until <= timezone('utc', now()))
    where player.contact_type in ('self', 'both')
      and lower(btrim(coalesce(adult_auth.email, ''))) = player.configured_email
      and btrim(coalesce(adult_auth.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  candidates as (
    select
      parent_recipient.player_id,
      parent_recipient.player_name,
      parent_recipient.recipient_email,
      parent_recipient.recipient_name,
      parent_recipient.recipient_type,
      parent_recipient.parent_link_id,
      parent_recipient.priority
    from resolved_parent_contacts parent_recipient
    union all
    select * from active_adult_players
  )
  select distinct on (candidate.player_id, candidate.recipient_email)
    candidate.player_id,
    candidate.player_name,
    candidate.recipient_email,
    candidate.recipient_name,
    candidate.recipient_type,
    candidate.parent_link_id
  from candidates candidate
  where candidate.recipient_email <> ''
    and candidate.recipient_type is not null
  order by candidate.player_id, candidate.recipient_email, candidate.priority, candidate.parent_link_id nulls last;
$$;

revoke all on function public.event_player_eligible_recipients(uuid, uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.event_player_eligible_recipients(uuid, uuid, uuid[])
to service_role;

comment on function public.event_player_eligible_recipients(uuid, uuid, uuid[]) is
  'Resolves email delivery from canonical Player contact details and attaches verified Parent app authority only when it exists.';

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
  event_date date,
  kickoff_time_tbc boolean,
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
set search_path = ''
as $$
  with target_link as (
    select link.*
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = (select auth.uid())
      and link.status = 'active'
    limit 1
  ),
  legacy as (
    select item.*
    from public.get_parent_portal_invitation_state_match_selection86_legacy(parent_link_id_value) item
  ),
  normalized as (
    select
      legacy.invitation_id,
      legacy.invitation_type,
      legacy.source_record_id,
      legacy.source_type,
      legacy.source_event_type,
      legacy.event_id,
      legacy.event_type,
      legacy.event_title,
      legacy.event_date,
      legacy.kickoff_time_tbc,
      legacy.event_start,
      legacy.event_end,
      legacy.event_location,
      legacy.team_name,
      legacy.child_id,
      legacy.child_name,
      target_link.id as parent_link_id,
      legacy.role_type,
      case
        when legacy.source_event_type = 'assessment_session' and assessment.status = 'cancelled' then 'cancelled'
        when legacy.source_event_type = 'assessment_session' and assessment.status = 'completed' then 'closed'
        else legacy.invitation_state
      end as invitation_state,
      case
        when legacy.invitation_type = 'training_attendance'
          then coalesce(training_response.status, 'awaiting_response')
        when legacy.invitation_type = 'match_attendance'
          then coalesce(match_availability.status, 'awaiting_response')
        else legacy.response_state
      end as response_state,
      case
        when legacy.source_event_type = 'match_day' and legacy.invitation_type = 'match_attendance'
          then coalesce(squad_decision.status, 'undecided')
        else legacy.selection_state
      end as selection_state,
      case
        when legacy.source_event_type = 'assessment_session' and assessment.status in ('cancelled', 'completed') then false
        when legacy.invitation_type = 'training_attendance' then
          training_request.status <> 'cancelled'
          and training_player.status not in ('cancelled', 'expired')
          and training_event.cancelled_at is null
          and training_request.occurrence_starts_at > now()
        when legacy.invitation_type = 'match_attendance' then
          match_request.id is not null
          and match_request.status <> 'expired'
          and match_request.expires_at > now()
          and match_day.status not in ('cancelled', 'postponed', 'full_time')
          and match_day.concluded_at is null
        else legacy.can_respond
      end as can_respond,
      case
        when legacy.source_event_type = 'assessment_session' and assessment.status in ('cancelled', 'completed') then false
        when legacy.invitation_type = 'training_attendance' then
          training_request.status <> 'cancelled'
          and training_player.status not in ('cancelled', 'expired')
          and training_event.cancelled_at is null
          and training_request.occurrence_starts_at > now()
        when legacy.invitation_type = 'match_attendance' then
          match_request.id is not null
          and match_request.status <> 'expired'
          and match_request.expires_at > now()
          and match_day.status not in ('cancelled', 'postponed', 'full_time')
          and match_day.concluded_at is null
        else legacy.can_change_response
      end as can_change_response,
      case
        when legacy.source_event_type = 'assessment_session' and assessment.status = 'cancelled'
          then 'This Assessment session has been cancelled.'
        when legacy.source_event_type = 'assessment_session' and assessment.status = 'completed'
          then 'This Assessment session is complete.'
        when legacy.invitation_type = 'training_attendance'
          and training_request.status <> 'cancelled'
          and training_player.status not in ('cancelled', 'expired')
          and training_event.cancelled_at is null
          and training_request.occurrence_starts_at > now() then ''
        when legacy.invitation_type = 'match_attendance'
          and match_request.id is not null
          and match_request.status <> 'expired'
          and match_request.expires_at > now()
          and match_day.status not in ('cancelled', 'postponed', 'full_time')
          and match_day.concluded_at is null then ''
        else legacy.lock_reason
      end as lock_reason,
      legacy.response_deadline,
      case
        when legacy.invitation_type = 'training_attendance' then training_response.responded_at
        when legacy.invitation_type = 'match_attendance' then match_availability.selected_at
        else legacy.last_responded_at
      end as last_responded_at,
      row_number() over (
        partition by legacy.invitation_type, legacy.event_id, legacy.child_id, coalesce(legacy.role_type, '')
        order by
          case
            when training_player.parent_link_id = target_link.id or match_request.parent_link_id = target_link.id then 0
            else 1
          end,
          legacy.source_record_id
      ) as duplicate_rank
    from legacy
    cross join target_link
    left join public.assessment_sessions assessment
      on legacy.source_event_type = 'assessment_session'
      and assessment.id = legacy.event_id
    left join public.training_availability_request_players training_player
      on legacy.invitation_type = 'training_attendance'
      and training_player.id = legacy.source_record_id
      and training_player.club_id = target_link.club_id
      and training_player.team_id = target_link.team_id
      and training_player.player_id = target_link.player_id
    left join public.training_availability_requests training_request
      on training_request.id = training_player.request_id
    left join public.calendar_events training_event
      on training_event.id = training_request.calendar_event_id
    left join public.training_availability_responses training_response
      on training_response.request_id = training_player.request_id
      and training_response.player_id = target_link.player_id
    left join public.match_days match_day
      on legacy.invitation_type = 'match_attendance'
      and match_day.id = legacy.event_id
    left join lateral (
      select request.*
      from public.match_day_availability_requests request
      where legacy.invitation_type = 'match_attendance'
        and request.match_day_id = legacy.event_id
        and request.club_id = target_link.club_id
        and request.team_id = target_link.team_id
        and request.player_id = target_link.player_id
      order by
        case when request.parent_link_id = target_link.id then 0 else 1 end,
        request.updated_at desc,
        request.created_at desc
      limit 1
    ) match_request on true
    left join public.match_day_player_availability match_availability
      on match_availability.match_day_id = legacy.event_id
      and match_availability.player_id = target_link.player_id
    left join public.match_day_player_squad_decisions squad_decision
      on squad_decision.match_day_id = legacy.event_id
      and squad_decision.player_id = target_link.player_id
      and squad_decision.club_id = target_link.club_id
  )
  select
    item.invitation_id,
    item.invitation_type,
    item.source_record_id,
    item.source_type,
    item.source_event_type,
    item.event_id,
    item.event_type,
    item.event_title,
    item.event_date,
    item.kickoff_time_tbc,
    item.event_start,
    item.event_end,
    item.event_location,
    item.team_name,
    item.child_id,
    item.child_name,
    item.parent_link_id,
    item.role_type,
    item.invitation_state,
    item.response_state,
    item.selection_state,
    item.can_respond,
    item.can_change_response,
    item.lock_reason,
    item.response_deadline,
    item.last_responded_at
  from normalized item
  where item.duplicate_rank = 1
    and (
      item.invitation_type <> 'calendar_attendance'
      or not exists (
        select 1
        from public.training_availability_requests request
        join public.training_availability_request_players request_player
          on request_player.request_id = request.id
          and request_player.player_id = item.child_id
        where request.calendar_event_id = item.event_id
          and request.club_id = (select link.club_id from target_link link)
          and request.team_id = (select link.team_id from target_link link)
          and request.status <> 'cancelled'
      )
    )
  order by item.event_start asc nulls last, item.event_title, item.invitation_type, item.role_type nulls first;
$$;

revoke all on function public.get_parent_portal_invitation_state(uuid) from public;
revoke execute on function public.get_parent_portal_invitation_state(uuid) from anon;
grant execute on function public.get_parent_portal_invitation_state(uuid) to authenticated, service_role;

comment on function public.get_parent_portal_invitation_state(uuid) is
  'Returns one child-scoped attendance request per event. Attendance is shared by active contacts for the child while volunteer offers remain contact-specific.';

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
  for update;

  if request_player_row.id is null then
    raise exception 'This invitation is not available for this player.';
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

revoke all on function public.respond_parent_portal_training_invitation(uuid, uuid, text) from public;
revoke execute on function public.respond_parent_portal_training_invitation(uuid, uuid, text) from anon;
grant execute on function public.respond_parent_portal_training_invitation(uuid, uuid, text) to authenticated, service_role;

revoke all on function public.respond_parent_portal_match_day_invitation(uuid, uuid, text, text, text) from public;
revoke execute on function public.respond_parent_portal_match_day_invitation(uuid, uuid, text, text, text) from anon;
grant execute on function public.respond_parent_portal_match_day_invitation(uuid, uuid, text, text, text) to authenticated, service_role;

comment on function public.respond_parent_portal_training_invitation(uuid, uuid, text) is
  'Allows any active Parent contact for the child and Team to update the canonical shared Training attendance response.';

comment on function public.respond_parent_portal_match_day_invitation(uuid, uuid, text, text, text) is
  'Shares player attendance across active Parent contacts while keeping Match Day volunteer offers contact-specific.';

create or replace function public.get_parent_portal_polls(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  title text,
  description text,
  audience text,
  poll_type text,
  options jsonb,
  status text,
  closes_at timestamptz,
  allow_multiple boolean,
  max_choices integer,
  allow_own_child_votes boolean,
  allow_vote_changes boolean,
  hide_votes boolean,
  allow_comments boolean,
  created_at timestamptz,
  current_option_id text,
  current_option_ids jsonb,
  votes jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with parent_link as (
    select link.*
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = (select auth.uid())
      and link.status = 'active'
    limit 1
  ),
  own_votes as (
    select
      vote.poll_id,
      jsonb_agg(vote.option_id order by vote.option_id) as option_ids,
      min(vote.option_id) as first_option_id
    from public.poll_votes vote
    where vote.auth_user_id = (select auth.uid())
    group by vote.poll_id
  ),
  vote_counts as (
    select vote.poll_id, vote.option_id, count(*)::integer as vote_count
    from public.poll_votes vote
    group by vote.poll_id, vote.option_id
  )
  select
    poll.id,
    poll.club_id,
    poll.team_id,
    poll.title,
    poll.description,
    poll.audience,
    poll.poll_type,
    poll.options,
    poll.status,
    poll.closes_at,
    poll.allow_multiple,
    poll.max_choices,
    poll.allow_own_child_votes,
    poll.allow_vote_changes,
    poll.hide_votes,
    poll.allow_comments,
    poll.created_at,
    own_votes.first_option_id,
    coalesce(own_votes.option_ids, '[]'::jsonb),
    case
      when poll.hide_votes
        and poll.status = 'open'
        and (poll.closes_at is null or poll.closes_at > timezone('utc', now()))
        and own_votes.poll_id is null then '[]'::jsonb
      else coalesce(
        jsonb_agg(
          jsonb_build_object('optionId', vote_counts.option_id, 'count', vote_counts.vote_count)
          order by vote_counts.option_id
        ) filter (where vote_counts.option_id is not null),
        '[]'::jsonb
      )
    end
  from public.polls poll
  join parent_link link
    on link.club_id = poll.club_id
   and (poll.team_id is null or poll.team_id = link.team_id)
  left join own_votes on own_votes.poll_id = poll.id
  left join vote_counts on vote_counts.poll_id = poll.id
  where poll.audience = 'parents'
    and poll.created_at >= date_trunc('day', link.created_at)
  group by poll.id, own_votes.poll_id, own_votes.first_option_id, own_votes.option_ids
  order by
    case when poll.status = 'open' and (poll.closes_at is null or poll.closes_at > timezone('utc', now())) then 0 else 1 end,
    poll.created_at desc;
$$;

alter function public.get_parent_portal_polls(uuid) owner to postgres;
revoke all on function public.get_parent_portal_polls(uuid) from public, anon, service_role;
grant execute on function public.get_parent_portal_polls(uuid) to authenticated;

comment on function public.get_parent_portal_polls(uuid) is
  'Returns only Parent Polls created on or after the day this Parent joined the child.';

create or replace function public.get_parent_portal_chat_rooms(
  parent_link_id_value uuid,
  child_only_value boolean default false
)
returns table (
  id uuid,
  room_type text,
  status text,
  title text,
  club_id uuid,
  club_name text,
  team_id uuid,
  team_name text,
  player_id uuid,
  player_name text,
  match_day_id uuid,
  opponent text,
  match_date date,
  kickoff_time time,
  kickoff_time_tbc boolean,
  meet_time time,
  venue_name text,
  fixture_status text,
  child_names text[],
  latest_message text,
  latest_message_at timestamptz,
  unread_count bigint,
  can_post boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  target_link public.parent_player_links%rowtype;
  selected_child_name text;
  history_cutoff timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Parent authentication is required.';
  end if;

  select parent_link.*
  into target_link
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = parent_link.club_id
   and coalesce(player.status, 'active') <> 'archived'
   and player.archived_at is null
  where parent_link.id = parent_link_id_value
    and parent_link.auth_user_id = auth.uid()
    and parent_link.status = 'active'
  limit 1;

  if target_link.id is null then
    raise exception 'Parent access is not available for this child.';
  end if;

  history_cutoff := date_trunc('day', target_link.created_at);

  select player.player_name
  into selected_child_name
  from public.players player
  where player.id = target_link.player_id;

  return query
  select
    room.id,
    room.room_type,
    room.status,
    room.title,
    room.club_id,
    room.club_name,
    room.team_id,
    room.team_name,
    room.player_id,
    room.player_name,
    room.match_day_id,
    room.opponent,
    room.match_date,
    room.kickoff_time,
    room.kickoff_time_tbc,
    room.meet_time,
    room.venue_name,
    room.fixture_status,
    case
      when child_only_value then array[selected_child_name]::text[]
      else room.child_names
    end,
    coalesce(latest.body, ''),
    latest.created_at,
    coalesce(unread.total, 0),
    room.can_post
  from public.get_parent_chat_rooms() room
  left join lateral (
    select message.body, message.created_at
    from public.parent_chat_messages message
    where message.room_id = room.id
      and message.deleted_at is null
      and message.created_at >= history_cutoff
    order by message.created_at desc
    limit 1
  ) latest on true
  left join lateral (
    select count(*)::bigint as total
    from public.parent_chat_messages message
    left join public.parent_chat_memberships membership
      on membership.room_id = room.id
      and membership.auth_user_id = auth.uid()
    where message.room_id = room.id
      and message.sender_id <> auth.uid()
      and message.deleted_at is null
      and message.created_at >= history_cutoff
      and message.created_at > greatest(
        coalesce(membership.last_read_at, '-infinity'::timestamptz),
        history_cutoff
      )
  ) unread on true
  where (
    not child_only_value
    or public.parent_chat_room_matches_parent_link(
      room.id,
      target_link.id,
      auth.uid()
    )
  )
  and (
    latest.created_at is not null
    or room.room_type = 'parent_staff'
  )
  order by latest.created_at desc nulls last, room.id;
end;
$$;

revoke all on function public.get_parent_portal_chat_rooms(uuid, boolean) from public, anon;
grant execute on function public.get_parent_portal_chat_rooms(uuid, boolean) to authenticated, service_role;

create or replace function public.get_parent_portal_chat_messages(
  parent_link_id_value uuid,
  target_room_id uuid,
  child_only_value boolean default false
)
returns table (
  id uuid,
  room_id uuid,
  sender_id uuid,
  sender_kind text,
  sender_name text,
  sender_role text,
  body text,
  deleted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  can_delete boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_link public.parent_player_links%rowtype;
  history_cutoff timestamptz;
begin
  select link.*
  into target_link
  from public.parent_player_links link
  where link.id = parent_link_id_value
    and link.auth_user_id = auth.uid()
    and link.status = 'active'
  limit 1;

  if target_link.id is null then
    raise exception 'Parent access is not available for this child.';
  end if;

  if child_only_value
    and not public.parent_chat_room_matches_parent_link(
      target_room_id,
      parent_link_id_value,
      auth.uid()
    ) then
    raise exception 'This Chat room is not available for the selected child.';
  end if;

  history_cutoff := date_trunc('day', target_link.created_at);

  return query
  select message.*
  from public.get_parent_chat_messages(target_room_id) message
  where message.created_at >= history_cutoff
  order by message.created_at;
end;
$$;

revoke all on function public.get_parent_portal_chat_messages(uuid, uuid, boolean) from public, anon;
grant execute on function public.get_parent_portal_chat_messages(uuid, uuid, boolean) to authenticated, service_role;

comment on function public.get_parent_portal_chat_rooms(uuid, boolean) is
  'Returns child-scoped Chat rooms with previews and unread counts limited to messages from the Parent join day onward.';

comment on function public.get_parent_portal_chat_messages(uuid, uuid, boolean) is
  'Prevents a Parent from reading Chat messages created before the day their child link became active.';
