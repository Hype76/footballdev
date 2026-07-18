create function public.is_match_day_action_token_current_internal(token_hash_value text)
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
    where request.token_hash = lower(btrim(coalesce(token_hash_value, '')))
      and lower(btrim(coalesce(token_hash_value, ''))) ~ '^[a-f0-9]{64}$'
      and request.status <> 'expired'
      and request.expires_at >= timezone('utc', now())
      and match_day.deleted_at is null
      and coalesce(match_day.status, 'scheduled') not in ('cancelled', 'full_time', 'postponed')
      and coalesce(player.status, 'active') <> 'archived'
      and (
        (request.parent_link_id is null and request.recipient_type = 'player')
        or (parent_link.id is not null and parent_link.status = 'active')
      )
  );
$$;

revoke all on function public.is_match_day_action_token_current_internal(text) from public, anon, authenticated;
grant execute on function public.is_match_day_action_token_current_internal(text) to service_role;

create function public.invalidate_removed_match_day_invite_tokens_internal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior_invite public.calendar_event_invites%rowtype;
begin
  prior_invite := old;

  if prior_invite.match_day_id is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE'
    or coalesce(new.invite_status, 'cancelled') = 'cancelled'
    or new.match_day_id is distinct from prior_invite.match_day_id
    or new.player_id is distinct from prior_invite.player_id then
    update public.match_day_availability_requests request
    set token_hash = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
        expires_at = '1970-01-01 00:00:00+00'::timestamptz,
        updated_at = timezone('utc', now())
    where request.match_day_id = prior_invite.match_day_id
      and request.club_id = prior_invite.club_id
      and request.team_id = prior_invite.team_id
      and request.player_id = prior_invite.player_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.invalidate_removed_match_day_invite_tokens_internal() from public, anon, authenticated;
grant execute on function public.invalidate_removed_match_day_invite_tokens_internal() to service_role;

drop trigger if exists calendar_event_invites_invalidate_match_day_tokens on public.calendar_event_invites;
create trigger calendar_event_invites_invalidate_match_day_tokens
after update of invite_status, match_day_id, player_id or delete
on public.calendar_event_invites
for each row
execute function public.invalidate_removed_match_day_invite_tokens_internal();

alter function public.get_match_day_availability_response_v2(text)
  rename to get_match_day_availability_response_v2_calendar_edit_parity_legacy;

revoke all on function public.get_match_day_availability_response_v2_calendar_edit_parity_legacy(text) from public, anon, authenticated;
grant execute on function public.get_match_day_availability_response_v2_calendar_edit_parity_legacy(text) to service_role;

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
begin
  if not public.is_match_day_action_token_current_internal(token_hash_value) then
    return;
  end if;

  return query
  select *
  from public.get_match_day_availability_response_v2_calendar_edit_parity_legacy(token_hash_value);
end;
$$;

revoke all on function public.get_match_day_availability_response_v2(text) from public;
grant execute on function public.get_match_day_availability_response_v2(text) to anon, authenticated, service_role;

alter function public.submit_match_day_availability_response(text, text, text, text, text, boolean, boolean, integer)
  rename to submit_match_day_availability_response_calendar_edit_parity_legacy;

revoke all on function public.submit_match_day_availability_response_calendar_edit_parity_legacy(text, text, text, text, text, boolean, boolean, integer) from public, anon, authenticated;
grant execute on function public.submit_match_day_availability_response_calendar_edit_parity_legacy(text, text, text, text, text, boolean, boolean, integer) to service_role;

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
begin
  if not public.is_match_day_action_token_current_internal(token_hash_value) then
    return;
  end if;

  return query
  select *
  from public.submit_match_day_availability_response_calendar_edit_parity_legacy(
    token_hash_value,
    status_value,
    volunteer_scorer_response_value,
    volunteer_linesman_response_value,
    volunteer_referee_response_value,
    transport_needs_lift_value,
    transport_can_offer_lift_value,
    transport_seats_offered_value
  );
end;
$$;

revoke all on function public.submit_match_day_availability_response(text, text, text, text, text, boolean, boolean, integer) from public;
grant execute on function public.submit_match_day_availability_response(text, text, text, text, text, boolean, boolean, integer) to anon, authenticated, service_role;

comment on function public.is_match_day_action_token_current_internal(text) is
  'Fails Match Day action tokens closed when the fixture, player, recipient link, or request is no longer current.';

comment on function public.invalidate_removed_match_day_invite_tokens_internal() is
  'Invalidates response tokens without deleting response evidence when a player leaves saved Match Day invitation scope.';

comment on function public.get_match_day_availability_response_v2(text) is
  'Reads only a current recipient, player, team, club, fixture and expiry scoped Match Day action token.';

comment on function public.submit_match_day_availability_response(text, text, text, text, text, boolean, boolean, integer) is
  'Submits availability, volunteer and transport responses only through a current scoped Match Day action token.';
