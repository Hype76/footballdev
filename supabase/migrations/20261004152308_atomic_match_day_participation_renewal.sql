-- Local review candidate. Never run as part of an unrelated release.
create or replace function public.renew_match_day_participation_invitations(
  idempotency_key_value uuid, match_day_id_value uuid,
  player_id_value uuid, recipient_units_value jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users%rowtype;
  fixture public.match_days%rowtype;
  command public.event_player_invitation_actions%rowtype;
  request public.match_day_availability_requests%rowtype;
  unit jsonb;
  eligible jsonb;
  payload jsonb;
  token_hash_value text;
  result_value jsonb;
  request_ids jsonb := '[]';
  expected_count integer;
  club_timezone text;
  queued_count integer := 0;
begin
  if auth.uid() is null or idempotency_key_value is null or match_day_id_value is null or player_id_value is null then
    raise exception 'Authenticated exact invitation scope is required.' using errcode = '42501';
  end if;
  -- Serialise both retries and distinct commands for the exact fixture/Player.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('availability-command:' || idempotency_key_value::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('availability-player:' || match_day_id_value::text || ':' || player_id_value::text, 0));
  select * into actor from public.users where id = auth.uid() for share;
  select * into fixture from public.match_days where id = match_day_id_value for update;
  if actor.id is null or actor.status is distinct from 'active' or actor.role is null or actor.role in ('parent_portal', 'super_admin')
    or coalesce(actor.role_rank, 0) < 20 or fixture.id is null or actor.club_id is distinct from fixture.club_id
    or fixture.deleted_at is not null or public.can_manage_match_day(fixture.team_id) is not true then
    raise exception 'Active team Coach authority is required.' using errcode = '42501';
  end if;
  perform 1 from auth.users where id = actor.id and deleted_at is null and email_confirmed_at is not null
    and (banned_until is null or banned_until <= pg_catalog.now()) for share;
  if not found then raise exception 'Active authenticated Coach account is required.' using errcode = '42501'; end if;
  select coalesce(nullif(pg_catalog.btrim(timezone_name), ''), 'Europe/London') into club_timezone
  from public.clubs where id = fixture.club_id and status = 'active' for share;
  if not found then raise exception 'Active Club authority is required.' using errcode = '42501'; end if;
  perform 1 from public.user_club_memberships where auth_user_id = actor.id and club_id = fixture.club_id
    and role = actor.role and role_rank = actor.role_rank for share;
  if not found then raise exception 'Current Club membership is required.' using errcode = '42501'; end if;
  -- Replays return only a result belonging to the same currently authorised actor/scope.
  select * into command from public.event_player_invitation_actions where idempotency_key = idempotency_key_value for update;
  if command.id is not null then
    if command.actor_id is distinct from actor.id or command.club_id is distinct from fixture.club_id
      or command.team_id is distinct from fixture.team_id or command.event_id is distinct from fixture.id
      or command.player_id is distinct from player_id_value or command.source_type <> 'match-day'
      or command.action <> 'resend' or command.result ->> 'renewalRequired' is distinct from 'true' then
      raise exception 'Invitation command key belongs to another action.' using errcode = '42501';
    end if;
    if command.status = 'completed' then return command.result || '{"duplicate":true}'::jsonb; end if;
    raise exception 'Invitation command is not complete.';
  end if;
  if public.current_user_billing_staff_mutation_allowed(fixture.club_id) is not true
    or public.can_use_plan_feature(fixture.club_id, 'parentInvitations') is not true
    or public.can_use_plan_feature(fixture.club_id, 'parentEmails') is not true then
    raise exception 'The current plan does not permit Parent invitation email.' using errcode = '42501';
  end if;
  if fixture.status in ('cancelled', 'postponed', 'full_time') or fixture.concluded_at is not null
    or fixture.match_date is null or fixture.match_date < (pg_catalog.statement_timestamp() at time zone club_timezone)::date then
    raise exception 'Fixture is closed for participation renewal.';
  end if;
  perform 1 from public.players where id = player_id_value and club_id = fixture.club_id
    and status = 'active' and archived_at is null for share;
  if not found then raise exception 'Current Player scope is required.'; end if;
  perform 1 from public.player_team_memberships where player_id = player_id_value and club_id = fixture.club_id
    and team_id = fixture.team_id and status = 'active' and ended_at is null for share;
  if not found then raise exception 'Active team membership is required.'; end if;
  perform 1 from public.calendar_event_invites where match_day_id = fixture.id and player_id = player_id_value
    and club_id = fixture.club_id and team_id = fixture.team_id and invite_status <> 'cancelled' and cancelled_at is null for share;
  if not found then raise exception 'Restore fixture participation before renewing.'; end if;
  -- Lock every existing relationship before re-resolving contact authority.
  perform 1 from public.parent_player_links where player_id = player_id_value and club_id = fixture.club_id and team_id = fixture.team_id order by id for share;
  perform 1 from public.adult_player_account_links where player_id = player_id_value and club_id = fixture.club_id and team_id = fixture.team_id order by id for share;
  perform 1 from auth.users where id in (
    select auth_user_id from public.parent_player_links where player_id = player_id_value and club_id = fixture.club_id and team_id = fixture.team_id
    union select user_id from public.adult_player_account_links where player_id = player_id_value and club_id = fixture.club_id and team_id = fixture.team_id
  ) order by id for share;
  perform 1 from public.match_day_availability_requests where match_day_id = fixture.id and player_id = player_id_value
    and club_id = fixture.club_id and team_id = fixture.team_id order by id for update;
  select coalesce(jsonb_agg(jsonb_build_object('email', lower(btrim(recipient_email)),
    'type', case when recipient_type in ('player', 'adult_player') then 'player' else 'parent' end,
    'parentLinkId', parent_link_id)), '[]'::jsonb) into eligible
  from public.event_player_eligible_recipients(fixture.club_id, fixture.team_id, array[player_id_value]);
  if jsonb_typeof(recipient_units_value) is distinct from 'array'
    or jsonb_array_length(recipient_units_value) not between 1 and 20 then
    raise exception 'Review current renewal recipients before confirming.';
  end if;
  if (select count(distinct value ->> 'requestId') from jsonb_array_elements(recipient_units_value)) <> jsonb_array_length(recipient_units_value) then
    raise exception 'Duplicate recipient request.';
  end if;
  if (select count(distinct value ->> 'tokenHash') from jsonb_array_elements(recipient_units_value)) <> jsonb_array_length(recipient_units_value) then
    raise exception 'Each recipient requires a distinct replacement token.';
  end if;
  -- Exact set equality stops stale previews silently expanding to another guardian.
  select count(*) into expected_count from public.match_day_availability_requests r
  where r.match_day_id = fixture.id and r.player_id = player_id_value and r.club_id = fixture.club_id and r.team_id = fixture.team_id
    and r.channel = 'email' and r.token_revoked_at is not null and r.token_revoked_reason = 'event_participation_removed'
    and exists (select 1 from jsonb_array_elements(eligible) c where c ->> 'email' = lower(btrim(r.recipient_email))
      and c ->> 'type' = r.recipient_type and (c ->> 'parentLinkId')::uuid is not distinct from r.parent_link_id);
  if expected_count <> jsonb_array_length(recipient_units_value) then raise exception 'Renewal recipients changed. Preview again.'; end if;
  insert into public.event_player_invitation_actions(idempotency_key, club_id, team_id, source_type, event_id, player_id, action, actor_id)
    values (idempotency_key_value, fixture.club_id, fixture.team_id, 'match-day', fixture.id, player_id_value, 'resend', actor.id)
    returning * into command;
  for unit in select value from jsonb_array_elements(recipient_units_value) order by value ->> 'requestId' loop
    select * into request from public.match_day_availability_requests where id = (unit ->> 'requestId')::uuid;
    if request.id is null or request.match_day_id is distinct from fixture.id or request.club_id is distinct from fixture.club_id
      or request.team_id is distinct from fixture.team_id or request.player_id is distinct from player_id_value or request.channel <> 'email'
      or request.token_revoked_at is null or request.token_revoked_reason <> 'event_participation_removed'
      or request.token_version is distinct from (unit ->> 'expectedTokenVersion')::integer
      or request.parent_link_id is distinct from (unit ->> 'parentLinkId')::uuid
      or not exists (select 1 from jsonb_array_elements(eligible) c where c ->> 'email' = lower(btrim(request.recipient_email))
        and c ->> 'type' = request.recipient_type and (c ->> 'parentLinkId')::uuid is not distinct from request.parent_link_id) then
      raise exception 'Request authority changed. Preview again.';
    end if;
    -- Configured email fallback must never revive a genuinely revoked app relationship.
    if request.recipient_type = 'parent' and request.parent_link_id is null and exists (
      select 1 from public.parent_player_links l left join auth.users u on u.id = l.auth_user_id
      where l.player_id = player_id_value and l.club_id = fixture.club_id and l.team_id = fixture.team_id
      and lower(btrim(l.email)) = lower(btrim(request.recipient_email))
      and (l.status is distinct from 'active' or u.id is null or u.deleted_at is not null or u.email_confirmed_at is null or u.banned_until > pg_catalog.now())
    ) then raise exception 'Withdrawn Parent authority cannot be renewed.'; end if;
    if coalesce(unit ->> 'rawToken', '') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid replacement token.'; end if;
    token_hash_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(unit ->> 'rawToken', 'UTF8')), 'hex');
    if token_hash_value = request.token_hash or token_hash_value is distinct from unit ->> 'tokenHash' then raise exception 'Fresh replacement token is required.'; end if;
    if exists (select 1 from public.match_day_availability_requests where token_hash = token_hash_value) then
      raise exception 'Replacement token is already in use.';
    end if;
    payload := unit -> 'payload';
    if jsonb_typeof(payload) is distinct from 'object' or coalesce(payload #>> '{resendPayload,subject}', '') = ''
      or payload #> '{resendPayload,to}' is distinct from jsonb_build_array(request.recipient_email)
      or payload #>> '{matchDayAvailability,rawToken}' is distinct from unit ->> 'rawToken'
      or payload #>> '{matchDayAvailability,tokenHash}' is distinct from token_hash_value
      or payload #>> '{matchDayAvailability,requestId}' is distinct from request.id::text
      or payload #>> '{matchDayAvailability,matchDayId}' is distinct from fixture.id::text
      or payload #>> '{matchDayAvailability,playerId}' is distinct from player_id_value::text then raise exception 'Invalid scoped queue payload.'; end if;
    if coalesce(payload #>> '{matchDayAvailability,parentLinkId}', '') <> coalesce(request.parent_link_id::text, '')
      or payload #>> '{matchDayAvailability,purpose}' is distinct from 'availability_request_notification' then raise exception 'Invalid Parent queue scope.'; end if;
    -- Authenticated callers can reach this function directly. Never persist their
    -- delivery controls or foreign queue discriminators, even if the server UI
    -- does not send them. Only rendered content crosses this input boundary.
    -- The worker supplies its trusted configured sender when 'from' is absent.
    payload := jsonb_build_object(
      'resendPayload', jsonb_build_object('emailAppRole', 'parent', 'to', jsonb_build_array(request.recipient_email),
        'subject', payload #>> '{resendPayload,subject}',
        'html', coalesce(payload #>> '{resendPayload,html}', ''),
        'text', coalesce(payload #>> '{resendPayload,text}', '')),
      'displayName', 'Football Player',
      'playerName', coalesce(to_jsonb(request) ->> 'player_name', ''),
      'parentName', coalesce(to_jsonb(request) ->> 'recipient_name', ''),
      'matchDayAvailability', jsonb_build_object('matchDayId', fixture.id, 'requestId', request.id,
        'playerId', player_id_value, 'parentLinkId', coalesce(request.parent_link_id::text, ''),
        'purpose', 'availability_request_notification', 'rawToken', unit ->> 'rawToken', 'tokenHash', token_hash_value),
      'clubId', fixture.club_id, 'teamId', fixture.team_id, 'actorId', actor.id,
      'actorEmail', actor.email, 'actorRole', actor.role, 'requiredFeature', 'parentEmails', 'visibleInEmailQueue', false,
      'eventPlayerInvitationAction', jsonb_build_object('action', 'resend', 'idempotencyKey', idempotency_key_value, 'playerId', player_id_value, 'sourceType', 'match-day'));
    payload := payload || jsonb_build_object('communicationLog', jsonb_build_object('clubId', fixture.club_id,
      'playerId', player_id_value, 'userId', actor.id, 'userEmail', actor.email, 'recipientEmail', request.recipient_email,
      'metadata', jsonb_build_object('type', 'match_day_availability', 'matchDayId', fixture.id,
        'matchDayAvailabilityRequestId', request.id, 'invitationAction', 'resend')));
    -- Saved availability, volunteer responses and history stay intact.
    update public.match_day_availability_requests set token_hash = token_hash_value, token_version = token_version + 1,
      status = case when status = 'expired' then 'pending' else status end,
      token_revoked_at = null, token_revoked_reason = null, token_revoked_by = null, token_revoked_source = null,
      expires_at = greatest(pg_catalog.now() + interval '1 day', (fixture.match_date::timestamp at time zone 'UTC') + interval '3 days' - interval '1 millisecond'),
      updated_at = pg_catalog.now() where id = request.id;
    insert into public.scheduled_email_queue(club_id, team_id, created_by, created_by_email, to_email, subject, status, scheduled_at, payload)
      values (fixture.club_id, fixture.team_id, actor.id, actor.email, request.recipient_email, payload #>> '{resendPayload,subject}', 'scheduled', pg_catalog.now(), payload);
    insert into public.match_day_event_log(club_id, team_id, match_day_id, player_id, actor_user_id, actor_role, event_type, event_label, metadata)
      values (fixture.club_id, fixture.team_id, fixture.id, player_id_value, actor.id, actor.role, 'invite_queued', 'Participation invitation renewed',
        jsonb_build_object('requestId', request.id, 'idempotencyKey', idempotency_key_value, 'tokenVersion', request.token_version + 1));
    queued_count := queued_count + 1;
    request_ids := request_ids || jsonb_build_array(request.id);
  end loop;
  result_value := jsonb_build_object('success', true, 'duplicate', false, 'renewalRequired', true, 'playerId', player_id_value,
    'queuedCount', queued_count, 'recipientCount', queued_count, 'sentCount', 0, 'failedCount', 0, 'requestState', 'queued',
    'queuedAt', pg_catalog.now(), 'requestIds', request_ids, 'auditLogRecorded', true);
  update public.event_player_invitation_actions set status = 'completed', result = result_value, completed_at = pg_catalog.now(), failure_detail = '' where id = command.id;
  return result_value;
end;
$$;
revoke all on function public.renew_match_day_participation_invitations(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.renew_match_day_participation_invitations(uuid, uuid, uuid, jsonb) to authenticated;
