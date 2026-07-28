\set ON_ERROR_STOP on

begin;

do $$
declare
  club_id_value constant uuid := '31e8bebc-07fb-4c8b-9ecc-2304d36415ed';
  team_id_value constant uuid := '492cee77-d3c4-4e07-b31b-6abc07328d25';
  admin_id_value constant uuid := '6c34f54e-5232-4d33-8575-bc027d19d4f1';
  trial_player_id_value constant uuid := '08a5186b-65a5-4aa2-80c1-0e20c55f6886';
  guardian_id_value uuid := gen_random_uuid();
  parent_link_id_value uuid := gen_random_uuid();
  event_id_value uuid := gen_random_uuid();
  pseudo_event_id_value uuid := gen_random_uuid();
  request_token_value uuid := gen_random_uuid();
  notification_result jsonb;
  duplicate_result jsonb;
  invitation_id_value uuid;
  queue_id_value uuid;
  raw_token_value text;
  token_hash_value text;
  response_record record;
  other_club_player_id uuid;
  event_type_value text;
begin
  perform set_config('request.jwt.claim.sub', admin_id_value::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  foreach event_type_value in array array[
    'general',
    'training',
    'match',
    'meeting',
    'tournament',
    'social',
    'other'
  ]
  loop
    insert into public.calendar_events (
      club_id,
      team_id,
      event_type,
      title,
      starts_at,
      ends_at,
      parent_visible,
      parent_audience,
      created_by,
      updated_by
    ) values (
      club_id_value,
      team_id_value,
      event_type_value,
      concat('FP TEST 39B ', event_type_value),
      timezone('utc', now()) + interval '7 days',
      timezone('utc', now()) + interval '7 days 1 hour',
      false,
      'none',
      admin_id_value,
      admin_id_value
    );
  end loop;

  begin
    insert into public.calendar_events (
      club_id,
      team_id,
      event_type,
      title,
      starts_at,
      ends_at,
      created_by,
      updated_by
    ) values (
      club_id_value,
      team_id_value,
      'availability_deadline',
      'FP TEST 39B unsupported pseudo event',
      timezone('utc', now()) + interval '7 days',
      timezone('utc', now()) + interval '7 days 1 hour',
      admin_id_value,
      admin_id_value
    );
    raise exception 'Pseudo-event creation unexpectedly succeeded.';
  exception
    when others then
      if sqlerrm = 'Pseudo-event creation unexpectedly succeeded.' then
        raise;
      end if;
  end;

  alter table public.calendar_events
    disable trigger calendar_events_validate_event_type_v1;

  insert into public.calendar_events (
    id,
    club_id,
    team_id,
    event_type,
    title,
    starts_at,
    ends_at,
    created_by,
    updated_by
  ) values (
    pseudo_event_id_value,
    club_id_value,
    team_id_value,
    'parent_cutoff',
    'FP TEST 39B historical pseudo event',
    timezone('utc', now()) + interval '7 days',
    timezone('utc', now()) + interval '7 days 1 hour',
    admin_id_value,
    admin_id_value
  );

  alter table public.calendar_events
    enable trigger calendar_events_validate_event_type_v1;

  update public.calendar_events
  set notes = 'Historical row remains readable and can receive unrelated safe edits.'
  where id = pseudo_event_id_value;

  if not exists (
    select 1
    from public.calendar_events
    where id = pseudo_event_id_value
      and event_type = 'parent_cutoff'
      and notes like 'Historical row remains readable%'
  ) then
    raise exception 'Historical pseudo-event compatibility failed.';
  end if;

  insert into public.guardians (
    id,
    club_id,
    transfer_reference,
    first_name,
    last_name,
    email,
    status,
    created_by,
    updated_by
  ) values (
    guardian_id_value,
    club_id_value,
    concat('FP-TEST-39B-', guardian_id_value),
    'FP TEST',
    'Trial Guardian',
    'delivered+fp-calendar-trial-39b@resend.dev',
    'active',
    admin_id_value,
    admin_id_value
  );

  insert into public.parent_player_links (
    id,
    club_id,
    team_id,
    player_id,
    link_type,
    email,
    auth_user_id,
    status,
    invited_by,
    guardian_id,
    relationship,
    primary_contact,
    receives_communications,
    emergency_contact
  ) values (
    parent_link_id_value,
    club_id_value,
    team_id_value,
    trial_player_id_value,
    'parent',
    'delivered+fp-calendar-trial-39b@resend.dev',
    null,
    'uninvited',
    admin_id_value,
    guardian_id_value,
    'Guardian',
    true,
    true,
    true
  );

  insert into public.calendar_events (
    id,
    club_id,
    team_id,
    event_type,
    title,
    starts_at,
    ends_at,
    location,
    notes,
    parent_visible,
    parent_audience,
    created_by,
    updated_by
  ) values (
    event_id_value,
    club_id_value,
    team_id_value,
    'training',
    'FP TEST 39B Trial Training',
    timezone('utc', now()) + interval '8 days',
    timezone('utc', now()) + interval '8 days 1 hour',
    'FP TEST Training Ground',
    'Synthetic Phase 39B production smoke.',
    true,
    'involved_players',
    admin_id_value,
    admin_id_value
  );

  perform public.sync_calendar_event_parent_scope_v2(
    event_id_value,
    true,
    null,
    array[trial_player_id_value],
    'manual'
  );

  notification_result := public.notify_calendar_event_parents(
    event_id_value,
    'creation',
    null,
    request_token_value,
    '{}'::uuid[]
  );

  if coalesce((notification_result ->> 'trialEligibleRecipientCount')::integer, 0) <> 1
    or coalesce((notification_result ->> 'trialQueuedCount')::integer, 0) <> 1
    or coalesce((notification_result ->> 'trialFailedCount')::integer, 0) <> 0 then
    raise exception 'Trial notification counts were not exact: %', notification_result;
  end if;

  select invitation.id, invitation.email_queue_id
  into invitation_id_value, queue_id_value
  from public.calendar_trial_event_invitations invitation
  where invitation.notification_command_id = (notification_result ->> 'notificationCommandId')::uuid
    and invitation.player_id = trial_player_id_value
    and invitation.parent_link_id = parent_link_id_value
    and invitation.guardian_id = guardian_id_value;

  if invitation_id_value is null or queue_id_value is null then
    raise exception 'Trial invitation or queue unit was not created.';
  end if;

  select queue.payload #>> '{trialEventInvitation,rawToken}'
  into raw_token_value
  from public.scheduled_email_queue queue
  where queue.id = queue_id_value;

  if raw_token_value !~ '^[0-9a-f]{64}$' then
    raise exception 'Trial response token is not a 256-bit hex value.';
  end if;

  token_hash_value := pg_catalog.encode(
    extensions.digest(raw_token_value, 'sha256'),
    'hex'
  );

  select * into response_record
  from public.get_calendar_trial_event_response(token_hash_value);

  if response_record.response_state <> 'available'
    or response_record.player_name <> 'FP TEST Scorer Child'
    or response_record.event_title <> 'FP TEST 39B Trial Training'
    or response_record.club_name <> 'FP TEST - Season Events Smoke'
    or response_record.team_name <> 'FP TEST - U99 Smoke Team' then
    raise exception 'Trial response scope was not exact.';
  end if;

  select * into response_record
  from public.submit_calendar_trial_event_response(token_hash_value, 'attending');

  if response_record.response_state <> 'responded'
    or response_record.current_response <> 'attending' then
    raise exception 'Trial response was not recorded.';
  end if;

  perform public.submit_calendar_trial_event_response(token_hash_value, 'attending');

  if (
    select invitation.response_count
    from public.calendar_trial_event_invitations invitation
    where invitation.id = invitation_id_value
  ) <> 2 then
    raise exception 'Safe replay did not remain idempotent and auditable.';
  end if;

  select * into response_record
  from public.get_calendar_trial_event_response(repeat('f', 64));

  if response_record.response_state <> 'invalid' then
    raise exception 'Wrong token did not fail closed.';
  end if;

  update public.calendar_trial_event_invitations
  set expires_at = timezone('utc', now()) - interval '1 minute'
  where id = invitation_id_value;

  select * into response_record
  from public.get_calendar_trial_event_response(token_hash_value);

  if response_record.response_state <> 'expired' then
    raise exception 'Expired token did not fail closed.';
  end if;

  update public.calendar_trial_event_invitations
  set expires_at = timezone('utc', now()) + interval '14 days'
  where id = invitation_id_value;

  update public.parent_player_links
  set receives_communications = false
  where id = parent_link_id_value;

  select * into response_record
  from public.get_calendar_trial_event_response(token_hash_value);

  if response_record.response_state <> 'revoked' then
    raise exception 'Invalidated contact did not revoke response access.';
  end if;

  update public.parent_player_links
  set receives_communications = true
  where id = parent_link_id_value;

  duplicate_result := public.notify_calendar_event_parents(
    event_id_value,
    'creation',
    null,
    request_token_value,
    '{}'::uuid[]
  );

  if (
    select count(*)
    from public.calendar_trial_event_invitations invitation
    where invitation.notification_command_id = (notification_result ->> 'notificationCommandId')::uuid
      and invitation.player_id = trial_player_id_value
      and invitation.guardian_id = guardian_id_value
  ) <> 1 then
    raise exception 'Repeated save created a duplicate trial invitation.';
  end if;

  if coalesce((duplicate_result ->> 'trialDuplicateCount')::integer, 0) < 1 then
    raise exception 'Repeated notification did not report trial idempotency.';
  end if;

  if exists (
    select 1
    from public.parent_player_links
    where id = parent_link_id_value
      and (
        status <> 'uninvited'
        or auth_user_id is not null
      )
  ) then
    raise exception 'Trial invitation created or changed Parent Portal identity.';
  end if;

  if exists (
    select 1
    from public.parent_player_links link
    where link.guardian_id = guardian_id_value
      and link.status in ('pending', 'active')
  ) then
    raise exception 'Trial invitation created a normal portal join link.';
  end if;

  select player.id into other_club_player_id
  from public.players player
  where player.club_id <> club_id_value
    and coalesce(player.status, 'active') <> 'archived'
  limit 1;

  if other_club_player_id is not null then
    begin
      perform public.sync_calendar_event_parent_scope_v2(
        event_id_value,
        false,
        null,
        array[other_club_player_id],
        'manual'
      );
      raise exception 'Cross-club player scope unexpectedly succeeded.';
    exception
      when others then
        if sqlerrm = 'Cross-club player scope unexpectedly succeeded.' then
          raise;
        end if;
    end;
  end if;

  if has_function_privilege('anon', 'public.get_calendar_trial_event_response(text)', 'execute')
    or has_function_privilege('authenticated', 'public.get_calendar_trial_event_response(text)', 'execute')
    or has_function_privilege('anon', 'public.submit_calendar_trial_event_response(text,text)', 'execute')
    or has_function_privilege('authenticated', 'public.submit_calendar_trial_event_response(text,text)', 'execute') then
    raise exception 'Trial response RPCs are exposed outside the server boundary.';
  end if;

  raise notice 'FP-V1-CALENDAR-INVITES-TRIALS-39B production transaction passed';
end;
$$;

rollback;
