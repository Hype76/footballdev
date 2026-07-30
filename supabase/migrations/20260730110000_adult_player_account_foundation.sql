create table public.adult_player_account_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  player_id uuid not null references public.players (id) on delete restrict,
  club_id uuid not null references public.clubs (id) on delete restrict,
  team_id uuid not null references public.teams (id) on delete restrict,
  status text not null default 'active',
  verified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  constraint adult_player_account_links_status_check
    check (status in ('active', 'revoked')),
  constraint adult_player_account_links_active_verification_check
    check (status <> 'active' or verified_at is not null),
  constraint adult_player_account_links_revocation_check
    check (
      (status = 'active' and revoked_at is null)
      or (status = 'revoked' and revoked_at is not null)
    )
);

create unique index adult_player_account_links_one_active_user_idx
on public.adult_player_account_links (user_id)
where status = 'active';

create unique index adult_player_account_links_one_active_player_idx
on public.adult_player_account_links (player_id)
where status = 'active';

create index adult_player_account_links_scope_idx
on public.adult_player_account_links (club_id, team_id, player_id, status);

create or replace function public.enforce_adult_player_account_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_row public.players%rowtype;
begin
  new.updated_at := timezone('utc', now());

  if new.status = 'revoked' then
    new.revoked_at := coalesce(new.revoked_at, timezone('utc', now()));
    return new;
  end if;

  select player.*
  into player_row
  from public.players player
  where player.id = new.player_id
  for share;

  if player_row.id is null then
    raise exception 'The adult-player link requires a valid player.';
  end if;

  if player_row.status <> 'active'
    or player_row.archived_at is not null
    or player_row.team_id is null then
    raise exception 'The adult-player link requires an active player with a team.';
  end if;

  if player_row.date_of_birth is null then
    raise exception 'The adult-player link requires a verified date of birth.';
  end if;

  if player_row.date_of_birth > (current_date - interval '18 years')::date then
    raise exception 'The adult-player link cannot be created for a player under 18.';
  end if;

  if player_row.contact_type not in ('self', 'both') then
    raise exception 'The adult-player link requires a self-managed player contact type.';
  end if;

  if not exists (
    select 1
    from public.teams team
    where team.id = player_row.team_id
      and team.club_id = player_row.club_id
  ) then
    raise exception 'The player team is outside the player club.';
  end if;

  if new.club_id is not null and new.club_id <> player_row.club_id then
    raise exception 'The requested club does not match the player club.';
  end if;

  if new.team_id is not null and new.team_id <> player_row.team_id then
    raise exception 'The requested team does not match the player team.';
  end if;

  if exists (
    select 1
    from public.users profile
    where profile.id = new.user_id
  ) then
    raise exception 'This authenticated user already has a staff or platform profile.';
  end if;

  if exists (
    select 1
    from public.parent_player_links parent_link
    where parent_link.status = 'active'
      and (
        parent_link.auth_user_id = new.user_id
        or parent_link.player_id = new.player_id
      )
  ) then
    raise exception 'This authenticated user or player already has active parent access.';
  end if;

  new.club_id := player_row.club_id;
  new.team_id := player_row.team_id;
  new.verified_at := coalesce(new.verified_at, timezone('utc', now()));
  new.revoked_at := null;
  new.revoked_by := null;
  return new;
end;
$$;

create trigger enforce_adult_player_account_link_before_write
before insert or update on public.adult_player_account_links
for each row execute function public.enforce_adult_player_account_link();

alter table public.adult_player_account_links enable row level security;

grant select on public.adult_player_account_links to authenticated;

create policy adult_player_account_links_select_own
on public.adult_player_account_links
for select
to authenticated
using (user_id = (select auth.uid()));

create policy players_select_own_adult_account
on public.players
for select
to authenticated
using (
  exists (
    select 1
    from public.adult_player_account_links adult_link
    where adult_link.user_id = (select auth.uid())
      and adult_link.player_id = players.id
      and adult_link.club_id = players.club_id
      and adult_link.team_id = players.team_id
      and adult_link.status = 'active'
      and players.status = 'active'
      and players.archived_at is null
      and players.date_of_birth is not null
      and players.date_of_birth <= (current_date - interval '18 years')::date
      and players.contact_type in ('self', 'both')
  )
);

create or replace function public.get_own_adult_player_account_state()
returns table (
  link_id uuid,
  user_id uuid,
  player_id uuid,
  player_name text,
  player_status text,
  date_of_birth date,
  contact_type text,
  club_id uuid,
  club_name text,
  club_logo_url text,
  club_contact_email text,
  team_id uuid,
  team_name text,
  theme_mode text,
  theme_accent text,
  theme_button_style text,
  link_status text,
  verified_at timestamptz,
  access_mode text,
  role_label text,
  access_granted boolean,
  denial_category text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  active_link_count integer := 0;
begin
  if auth.uid() is null then
    return;
  end if;

  select count(*)
  into active_link_count
  from public.adult_player_account_links adult_link
  where adult_link.user_id = (select auth.uid())
    and adult_link.status = 'active';

  if active_link_count > 1 then
    return query
    select
      null::uuid,
      (select auth.uid()),
      null::uuid,
      ''::text,
      ''::text,
      null::date,
      ''::text,
      null::uuid,
      ''::text,
      ''::text,
      ''::text,
      null::uuid,
      ''::text,
      ''::text,
      ''::text,
      ''::text,
      'active'::text,
      null::timestamptz,
      'player'::text,
      'Player'::text,
      false,
      'ambiguous_active_links'::text;
    return;
  end if;

  return query
  select
    adult_link.id,
    adult_link.user_id,
    adult_link.player_id,
    coalesce(nullif(player.player_name, ''), 'Player')::text,
    player.status,
    player.date_of_birth,
    player.contact_type,
    adult_link.club_id,
    coalesce(nullif(club.name, ''), 'Football club')::text,
    coalesce(club.logo_url, '')::text,
    coalesce(club.contact_email, '')::text,
    adult_link.team_id,
    coalesce(nullif(team.name, ''), nullif(player.team, ''), 'Team')::text,
    coalesce(team.theme_mode, '')::text,
    coalesce(club.theme_accent, team.theme_accent, '')::text,
    coalesce(club.theme_button_style, team.theme_button_style, '')::text,
    adult_link.status,
    adult_link.verified_at,
    'player'::text,
    'Player'::text,
    (
      adult_link.status = 'active'
      and player.status = 'active'
      and player.archived_at is null
      and player.club_id = adult_link.club_id
      and player.team_id = adult_link.team_id
      and team.club_id = adult_link.club_id
      and player.date_of_birth is not null
      and player.date_of_birth <= (current_date - interval '18 years')::date
      and player.contact_type in ('self', 'both')
    ),
    case
      when adult_link.status <> 'active' then 'link_revoked'
      when player.status <> 'active' or player.archived_at is not null then 'player_inactive'
      when player.club_id <> adult_link.club_id or player.team_id <> adult_link.team_id then 'scope_changed'
      when team.id is null or team.club_id <> adult_link.club_id then 'team_access_missing'
      when player.date_of_birth is null then 'date_of_birth_missing'
      when player.date_of_birth > (current_date - interval '18 years')::date then 'player_under_18'
      when player.contact_type not in ('self', 'both') then 'player_not_self_managed'
      else ''
    end::text
  from public.adult_player_account_links adult_link
  left join public.players player
    on player.id = adult_link.player_id
  left join public.clubs club
    on club.id = adult_link.club_id
  left join public.teams team
    on team.id = adult_link.team_id
  where adult_link.user_id = (select auth.uid())
  order by
    case when adult_link.status = 'active' then 0 else 1 end,
    adult_link.created_at desc
  limit 1;
end;
$$;

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
    limit 1
  ),
  calendar_items as (
    select
      concat('calendar:', invite.id)::text as invitation_id,
      'calendar_information'::text as invitation_type,
      invite.id as source_record_id,
      event.id as event_id,
      coalesce(nullif(event.event_type, ''), 'general')::text as event_type,
      coalesce(nullif(event.title, ''), 'Club event')::text as event_title,
      event.starts_at as event_start,
      event.ends_at as event_end,
      coalesce(event.location, '')::text as event_location,
      context.team_name,
      'not_required'::text as response_state,
      'not_applicable'::text as selection_state,
      false as can_respond,
      case
        when invite.invite_status = 'cancelled' or event.cancelled_at is not null then 'This event has been cancelled.'
        when event.starts_at <= now() then 'This event has closed.'
        else 'This event is for information. No response is required.'
      end::text as lock_reason,
      null::timestamptz as response_deadline,
      invite.responded_at as last_responded_at
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
      and event.event_type <> 'training'
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
        request.status <> 'cancelled'
        and request_player.status not in ('cancelled', 'expired')
        and event.cancelled_at is null
        and request.occurrence_starts_at > now()
      ) as can_respond,
      case
        when request.status = 'cancelled' or request_player.status = 'cancelled' or event.cancelled_at is not null then 'This training session has been cancelled.'
        when request_player.status = 'expired' or request.occurrence_starts_at <= now() then 'The response window has closed.'
        else ''
      end::text as lock_reason,
      request.occurrence_starts_at as response_deadline,
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
        and request.expires_at > now()
        and match_day.status not in ('cancelled', 'postponed', 'full_time')
        and match_day.concluded_at is null
        and match_day.deleted_at is null
      ) as can_respond,
      case
        when match_day.status in ('cancelled', 'postponed') then 'This fixture is not active.'
        when match_day.status = 'full_time' or match_day.concluded_at is not null then 'This fixture has concluded.'
        when match_day.deleted_at is not null then 'This fixture is no longer available.'
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

create or replace function public.record_adult_player_response_audit_internal(
  club_id_value uuid,
  actor_id_value uuid,
  link_id_value uuid,
  player_id_value uuid,
  team_id_value uuid,
  event_id_value uuid,
  invitation_id_value uuid,
  action_value text,
  outcome_value text,
  previous_response_value text,
  new_response_value text,
  denial_category_value text default ''
)
returns void
language sql
security definer
set search_path = ''
as $$
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
    club_id_value,
    actor_id_value,
    action_value,
    'adult_player_invitation',
    invitation_id_value,
    jsonb_build_object(
      'adultPlayerLinkId', link_id_value,
      'playerId', player_id_value,
      'teamId', team_id_value,
      'eventId', event_id_value,
      'invitationId', invitation_id_value,
      'previousResponse', nullif(previous_response_value, ''),
      'newResponse', nullif(new_response_value, ''),
      'responseSource', 'adult_player',
      'outcome', outcome_value,
      'denialCategory', nullif(denial_category_value, ''),
      'recordedAt', timezone('utc', now())
    ),
    timezone('utc', now())
  );
$$;

create or replace function public.respond_own_adult_player_match_invitation(
  request_id_value uuid,
  response_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row record;
  request_row public.match_day_availability_requests%rowtype;
  match_row public.match_days%rowtype;
  response_row record;
  normalized_response text := lower(trim(coalesce(response_value, '')));
  previous_response text := '';
begin
  select state.*
  into context_row
  from public.get_own_adult_player_account_state() state
  where state.access_granted is true
  limit 1;

  if context_row.link_id is null then
    return jsonb_build_object(
      'success', false,
      'denialCategory', 'adult_player_context_denied',
      'message', 'Adult-player access is not available.'
    );
  end if;

  if normalized_response not in ('available', 'unavailable', 'maybe') then
    perform public.record_adult_player_response_audit_internal(
      context_row.club_id, auth.uid(), context_row.link_id, context_row.player_id,
      context_row.team_id, null, request_id_value, 'adult_player_match_response_denied',
      'denied', '', normalized_response, 'invalid_response'
    );
    return jsonb_build_object(
      'success', false,
      'denialCategory', 'invalid_response',
      'message', 'Choose Available, Maybe, or Unavailable.'
    );
  end if;

  select request.*
  into request_row
  from public.match_day_availability_requests request
  where request.id = request_id_value
    and request.club_id = context_row.club_id
    and request.team_id = context_row.team_id
    and request.player_id = context_row.player_id
    and request.parent_link_id is null
    and request.recipient_type = 'player'
  for update;

  if request_row.id is null then
    perform public.record_adult_player_response_audit_internal(
      context_row.club_id, auth.uid(), context_row.link_id, context_row.player_id,
      context_row.team_id, null, request_id_value, 'adult_player_match_response_denied',
      'denied', '', normalized_response, 'invitation_not_owned'
    );
    return jsonb_build_object(
      'success', false,
      'denialCategory', 'invitation_not_owned',
      'message', 'This match invitation is not available to this player.'
    );
  end if;

  select match_day.*
  into match_row
  from public.match_days match_day
  where match_day.id = request_row.match_day_id
    and match_day.club_id = context_row.club_id
    and match_day.team_id = context_row.team_id
  limit 1;

  if match_row.id is null
    or match_row.deleted_at is not null
    or match_row.status in ('cancelled', 'postponed', 'full_time')
    or match_row.concluded_at is not null
    or request_row.status = 'expired'
    or request_row.expires_at <= now() then
    perform public.record_adult_player_response_audit_internal(
      context_row.club_id, auth.uid(), context_row.link_id, context_row.player_id,
      context_row.team_id, request_row.match_day_id, request_row.id,
      'adult_player_match_response_denied', 'denied', request_row.status,
      normalized_response, 'response_window_closed'
    );
    return jsonb_build_object(
      'success', false,
      'denialCategory', 'response_window_closed',
      'message', 'This match response window has closed.'
    );
  end if;

  previous_response := request_row.status;

  select response.*
  into response_row
  from public.submit_match_day_availability_response(
    request_row.token_hash,
    normalized_response,
    null,
    null,
    null,
    null,
    null,
    null
  ) response
  limit 1;

  if response_row.request_id is null then
    perform public.record_adult_player_response_audit_internal(
      context_row.club_id, auth.uid(), context_row.link_id, context_row.player_id,
      context_row.team_id, request_row.match_day_id, request_row.id,
      'adult_player_match_response_denied', 'denied', previous_response,
      normalized_response, 'action_token_invalid'
    );
    return jsonb_build_object(
      'success', false,
      'denialCategory', 'action_token_invalid',
      'message', 'This match invitation is no longer valid.'
    );
  end if;

  perform public.record_adult_player_response_audit_internal(
    context_row.club_id, auth.uid(), context_row.link_id, context_row.player_id,
    context_row.team_id, request_row.match_day_id, request_row.id,
    'adult_player_match_response_saved', 'success', previous_response,
    normalized_response, ''
  );

  return jsonb_build_object(
    'success', true,
    'requestId', response_row.request_id,
    'responseState', response_row.response_status,
    'respondedAt', response_row.responded_at,
    'responseSource', 'adult_player'
  );
end;
$$;

create or replace function public.respond_own_adult_player_training_invitation(
  request_player_id_value uuid,
  response_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row record;
  request_player_row public.training_availability_request_players%rowtype;
  request_row public.training_availability_requests%rowtype;
  event_row public.calendar_events%rowtype;
  existing_response_row public.training_availability_responses%rowtype;
  response_row record;
  normalized_response text := lower(trim(coalesce(response_value, '')));
  previous_response text := '';
begin
  select state.*
  into context_row
  from public.get_own_adult_player_account_state() state
  where state.access_granted is true
  limit 1;

  if context_row.link_id is null then
    return jsonb_build_object(
      'success', false,
      'denialCategory', 'adult_player_context_denied',
      'message', 'Adult-player access is not available.'
    );
  end if;

  if normalized_response not in ('available', 'unavailable', 'maybe') then
    perform public.record_adult_player_response_audit_internal(
      context_row.club_id, auth.uid(), context_row.link_id, context_row.player_id,
      context_row.team_id, null, request_player_id_value,
      'adult_player_training_response_denied', 'denied', '',
      normalized_response, 'invalid_response'
    );
    return jsonb_build_object(
      'success', false,
      'denialCategory', 'invalid_response',
      'message', 'Choose Attending, Maybe, or Not attending.'
    );
  end if;

  select request_player.*
  into request_player_row
  from public.training_availability_request_players request_player
  where request_player.id = request_player_id_value
    and request_player.club_id = context_row.club_id
    and request_player.team_id = context_row.team_id
    and request_player.player_id = context_row.player_id
    and request_player.parent_link_id is null
    and request_player.recipient_type = 'player'
  for update;

  if request_player_row.id is null then
    perform public.record_adult_player_response_audit_internal(
      context_row.club_id, auth.uid(), context_row.link_id, context_row.player_id,
      context_row.team_id, null, request_player_id_value,
      'adult_player_training_response_denied', 'denied', '',
      normalized_response, 'invitation_not_owned'
    );
    return jsonb_build_object(
      'success', false,
      'denialCategory', 'invitation_not_owned',
      'message', 'This training invitation is not available to this player.'
    );
  end if;

  select request.*
  into request_row
  from public.training_availability_requests request
  where request.id = request_player_row.request_id
    and request.club_id = context_row.club_id
    and request.team_id = context_row.team_id
  limit 1;

  select event.*
  into event_row
  from public.calendar_events event
  where event.id = request_player_row.calendar_event_id
    and event.club_id = context_row.club_id
    and event.team_id = context_row.team_id
  limit 1;

  if request_row.id is null
    or event_row.id is null
    or request_row.status = 'cancelled'
    or request_player_row.status in ('cancelled', 'expired')
    or event_row.cancelled_at is not null
    or request_row.occurrence_starts_at <= now() then
    perform public.record_adult_player_response_audit_internal(
      context_row.club_id, auth.uid(), context_row.link_id, context_row.player_id,
      context_row.team_id, request_player_row.calendar_event_id, request_player_row.id,
      'adult_player_training_response_denied', 'denied', '',
      normalized_response, 'response_window_closed'
    );
    return jsonb_build_object(
      'success', false,
      'denialCategory', 'response_window_closed',
      'message', 'This training response window has closed.'
    );
  end if;

  select response.*
  into existing_response_row
  from public.training_availability_responses response
  where response.request_player_id = request_player_row.id
  limit 1;

  previous_response := coalesce(existing_response_row.status, 'awaiting_response');

  select response.*
  into response_row
  from public.submit_training_availability_response(
    request_player_row.token_hash,
    normalized_response,
    ''
  ) response
  limit 1;

  if response_row.request_player_id is null then
    perform public.record_adult_player_response_audit_internal(
      context_row.club_id, auth.uid(), context_row.link_id, context_row.player_id,
      context_row.team_id, request_player_row.calendar_event_id, request_player_row.id,
      'adult_player_training_response_denied', 'denied', previous_response,
      normalized_response, 'action_token_invalid'
    );
    return jsonb_build_object(
      'success', false,
      'denialCategory', 'action_token_invalid',
      'message', 'This training invitation is no longer valid.'
    );
  end if;

  perform public.record_adult_player_response_audit_internal(
    context_row.club_id, auth.uid(), context_row.link_id, context_row.player_id,
    context_row.team_id, request_player_row.calendar_event_id, request_player_row.id,
    'adult_player_training_response_saved', 'success', previous_response,
    normalized_response, ''
  );

  return jsonb_build_object(
    'success', true,
    'requestPlayerId', response_row.request_player_id,
    'responseState', response_row.response_status,
    'respondedAt', response_row.responded_at,
    'responseSource', 'adult_player'
  );
end;
$$;

revoke all on function public.enforce_adult_player_account_link() from public;
revoke all on function public.record_adult_player_response_audit_internal(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text) from public;

revoke all on function public.get_own_adult_player_account_state() from public;
grant execute on function public.get_own_adult_player_account_state() to authenticated, service_role;

revoke all on function public.get_own_adult_player_invitation_state() from public;
grant execute on function public.get_own_adult_player_invitation_state() to authenticated, service_role;

revoke all on function public.respond_own_adult_player_match_invitation(uuid, text) from public;
grant execute on function public.respond_own_adult_player_match_invitation(uuid, text) to authenticated, service_role;

revoke all on function public.respond_own_adult_player_training_invitation(uuid, text) from public;
grant execute on function public.respond_own_adult_player_training_invitation(uuid, text) to authenticated, service_role;
