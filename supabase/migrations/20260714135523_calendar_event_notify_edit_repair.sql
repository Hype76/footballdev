alter table public.calendar_events
  add column if not exists notification_revision bigint not null default 1;

create or replace function public.set_calendar_event_notification_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    new.team_id,
    new.event_type,
    new.title,
    new.starts_at,
    new.ends_at,
    new.location,
    new.notes,
    new.recurrence_frequency,
    new.recurrence_until,
    new.cancelled_at,
    new.parent_visible,
    new.parent_audience
  ) is distinct from row(
    old.team_id,
    old.event_type,
    old.title,
    old.starts_at,
    old.ends_at,
    old.location,
    old.notes,
    old.recurrence_frequency,
    old.recurrence_until,
    old.cancelled_at,
    old.parent_visible,
    old.parent_audience
  ) then
    new.notification_revision = old.notification_revision + 1;
  else
    new.notification_revision = old.notification_revision;
  end if;

  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists calendar_events_set_notification_revision on public.calendar_events;
create trigger calendar_events_set_notification_revision
before update on public.calendar_events
for each row
execute function public.set_calendar_event_notification_revision();

revoke all on function public.set_calendar_event_notification_revision() from public, anon, authenticated;

create table if not exists public.calendar_event_notification_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  calendar_event_id uuid references public.calendar_events (id) on delete set null,
  event_revision bigint not null,
  notification_type text not null,
  event_action_type text not null default 'informational',
  parent_link_id uuid references public.parent_player_links (id) on delete set null,
  player_id uuid references public.players (id) on delete set null,
  recipient_email text not null,
  idempotency_key text not null,
  portal_state text not null default 'ready',
  response_requirement text not null default 'informational',
  status text not null default 'pending',
  email_queue_id uuid references public.scheduled_email_queue (id) on delete set null,
  last_error text,
  requested_by uuid references public.users (id) on delete set null,
  requested_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint calendar_event_notification_events_type_check check (
    notification_type in ('creation', 'update')
  ),
  constraint calendar_event_notification_events_portal_state_check check (
    portal_state in ('ready', 'failed')
  ),
  constraint calendar_event_notification_events_response_check check (
    response_requirement in ('informational', 'response_required')
  ),
  constraint calendar_event_notification_events_status_check check (
    status in ('pending', 'queued', 'failed')
  )
);

create unique index if not exists calendar_event_notification_events_revision_recipient_key
on public.calendar_event_notification_events (
  calendar_event_id,
  event_revision,
  notification_type,
  lower(recipient_email)
)
where calendar_event_id is not null;

create index if not exists calendar_event_notification_events_event_status_idx
on public.calendar_event_notification_events (calendar_event_id, event_revision, status, requested_at desc);

alter table public.calendar_event_notification_events enable row level security;

revoke all privileges on table public.calendar_event_notification_events from public, anon, authenticated;
grant select, insert, update, delete on table public.calendar_event_notification_events to service_role;

create or replace function public.calendar_event_notification_escape_html(value text)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select replace(
    replace(
      replace(
        replace(
          replace(value, '&', '&amp;'),
          '<', '&lt;'
        ),
        '>', '&gt;'
      ),
      '"', '&quot;'
    ),
    '''', '&#39;'
  );
$$;

revoke all on function public.calendar_event_notification_escape_html(text) from public, anon, authenticated;
grant execute on function public.calendar_event_notification_escape_html(text) to service_role;

create or replace function public.notify_calendar_event_parents(
  calendar_event_id_value uuid,
  event_action_value text,
  player_ids_value uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  event_record public.calendar_events%rowtype;
  club_name_value text;
  team_name_value text;
  normalized_action text := lower(btrim(coalesce(event_action_value, '')));
  selected_player_ids uuid[] := '{}'::uuid[];
  requested_player_count integer := 0;
  selected_player_count integer := 0;
  existing_portal_count integer := 0;
  portal_created_count integer := 0;
  portal_updated_count integer := 0;
  eligible_recipient_count integer := 0;
  queued_count integer := 0;
  failed_count integer := 0;
  duplicate_count integer := 0;
  notification_record public.calendar_event_notification_events%rowtype;
  queue_id_value uuid;
  recipient record;
  subject_value text;
  parent_portal_url text;
  idempotency_key_value text;
  html_value text;
  response_label text := 'No response is required. This event is informational.';
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to notify parents.';
  end if;

  select profile.*
  into actor
  from public.users profile
  where profile.id = auth.uid()
  limit 1;

  if actor.id is null
    or actor.club_id is null
    or actor.role in ('parent_portal', 'super_admin')
    or coalesce(actor.status, 'active') <> 'active'
    or coalesce(actor.role_rank, 0) < 20 then
    raise exception 'Coach or manager access is required to notify parents.';
  end if;

  if normalized_action not in ('creation', 'update') then
    raise exception 'Choose a valid Calendar notification action.';
  end if;

  select calendar_event.*
  into event_record
  from public.calendar_events calendar_event
  where calendar_event.id = calendar_event_id_value
    and calendar_event.club_id = actor.club_id
  for update;

  if event_record.id is null then
    raise exception 'Calendar event was not found in the current club.';
  end if;

  if event_record.team_id is null then
    raise exception 'Choose a team before notifying parents about this event.';
  end if;

  if actor.role <> 'admin' and not exists (
    select 1
    from public.team_staff staff
    where staff.team_id = event_record.team_id
      and staff.user_id = actor.id
  ) then
    raise exception 'You do not have permission to notify parents for this team.';
  end if;

  if event_record.cancelled_at is not null then
    raise exception 'Parents cannot be notified about a cancelled event.';
  end if;

  if event_record.parent_visible is not true
    or event_record.parent_audience not in ('involved_players', 'all_team_parents') then
    raise exception 'Share this event with a supported parent audience before notifying parents.';
  end if;

  if not public.can_use_plan_feature(event_record.club_id, 'parentPortal')
    or not public.can_use_plan_feature(event_record.club_id, 'parentEmails') then
    raise exception 'The current club plan does not include Parent Portal email notifications.';
  end if;

  if event_record.parent_audience = 'all_team_parents' then
    select coalesce(array_agg(player.id order by player.id), '{}'::uuid[])
    into selected_player_ids
    from public.players player
    where player.club_id = event_record.club_id
      and player.team_id = event_record.team_id
      and coalesce(player.status, 'active') <> 'archived';
  else
    select count(distinct requested_id), coalesce(array_agg(distinct requested_id order by requested_id), '{}'::uuid[])
    into requested_player_count, selected_player_ids
    from unnest(coalesce(player_ids_value, '{}'::uuid[])) requested_id;

    if requested_player_count = 0 then
      raise exception 'Choose at least one involved player before notifying parents.';
    end if;

    select count(*)
    into selected_player_count
    from public.players player
    where player.id = any(selected_player_ids)
      and player.club_id = event_record.club_id
      and player.team_id = event_record.team_id
      and coalesce(player.status, 'active') <> 'archived';

    if selected_player_count <> requested_player_count then
      raise exception 'One or more selected players are outside this event team or are no longer active.';
    end if;
  end if;

  selected_player_count := coalesce(array_length(selected_player_ids, 1), 0);

  if selected_player_count = 0 then
    raise exception 'No active players are available for this event audience.';
  end if;

  select count(*)
  into existing_portal_count
  from public.calendar_event_invites invite
  where invite.calendar_event_id = event_record.id
    and invite.player_id = any(selected_player_ids);

  update public.calendar_event_invites invite
  set invite_status = 'cancelled',
      cancelled_at = coalesce(invite.cancelled_at, timezone('utc', now())),
      updated_by = actor.id,
      updated_by_name = coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), actor.email, ''),
      updated_by_email = coalesce(actor.email, '')
  where invite.calendar_event_id = event_record.id
    and invite.club_id = event_record.club_id
    and invite.player_id <> all(selected_player_ids)
    and invite.invite_status <> 'cancelled';

  insert into public.calendar_event_invites (
    club_id,
    team_id,
    calendar_event_id,
    assessment_session_id,
    player_id,
    parent_link_id,
    player_status_at_invite,
    recipient_type,
    parent_contact_name,
    parent_contact_email,
    player_contact_email,
    recipient_contacts,
    invite_status,
    notify_requested,
    cancelled_at,
    created_by,
    created_by_name,
    created_by_email,
    updated_by,
    updated_by_name,
    updated_by_email
  )
  select
    event_record.club_id,
    event_record.team_id,
    event_record.id,
    null,
    player.id,
    primary_link.id,
    coalesce(player.section, ''),
    'parent_guardian',
    coalesce(nullif(primary_parent.display_name, ''), nullif(primary_parent.name, ''), ''),
    coalesce(primary_link.email, ''),
    '',
    '[]'::jsonb,
    'active',
    true,
    null,
    actor.id,
    coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), actor.email, ''),
    coalesce(actor.email, ''),
    actor.id,
    coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), actor.email, ''),
    coalesce(actor.email, '')
  from public.players player
  left join lateral (
    select link.*
    from public.parent_player_links link
    where link.club_id = event_record.club_id
      and link.team_id = event_record.team_id
      and link.player_id = player.id
      and link.status = 'active'
    order by link.created_at, link.id
    limit 1
  ) primary_link on true
  left join public.users primary_parent on primary_parent.id = primary_link.auth_user_id
  where player.id = any(selected_player_ids)
  on conflict (club_id, player_id, calendar_event_id, assessment_session_id) do update
  set team_id = excluded.team_id,
      parent_link_id = excluded.parent_link_id,
      player_status_at_invite = excluded.player_status_at_invite,
      parent_contact_name = excluded.parent_contact_name,
      parent_contact_email = excluded.parent_contact_email,
      invite_status = case
        when public.calendar_event_invites.responded_at is not null then public.calendar_event_invites.invite_status
        else 'active'
      end,
      notify_requested = true,
      cancelled_at = null,
      updated_by = excluded.updated_by,
      updated_by_name = excluded.updated_by_name,
      updated_by_email = excluded.updated_by_email;

  portal_updated_count := least(existing_portal_count, selected_player_count);
  portal_created_count := greatest(selected_player_count - existing_portal_count, 0);

  select coalesce(club.name, ''), coalesce(team.name, '')
  into club_name_value, team_name_value
  from public.clubs club
  join public.teams team on team.id = event_record.team_id
  where club.id = event_record.club_id;

  subject_value := case normalized_action
    when 'creation' then concat('New event added: ', event_record.title)
    else concat('Event details updated: ', event_record.title)
  end;
  select count(*)
  into eligible_recipient_count
  from (
    select distinct lower(btrim(link.email)) as recipient_email
    from public.parent_player_links link
    where link.club_id = event_record.club_id
      and link.team_id = event_record.team_id
      and link.player_id = any(selected_player_ids)
      and link.status = 'active'
      and link.auth_user_id is not null
      and btrim(coalesce(link.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ) eligible;

  for recipient in
    select distinct on (lower(btrim(link.email)))
      link.id as parent_link_id,
      link.player_id,
      lower(btrim(link.email)) as recipient_email,
      coalesce(nullif(parent_profile.display_name, ''), nullif(parent_profile.name, ''), 'Parent or guardian') as parent_name,
      coalesce(nullif(player.player_name, ''), 'your child') as player_name
    from public.parent_player_links link
    join public.players player
      on player.id = link.player_id
      and player.club_id = link.club_id
      and player.team_id = link.team_id
    left join public.users parent_profile on parent_profile.id = link.auth_user_id
    where link.club_id = event_record.club_id
      and link.team_id = event_record.team_id
      and link.player_id = any(selected_player_ids)
      and link.status = 'active'
      and link.auth_user_id is not null
      and btrim(coalesce(link.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
    order by lower(btrim(link.email)), link.created_at, link.id
  loop
    parent_portal_url := concat(
      'https://parent.footballplayer.online/parent-portal?section=calendar&eventId=',
      event_record.id,
      '&parentLinkId=',
      recipient.parent_link_id
    );
    idempotency_key_value := concat(
      'calendar-event:', event_record.id,
      ':revision:', event_record.notification_revision,
      ':', normalized_action,
      ':', recipient.recipient_email
    );

    insert into public.calendar_event_notification_events (
      club_id,
      team_id,
      calendar_event_id,
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
    )
    values (
      event_record.club_id,
      event_record.team_id,
      event_record.id,
      event_record.notification_revision,
      normalized_action,
      'informational',
      recipient.parent_link_id,
      recipient.player_id,
      recipient.recipient_email,
      idempotency_key_value,
      'ready',
      'informational',
      'pending',
      actor.id
    )
    on conflict (calendar_event_id, event_revision, notification_type, lower(recipient_email))
      where calendar_event_id is not null
      do nothing
    returning * into notification_record;

    if notification_record.id is null then
      select notification.*
      into notification_record
      from public.calendar_event_notification_events notification
      where notification.calendar_event_id = event_record.id
        and notification.event_revision = event_record.notification_revision
        and notification.notification_type = normalized_action
        and lower(notification.recipient_email) = recipient.recipient_email
      limit 1;
    end if;

    if notification_record.status = 'queued' then
      duplicate_count := duplicate_count + 1;
      notification_record := null;
      continue;
    end if;

    html_value := concat(
      '<div style="font-family:Arial,sans-serif;color:#142018;background:#ffffff;padding:28px;line-height:1.55;max-width:720px;margin:0 auto;">',
      '<p style="margin:0 0 10px;color:#4f6552;font-size:12px;font-weight:700;text-transform:uppercase;">',
      case normalized_action when 'creation' then 'New event added' else 'Event details updated' end,
      '</p><h1 style="margin:0 0 14px;font-size:24px;">',
      public.calendar_event_notification_escape_html(coalesce(event_record.title, 'Club event')),
      '</h1><p style="margin:0 0 18px;font-size:15px;">Hi ',
      public.calendar_event_notification_escape_html(recipient.parent_name),
      ', the latest details for ',
      public.calendar_event_notification_escape_html(recipient.player_name),
      ' are available in the Parent Portal.</p>',
      '<div style="border:1px solid #e7ece3;border-radius:12px;background:#fbfcf9;padding:14px 16px;margin:0 0 20px;">',
      '<p><strong>Team:</strong> ', public.calendar_event_notification_escape_html(coalesce(team_name_value, 'Team')), '</p>',
      '<p><strong>Type:</strong> ', public.calendar_event_notification_escape_html(coalesce(event_record.event_type, 'general')), '</p>',
      '<p><strong>Starts:</strong> ', public.calendar_event_notification_escape_html(to_char(event_record.starts_at at time zone 'Europe/London', 'Dy DD Mon YYYY at HH24:MI')), '</p>',
      case when event_record.ends_at is null then '' else concat(
        '<p><strong>Ends:</strong> ', public.calendar_event_notification_escape_html(to_char(event_record.ends_at at time zone 'Europe/London', 'Dy DD Mon YYYY at HH24:MI')), '</p>'
      ) end,
      case when btrim(coalesce(event_record.location, '')) = '' then '' else concat(
        '<p><strong>Venue:</strong> ', public.calendar_event_notification_escape_html(event_record.location), '</p>'
      ) end,
      case when btrim(coalesce(event_record.notes, '')) = '' then '' else concat(
        '<p><strong>Notes:</strong> ', public.calendar_event_notification_escape_html(event_record.notes), '</p>'
      ) end,
      '<p><strong>Response:</strong> ', response_label, '</p>',
      case normalized_action when 'update' then '<p>Your existing response remains unchanged. No new response is required.</p>' else '' end,
      '</div><p style="margin:0 0 20px;"><a href="', parent_portal_url,
      '" style="display:inline-block;background:#047857;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">View event details</a></p>',
      '<p style="margin:0;color:#5a6b5b;font-size:13px;">',
      public.calendar_event_notification_escape_html(coalesce(club_name_value, 'Football Player')),
      ' | ', public.calendar_event_notification_escape_html(coalesce(team_name_value, 'Team')),
      '</p></div>'
    );

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
      )
      values (
        event_record.club_id,
        event_record.team_id,
        actor.id,
        coalesce(actor.email, ''),
        recipient.recipient_email,
        subject_value,
        'scheduled',
        timezone('utc', now()) + interval '10 minutes',
        jsonb_build_object(
          'resendPayload', jsonb_build_object(
            'to', jsonb_build_array(recipient.recipient_email),
            'subject', subject_value,
            'html', html_value
          ),
          'displayName', coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), 'Football Player'),
          'teamName', coalesce(team_name_value, ''),
          'clubName', coalesce(club_name_value, ''),
          'playerName', recipient.player_name,
          'parentName', recipient.parent_name,
          'clubId', event_record.club_id,
          'teamId', event_record.team_id,
          'actorId', actor.id,
          'actorEmail', coalesce(actor.email, ''),
          'actorRole', actor.role,
          'requiredFeature', 'parentEmails',
          'visibleInEmailQueue', true,
          'communicationLog', jsonb_build_object(
            'clubId', event_record.club_id,
            'playerId', recipient.player_id,
            'userId', actor.id,
            'userName', coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), ''),
            'userEmail', coalesce(actor.email, ''),
            'recipientEmail', recipient.recipient_email,
            'metadata', jsonb_build_object(
              'source', 'calendar_event_notification',
              'calendarEventId', event_record.id,
              'eventRevision', event_record.notification_revision,
              'notificationType', normalized_action,
              'idempotencyKey', idempotency_key_value,
              'subject', subject_value,
              'body', html_value,
              'scheduledAt', timezone('utc', now()) + interval '10 minutes'
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
    exception
      when others then
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

  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    event_record.club_id,
    actor.id,
    'calendar_event_parent_notification_requested',
    'calendar_event',
    event_record.id,
    jsonb_build_object(
      'eventRevision', event_record.notification_revision,
      'notificationType', normalized_action,
      'eventActionType', 'informational',
      'portalCreatedCount', portal_created_count,
      'portalUpdatedCount', portal_updated_count,
      'responseRequirement', 'informational',
      'eligibleRecipientCount', eligible_recipient_count,
      'queuedCount', queued_count,
      'failedCount', failed_count,
      'duplicateCount', duplicate_count,
      'idempotencyPrefix', concat('calendar-event:', event_record.id, ':revision:', event_record.notification_revision),
      'finalState', case
        when failed_count > 0 then 'portal_ready_email_partial'
        when eligible_recipient_count = 0 then 'portal_ready_no_eligible_email'
        else 'portal_ready_email_queued'
      end
    )
  );

  return jsonb_build_object(
    'eventId', event_record.id,
    'eventRevision', event_record.notification_revision,
    'notificationType', normalized_action,
    'eventActionType', 'informational',
    'portalState', 'ready',
    'portalCreatedCount', portal_created_count,
    'portalUpdatedCount', portal_updated_count,
    'portalRecordCount', selected_player_count,
    'responseRequirement', 'informational',
    'eligibleRecipientCount', eligible_recipient_count,
    'queuedCount', queued_count,
    'failedCount', failed_count,
    'duplicateCount', duplicate_count,
    'idempotencyPrefix', concat('calendar-event:', event_record.id, ':revision:', event_record.notification_revision),
    'finalState', case
      when failed_count > 0 then 'portal_ready_email_partial'
      when eligible_recipient_count = 0 then 'portal_ready_no_eligible_email'
      else 'portal_ready_email_queued'
    end
  );
end;
$$;

revoke all on function public.notify_calendar_event_parents(uuid, text, uuid[]) from public;
revoke execute on function public.notify_calendar_event_parents(uuid, text, uuid[]) from anon;
grant execute on function public.notify_calendar_event_parents(uuid, text, uuid[]) to authenticated, service_role;

comment on function public.notify_calendar_event_parents(uuid, text, uuid[]) is
  'Authoritative Calendar notify command. Verifies staff scope, maintains informational Parent Portal state, resolves active guardians server-side, and queues revision-aware creation or update email alerts.';
