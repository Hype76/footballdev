-- Bounded installed catalog snapshot, 02:10:2026. No application records.
CREATE OR REPLACE FUNCTION public.is_match_day_action_token_current_internal(token_hash_value text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
          and exists (
            select 1 from public.adult_player_account_links adult_link
            join public.users adult_user on adult_user.id = adult_link.user_id and adult_user.club_id = request.club_id and coalesce(adult_user.status, 'active') = 'active' and lower(btrim(coalesce(adult_user.email, ''))) = lower(btrim(request.recipient_email))
            where adult_link.player_id = request.player_id and adult_link.club_id = request.club_id and adult_link.team_id = request.team_id and adult_link.status = 'active' and adult_link.revoked_at is null
          )
          and ((lower(btrim(coalesce(player.contact_type, 'parent'))) = 'self' and ((current_contacts.usable_count = 0 and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request.recipient_email))) or (current_contacts.usable_count = 1 and current_contacts.any_match) or current_contacts.self_match)) or (lower(btrim(coalesce(player.contact_type, 'parent'))) = 'both' and current_contacts.self_match)))
        or (parent_link.id is not null and parent_link.status = 'active')
        or (request.parent_link_id is null and request.recipient_type = 'parent' and lower(btrim(coalesce(player.contact_type, 'parent'))) in ('parent', 'both') and ((current_contacts.usable_count = 0 and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request.recipient_email))) or current_contacts.parent_match))
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.is_training_availability_token_current_internal(token_hash_value text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        or (request_player.parent_link_id is null and request_player.recipient_type = 'player' and player.contact_type in ('self', 'both') and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request_player.recipient_email)) and exists (select 1 from public.adult_player_account_links adult_link join public.users adult_user on adult_user.id = adult_link.user_id and adult_user.club_id = request_player.club_id and coalesce(adult_user.status, 'active') = 'active' and lower(btrim(coalesce(adult_user.email, ''))) = lower(btrim(request_player.recipient_email)) where adult_link.player_id = request_player.player_id and adult_link.club_id = request_player.club_id and adult_link.team_id = request_player.team_id and adult_link.status = 'active' and adult_link.revoked_at is null))
        or (request_player.parent_link_id is null and request_player.recipient_type = 'parent' and coalesce(player.contact_type, 'parent') <> 'self' and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request_player.recipient_email)) and not exists (select 1 from public.parent_player_links active_parent_link where active_parent_link.club_id = request_player.club_id and active_parent_link.team_id = request_player.team_id and active_parent_link.player_id = request_player.player_id and active_parent_link.status = 'active'))
      )
  );
$function$
;