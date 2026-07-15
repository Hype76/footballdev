alter table public.match_days
  add column if not exists notification_revision bigint not null default 1;

create or replace function public.set_match_day_notification_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    new.team_id,
    new.opponent,
    new.match_date,
    new.kickoff_time,
    new.kickoff_time_tbc,
    new.arrival_time,
    new.venue_name,
    new.venue_address,
    new.notes,
    new.status,
    new.parent_visible,
    new.parent_audience
  ) is distinct from row(
    old.team_id,
    old.opponent,
    old.match_date,
    old.kickoff_time,
    old.kickoff_time_tbc,
    old.arrival_time,
    old.venue_name,
    old.venue_address,
    old.notes,
    old.status,
    old.parent_visible,
    old.parent_audience
  ) then
    new.notification_revision = old.notification_revision + 1;
  else
    new.notification_revision = old.notification_revision;
  end if;

  return new;
end;
$$;

drop trigger if exists match_days_set_notification_revision on public.match_days;
create trigger match_days_set_notification_revision
before update on public.match_days
for each row
execute function public.set_match_day_notification_revision();

revoke all on function public.set_match_day_notification_revision() from public, anon, authenticated;
grant execute on function public.set_match_day_notification_revision() to service_role;

alter table public.calendar_event_invites
  add column if not exists match_day_id uuid references public.match_days (id) on delete cascade,
  add column if not exists response_requirement text not null default 'response_required';

alter table public.calendar_event_invites
  drop constraint if exists calendar_event_invites_source_check,
  drop constraint if exists calendar_event_invites_response_requirement_check;

alter table public.calendar_event_invites
  add constraint calendar_event_invites_source_check check (
    num_nonnulls(calendar_event_id, assessment_session_id, match_day_id) = 1
  ),
  add constraint calendar_event_invites_response_requirement_check check (
    response_requirement in ('informational', 'response_required')
  );

drop index if exists public.calendar_event_invites_source_player_key;
create unique index calendar_event_invites_source_player_key
on public.calendar_event_invites (
  club_id,
  player_id,
  calendar_event_id,
  assessment_session_id,
  match_day_id
) nulls not distinct;

create index if not exists calendar_event_invites_match_day_idx
on public.calendar_event_invites (match_day_id, player_id, invite_status);

create table if not exists public.calendar_event_notification_commands (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  calendar_event_id uuid references public.calendar_events (id) on delete set null,
  match_day_id uuid references public.match_days (id) on delete set null,
  event_revision bigint not null,
  notification_type text not null,
  request_token uuid not null,
  player_ids uuid[] not null default '{}'::uuid[],
  requested_by uuid references public.users (id) on delete set null,
  result jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  constraint calendar_event_notification_commands_source_check check (
    not (calendar_event_id is not null and match_day_id is not null)
  ),
  constraint calendar_event_notification_commands_type_check check (
    notification_type in ('creation', 'update')
  )
);

create unique index if not exists calendar_event_notification_commands_request_key
on public.calendar_event_notification_commands (
  requested_by,
  coalesce(calendar_event_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(match_day_id, '00000000-0000-0000-0000-000000000000'::uuid),
  request_token
);

create index if not exists calendar_event_notification_commands_source_idx
on public.calendar_event_notification_commands (
  coalesce(calendar_event_id, match_day_id),
  event_revision,
  created_at desc
);

alter table public.calendar_event_notification_commands enable row level security;
revoke all privileges on table public.calendar_event_notification_commands from public, anon, authenticated;
grant select, insert, update, delete on table public.calendar_event_notification_commands to service_role;

alter table public.calendar_event_notification_events
  add column if not exists match_day_id uuid references public.match_days (id) on delete set null,
  add column if not exists notification_command_id uuid references public.calendar_event_notification_commands (id) on delete set null;

drop index if exists public.calendar_event_notification_events_revision_recipient_key;
create unique index if not exists calendar_event_notification_events_command_recipient_key
on public.calendar_event_notification_events (notification_command_id, lower(recipient_email))
where notification_command_id is not null;

create index if not exists calendar_event_notification_events_match_day_status_idx
on public.calendar_event_notification_events (match_day_id, event_revision, status, requested_at desc);

drop function if exists public.notify_calendar_event_parents(uuid, text, uuid[]);

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
  actor public.users%rowtype;
  source_kind text;
  source_id uuid;
  club_id_value uuid;
  team_id_value uuid;
  title_value text;
  event_type_value text;
  starts_at_value timestamptz;
  ends_at_value timestamptz;
  location_value text;
  notes_value text;
  audience_value text;
  parent_visible_value boolean;
  cancelled_value boolean;
  event_revision_value bigint;
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
  command_record public.calendar_event_notification_commands%rowtype;
  notification_record public.calendar_event_notification_events%rowtype;
  result_value jsonb;
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

  if num_nonnulls(calendar_event_id_value, match_day_id_value) <> 1 then
    raise exception 'Choose exactly one supported Calendar event source.';
  end if;

  if notification_request_token_value is null then
    raise exception 'A notification request token is required.';
  end if;

  select profile.* into actor
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

  if calendar_event_id_value is not null then
    source_kind := 'calendar';
    source_id := calendar_event_id_value;

    select event.club_id, event.team_id, event.title, event.event_type,
      event.starts_at, event.ends_at, event.location, event.notes,
      event.parent_audience, event.parent_visible, event.cancelled_at is not null,
      event.notification_revision
    into club_id_value, team_id_value, title_value, event_type_value,
      starts_at_value, ends_at_value, location_value, notes_value,
      audience_value, parent_visible_value, cancelled_value, event_revision_value
    from public.calendar_events event
    where event.id = calendar_event_id_value
      and event.club_id = actor.club_id
    for update;
  else
    source_kind := 'match-day';
    source_id := match_day_id_value;

    select fixture.club_id, fixture.team_id,
      concat('Match vs ', coalesce(nullif(fixture.opponent, ''), 'Opponent')),
      'match',
      case
        when fixture.kickoff_time_tbc is true or fixture.kickoff_time is null
          then fixture.match_date::timestamp at time zone 'Europe/London'
        else (fixture.match_date + fixture.kickoff_time)::timestamp at time zone 'Europe/London'
      end,
      case
        when fixture.kickoff_time_tbc is true or fixture.kickoff_time is null then null
        else ((fixture.match_date + fixture.kickoff_time)::timestamp + interval '2 hours') at time zone 'Europe/London'
      end,
      fixture.venue_name, fixture.notes, fixture.parent_audience, fixture.parent_visible,
      fixture.status = 'cancelled', fixture.notification_revision
    into club_id_value, team_id_value, title_value, event_type_value,
      starts_at_value, ends_at_value, location_value, notes_value,
      audience_value, parent_visible_value, cancelled_value, event_revision_value
    from public.match_days fixture
    where fixture.id = match_day_id_value
      and fixture.club_id = actor.club_id
    for update;
  end if;

  if source_id is null or club_id_value is null then
    raise exception 'Calendar event was not found in the current club.';
  end if;

  if team_id_value is null then
    raise exception 'Choose a team before notifying parents about this event.';
  end if;

  if actor.role <> 'admin' and not exists (
    select 1 from public.team_staff staff
    where staff.team_id = team_id_value and staff.user_id = actor.id
  ) then
    raise exception 'You do not have permission to notify parents for this team.';
  end if;

  if cancelled_value then
    raise exception 'Parents cannot be notified about a cancelled event.';
  end if;

  if parent_visible_value is not true
    or audience_value not in ('involved_players', 'all_team_parents') then
    raise exception 'Share this event with a supported parent audience before notifying parents.';
  end if;

  if not public.can_use_plan_feature(club_id_value, 'parentPortal')
    or not public.can_use_plan_feature(club_id_value, 'parentEmails') then
    raise exception 'The current club plan does not include Parent Portal email notifications.';
  end if;

  if audience_value = 'all_team_parents' then
    select coalesce(array_agg(player.id order by player.id), '{}'::uuid[])
    into selected_player_ids
    from public.players player
    where player.club_id = club_id_value
      and player.team_id = team_id_value
      and coalesce(player.status, 'active') <> 'archived';
  else
    select count(distinct requested_id), coalesce(array_agg(distinct requested_id order by requested_id), '{}'::uuid[])
    into requested_player_count, selected_player_ids
    from unnest(coalesce(player_ids_value, '{}'::uuid[])) requested_id;

    if requested_player_count = 0 then
      select coalesce(array_agg(invite.player_id order by invite.player_id), '{}'::uuid[])
      into selected_player_ids
      from public.calendar_event_invites invite
      where invite.club_id = club_id_value
        and invite.team_id = team_id_value
        and invite.invite_status <> 'cancelled'
        and (
          (source_kind = 'calendar' and invite.calendar_event_id = source_id)
          or (source_kind = 'match-day' and invite.match_day_id = source_id)
        );
      requested_player_count := coalesce(array_length(selected_player_ids, 1), 0);
    end if;

    if requested_player_count = 0 then
      raise exception 'Choose at least one involved player before notifying parents.';
    end if;

    select count(*) into selected_player_count
    from public.players player
    where player.id = any(selected_player_ids)
      and player.club_id = club_id_value
      and player.team_id = team_id_value
      and coalesce(player.status, 'active') <> 'archived';

    if selected_player_count <> requested_player_count then
      raise exception 'One or more selected players are outside this event team or are no longer active.';
    end if;
  end if;

  selected_player_count := coalesce(array_length(selected_player_ids, 1), 0);

  insert into public.calendar_event_notification_commands (
    club_id, team_id, calendar_event_id, match_day_id, event_revision,
    notification_type, request_token, player_ids, requested_by
  ) values (
    club_id_value, team_id_value, calendar_event_id_value, match_day_id_value,
    event_revision_value, normalized_action, notification_request_token_value,
    selected_player_ids, actor.id
  )
  on conflict do nothing
  returning * into command_record;

  if command_record.id is null then
    select command.* into command_record
    from public.calendar_event_notification_commands command
    where command.requested_by = actor.id
      and command.request_token = notification_request_token_value
      and command.calendar_event_id is not distinct from calendar_event_id_value
      and command.match_day_id is not distinct from match_day_id_value
    for update;

    if command_record.result is not null then
      return command_record.result || jsonb_build_object('duplicateCount', greatest(coalesce((command_record.result ->> 'eligibleRecipientCount')::integer, 0), 1));
    end if;

    selected_player_ids := command_record.player_ids;
    selected_player_count := coalesce(array_length(selected_player_ids, 1), 0);
  end if;

  select count(*) into existing_portal_count
  from public.calendar_event_invites invite
  where invite.player_id = any(selected_player_ids)
    and (
      (source_kind = 'calendar' and invite.calendar_event_id = source_id)
      or (source_kind = 'match-day' and invite.match_day_id = source_id)
    );

  update public.calendar_event_invites invite
  set invite_status = 'cancelled',
      cancelled_at = coalesce(invite.cancelled_at, timezone('utc', now())),
      updated_by = actor.id,
      updated_by_name = coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), actor.email, ''),
      updated_by_email = coalesce(actor.email, '')
  where invite.club_id = club_id_value
    and invite.player_id <> all(selected_player_ids)
    and invite.invite_status <> 'cancelled'
    and (
      (source_kind = 'calendar' and invite.calendar_event_id = source_id)
      or (source_kind = 'match-day' and invite.match_day_id = source_id)
    );

  insert into public.calendar_event_invites (
    club_id, team_id, calendar_event_id, assessment_session_id, match_day_id,
    player_id, parent_link_id, player_status_at_invite, recipient_type,
    parent_contact_name, parent_contact_email, player_contact_email,
    recipient_contacts, invite_status, notify_requested, response_requirement,
    cancelled_at, created_by, created_by_name, created_by_email,
    updated_by, updated_by_name, updated_by_email
  )
  select
    club_id_value, team_id_value, calendar_event_id_value, null, match_day_id_value,
    player.id, primary_link.id, coalesce(player.section, ''), 'parent_guardian',
    coalesce(nullif(primary_parent.display_name, ''), nullif(primary_parent.name, ''), ''),
    coalesce(primary_link.email, ''), '', '[]'::jsonb, 'active', true, 'informational',
    null, actor.id,
    coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), actor.email, ''),
    coalesce(actor.email, ''), actor.id,
    coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), actor.email, ''),
    coalesce(actor.email, '')
  from public.players player
  left join lateral (
    select link.* from public.parent_player_links link
    where link.club_id = club_id_value
      and link.team_id = team_id_value
      and link.player_id = player.id
      and link.status = 'active'
    order by link.created_at, link.id
    limit 1
  ) primary_link on true
  left join public.users primary_parent on primary_parent.id = primary_link.auth_user_id
  where player.id = any(selected_player_ids)
  on conflict (club_id, player_id, calendar_event_id, assessment_session_id, match_day_id) do update
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
      response_requirement = 'informational',
      cancelled_at = null,
      updated_by = excluded.updated_by,
      updated_by_name = excluded.updated_by_name,
      updated_by_email = excluded.updated_by_email;

  portal_updated_count := least(existing_portal_count, selected_player_count);
  portal_created_count := greatest(selected_player_count - existing_portal_count, 0);

  select coalesce(club.name, ''), coalesce(team.name, '')
  into club_name_value, team_name_value
  from public.clubs club
  join public.teams team on team.id = team_id_value
  where club.id = club_id_value;

  subject_value := case normalized_action
    when 'creation' then concat('New event added: ', title_value)
    else concat('Event details updated: ', title_value)
  end;

  select count(*) into eligible_recipient_count
  from (
    select distinct lower(btrim(link.email)) as recipient_email
    from public.parent_player_links link
    where link.club_id = club_id_value
      and link.team_id = team_id_value
      and link.player_id = any(selected_player_ids)
      and link.status = 'active'
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
    join public.players player on player.id = link.player_id
      and player.club_id = link.club_id and player.team_id = link.team_id
    left join public.users parent_profile on parent_profile.id = link.auth_user_id
    where link.club_id = club_id_value
      and link.team_id = team_id_value
      and link.player_id = any(selected_player_ids)
      and link.status = 'active'
      and btrim(coalesce(link.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
    order by lower(btrim(link.email)), link.created_at, link.id
  loop
    parent_portal_url := concat(
      'https://parent.footballplayer.online/parent-portal?section=calendar&eventId=',
      source_id, '&parentLinkId=', recipient.parent_link_id
    );
    idempotency_key_value := concat(
      'calendar-notify-command:', command_record.id, ':', recipient.recipient_email
    );

    insert into public.calendar_event_notification_events (
      club_id, team_id, calendar_event_id, match_day_id, notification_command_id,
      event_revision, notification_type, event_action_type, parent_link_id,
      player_id, recipient_email, idempotency_key, portal_state,
      response_requirement, status, requested_by
    ) values (
      club_id_value, team_id_value, calendar_event_id_value, match_day_id_value,
      command_record.id, event_revision_value, normalized_action, 'informational',
      recipient.parent_link_id, recipient.player_id, recipient.recipient_email,
      idempotency_key_value, 'ready', 'informational', 'pending', actor.id
    )
    on conflict (notification_command_id, lower(recipient_email))
      where notification_command_id is not null do nothing
    returning * into notification_record;

    if notification_record.id is null then
      duplicate_count := duplicate_count + 1;
      continue;
    end if;

    html_value := concat(
      '<div style="font-family:Arial,sans-serif;color:#142018;background:#ffffff;padding:28px;line-height:1.55;max-width:720px;margin:0 auto;">',
      '<p style="margin:0 0 10px;color:#4f6552;font-size:12px;font-weight:700;text-transform:uppercase;">',
      case normalized_action when 'creation' then 'New event added' else 'Event details updated' end,
      '</p><h1 style="margin:0 0 14px;font-size:24px;">',
      public.calendar_event_notification_escape_html(coalesce(title_value, 'Club event')),
      '</h1><p style="margin:0 0 18px;font-size:15px;">Hi ',
      public.calendar_event_notification_escape_html(recipient.parent_name),
      ', the latest details for ',
      public.calendar_event_notification_escape_html(recipient.player_name),
      ' are available in the Parent Portal.</p>',
      '<div style="border:1px solid #e7ece3;border-radius:12px;background:#fbfcf9;padding:14px 16px;margin:0 0 20px;">',
      '<p><strong>Team:</strong> ', public.calendar_event_notification_escape_html(coalesce(team_name_value, 'Team')), '</p>',
      '<p><strong>Type:</strong> ', public.calendar_event_notification_escape_html(coalesce(event_type_value, 'general')), '</p>',
      '<p><strong>Starts:</strong> ', public.calendar_event_notification_escape_html(to_char(starts_at_value at time zone 'Europe/London', 'Dy DD Mon YYYY at HH24:MI')), '</p>',
      case when ends_at_value is null then '' else concat(
        '<p><strong>Ends:</strong> ', public.calendar_event_notification_escape_html(to_char(ends_at_value at time zone 'Europe/London', 'Dy DD Mon YYYY at HH24:MI')), '</p>'
      ) end,
      case when btrim(coalesce(location_value, '')) = '' then '' else concat(
        '<p><strong>Venue:</strong> ', public.calendar_event_notification_escape_html(location_value), '</p>'
      ) end,
      case when btrim(coalesce(notes_value, '')) = '' then '' else concat(
        '<p><strong>Notes:</strong> ', public.calendar_event_notification_escape_html(notes_value), '</p>'
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
        club_id, team_id, created_by, created_by_email, to_email,
        subject, status, scheduled_at, payload
      ) values (
        club_id_value, team_id_value, actor.id, coalesce(actor.email, ''),
        recipient.recipient_email, subject_value, 'scheduled',
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
          'clubId', club_id_value,
          'teamId', team_id_value,
          'actorId', actor.id,
          'actorEmail', coalesce(actor.email, ''),
          'actorRole', actor.role,
          'requiredFeature', 'parentEmails',
          'visibleInEmailQueue', true,
          'communicationLog', jsonb_build_object(
            'clubId', club_id_value,
            'playerId', recipient.player_id,
            'userId', actor.id,
            'userName', coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), ''),
            'userEmail', coalesce(actor.email, ''),
            'recipientEmail', recipient.recipient_email,
            'metadata', jsonb_build_object(
              'source', 'calendar_event_notification',
              'eventSource', source_kind,
              'calendarEventId', calendar_event_id_value,
              'matchDayId', match_day_id_value,
              'eventRevision', event_revision_value,
              'notificationCommandId', command_record.id,
              'notificationType', normalized_action,
              'idempotencyKey', idempotency_key_value,
              'subject', subject_value,
              'body', html_value,
              'scheduledAt', timezone('utc', now()) + interval '10 minutes'
            )
          )
        )
      ) returning id into queue_id_value;

      update public.calendar_event_notification_events notification
      set status = 'queued', email_queue_id = queue_id_value, last_error = null,
          updated_at = timezone('utc', now())
      where notification.id = notification_record.id;
      queued_count := queued_count + 1;
    exception when others then
      update public.calendar_event_notification_events notification
      set status = 'failed', last_error = left(sqlerrm, 1000),
          updated_at = timezone('utc', now())
      where notification.id = notification_record.id;
      failed_count := failed_count + 1;
    end;

    notification_record := null;
    queue_id_value := null;
  end loop;

  result_value := jsonb_build_object(
    'eventId', source_id,
    'eventSource', source_kind,
    'eventRevision', event_revision_value,
    'notificationCommandId', command_record.id,
    'notificationType', normalized_action,
    'eventActionType', 'informational',
    'portalState', case when selected_player_count = 0 then 'empty' else 'ready' end,
    'portalCreatedCount', portal_created_count,
    'portalUpdatedCount', portal_updated_count,
    'portalRecordCount', selected_player_count,
    'responseRequirement', 'informational',
    'eligibleRecipientCount', eligible_recipient_count,
    'queuedCount', queued_count,
    'failedCount', failed_count,
    'duplicateCount', duplicate_count,
    'idempotencyPrefix', concat('calendar-notify-command:', command_record.id),
    'finalState', case
      when selected_player_count = 0 then 'no_parent_scope'
      when failed_count > 0 then 'portal_ready_email_partial'
      when eligible_recipient_count = 0 then 'portal_ready_no_eligible_email'
      else 'portal_ready_email_queued'
    end
  );

  update public.calendar_event_notification_commands command
  set result = result_value, completed_at = timezone('utc', now())
  where command.id = command_record.id;

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    club_id_value, actor.id, 'calendar_event_parent_notification_requested',
    case source_kind when 'match-day' then 'match_day' else 'calendar_event' end,
    source_id,
    jsonb_build_object(
      'eventSource', source_kind,
      'eventRevision', event_revision_value,
      'notificationCommandId', command_record.id,
      'notificationType', normalized_action,
      'eventActionType', 'informational',
      'portalCreatedCount', portal_created_count,
      'portalUpdatedCount', portal_updated_count,
      'responseRequirement', 'informational',
      'eligibleRecipientCount', eligible_recipient_count,
      'queuedCount', queued_count,
      'failedCount', failed_count,
      'duplicateCount', duplicate_count,
      'finalState', result_value ->> 'finalState'
    )
  );

  return result_value;
end;
$$;

revoke all on function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[]) from public;
revoke execute on function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[]) from anon;
grant execute on function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[]) to authenticated, service_role;

comment on function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[]) is
  'Server-authoritative Calendar notification command for Calendar events and Match Day items. The browser token correlates retries only; the database generates the durable command identity and resolves authority, audience, Portal scope, and email recipients.';

alter function public.get_parent_portal_match_days(uuid)
  rename to get_parent_portal_match_days_calendar_notify_hotfix_legacy;

revoke all on function public.get_parent_portal_match_days_calendar_notify_hotfix_legacy(uuid) from public;
revoke execute on function public.get_parent_portal_match_days_calendar_notify_hotfix_legacy(uuid) from anon, authenticated;

create function public.get_parent_portal_match_days(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  team_name text,
  opponent text,
  match_date date,
  kickoff_time time,
  kickoff_time_tbc boolean,
  arrival_time time,
  home_away text,
  venue_name text,
  venue_address text,
  notes text,
  scorer_request_message text,
  request_scorer boolean,
  request_linesman boolean,
  request_referee boolean,
  status text,
  home_score integer,
  away_score integer,
  created_at timestamptz,
  updated_at timestamptz,
  phase_started_at timestamptz,
  timer_started_at timestamptz,
  timer_paused_at timestamptz,
  timer_elapsed_seconds integer,
  timer_status text,
  availability_status text,
  availability_responded_at timestamptz,
  squad_decision_state text,
  squad_decision_updated_at timestamptz,
  volunteer_scorer_response text,
  volunteer_linesman_response text,
  volunteer_referee_response text,
  volunteer_responded_at timestamptz,
  has_interest boolean,
  is_scorer boolean,
  role_assignments jsonb,
  events jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with authorised_link as (
    select link.*
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = (select auth.uid())
      and link.status = 'active'
    limit 1
  ), legacy as (
    select *
    from public.get_parent_portal_match_days_calendar_notify_hotfix_legacy(parent_link_id_value)
  )
  select * from legacy
  union all
  select
    fixture.id,
    fixture.club_id,
    fixture.team_id,
    coalesce(team.name, ''),
    fixture.opponent,
    fixture.match_date,
    fixture.kickoff_time,
    fixture.kickoff_time_tbc,
    fixture.arrival_time,
    fixture.home_away,
    fixture.venue_name,
    fixture.venue_address,
    fixture.notes,
    fixture.scorer_request_message,
    fixture.request_scorer,
    fixture.request_linesman,
    fixture.request_referee,
    fixture.status,
    fixture.home_score,
    fixture.away_score,
    fixture.created_at,
    fixture.updated_at,
    fixture.phase_started_at,
    fixture.timer_started_at,
    fixture.timer_paused_at,
    fixture.timer_elapsed_seconds,
    fixture.timer_status,
    null::text,
    null::timestamptz,
    coalesce(decision.status, 'undecided'),
    decision.updated_at,
    'no_response'::text,
    'no_response'::text,
    'no_response'::text,
    null::timestamptz,
    false,
    false,
    '[]'::jsonb,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', event.id,
          'eventType', event.event_type,
          'teamSide', event.team_side,
          'minute', event.minute,
          'scorerName', event.scorer_name,
          'scorerInitials', event.scorer_initials,
          'scorerShirtNumber', event.scorer_shirt_number,
          'assistName', event.assist_name,
          'assistInitials', event.assist_initials,
          'assistShirtNumber', event.assist_shirt_number,
          'homeScore', event.home_score,
          'awayScore', event.away_score,
          'notes', event.notes,
          'createdByName', event.created_by_name,
          'createdAt', event.created_at
        ) order by event.created_at desc
      )
      from public.match_day_events event
      where event.match_day_id = fixture.id
    ), '[]'::jsonb)
  from public.match_days fixture
  join authorised_link link
    on link.club_id = fixture.club_id
    and link.team_id = fixture.team_id
  join public.teams team on team.id = fixture.team_id
  join public.calendar_event_invites invite
    on invite.match_day_id = fixture.id
    and invite.club_id = fixture.club_id
    and invite.team_id = fixture.team_id
    and invite.player_id = link.player_id
    and invite.invite_status <> 'cancelled'
    and invite.response_requirement = 'informational'
  left join public.match_day_player_squad_decisions decision
    on decision.match_day_id = fixture.id
    and decision.club_id = fixture.club_id
    and decision.team_id = fixture.team_id
    and decision.player_id = link.player_id
  where fixture.parent_visible is true
    and fixture.parent_audience = 'involved_players'
    and fixture.status in ('scorer_request', 'live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time', 'scheduled')
    and fixture.previous_hidden_at is null
    and (fixture.match_date is null or fixture.match_date >= (timezone('Europe/London', now())::date - 365))
    and not exists (select 1 from legacy where legacy.id = fixture.id)
  order by match_date asc nulls last, kickoff_time asc nulls last, created_at desc;
$$;

revoke all on function public.get_parent_portal_match_days(uuid) from public;
revoke execute on function public.get_parent_portal_match_days(uuid) from anon;
grant execute on function public.get_parent_portal_match_days(uuid) to authenticated, service_role;

comment on function public.get_parent_portal_match_days(uuid) is
  'Returns authorised Match Day Calendar items, including informational involved-player visibility created by the Calendar notification command without creating an availability request.';
