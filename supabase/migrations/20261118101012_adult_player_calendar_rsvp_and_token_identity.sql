-- Auth-only adult accounts have no staff profile. Resolve their current verified identity from Auth.
create or replace function app_private.adult_player_contact_is_current(
  player_id_value uuid, club_id_value uuid, team_id_value uuid, email_value text
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.adult_player_account_links link
    join auth.users account on account.id = link.user_id
    join public.players player on player.id = link.player_id
    join public.teams team on team.id = link.team_id and team.club_id = link.club_id
    join public.clubs club on club.id = link.club_id
    where link.player_id = player_id_value and link.club_id = club_id_value and link.team_id = team_id_value
      and link.status = 'active' and link.revoked_at is null and link.verified_at is not null
      and account.deleted_at is null and account.email_confirmed_at is not null
      and (account.banned_until is null or account.banned_until <= now())
      and lower(btrim(account.email)) = lower(btrim(email_value))
      and player.club_id = link.club_id and player.team_id = link.team_id
      and player.status = 'active' and player.archived_at is null
      and player.date_of_birth <= (current_date - interval '18 years')::date
      and player.contact_type in ('self', 'both')
      and coalesce(team.status, 'active') = 'active'
      and coalesce(club.status, 'active') = 'active' and club.archived_at is null
      and not exists (select 1 from public.users staff where staff.id = account.id)
      and not exists (select 1 from public.user_club_memberships staff where staff.auth_user_id = account.id)
      and exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(player.parent_contacts) = 'array' then player.parent_contacts else '[]'::jsonb end) contact
        where lower(btrim(coalesce(contact->>'type', contact->>'contactType', ''))) = 'self'
          and lower(btrim(coalesce(contact->>'email', contact->>'parentEmail', ''))) = lower(btrim(account.email))
      )
  );
$$;
revoke all on function app_private.adult_player_contact_is_current(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function app_private.adult_player_contact_is_current(uuid, uuid, uuid, text) to service_role;

-- Parent token branches remain unchanged. Only direct adult identity resolution changes.
create or replace function public.is_match_day_action_token_current_internal(token_hash_value text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.match_day_availability_requests request
    join public.match_days match_day on match_day.id = request.match_day_id and match_day.club_id = request.club_id and match_day.team_id = request.team_id
    join public.players player on player.id = request.player_id and player.club_id = request.club_id
    left join public.parent_player_links parent_link on parent_link.id = request.parent_link_id and parent_link.club_id = request.club_id and parent_link.team_id = request.team_id and parent_link.player_id = request.player_id and lower(btrim(parent_link.email)) = lower(btrim(request.recipient_email))
    left join lateral (
      select
        count(*) filter (where btrim(coalesce(contact ->> 'email', contact ->> 'parentEmail', '')) <> '')::integer usable_count,
        coalesce(bool_or(lower(btrim(coalesce(contact ->> 'email', contact ->> 'parentEmail', ''))) = lower(btrim(request.recipient_email))), false) any_match,
        coalesce(bool_or(lower(btrim(coalesce(contact ->> 'email', contact ->> 'parentEmail', ''))) = lower(btrim(request.recipient_email)) and lower(btrim(coalesce(contact ->> 'type', contact ->> 'contactType', 'parent'))) = 'self'), false) self_match,
        coalesce(bool_or(lower(btrim(coalesce(contact ->> 'email', contact ->> 'parentEmail', ''))) = lower(btrim(request.recipient_email)) and lower(btrim(coalesce(contact ->> 'type', contact ->> 'contactType', 'parent'))) <> 'self'), false) parent_match
      from jsonb_array_elements(coalesce(player.parent_contacts, '[]'::jsonb)) contact
    ) current_contacts on true
    where request.token_hash = lower(btrim(coalesce(token_hash_value, '')))
      and lower(btrim(coalesce(token_hash_value, ''))) ~ '^[a-f0-9]{64}$'
      and request.token_revoked_at is null
      and request.status <> 'expired'
      and request.expires_at >= timezone('utc', now())
      and match_day.deleted_at is null
      and coalesce(match_day.status, 'scheduled') not in ('cancelled', 'full_time', 'postponed')
      and coalesce(player.status, 'active') <> 'archived'
      and (
        (request.parent_link_id is null and request.recipient_type = 'player'
          and app_private.adult_player_contact_is_current(request.player_id, request.club_id, request.team_id, request.recipient_email)
          and ((lower(btrim(coalesce(player.contact_type, 'parent'))) = 'self' and ((current_contacts.usable_count = 0 and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request.recipient_email))) or (current_contacts.usable_count = 1 and current_contacts.any_match) or current_contacts.self_match)) or (lower(btrim(coalesce(player.contact_type, 'parent'))) = 'both' and current_contacts.self_match)))
        or (parent_link.id is not null and parent_link.status = 'active')
        or (request.parent_link_id is null and request.recipient_type = 'parent' and lower(btrim(coalesce(player.contact_type, 'parent'))) in ('parent', 'both') and ((current_contacts.usable_count = 0 and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request.recipient_email))) or current_contacts.parent_match))
      )
  );
$$;

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
    join public.training_availability_requests request on request.id = request_player.request_id and request.calendar_event_id = request_player.calendar_event_id and request.club_id = request_player.club_id and request.team_id = request_player.team_id
    join public.calendar_events event on event.id = request.calendar_event_id and event.club_id = request.club_id and event.team_id = request.team_id
    join public.players player on player.id = request_player.player_id and player.club_id = request_player.club_id
    where request_player.token_hash = lower(btrim(coalesce(token_hash_value, '')))
      and lower(btrim(coalesce(token_hash_value, ''))) ~ '^[a-f0-9]{64}$'
      and request_player.token_revoked_at is null
      and lower(coalesce(request_player.status, '')) not in ('cancelled', 'expired')
      and lower(coalesce(request.status, '')) not in ('cancelled', 'expired')
      and coalesce(request_player.response_deadline_at, request.occurrence_starts_at) >= timezone('utc', now())
      and event.cancelled_at is null
      and lower(coalesce(player.status, 'active')) <> 'archived'
      and (
        (request_player.parent_link_id is not null and exists (select 1 from public.parent_player_links parent_link where parent_link.id = request_player.parent_link_id and parent_link.club_id = request_player.club_id and parent_link.team_id = request_player.team_id and parent_link.player_id = request_player.player_id and parent_link.status = 'active' and lower(btrim(coalesce(parent_link.email, ''))) = lower(btrim(request_player.recipient_email))))
        or (request_player.parent_link_id is null and request_player.recipient_type = 'player' and app_private.adult_player_contact_is_current(request_player.player_id, request_player.club_id, request_player.team_id, request_player.recipient_email))
        or (request_player.parent_link_id is null and request_player.recipient_type = 'parent' and coalesce(player.contact_type, 'parent') <> 'self' and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request_player.recipient_email)) and not exists (select 1 from public.parent_player_links active_parent_link where active_parent_link.club_id = request_player.club_id and active_parent_link.team_id = request_player.team_id and active_parent_link.player_id = request_player.player_id and active_parent_link.status = 'active'))
      )
  );
$$;

-- Keep adult responses separate from any coexisting Parent response on the invitation.
alter table public.calendar_event_invites
  add column adult_response_status text,
  add column adult_responded_at timestamptz,
  add column adult_response_user_id uuid references auth.users(id) on delete set null,
  add constraint calendar_event_invites_adult_response_check check (adult_response_status in ('available', 'maybe', 'unavailable'));

create or replace function public.get_own_adult_player_invitation_state()
returns table (
  invitation_id text,
  invitation_type text,
  source_record_id uuid,
  event_id uuid,
  event_type text,
  event_title text,
  event_start timestamptz,
  event_end timestamptz,
  event_location text,
  team_name text,
  response_state text,
  selection_state text,
  can_respond boolean,
  lock_reason text,
  response_deadline timestamptz,
  last_responded_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with adult_context as (
    select state.*
    from public.get_own_adult_player_account_state() state
    where state.access_granted is true
      and app_private.adult_player_contact_is_current(state.player_id, state.club_id, state.team_id, (select email from auth.users where id = auth.uid()))
    limit 1
  ),
  calendar_items as (
    select
      concat('calendar:', invite.id)::text as invitation_id,
      'calendar_attendance'::text as invitation_type,
      invite.id as source_record_id,
      event.id as event_id,
      coalesce(nullif(event.event_type, ''), 'general')::text as event_type,
      coalesce(nullif(event.title, ''), 'Club event')::text as event_title,
      event.starts_at as event_start,
      event.ends_at as event_end,
      coalesce(event.location, '')::text as event_location,
      context.team_name,
      coalesce(invite.adult_response_status, 'awaiting_response')::text as response_state,
      'not_applicable'::text as selection_state,
      (invite.invite_status <> 'cancelled' and invite.cancelled_at is null and event.cancelled_at is null and event.starts_at > now()) as can_respond,
      case
        when invite.invite_status = 'cancelled' or invite.cancelled_at is not null or event.cancelled_at is not null then 'This event has been cancelled.'
        when event.starts_at <= now() then 'This event has closed.'
        else ''
      end::text as lock_reason,
      event.starts_at as response_deadline,
      invite.adult_responded_at as last_responded_at
    from adult_context context
    join public.calendar_event_invites invite
      on invite.club_id = context.club_id
      and invite.team_id = context.team_id
      and invite.player_id = context.player_id
      and invite.recipient_type in ('player', 'parent_and_player')
    join public.calendar_events event
      on event.id = invite.calendar_event_id
      and event.club_id = context.club_id
      and event.team_id = context.team_id
    where event.starts_at >= now() - interval '30 days'
      and event.event_type not in ('training', 'match_day')
      and lower(btrim(invite.player_contact_email)) = lower(btrim((select email from auth.users where id = auth.uid())))
  ),
  training_items as (
    select
      concat('training:', request_player.id)::text as invitation_id,
      'training_attendance'::text as invitation_type,
      request_player.id as source_record_id,
      request.calendar_event_id as event_id,
      'training'::text as event_type,
      coalesce(nullif(event.title, ''), 'Training')::text as event_title,
      request.occurrence_starts_at as event_start,
      request.occurrence_ends_at as event_end,
      coalesce(event.location, '')::text as event_location,
      context.team_name,
      coalesce(response.status, 'awaiting_response')::text as response_state,
      'not_applicable'::text as selection_state,
      (
        request.status not in ('cancelled', 'expired')
        and request_player.token_revoked_at is null
        and request_player.status not in ('cancelled', 'expired')
        and event.cancelled_at is null
        and coalesce(request_player.response_deadline_at, request.occurrence_starts_at) > now()
      ) as can_respond,
      case
        when request.status = 'cancelled' or request_player.status = 'cancelled' or event.cancelled_at is not null then 'This training session has been cancelled.'
        when request_player.token_revoked_at is not null then 'This invitation is no longer valid.'
        when request.status = 'expired' or request_player.status = 'expired' or coalesce(request_player.response_deadline_at, request.occurrence_starts_at) <= now() then 'The response window has closed.'
        else ''
      end::text as lock_reason,
      coalesce(request_player.response_deadline_at, request.occurrence_starts_at) as response_deadline,
      response.responded_at as last_responded_at
    from adult_context context
    join public.training_availability_request_players request_player
      on request_player.club_id = context.club_id
      and request_player.team_id = context.team_id
      and request_player.player_id = context.player_id
      and request_player.parent_link_id is null
      and request_player.recipient_type = 'player'
    join public.training_availability_requests request
      on request.id = request_player.request_id
      and request.club_id = context.club_id
      and request.team_id = context.team_id
    join public.calendar_events event
      on event.id = request.calendar_event_id
      and event.club_id = context.club_id
      and event.team_id = context.team_id
    left join public.training_availability_responses response
      on response.request_player_id = request_player.id
    where request.occurrence_starts_at >= now() - interval '30 days'
  ),
  match_items as (
    select
      concat('match:', request.id)::text as invitation_id,
      'match_attendance'::text as invitation_type,
      request.id as source_record_id,
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
      context.team_name,
      coalesce(availability.status, nullif(request.status, 'pending'), 'awaiting_response')::text as response_state,
      coalesce(decision.status, 'undecided')::text as selection_state,
      (
        request.status <> 'expired'
        and request.token_revoked_at is null
        and request.expires_at > now()
        and match_day.status not in ('cancelled', 'postponed', 'full_time')
        and match_day.concluded_at is null
        and match_day.deleted_at is null
      ) as can_respond,
      case
        when match_day.status in ('cancelled', 'postponed') then 'This fixture is not active.'
        when match_day.status = 'full_time' or match_day.concluded_at is not null then 'This fixture has concluded.'
        when match_day.deleted_at is not null then 'This fixture is no longer available.'
        when request.token_revoked_at is not null then 'This invitation is no longer valid.'
        when request.status = 'expired' or request.expires_at <= now() then 'The response deadline has passed.'
        else ''
      end::text as lock_reason,
      request.expires_at as response_deadline,
      coalesce(availability.selected_at, request.responded_at) as last_responded_at
    from adult_context context
    join public.match_day_availability_requests request
      on request.club_id = context.club_id
      and request.team_id = context.team_id
      and request.player_id = context.player_id
      and request.parent_link_id is null
      and request.recipient_type = 'player'
    join public.match_days match_day
      on match_day.id = request.match_day_id
      and match_day.club_id = context.club_id
      and match_day.team_id = context.team_id
    left join public.match_day_player_availability availability
      on availability.match_day_id = match_day.id
      and availability.player_id = context.player_id
    left join public.match_day_player_squad_decisions decision
      on decision.match_day_id = match_day.id
      and decision.player_id = context.player_id
    where match_day.match_date is null
      or match_day.match_date >= timezone('Europe/London', now())::date - 30
  )
  select * from calendar_items
  union all
  select * from training_items
  union all
  select * from match_items
  order by event_start asc nulls last, event_title, invitation_type;
$$;

create function public.respond_own_adult_player_calendar_invitation(invite_id_value uuid, response_value text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  context_row record;
  invite public.calendar_event_invites%rowtype;
  event public.calendar_events%rowtype;
  account_email text;
  normalized_response text := lower(btrim(coalesce(response_value, '')));
begin
  select email into account_email from auth.users where id = auth.uid();
  select state.* into context_row from public.get_own_adult_player_account_state() state
    where state.access_granted is true
      and app_private.adult_player_contact_is_current(state.player_id, state.club_id, state.team_id, account_email);
  if context_row.link_id is null then
    return jsonb_build_object('success', false, 'denialCategory', 'adult_player_context_denied', 'message', 'Adult-player access is not available.');
  end if;
  if normalized_response not in ('available', 'maybe', 'unavailable') then
    return jsonb_build_object('success', false, 'denialCategory', 'invalid_response', 'message', 'Choose Attending, Maybe, or Not attending.');
  end if;
  select i.* into invite from public.calendar_event_invites i
    where i.id = invite_id_value and i.player_id = context_row.player_id
      and i.club_id = context_row.club_id and i.team_id = context_row.team_id
      and i.recipient_type in ('player', 'parent_and_player')
      and lower(btrim(i.player_contact_email)) = lower(btrim(account_email)) for update;
  if invite.id is null then
    return jsonb_build_object('success', false, 'denialCategory', 'invitation_not_owned', 'message', 'This Calendar invitation is not available to this player.');
  end if;
  select e.* into event from public.calendar_events e where e.id = invite.calendar_event_id
    and e.club_id = context_row.club_id and e.team_id = context_row.team_id for share;
  if event.id is null or event.event_type in ('training', 'match_day')
    or invite.invite_status = 'cancelled' or invite.cancelled_at is not null
    or event.cancelled_at is not null or event.starts_at <= now() then
    return jsonb_build_object('success', false, 'denialCategory', 'response_window_closed', 'message', 'This Calendar response window has closed.');
  end if;
  update public.calendar_event_invites set adult_response_status = normalized_response,
    adult_responded_at = now(), adult_response_user_id = auth.uid() where id = invite.id;
  perform public.record_adult_player_response_audit_internal(context_row.club_id, auth.uid(), context_row.link_id,
    context_row.player_id, context_row.team_id, event.id, invite.id, 'adult_player_calendar_response_saved',
    'success', coalesce(invite.adult_response_status, 'awaiting_response'), normalized_response, '');
  return jsonb_build_object('success', true, 'inviteId', invite.id, 'responseState', normalized_response, 'responseSource', 'adult_player');
end;
$$;
revoke all on function public.respond_own_adult_player_calendar_invitation(uuid, text) from public, anon;
grant execute on function public.respond_own_adult_player_calendar_invitation(uuid, text) to authenticated, service_role;
