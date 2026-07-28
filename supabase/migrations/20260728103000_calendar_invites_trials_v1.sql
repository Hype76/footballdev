-- FP-V1-CALENDAR-INVITES-TRIALS-39B

alter table public.calendar_events
  drop constraint if exists calendar_events_event_type_check;

create or replace function public.validate_calendar_event_type_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  user_facing_types constant text[] := array[
    'general',
    'training',
    'match',
    'meeting',
    'tournament',
    'social',
    'other'
  ];
begin
  if tg_op = 'INSERT' and not (new.event_type = any(user_facing_types)) then
    raise exception 'Choose a supported user-facing event type.';
  end if;

  if tg_op = 'UPDATE'
    and new.event_type is distinct from old.event_type
    and not (new.event_type = any(user_facing_types)) then
    raise exception 'Choose a supported user-facing event type.';
  end if;

  return new;
end;
$$;

drop trigger if exists calendar_events_validate_event_type_v1
on public.calendar_events;

create trigger calendar_events_validate_event_type_v1
before insert or update of event_type on public.calendar_events
for each row
execute function public.validate_calendar_event_type_v1();

revoke all on function public.validate_calendar_event_type_v1()
from public, anon, authenticated;
grant execute on function public.validate_calendar_event_type_v1()
to service_role;

comment on function public.validate_calendar_event_type_v1() is
  'Allows supported user-facing event types on direct creation or type changes while preserving unchanged historical pseudo-event rows for readback and unrelated edits.';

create table public.calendar_trial_event_invitations (
  id uuid primary key default gen_random_uuid(),
  notification_command_id uuid not null references public.calendar_event_notification_commands (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  calendar_event_id uuid references public.calendar_events (id) on delete cascade,
  match_day_id uuid references public.match_days (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  parent_link_id uuid not null references public.parent_player_links (id) on delete cascade,
  guardian_id uuid not null references public.guardians (id) on delete cascade,
  recipient_name text not null default '',
  recipient_email text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  status text not null default 'pending',
  response text,
  responded_at timestamptz,
  response_count integer not null default 0,
  revoked_at timestamptz,
  revoked_reason text,
  email_queue_id uuid references public.scheduled_email_queue (id) on delete set null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint calendar_trial_event_invitations_source_check check (
    num_nonnulls(calendar_event_id, match_day_id) = 1
  ),
  constraint calendar_trial_event_invitations_token_check check (
    token_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint calendar_trial_event_invitations_status_check check (
    status in ('pending', 'queued', 'processing', 'sent', 'responded', 'failed', 'revoked')
  ),
  constraint calendar_trial_event_invitations_response_check check (
    response is null or response in ('attending', 'not_attending', 'maybe')
  )
);

create unique index calendar_trial_event_invitations_token_key
on public.calendar_trial_event_invitations (token_hash);

create unique index calendar_trial_event_invitations_command_recipient_key
on public.calendar_trial_event_invitations (
  notification_command_id,
  player_id,
  guardian_id,
  lower(recipient_email)
);

create index calendar_trial_event_invitations_source_idx
on public.calendar_trial_event_invitations (
  coalesce(calendar_event_id, match_day_id),
  player_id,
  created_at desc
);

create index calendar_trial_event_invitations_queue_idx
on public.calendar_trial_event_invitations (email_queue_id)
where email_queue_id is not null;

alter table public.calendar_trial_event_invitations enable row level security;
revoke all on table public.calendar_trial_event_invitations
from public, anon, authenticated;
grant select, insert, update, delete on table public.calendar_trial_event_invitations
to service_role;

comment on table public.calendar_trial_event_invitations is
  'Event-specific trial guardian invitations. Bearer token hashes are stored here. Rows never grant Parent Portal identity or wider player access.';

create function public.prepare_calendar_trial_event_invitations_internal(
  notification_command_id_value uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  command_record public.calendar_event_notification_commands%rowtype;
  calendar_event_record public.calendar_events%rowtype;
  match_day_record public.match_days%rowtype;
  source_id_value uuid;
  title_value text;
  recipient record;
  invitation_record public.calendar_trial_event_invitations%rowtype;
  raw_token_value text;
  token_hash_value text;
  queue_id_value uuid;
  queued_count integer := 0;
  failed_count integer := 0;
  duplicate_count integer := 0;
  eligible_count integer := 0;
  expires_at_value timestamptz := timezone('utc', now()) + interval '14 days';
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to notify trial guardians.';
  end if;

  select command.* into command_record
  from public.calendar_event_notification_commands command
  where command.id = notification_command_id_value
    and command.requested_by = auth.uid()
  for update;

  if command_record.id is null or command_record.team_id is null then
    return jsonb_build_object(
      'eligibleRecipientCount', 0,
      'queuedCount', 0,
      'failedCount', 0,
      'duplicateCount', 0
    );
  end if;

  select profile.* into actor
  from public.users profile
  where profile.id = auth.uid()
    and profile.club_id = command_record.club_id
    and profile.role not in ('parent_portal', 'super_admin')
    and coalesce(profile.status, 'active') = 'active'
    and coalesce(profile.role_rank, 0) >= 20
  limit 1;

  if actor.id is null then
    raise exception 'Coach or manager access is required to notify trial guardians.';
  end if;

  if actor.role <> 'admin' and not exists (
    select 1
    from public.team_staff staff
    where staff.team_id = command_record.team_id
      and staff.user_id = actor.id
  ) then
    raise exception 'You do not have permission to notify trial guardians for this team.';
  end if;

  if command_record.calendar_event_id is not null then
    select event.* into calendar_event_record
    from public.calendar_events event
    where event.id = command_record.calendar_event_id
      and event.club_id = command_record.club_id
      and event.team_id = command_record.team_id
      and event.cancelled_at is null
      and event.parent_visible is true
      and event.parent_audience in ('involved_players', 'all_team_parents');

    source_id_value := calendar_event_record.id;
    title_value := calendar_event_record.title;
  else
    select fixture.* into match_day_record
    from public.match_days fixture
    where fixture.id = command_record.match_day_id
      and fixture.club_id = command_record.club_id
      and fixture.team_id = command_record.team_id
      and fixture.status <> 'cancelled'
      and fixture.parent_visible is true
      and fixture.parent_audience in ('involved_players', 'all_team_parents');

    source_id_value := match_day_record.id;
    title_value := concat('Match vs ', coalesce(nullif(match_day_record.opponent, ''), 'Opponent'));
  end if;

  if source_id_value is null then
    return jsonb_build_object(
      'eligibleRecipientCount', 0,
      'queuedCount', 0,
      'failedCount', 0,
      'duplicateCount', 0
    );
  end if;

  for recipient in
    select
      player.id as player_id,
      player.player_name,
      link.id as parent_link_id,
      guardian.id as guardian_id,
      concat_ws(' ', nullif(guardian.first_name, ''), nullif(guardian.last_name, '')) as guardian_name,
      lower(btrim(guardian.email)) as guardian_email
    from public.players player
    join public.parent_player_links link
      on link.club_id = player.club_id
      and link.team_id = player.team_id
      and link.player_id = player.id
      and link.status = 'uninvited'
      and link.auth_user_id is null
      and link.guardian_id is not null
      and link.receives_communications is true
    join public.guardians guardian
      on guardian.id = link.guardian_id
      and guardian.club_id = link.club_id
      and guardian.status = 'active'
      and lower(btrim(coalesce(guardian.email, ''))) = lower(btrim(coalesce(link.email, '')))
    where player.id = any(command_record.player_ids)
      and player.club_id = command_record.club_id
      and player.team_id = command_record.team_id
      and lower(btrim(coalesce(player.section, ''))) = 'trial'
      and coalesce(player.status, 'active') <> 'archived'
      and btrim(coalesce(guardian.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
    order by player.id, guardian.id
  loop
    eligible_count := eligible_count + 1;

    select invitation.* into invitation_record
    from public.calendar_trial_event_invitations invitation
    where invitation.notification_command_id = command_record.id
      and invitation.player_id = recipient.player_id
      and invitation.guardian_id = recipient.guardian_id
      and lower(invitation.recipient_email) = recipient.guardian_email
    limit 1;

    if invitation_record.id is not null then
      duplicate_count := duplicate_count + 1;
      invitation_record := null;
      continue;
    end if;

    update public.calendar_trial_event_invitations invitation
    set status = 'revoked',
        revoked_at = coalesce(invitation.revoked_at, timezone('utc', now())),
        revoked_reason = coalesce(invitation.revoked_reason, 'superseded_by_new_event_notification'),
        updated_at = timezone('utc', now())
    where invitation.notification_command_id <> command_record.id
      and invitation.player_id = recipient.player_id
      and invitation.guardian_id = recipient.guardian_id
      and invitation.calendar_event_id is not distinct from command_record.calendar_event_id
      and invitation.match_day_id is not distinct from command_record.match_day_id
      and invitation.revoked_at is null;

    raw_token_value := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
    token_hash_value := pg_catalog.encode(extensions.digest(raw_token_value, 'sha256'), 'hex');

    begin
      insert into public.calendar_trial_event_invitations (
        notification_command_id,
        club_id,
        team_id,
        calendar_event_id,
        match_day_id,
        player_id,
        parent_link_id,
        guardian_id,
        recipient_name,
        recipient_email,
        token_hash,
        expires_at,
        created_by
      ) values (
        command_record.id,
        command_record.club_id,
        command_record.team_id,
        command_record.calendar_event_id,
        command_record.match_day_id,
        recipient.player_id,
        recipient.parent_link_id,
        recipient.guardian_id,
        coalesce(recipient.guardian_name, ''),
        recipient.guardian_email,
        token_hash_value,
        expires_at_value,
        actor.id
      )
      returning * into invitation_record;

      insert into public.scheduled_email_queue (
        club_id,
        team_id,
        created_by,
        created_by_email,
        to_email,
        subject,
        status,
        scheduled_at,
        payload
      ) values (
        command_record.club_id,
        command_record.team_id,
        actor.id,
        coalesce(actor.email, ''),
        recipient.guardian_email,
        concat(coalesce(nullif(title_value, ''), 'Event invitation'), ' invitation'),
        'scheduled',
        timezone('utc', now()),
        jsonb_build_object(
          'resendPayload', jsonb_build_object(
            'to', jsonb_build_array(recipient.guardian_email),
            'subject', concat(coalesce(nullif(title_value, ''), 'Event invitation'), ' invitation'),
            'html', '<p>Event invitation</p>'
          ),
          'displayName', 'Football Player',
          'playerName', coalesce(recipient.player_name, ''),
          'parentName', coalesce(recipient.guardian_name, ''),
          'clubId', command_record.club_id,
          'teamId', command_record.team_id,
          'actorId', actor.id,
          'actorEmail', coalesce(actor.email, ''),
          'actorRole', actor.role,
          'requiredFeature', 'parentEmails',
          'visibleInEmailQueue', false,
          'trialEventInvitation', jsonb_build_object(
            'id', invitation_record.id,
            'rawToken', raw_token_value,
            'type', 'calendar_trial_event_invitation'
          ),
          'communicationLog', jsonb_build_object(
            'clubId', command_record.club_id,
            'playerId', recipient.player_id,
            'userId', actor.id,
            'userName', coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), ''),
            'userEmail', coalesce(actor.email, ''),
            'recipientEmail', recipient.guardian_email,
            'metadata', jsonb_build_object(
              'source', 'calendar_trial_event_notification',
              'eventSource', case when command_record.calendar_event_id is null then 'match-day' else 'calendar' end,
              'calendarEventId', command_record.calendar_event_id,
              'matchDayId', command_record.match_day_id,
              'notificationCommandId', command_record.id,
              'notificationType', command_record.notification_type,
              'trialInvitationId', invitation_record.id,
              'subject', concat(coalesce(nullif(title_value, ''), 'Event invitation'), ' invitation'),
              'body', '<p>Event invitation</p>',
              'scheduledAt', timezone('utc', now())
            )
          )
        )
      )
      returning id into queue_id_value;

      update public.calendar_trial_event_invitations invitation
      set email_queue_id = queue_id_value,
          status = 'queued',
          updated_at = timezone('utc', now())
      where invitation.id = invitation_record.id;

      insert into public.audit_logs (
        club_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
      ) values (
        command_record.club_id,
        actor.id,
        'calendar_trial_event_invitation_created',
        'calendar_trial_event_invitation',
        invitation_record.id,
        jsonb_build_object(
          'eventSource', case when command_record.calendar_event_id is null then 'match-day' else 'calendar' end,
          'calendarEventId', command_record.calendar_event_id,
          'matchDayId', command_record.match_day_id,
          'notificationCommandId', command_record.id,
          'playerId', recipient.player_id,
          'parentLinkId', recipient.parent_link_id,
          'guardianId', recipient.guardian_id,
          'expiresAt', expires_at_value
        )
      );

      queued_count := queued_count + 1;
    exception when others then
      failed_count := failed_count + 1;
    end;

    invitation_record := null;
    raw_token_value := null;
    token_hash_value := null;
    queue_id_value := null;
  end loop;

  return jsonb_build_object(
    'eligibleRecipientCount', eligible_count,
    'queuedCount', queued_count,
    'failedCount', failed_count,
    'duplicateCount', duplicate_count
  );
end;
$$;

revoke all on function public.prepare_calendar_trial_event_invitations_internal(uuid)
from public, anon, authenticated;
grant execute on function public.prepare_calendar_trial_event_invitations_internal(uuid)
to service_role;

create function public.notify_clubwide_calendar_event_parents_internal(
  calendar_event_id_value uuid,
  event_action_value text,
  notification_request_token_value uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  event_record public.calendar_events%rowtype;
  command_record public.calendar_event_notification_commands%rowtype;
  notification_record public.calendar_event_notification_events%rowtype;
  recipient record;
  normalized_action text := lower(btrim(coalesce(event_action_value, '')));
  queue_id_value uuid;
  eligible_count integer := 0;
  queued_count integer := 0;
  failed_count integer := 0;
  duplicate_count integer := 0;
  result_value jsonb;
begin
  if auth.uid() is null or notification_request_token_value is null then
    raise exception 'Authentication and a notification request token are required.';
  end if;

  if normalized_action not in ('creation', 'update') then
    raise exception 'Choose a valid Calendar notification action.';
  end if;

  select profile.* into actor
  from public.users profile
  where profile.id = auth.uid()
    and profile.role = 'admin'
    and profile.club_id is not null
    and coalesce(profile.status, 'active') = 'active'
  limit 1;

  if actor.id is null then
    raise exception 'Club Admin access is required to notify club families.';
  end if;

  select event.* into event_record
  from public.calendar_events event
  where event.id = calendar_event_id_value
    and event.club_id = actor.club_id
    and event.team_id is null
    and event.cancelled_at is null
    and event.parent_visible is true
    and event.parent_audience = 'all_club_parents'
  for update;

  if event_record.id is null then
    raise exception 'A shared club event was not found.';
  end if;

  if not public.can_use_plan_feature(actor.club_id, 'parentPortal')
    or not public.can_use_plan_feature(actor.club_id, 'parentEmails') then
    raise exception 'The current club plan does not include Parent Portal email notifications.';
  end if;

  insert into public.calendar_event_notification_commands (
    club_id,
    team_id,
    calendar_event_id,
    match_day_id,
    event_revision,
    notification_type,
    request_token,
    player_ids,
    requested_by
  ) values (
    actor.club_id,
    null,
    event_record.id,
    null,
    event_record.notification_revision,
    normalized_action,
    notification_request_token_value,
    '{}'::uuid[],
    actor.id
  )
  on conflict do nothing
  returning * into command_record;

  if command_record.id is null then
    select command.* into command_record
    from public.calendar_event_notification_commands command
    where command.requested_by = actor.id
      and command.calendar_event_id = event_record.id
      and command.match_day_id is null
      and command.request_token = notification_request_token_value
    for update;

    if command_record.result is not null then
      return command_record.result
        || jsonb_build_object(
          'duplicateCount',
          greatest(coalesce((command_record.result ->> 'eligibleRecipientCount')::integer, 0), 1)
        );
    end if;
  end if;

  select count(*) into eligible_count
  from (
    select distinct lower(btrim(link.email))
    from public.parent_player_links link
    join public.players player
      on player.id = link.player_id
      and player.club_id = link.club_id
    join public.users parent_profile
      on parent_profile.id = link.auth_user_id
      and parent_profile.club_id = link.club_id
      and coalesce(parent_profile.status, 'active') = 'active'
    where link.club_id = actor.club_id
      and link.status = 'active'
      and coalesce(player.status, 'active') <> 'archived'
      and btrim(coalesce(link.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ) eligible;

  for recipient in
    select distinct on (lower(btrim(link.email)))
      link.id as parent_link_id,
      player.id as player_id,
      player.player_name,
      lower(btrim(link.email)) as recipient_email,
      coalesce(nullif(parent_profile.display_name, ''), nullif(parent_profile.name, ''), 'Parent or guardian') as parent_name
    from public.parent_player_links link
    join public.players player
      on player.id = link.player_id
      and player.club_id = link.club_id
    join public.users parent_profile
      on parent_profile.id = link.auth_user_id
      and parent_profile.club_id = link.club_id
      and coalesce(parent_profile.status, 'active') = 'active'
    where link.club_id = actor.club_id
      and link.status = 'active'
      and coalesce(player.status, 'active') <> 'archived'
      and btrim(coalesce(link.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
    order by lower(btrim(link.email)), link.created_at, link.id
  loop
    insert into public.calendar_event_notification_events (
      club_id,
      team_id,
      calendar_event_id,
      match_day_id,
      notification_command_id,
      event_revision,
      notification_type,
      event_action_type,
      parent_link_id,
      player_id,
      recipient_email,
      idempotency_key,
      portal_state,
      response_requirement,
      status,
      requested_by
    ) values (
      actor.club_id,
      null,
      event_record.id,
      null,
      command_record.id,
      event_record.notification_revision,
      normalized_action,
      'informational',
      recipient.parent_link_id,
      recipient.player_id,
      recipient.recipient_email,
      concat('calendar-notify-command:', command_record.id, ':', recipient.recipient_email),
      'ready',
      'informational',
      'pending',
      actor.id
    )
    on conflict (notification_command_id, lower(recipient_email))
      where notification_command_id is not null do nothing
    returning * into notification_record;

    if notification_record.id is null then
      duplicate_count := duplicate_count + 1;
      continue;
    end if;

    begin
      insert into public.scheduled_email_queue (
        club_id,
        team_id,
        created_by,
        created_by_email,
        to_email,
        subject,
        status,
        scheduled_at,
        payload
      ) values (
        actor.club_id,
        null,
        actor.id,
        coalesce(actor.email, ''),
        recipient.recipient_email,
        concat(coalesce(nullif(event_record.title, ''), 'Club event'), ' invitation'),
        'scheduled',
        timezone('utc', now()),
        jsonb_build_object(
          'resendPayload', jsonb_build_object(
            'to', jsonb_build_array(recipient.recipient_email),
            'subject', concat(coalesce(nullif(event_record.title, ''), 'Club event'), ' invitation'),
            'html', '<p>Club event invitation</p>'
          ),
          'displayName', 'Football Player',
          'playerName', coalesce(recipient.player_name, ''),
          'parentName', coalesce(recipient.parent_name, ''),
          'clubId', actor.club_id,
          'teamId', null,
          'actorId', actor.id,
          'actorEmail', coalesce(actor.email, ''),
          'actorRole', actor.role,
          'requiredFeature', 'parentEmails',
          'visibleInEmailQueue', true,
          'communicationLog', jsonb_build_object(
            'clubId', actor.club_id,
            'playerId', recipient.player_id,
            'userId', actor.id,
            'userName', coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), ''),
            'userEmail', coalesce(actor.email, ''),
            'recipientEmail', recipient.recipient_email,
            'metadata', jsonb_build_object(
              'source', 'calendar_event_notification',
              'eventSource', 'calendar',
              'calendarEventId', event_record.id,
              'matchDayId', null,
              'eventRevision', event_record.notification_revision,
              'notificationCommandId', command_record.id,
              'notificationType', normalized_action,
              'subject', concat(coalesce(nullif(event_record.title, ''), 'Club event'), ' invitation'),
              'body', '<p>Club event invitation</p>',
              'scheduledAt', timezone('utc', now())
            )
          )
        )
      )
      returning id into queue_id_value;

      update public.calendar_event_notification_events notification
      set status = 'queued',
          email_queue_id = queue_id_value,
          last_error = null,
          updated_at = timezone('utc', now())
      where notification.id = notification_record.id;

      queued_count := queued_count + 1;
    exception when others then
      update public.calendar_event_notification_events notification
      set status = 'failed',
          last_error = left(sqlerrm, 1000),
          updated_at = timezone('utc', now())
      where notification.id = notification_record.id;
      failed_count := failed_count + 1;
    end;

    notification_record := null;
    queue_id_value := null;
  end loop;

  result_value := jsonb_build_object(
    'eventId', event_record.id,
    'eventSource', 'calendar',
    'eventRevision', event_record.notification_revision,
    'notificationCommandId', command_record.id,
    'notificationType', normalized_action,
    'eventActionType', 'informational',
    'portalState', 'ready',
    'portalCreatedCount', 0,
    'portalUpdatedCount', 0,
    'portalRecordCount', eligible_count,
    'responseRequirement', 'informational',
    'eligibleRecipientCount', eligible_count,
    'queuedCount', queued_count,
    'failedCount', failed_count,
    'duplicateCount', duplicate_count,
    'idempotencyPrefix', concat('calendar-notify-command:', command_record.id),
    'finalState', case
      when failed_count > 0 then 'portal_ready_email_partial'
      when eligible_count = 0 then 'portal_ready_no_eligible_email'
      else 'portal_ready_email_queued'
    end
  );

  update public.calendar_event_notification_commands command
  set result = result_value,
      completed_at = timezone('utc', now())
  where command.id = command_record.id;

  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    actor.club_id,
    actor.id,
    'clubwide_calendar_event_parents_notified',
    'calendar_event',
    event_record.id,
    result_value
  );

  return result_value;
end;
$$;

revoke all on function public.notify_clubwide_calendar_event_parents_internal(uuid, text, uuid)
from public, anon, authenticated;
grant execute on function public.notify_clubwide_calendar_event_parents_internal(uuid, text, uuid)
to service_role;

alter function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[])
  rename to notify_calendar_event_parents_trials39b_legacy;

revoke all on function public.notify_calendar_event_parents_trials39b_legacy(uuid, text, uuid, uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.notify_calendar_event_parents_trials39b_legacy(uuid, text, uuid, uuid, uuid[])
to service_role;

create function public.notify_calendar_event_parents(
  calendar_event_id_value uuid,
  event_action_value text,
  match_day_id_value uuid,
  notification_request_token_value uuid,
  player_ids_value uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_value jsonb;
  trial_result jsonb;
  command_id_value uuid;
  calendar_team_id uuid;
  total_eligible integer;
  total_queued integer;
  total_failed integer;
  total_duplicates integer;
begin
  if coalesce(array_length(player_ids_value, 1), 0) > 0 then
    raise exception 'Notification recipients are resolved from saved server-side event scope.';
  end if;

  if num_nonnulls(calendar_event_id_value, match_day_id_value) <> 1 then
    raise exception 'Choose exactly one supported Calendar event source.';
  end if;

  if calendar_event_id_value is not null then
    select event.team_id into calendar_team_id
    from public.calendar_events event
    where event.id = calendar_event_id_value;
  end if;

  if calendar_event_id_value is not null and calendar_team_id is null then
    result_value := public.notify_clubwide_calendar_event_parents_internal(
      calendar_event_id_value,
      event_action_value,
      notification_request_token_value
    );
  else
    result_value := public.notify_calendar_event_parents_trials39b_legacy(
      calendar_event_id_value,
      event_action_value,
      match_day_id_value,
      notification_request_token_value,
      '{}'::uuid[]
    );
  end if;

  command_id_value := nullif(result_value ->> 'notificationCommandId', '')::uuid;

  if command_id_value is null then
    return result_value;
  end if;

  trial_result := public.prepare_calendar_trial_event_invitations_internal(command_id_value);
  total_eligible := coalesce((result_value ->> 'eligibleRecipientCount')::integer, 0)
    + coalesce((trial_result ->> 'eligibleRecipientCount')::integer, 0);
  total_queued := coalesce((result_value ->> 'queuedCount')::integer, 0)
    + coalesce((trial_result ->> 'queuedCount')::integer, 0);
  total_failed := coalesce((result_value ->> 'failedCount')::integer, 0)
    + coalesce((trial_result ->> 'failedCount')::integer, 0);
  total_duplicates := coalesce((result_value ->> 'duplicateCount')::integer, 0)
    + coalesce((trial_result ->> 'duplicateCount')::integer, 0);

  result_value := result_value || jsonb_build_object(
    'eligibleRecipientCount', total_eligible,
    'queuedCount', total_queued,
    'failedCount', total_failed,
    'duplicateCount', total_duplicates,
    'trialEligibleRecipientCount', coalesce((trial_result ->> 'eligibleRecipientCount')::integer, 0),
    'trialQueuedCount', coalesce((trial_result ->> 'queuedCount')::integer, 0),
    'trialFailedCount', coalesce((trial_result ->> 'failedCount')::integer, 0),
    'trialDuplicateCount', coalesce((trial_result ->> 'duplicateCount')::integer, 0),
    'finalState', case
      when total_failed > 0 and total_queued > 0 then 'portal_ready_email_partial'
      when total_failed > 0 then 'portal_ready_email_failed'
      when total_queued > 0 then 'portal_ready_email_queued'
      else coalesce(result_value ->> 'finalState', 'portal_ready_no_eligible_email')
    end
  );

  update public.calendar_event_notification_commands command
  set result = result_value,
      completed_at = timezone('utc', now())
  where command.id = command_id_value
    and command.requested_by = auth.uid();

  return result_value;
end;
$$;

revoke all on function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[])
from public;
revoke execute on function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[])
from anon;
grant execute on function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[])
to authenticated, service_role;

comment on function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[]) is
  'Runs the established server-authoritative Calendar command, adds club-wide email coverage, and creates scoped non-portal trial guardian invitations.';

create function public.get_calendar_trial_event_response(
  token_hash_value text
)
returns table (
  response_state text,
  invitation_id uuid,
  club_name text,
  club_logo_url text,
  theme_accent text,
  team_name text,
  player_name text,
  event_title text,
  event_type text,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  notes text,
  current_response text,
  responded_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.calendar_trial_event_invitations%rowtype;
  valid_scope boolean := false;
begin
  if lower(btrim(coalesce(token_hash_value, ''))) !~ '^[0-9a-f]{64}$' then
    response_state := 'invalid';
    return next;
    return;
  end if;

  select row.* into invitation
  from public.calendar_trial_event_invitations row
  where row.token_hash = lower(btrim(token_hash_value))
  limit 1;

  if invitation.id is null then
    response_state := 'invalid';
    return next;
    return;
  end if;

  invitation_id := invitation.id;
  expires_at := invitation.expires_at;
  current_response := invitation.response;
  responded_at := invitation.responded_at;

  if invitation.revoked_at is not null or invitation.status = 'revoked' then
    response_state := 'revoked';
    return next;
    return;
  end if;

  if invitation.expires_at <= timezone('utc', now()) then
    response_state := 'expired';
    return next;
    return;
  end if;

  select exists (
    select 1
    from public.players player
    join public.parent_player_links link
      on link.id = invitation.parent_link_id
      and link.club_id = invitation.club_id
      and link.team_id = invitation.team_id
      and link.player_id = invitation.player_id
      and link.guardian_id = invitation.guardian_id
      and link.status = 'uninvited'
      and link.auth_user_id is null
      and link.receives_communications is true
      and lower(btrim(coalesce(link.email, ''))) = lower(btrim(invitation.recipient_email))
    join public.guardians guardian
      on guardian.id = invitation.guardian_id
      and guardian.club_id = invitation.club_id
      and guardian.status = 'active'
      and lower(btrim(coalesce(guardian.email, ''))) = lower(btrim(invitation.recipient_email))
    where player.id = invitation.player_id
      and player.club_id = invitation.club_id
      and player.team_id = invitation.team_id
      and lower(btrim(coalesce(player.section, ''))) = 'trial'
      and coalesce(player.status, 'active') <> 'archived'
      and (
        (
          invitation.calendar_event_id is not null
          and exists (
            select 1
            from public.calendar_events event
            where event.id = invitation.calendar_event_id
              and event.club_id = invitation.club_id
              and event.team_id = invitation.team_id
              and event.cancelled_at is null
              and event.parent_visible is true
              and event.parent_audience in ('involved_players', 'all_team_parents')
          )
        )
        or (
          invitation.match_day_id is not null
          and exists (
            select 1
            from public.match_days fixture
            where fixture.id = invitation.match_day_id
              and fixture.club_id = invitation.club_id
              and fixture.team_id = invitation.team_id
              and fixture.status <> 'cancelled'
              and fixture.parent_visible is true
              and fixture.parent_audience in ('involved_players', 'all_team_parents')
          )
        )
      )
  ) into valid_scope;

  if valid_scope is not true then
    response_state := 'revoked';
    return next;
    return;
  end if;

  select
    club.name,
    coalesce(club.logo_url, ''),
    coalesce(club.theme_accent, 'green'),
    team.name,
    player.player_name
  into
    club_name,
    club_logo_url,
    theme_accent,
    team_name,
    player_name
  from public.clubs club
  join public.teams team
    on team.id = invitation.team_id
    and team.club_id = club.id
  join public.players player
    on player.id = invitation.player_id
    and player.club_id = club.id
    and player.team_id = team.id
  where club.id = invitation.club_id;

  if invitation.calendar_event_id is not null then
    select
      event.title,
      event.event_type,
      event.starts_at,
      event.ends_at,
      event.location,
      event.notes
    into
      event_title,
      event_type,
      starts_at,
      ends_at,
      location,
      notes
    from public.calendar_events event
    where event.id = invitation.calendar_event_id;
  else
    select
      concat('Match vs ', coalesce(nullif(fixture.opponent, ''), 'Opponent')),
      'match',
      case
        when fixture.kickoff_time_tbc is true or fixture.kickoff_time is null
          then fixture.match_date::timestamp at time zone 'Europe/London'
        else (fixture.match_date + fixture.kickoff_time)::timestamp at time zone 'Europe/London'
      end,
      case
        when fixture.kickoff_time_tbc is true or fixture.kickoff_time is null
          then null
        else ((fixture.match_date + fixture.kickoff_time)::timestamp + interval '2 hours') at time zone 'Europe/London'
      end,
      fixture.venue_name,
      fixture.notes
    into
      event_title,
      event_type,
      starts_at,
      ends_at,
      location,
      notes
    from public.match_days fixture
    where fixture.id = invitation.match_day_id;
  end if;

  response_state := case when invitation.response is null then 'available' else 'responded' end;
  return next;
end;
$$;

revoke all on function public.get_calendar_trial_event_response(text)
from public;
grant execute on function public.get_calendar_trial_event_response(text)
to anon, authenticated, service_role;

create function public.submit_calendar_trial_event_response(
  token_hash_value text,
  response_value text
)
returns table (
  response_state text,
  invitation_id uuid,
  club_name text,
  club_logo_url text,
  theme_accent text,
  team_name text,
  player_name text,
  event_title text,
  event_type text,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  notes text,
  current_response text,
  responded_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.calendar_trial_event_invitations%rowtype;
  current_state text;
  normalized_response text := lower(btrim(coalesce(response_value, '')));
begin
  if normalized_response not in ('attending', 'not_attending', 'maybe') then
    return query
    select
      'invalid'::text,
      null::uuid,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::timestamptz,
      null::timestamptz,
      null::text,
      null::text,
      null::text,
      null::timestamptz,
      null::timestamptz;
    return;
  end if;

  if lower(btrim(coalesce(token_hash_value, ''))) !~ '^[0-9a-f]{64}$' then
    return query select * from public.get_calendar_trial_event_response(token_hash_value);
    return;
  end if;

  select row.* into invitation
  from public.calendar_trial_event_invitations row
  where row.token_hash = lower(btrim(token_hash_value))
  for update;

  if invitation.id is null then
    return query select * from public.get_calendar_trial_event_response(token_hash_value);
    return;
  end if;

  select response.response_state into current_state
  from public.get_calendar_trial_event_response(token_hash_value) response;

  if current_state not in ('available', 'responded') then
    return query select * from public.get_calendar_trial_event_response(token_hash_value);
    return;
  end if;

  update public.calendar_trial_event_invitations row
  set response = normalized_response,
      responded_at = case
        when row.response is not distinct from normalized_response and row.responded_at is not null
          then row.responded_at
        else timezone('utc', now())
      end,
      response_count = row.response_count + 1,
      status = 'responded',
      updated_at = timezone('utc', now())
  where row.id = invitation.id;

  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    invitation.club_id,
    null,
    'calendar_trial_event_response_recorded',
    'calendar_trial_event_invitation',
    invitation.id,
    jsonb_build_object(
      'calendarEventId', invitation.calendar_event_id,
      'matchDayId', invitation.match_day_id,
      'playerId', invitation.player_id,
      'response', normalized_response,
      'safeReplay', invitation.response is not distinct from normalized_response
    )
  );

  return query select * from public.get_calendar_trial_event_response(token_hash_value);
end;
$$;

revoke all on function public.submit_calendar_trial_event_response(text, text)
from public;
grant execute on function public.submit_calendar_trial_event_response(text, text)
to anon, authenticated, service_role;

comment on function public.get_calendar_trial_event_response(text) is
  'Returns only the event, trial player, club branding, and current response tied to one valid invitation token hash.';

comment on function public.submit_calendar_trial_event_response(text, text) is
  'Records an idempotent event-specific trial RSVP without creating or requiring a Parent Portal account.';
