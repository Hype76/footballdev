-- FP-V1-REUSABLE-AVAILABILITY-LINKS-26A

alter table public.match_day_availability_requests
  add column if not exists token_version integer not null default 1,
  add column if not exists token_revoked_at timestamptz,
  add column if not exists token_revoked_reason text,
  add column if not exists token_revoked_by uuid,
  add column if not exists token_revoked_source text;

alter table public.match_day_availability_requests
  drop constraint if exists match_day_availability_token_version_check;

alter table public.match_day_availability_requests
  add constraint match_day_availability_token_version_check
  check (token_version > 0);

alter table public.match_day_availability_requests
  drop constraint if exists match_day_availability_token_revocation_check;

alter table public.match_day_availability_requests
  add constraint match_day_availability_token_revocation_check
  check (
    (token_revoked_at is null and token_revoked_reason is null)
    or (
      token_revoked_at is not null
      and btrim(coalesce(token_revoked_reason, '')) <> ''
      and char_length(token_revoked_reason) <= 500
    )
  );

alter table public.training_availability_request_players
  add column if not exists token_version integer not null default 1,
  add column if not exists token_revoked_at timestamptz,
  add column if not exists token_revoked_reason text,
  add column if not exists token_revoked_by uuid,
  add column if not exists token_revoked_source text;

alter table public.training_availability_request_players
  drop constraint if exists training_availability_token_version_check;

alter table public.training_availability_request_players
  add constraint training_availability_token_version_check
  check (token_version > 0);

alter table public.training_availability_request_players
  drop constraint if exists training_availability_token_revocation_check;

alter table public.training_availability_request_players
  add constraint training_availability_token_revocation_check
  check (
    (token_revoked_at is null and token_revoked_reason is null)
    or (
      token_revoked_at is not null
      and btrim(coalesce(token_revoked_reason, '')) <> ''
      and char_length(token_revoked_reason) <= 500
    )
  );

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
    join public.match_days match_day
      on match_day.id = request.match_day_id
      and match_day.club_id = request.club_id
      and match_day.team_id = request.team_id
    join public.players player
      on player.id = request.player_id
      and player.club_id = request.club_id
      and player.team_id = request.team_id
    left join public.parent_player_links parent_link
      on parent_link.id = request.parent_link_id
      and parent_link.club_id = request.club_id
      and parent_link.team_id = request.team_id
      and parent_link.player_id = request.player_id
      and lower(btrim(parent_link.email)) = lower(btrim(request.recipient_email))
    left join lateral (
      select
        count(*) filter (
          where btrim(coalesce(contact ->> 'email', contact ->> 'parentEmail', '')) <> ''
        )::integer as usable_count,
        coalesce(bool_or(
          lower(btrim(coalesce(contact ->> 'email', contact ->> 'parentEmail', '')))
            = lower(btrim(request.recipient_email))
        ), false) as any_match,
        coalesce(bool_or(
          lower(btrim(coalesce(contact ->> 'email', contact ->> 'parentEmail', '')))
            = lower(btrim(request.recipient_email))
          and lower(btrim(coalesce(contact ->> 'type', contact ->> 'contactType', 'parent'))) = 'self'
        ), false) as self_match,
        coalesce(bool_or(
          lower(btrim(coalesce(contact ->> 'email', contact ->> 'parentEmail', '')))
            = lower(btrim(request.recipient_email))
          and lower(btrim(coalesce(contact ->> 'type', contact ->> 'contactType', 'parent'))) <> 'self'
        ), false) as parent_match
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
        (
          request.parent_link_id is null
          and request.recipient_type = 'player'
          and exists (
            select 1
            from public.adult_player_account_links adult_link
            join public.users adult_user
              on adult_user.id = adult_link.user_id
              and adult_user.club_id = request.club_id
              and coalesce(adult_user.status, 'active') = 'active'
              and lower(btrim(coalesce(adult_user.email, ''))) = lower(btrim(request.recipient_email))
            where adult_link.player_id = request.player_id
              and adult_link.club_id = request.club_id
              and adult_link.team_id = request.team_id
              and adult_link.status = 'active'
              and adult_link.revoked_at is null
          )
          and (
            (
              lower(btrim(coalesce(player.contact_type, 'parent'))) = 'self'
              and (
                (current_contacts.usable_count = 0 and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request.recipient_email)))
                or (current_contacts.usable_count = 1 and current_contacts.any_match)
                or current_contacts.self_match
              )
            )
            or (
              lower(btrim(coalesce(player.contact_type, 'parent'))) = 'both'
              and current_contacts.self_match
            )
          )
        )
        or (parent_link.id is not null and parent_link.status = 'active')
        or (
          request.parent_link_id is null
          and request.recipient_type = 'parent'
          and lower(btrim(coalesce(player.contact_type, 'parent'))) in ('parent', 'both')
          and (
            (current_contacts.usable_count = 0 and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request.recipient_email)))
            or current_contacts.parent_match
          )
        )
      )
  );
$$;

revoke all on function public.is_match_day_action_token_current_internal(text)
from public, anon, authenticated;

grant execute on function public.is_match_day_action_token_current_internal(text)
to service_role;

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
      and request_player.token_revoked_at is null
      and lower(coalesce(request_player.status, '')) not in ('cancelled', 'expired')
      and lower(coalesce(request.status, '')) not in ('cancelled', 'expired')
      and coalesce(request_player.response_deadline_at, request.occurrence_starts_at) >= timezone('utc', now())
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
              and lower(btrim(coalesce(parent_link.email, ''))) = lower(btrim(request_player.recipient_email))
          )
        )
        or (
          request_player.parent_link_id is null
          and request_player.recipient_type = 'player'
          and player.contact_type in ('self', 'both')
          and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request_player.recipient_email))
          and exists (
            select 1
            from public.adult_player_account_links adult_link
            join public.users adult_user
              on adult_user.id = adult_link.user_id
              and adult_user.club_id = request_player.club_id
              and coalesce(adult_user.status, 'active') = 'active'
              and lower(btrim(coalesce(adult_user.email, ''))) = lower(btrim(request_player.recipient_email))
            where adult_link.player_id = request_player.player_id
              and adult_link.club_id = request_player.club_id
              and adult_link.team_id = request_player.team_id
              and adult_link.status = 'active'
              and adult_link.revoked_at is null
          )
        )
        or (
          request_player.parent_link_id is null
          and request_player.recipient_type = 'parent'
          and coalesce(player.contact_type, 'parent') <> 'self'
          and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request_player.recipient_email))
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
  );
$$;

revoke all on function public.is_training_availability_token_current_internal(text)
from public, anon, authenticated;

grant execute on function public.is_training_availability_token_current_internal(text)
to service_role;

drop function if exists public.get_match_day_availability_response_v2(text);

create function public.get_match_day_availability_response_v2(token_hash_value text)
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
  kickoff_time_tbc boolean,
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
set search_path = ''
as $$
declare
  normalized_token_hash text := lower(btrim(coalesce(token_hash_value, '')));
  request_row public.match_day_availability_requests%rowtype;
begin
  if not public.is_match_day_action_token_current_internal(normalized_token_hash) then
    return;
  end if;

  select request.*
  into request_row
  from public.match_day_availability_requests request
  where request.token_hash = normalized_token_hash
  limit 1;

  return query
  select
    request_row.id,
    request_row.player_id,
    request_row.player_name,
    ''::text,
    ''::text,
    request_row.status,
    request_row.responded_at,
    request_row.expires_at,
    fixture.id,
    coalesce(current_response.status, nullif(request_row.status, 'pending'), 'pending'),
    case
      when current_response.id is null then ''
      when current_response.selected_by_request_id = request_row.id then 'this response link'
      when current_response.selected_by_request_id is null then 'authorised team staff'
      when selected_request.recipient_type = 'player' then 'the adult Player'
      else 'another authorised Parent'
    end,
    ''::text,
    current_response.selected_at,
    coalesce(team.name, ''),
    fixture.opponent,
    fixture.match_date,
    fixture.kickoff_time,
    coalesce(fixture.kickoff_time_tbc, false),
    fixture.arrival_time,
    fixture.venue_name,
    fixture.venue_address,
    coalesce(fixture.request_scorer, false),
    coalesce(fixture.request_linesman, false),
    coalesce(fixture.request_referee, false),
    coalesce(request_row.volunteer_scorer_response, 'no_response'),
    coalesce(request_row.volunteer_linesman_response, 'no_response'),
    coalesce(request_row.volunteer_referee_response, 'no_response'),
    request_row.volunteer_responded_at,
    coalesce(request_row.transport_needs_lift, false),
    coalesce(request_row.transport_can_offer_lift, false),
    coalesce(request_row.transport_seats_offered, 0),
    request_row.transport_responded_at
  from public.match_days fixture
  left join public.teams team
    on team.id = fixture.team_id
    and team.club_id = fixture.club_id
  left join public.match_day_player_availability current_response
    on current_response.match_day_id = request_row.match_day_id
    and current_response.player_id = request_row.player_id
    and current_response.club_id = request_row.club_id
    and current_response.team_id = request_row.team_id
  left join public.match_day_availability_requests selected_request
    on selected_request.id = current_response.selected_by_request_id
    and selected_request.club_id = request_row.club_id
    and selected_request.team_id = request_row.team_id
    and selected_request.player_id = request_row.player_id
  where fixture.id = request_row.match_day_id
    and fixture.club_id = request_row.club_id
    and fixture.team_id = request_row.team_id;
end;
$$;

revoke all on function public.get_match_day_availability_response_v2(text) from public;
grant execute on function public.get_match_day_availability_response_v2(text) to anon, authenticated, service_role;

do $$
begin
  if to_regprocedure('public.get_match_day_availability_response_v2_datetime82_legacy(text)') is not null then
    execute 'revoke all on function public.get_match_day_availability_response_v2_datetime82_legacy(text) from public, anon, authenticated, service_role';
  end if;
end;
$$;

alter function public.submit_match_day_availability_response(
  text, text, text, text, text, boolean, boolean, integer
)
rename to submit_match_day_availability_response_26a_legacy;

revoke all on function public.submit_match_day_availability_response_26a_legacy(
  text, text, text, text, text, boolean, boolean, integer
)
from public, anon, authenticated;

grant execute on function public.submit_match_day_availability_response_26a_legacy(
  text, text, text, text, text, boolean, boolean, integer
)
to service_role;

create function public.submit_match_day_availability_response(
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

revoke all on function public.submit_match_day_availability_response(
  text, text, text, text, text, boolean, boolean, integer
)
from public;

grant execute on function public.submit_match_day_availability_response(
  text, text, text, text, text, boolean, boolean, integer
)
to anon, authenticated, service_role;

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

  select recipient.*
  into request_player_row
  from public.training_availability_request_players recipient
  where recipient.token_hash = normalized_token_hash
  limit 1;

  return query
  select
    request_player_row.id,
    request_player_row.request_id,
    request_player_row.calendar_event_id,
    request_player_row.player_id,
    request_player_row.player_name,
    case
      when response.id is null then ''
      when response.request_player_id = request_player_row.id then 'this response link'
      when response.response_source = 'staff_on_behalf' then 'authorised team staff'
      when response.response_source = 'adult_player' then 'the adult Player'
      else 'another authorised Parent'
    end,
    ''::text,
    response.status,
    coalesce(response.note, ''),
    response.responded_at,
    coalesce(team.name, ''),
    event.title,
    request.occurrence_date,
    request.occurrence_starts_at,
    request.occurrence_ends_at,
    event.location,
    event.notes
  from public.training_availability_requests request
  join public.calendar_events event
    on event.id = request.calendar_event_id
    and event.club_id = request.club_id
    and event.team_id = request.team_id
  left join public.teams team
    on team.id = request.team_id
    and team.club_id = request.club_id
  left join public.training_availability_responses response
    on response.request_id = request_player_row.request_id
    and response.player_id = request_player_row.player_id
    and response.club_id = request_player_row.club_id
    and response.team_id = request_player_row.team_id
    and response.calendar_event_id = request_player_row.calendar_event_id
  where request.id = request_player_row.request_id
    and request.club_id = request_player_row.club_id
    and request.team_id = request_player_row.team_id
    and request.calendar_event_id = request_player_row.calendar_event_id;
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

revoke all on function public.get_training_availability_response(text) from public;
revoke all on function public.submit_training_availability_response(text, text, text) from public;
grant execute on function public.get_training_availability_response(text) to anon, authenticated;
grant execute on function public.submit_training_availability_response(text, text, text) to anon, authenticated;

comment on column public.match_day_availability_requests.token_version is
  'Monotonic scoped bearer-token version. Normal response submission does not change it.';

comment on column public.match_day_availability_requests.token_revoked_at is
  'Explicit token revocation time. Response submission and resend do not set it.';

comment on column public.training_availability_request_players.token_version is
  'Monotonic scoped bearer-token version. Normal response submission does not change it.';

comment on column public.training_availability_request_players.token_revoked_at is
  'Explicit token revocation time. Response submission and resend do not set it.';

comment on function public.get_match_day_availability_response_v2(text) is
  'Returns only a current scoped Match response and uses privacy-safe responder attribution.';

comment on function public.submit_match_day_availability_response(
  text, text, text, text, text, boolean, boolean, integer
) is
  'Serializes Match response changes, keeps the scoped token reusable, and avoids duplicate history for identical repeats.';

comment on function public.get_training_availability_response(text) is
  'Returns the shared current Training response only while participant, responder, deadline, and token authority remain valid.';

comment on function public.submit_training_availability_response(text, text, text) is
  'Serializes Training response changes, keeps the scoped token reusable, and avoids duplicate history for identical repeats.';
