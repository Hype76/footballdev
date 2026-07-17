create function public.reconcile_match_day_calendar_actions_internal(
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
  fixture public.match_days%rowtype;
  authoritative_player_count integer := 0;
  eligible_request_count integer := 0;
  existing_request_count integer := 0;
  created_request_count integer := 0;
  preserved_request_count integer := 0;
  closed_request_count integer := 0;
  missing_player_link_count integer := 0;
  configured_role_count integer := 0;
  open_role_count integer := 0;
  accepted_assignment_count integer := 0;
  volunteer_created_count integer := 0;
  volunteer_preserved_count integer := 0;
  result_value jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to create Match Day parent actions.';
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
    raise exception 'Coach or manager access is required to create Match Day parent actions.';
  end if;

  select command.* into command_record
  from public.calendar_event_notification_commands command
  where command.id = notification_command_id_value
    and command.requested_by = actor.id
    and command.club_id = actor.club_id
    and command.match_day_id is not null
  for update;

  if command_record.id is null then
    raise exception 'The Match Day notification command was not found for this account.';
  end if;

  if command_record.result ? 'actionReconciliationState' then
    return command_record.result;
  end if;

  select match.* into fixture
  from public.match_days match
  where match.id = command_record.match_day_id
    and match.club_id = command_record.club_id
    and match.team_id = command_record.team_id
  for update;

  if fixture.id is null then
    raise exception 'The Match Day fixture was not found in the notification command scope.';
  end if;

  if fixture.status = 'cancelled' then
    raise exception 'Cancelled fixtures cannot create active parent actions.';
  end if;

  if actor.role <> 'admin' and not exists (
    select 1
    from public.team_staff staff
    where staff.team_id = fixture.team_id
      and staff.user_id = actor.id
  ) then
    raise exception 'You do not have permission to create parent actions for this team.';
  end if;

  select count(*) into authoritative_player_count
  from public.players player
  where player.id = any(command_record.player_ids)
    and player.club_id = fixture.club_id
    and player.team_id = fixture.team_id
    and coalesce(player.status, 'active') <> 'archived';

  if authoritative_player_count <> coalesce(array_length(command_record.player_ids, 1), 0) then
    raise exception 'The saved notification scope includes a player outside this active Match Day team.';
  end if;

  select count(*) into eligible_request_count
  from public.parent_player_links link
  join public.players player
    on player.id = link.player_id
    and player.club_id = link.club_id
    and player.team_id = link.team_id
  where link.club_id = fixture.club_id
    and link.team_id = fixture.team_id
    and link.player_id = any(command_record.player_ids)
    and link.status = 'active'
    and btrim(coalesce(link.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$';

  select count(*) into missing_player_link_count
  from unnest(command_record.player_ids) selected_player_id
  where not exists (
    select 1
    from public.parent_player_links link
    where link.club_id = fixture.club_id
      and link.team_id = fixture.team_id
      and link.player_id = selected_player_id
      and link.status = 'active'
      and btrim(coalesce(link.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  );

  select count(*) into existing_request_count
  from public.match_day_availability_requests request
  join public.parent_player_links link
    on link.club_id = request.club_id
    and link.team_id = request.team_id
    and link.player_id = request.player_id
    and lower(btrim(link.email)) = lower(btrim(request.recipient_email))
  where request.match_day_id = fixture.id
    and request.club_id = fixture.club_id
    and request.team_id = fixture.team_id
    and request.player_id = any(command_record.player_ids)
    and request.recipient_type = 'parent'
    and request.channel = 'email'
    and link.status = 'active'
    and lower(btrim(request.recipient_email)) = lower(btrim(link.email));

  insert into public.match_day_availability_requests (
    match_day_id, club_id, team_id, player_id, player_name,
    recipient_email, recipient_name, recipient_type, parent_link_id,
    channel, token_hash, status, expires_at, created_by, created_by_name
  )
  select
    fixture.id, fixture.club_id, fixture.team_id, player.id,
    coalesce(player.player_name, ''), lower(btrim(link.email)),
    coalesce(nullif(parent_profile.display_name, ''), nullif(parent_profile.name, ''), 'Parent or guardian'),
    'parent', link.id, 'email',
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    'pending',
    greatest(
      timezone('utc', now()) + interval '1 day',
      (fixture.match_date + 2)::timestamp at time zone 'Europe/London'
    ),
    actor.id,
    coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), actor.email, '')
  from public.parent_player_links link
  join public.players player
    on player.id = link.player_id
    and player.club_id = link.club_id
    and player.team_id = link.team_id
  left join public.users parent_profile on parent_profile.id = link.auth_user_id
  where link.club_id = fixture.club_id
    and link.team_id = fixture.team_id
    and link.player_id = any(command_record.player_ids)
    and link.status = 'active'
    and btrim(coalesce(link.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  on conflict (match_day_id, player_id, recipient_email, recipient_type, channel)
  do update set
    parent_link_id = excluded.parent_link_id,
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    player_name = excluded.player_name,
    recipient_name = excluded.recipient_name,
    expires_at = case
      when public.match_day_availability_requests.status = 'pending'
        then greatest(public.match_day_availability_requests.expires_at, excluded.expires_at)
      else public.match_day_availability_requests.expires_at
    end,
    updated_at = timezone('utc', now());

  created_request_count := greatest(eligible_request_count - existing_request_count, 0);
  preserved_request_count := least(existing_request_count, eligible_request_count);

  update public.match_day_availability_requests request
  set status = 'expired',
      updated_at = timezone('utc', now())
  where request.match_day_id = fixture.id
    and request.club_id = fixture.club_id
    and request.team_id = fixture.team_id
    and request.status = 'pending'
    and not exists (
      select 1
      from public.parent_player_links link
      where link.id = request.parent_link_id
        and link.club_id = fixture.club_id
        and link.team_id = fixture.team_id
        and link.player_id = request.player_id
        and link.status = 'active'
        and link.player_id = any(command_record.player_ids)
        and lower(btrim(link.email)) = lower(btrim(request.recipient_email))
    );
  get diagnostics closed_request_count = row_count;

  configured_role_count :=
    (case when coalesce(fixture.request_scorer, false) then 1 else 0 end) +
    (case when coalesce(fixture.request_linesman, false) then 1 else 0 end) +
    (case when coalesce(fixture.request_referee, false) then 1 else 0 end);

  select count(*) into accepted_assignment_count
  from public.match_day_role_assignments assignment
  where assignment.match_day_id = fixture.id
    and assignment.club_id = fixture.club_id
    and assignment.team_id = fixture.team_id
    and (
      (assignment.role = 'scorer' and fixture.request_scorer is true)
      or (assignment.role = 'linesman' and fixture.request_linesman is true)
      or (assignment.role = 'referee' and fixture.request_referee is true)
    );

  open_role_count := greatest(configured_role_count - accepted_assignment_count, 0);
  volunteer_created_count := created_request_count * open_role_count;
  volunteer_preserved_count := preserved_request_count * open_role_count;

  result_value := coalesce(command_record.result, '{}'::jsonb) || jsonb_build_object(
    'eventActionType', 'match_day_action_required',
    'responseRequirement', 'response_required',
    'actionReconciliationState', 'ready',
    'authoritativePlayerCount', authoritative_player_count,
    'actionablePlayerCount', authoritative_player_count - missing_player_link_count,
    'missingPlayerLinkCount', missing_player_link_count,
    'playerRequestCreatedCount', created_request_count,
    'playerRequestPreservedCount', preserved_request_count,
    'playerRequestClosedCount', closed_request_count,
    'volunteerConfiguredRoleCount', configured_role_count,
    'volunteerOpenRoleCount', open_role_count,
    'volunteerRequestCreatedCount', volunteer_created_count,
    'volunteerRequestPreservedCount', volunteer_preserved_count,
    'volunteerRequestClosedCount', 0,
    'acceptedVolunteerAssignmentCount', accepted_assignment_count
  );

  update public.calendar_event_notification_commands command
  set result = result_value,
      completed_at = timezone('utc', now())
  where command.id = command_record.id;

  update public.calendar_event_notification_events notification
  set event_action_type = 'match_day_action_required',
      response_requirement = 'response_required',
      updated_at = timezone('utc', now())
  where notification.notification_command_id = command_record.id;

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    fixture.club_id, actor.id, 'match_day_calendar_parent_actions_reconciled',
    'match_day', fixture.id,
    jsonb_build_object(
      'notificationCommandId', command_record.id,
      'eventRevision', command_record.event_revision,
      'authoritativePlayerCount', authoritative_player_count,
      'missingPlayerLinkCount', missing_player_link_count,
      'playerRequestCreatedCount', created_request_count,
      'playerRequestPreservedCount', preserved_request_count,
      'playerRequestClosedCount', closed_request_count,
      'volunteerConfiguredRoleCount', configured_role_count,
      'volunteerRequestCreatedCount', volunteer_created_count,
      'volunteerRequestPreservedCount', volunteer_preserved_count,
      'acceptedVolunteerAssignmentCount', accepted_assignment_count,
      'eligibleRecipientCount', coalesce((result_value ->> 'eligibleRecipientCount')::integer, 0),
      'failureCategory', null
    )
  );

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, new_value, metadata
  ) values (
    fixture.club_id, fixture.team_id, fixture.id, actor.id,
    coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), actor.email, ''),
    actor.role, 'invite_prepared', 'Calendar parent actions reconciled',
    jsonb_build_object('state', 'ready'),
    jsonb_build_object(
      'source', 'calendar_notification_command',
      'notificationCommandId', command_record.id,
      'authoritativePlayerCount', authoritative_player_count,
      'playerRequestCreatedCount', created_request_count,
      'playerRequestPreservedCount', preserved_request_count,
      'playerRequestClosedCount', closed_request_count,
      'volunteerConfiguredRoleCount', configured_role_count,
      'volunteerRequestCreatedCount', volunteer_created_count,
      'volunteerRequestPreservedCount', volunteer_preserved_count
    )
  );

  return result_value;
end;
$$;

revoke all on function public.reconcile_match_day_calendar_actions_internal(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_match_day_calendar_actions_internal(uuid) to service_role;

comment on function public.reconcile_match_day_calendar_actions_internal(uuid) is
  'Privately reconciles existing Match Day availability and volunteer action state from a durable Calendar notification command without resetting responses or assignments.';

create function public.prepare_match_day_calendar_action_email_internal(
  notification_command_id_value uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  command_record public.calendar_event_notification_commands%rowtype;
  fixture public.match_days%rowtype;
  team_name_value text := '';
  club_name_value text := '';
  role_label_value text := '';
  subject_value text;
  parent_portal_url text;
  response_label text;
  html_value text;
  notification record;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to prepare Match Day action email.';
  end if;

  select profile.* into actor
  from public.users profile
  where profile.id = auth.uid()
  limit 1;

  select command.* into command_record
  from public.calendar_event_notification_commands command
  where command.id = notification_command_id_value
    and command.requested_by = actor.id
    and command.club_id = actor.club_id
    and command.match_day_id is not null;

  if command_record.id is null then
    raise exception 'The Match Day notification command was not found for email preparation.';
  end if;

  select match.* into fixture
  from public.match_days match
  where match.id = command_record.match_day_id
    and match.club_id = command_record.club_id
    and match.team_id = command_record.team_id;

  if fixture.id is null then
    raise exception 'The Match Day fixture was not found for email preparation.';
  end if;

  select coalesce(team.name, ''), coalesce(club.name, '')
  into team_name_value, club_name_value
  from public.teams team
  join public.clubs club on club.id = fixture.club_id
  where team.id = fixture.team_id;

  select string_agg(role_name, ', ' order by role_order)
  into role_label_value
  from (
    values
      ('Scorer'::text, 1, fixture.request_scorer is true and not exists (
        select 1 from public.match_day_role_assignments assignment
        where assignment.match_day_id = fixture.id and assignment.role = 'scorer'
      )),
      ('Linesman'::text, 2, fixture.request_linesman is true and not exists (
        select 1 from public.match_day_role_assignments assignment
        where assignment.match_day_id = fixture.id and assignment.role = 'linesman'
      )),
      ('Referee'::text, 3, fixture.request_referee is true and not exists (
        select 1 from public.match_day_role_assignments assignment
        where assignment.match_day_id = fixture.id and assignment.role = 'referee'
      ))
  ) roles(role_name, role_order, is_open)
  where is_open;

  subject_value := concat('Action required: ', team_name_value, ' vs ', coalesce(nullif(fixture.opponent, ''), 'Opponent'));

  for notification in
    select event.id, event.email_queue_id, event.parent_link_id,
      coalesce(nullif(parent_profile.display_name, ''), nullif(parent_profile.name, ''), 'Parent or guardian') as parent_name,
      coalesce(nullif(player.player_name, ''), 'your child') as player_name
    from public.calendar_event_notification_events event
    join public.parent_player_links link on link.id = event.parent_link_id
    join public.players player on player.id = event.player_id
    left join public.users parent_profile on parent_profile.id = link.auth_user_id
    where event.notification_command_id = command_record.id
      and event.email_queue_id is not null
      and event.club_id = fixture.club_id
      and event.team_id = fixture.team_id
      and link.status = 'active'
  loop
    parent_portal_url := concat(
      'https://parent.footballplayer.online/parent-portal?section=invites&eventId=',
      fixture.id, '&parentLinkId=', notification.parent_link_id
    );
    response_label := case
      when btrim(coalesce(role_label_value, '')) = ''
        then 'Please confirm player availability in the Parent Portal.'
      else concat('Please confirm player availability. Volunteer opportunities: ', role_label_value, '.')
    end;

    html_value := concat(
      '<div style="font-family:Arial,sans-serif;color:#142018;background:#ffffff;padding:28px;line-height:1.55;max-width:720px;margin:0 auto;">',
      '<p style="margin:0 0 10px;color:#4f6552;font-size:12px;font-weight:700;text-transform:uppercase;">Action required</p>',
      '<h1 style="margin:0 0 14px;font-size:24px;">Match Day response needed</h1>',
      '<p style="margin:0 0 18px;font-size:15px;">Hi ',
      public.calendar_event_notification_escape_html(notification.parent_name),
      ', please review and respond for ',
      public.calendar_event_notification_escape_html(notification.player_name),
      ' in the Parent Portal.</p>',
      '<div style="border:1px solid #e7ece3;border-radius:12px;background:#fbfcf9;padding:14px 16px;margin:0 0 20px;">',
      '<p><strong>Child:</strong> ', public.calendar_event_notification_escape_html(notification.player_name), '</p>',
      '<p><strong>Team:</strong> ', public.calendar_event_notification_escape_html(team_name_value), '</p>',
      '<p><strong>Opponent:</strong> ', public.calendar_event_notification_escape_html(coalesce(nullif(fixture.opponent, ''), 'Opponent')), '</p>',
      '<p><strong>Date:</strong> ', public.calendar_event_notification_escape_html(to_char(fixture.match_date, 'Dy DD Mon YYYY')), '</p>',
      '<p><strong>Kickoff:</strong> ', case when fixture.kickoff_time_tbc is true or fixture.kickoff_time is null then 'Time TBC' else public.calendar_event_notification_escape_html(to_char(fixture.kickoff_time, 'HH24:MI')) end, '</p>',
      '<p><strong>Meet time:</strong> ', case when fixture.arrival_time is null then 'Not set' else public.calendar_event_notification_escape_html(to_char(fixture.arrival_time, 'HH24:MI')) end, '</p>',
      '<p><strong>Venue:</strong> ', public.calendar_event_notification_escape_html(coalesce(nullif(fixture.venue_name, ''), 'Not set')), '</p>',
      '<p><strong>Response:</strong> ', public.calendar_event_notification_escape_html(response_label), '</p>',
      '</div><p style="margin:0 0 20px;"><a href="', parent_portal_url,
      '" style="display:inline-block;background:#047857;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">View and respond</a></p>',
      '<p style="margin:0;color:#5a6b5b;font-size:13px;">',
      public.calendar_event_notification_escape_html(club_name_value), ' | ',
      public.calendar_event_notification_escape_html(team_name_value),
      '</p></div>'
    );

    update public.scheduled_email_queue queue
    set subject = subject_value,
        payload = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(queue.payload, '{resendPayload,subject}', to_jsonb(subject_value), true),
              '{resendPayload,html}', to_jsonb(html_value), true
            ),
            '{communicationLog,metadata,subject}', to_jsonb(subject_value), true
          ),
          '{communicationLog,metadata,body}', to_jsonb(html_value), true
        )
    where queue.id = notification.email_queue_id
      and queue.club_id = fixture.club_id
      and queue.team_id = fixture.team_id
      and queue.status = 'scheduled';
  end loop;
end;
$$;

revoke all on function public.prepare_match_day_calendar_action_email_internal(uuid) from public, anon, authenticated;
grant execute on function public.prepare_match_day_calendar_action_email_internal(uuid) to service_role;

comment on function public.prepare_match_day_calendar_action_email_internal(uuid) is
  'Privately changes queued Match Day Calendar email units into action-required Parent Portal alerts before immediate delivery.';

create or replace function public.notify_calendar_event_parents(
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
  failure_detail text;
  command_id_value uuid;
begin
  if coalesce(array_length(player_ids_value, 1), 0) > 0 then
    raise exception 'Notification recipients are resolved from saved server-side event scope.';
  end if;

  result_value := public.notify_calendar_event_parents_authoritative_scope_internal(
    calendar_event_id_value,
    event_action_value,
    match_day_id_value,
    notification_request_token_value,
    '{}'::uuid[]
  );

  if match_day_id_value is null then
    return result_value;
  end if;

  command_id_value := (result_value ->> 'notificationCommandId')::uuid;

  if not (result_value ? 'actionReconciliationState') then
    begin
      result_value := public.reconcile_match_day_calendar_actions_internal(command_id_value);
      perform public.prepare_match_day_calendar_action_email_internal(command_id_value);
    exception when others then
      get stacked diagnostics failure_detail = message_text;

      update public.scheduled_email_queue queue
      set status = 'failed',
          payload = jsonb_set(
            jsonb_set(queue.payload, '{resendPayload,to}', '[]'::jsonb, true),
            '{calendarActionReconciliationBlocked}', 'true'::jsonb, true
          )
      where queue.id in (
        select notification.email_queue_id
        from public.calendar_event_notification_events notification
        where notification.notification_command_id = command_id_value
          and notification.email_queue_id is not null
      );

      update public.calendar_event_notification_events notification
      set status = 'failed',
          last_error = left(failure_detail, 1000),
          updated_at = timezone('utc', now())
      where notification.notification_command_id = command_id_value;

      result_value := result_value || jsonb_build_object(
        'eventActionType', 'match_day_action_required',
        'responseRequirement', 'response_required',
        'actionReconciliationState', 'failed',
        'failureCategory', 'player_request_reconciliation_failed',
        'failureDetail', left(failure_detail, 1000),
        'actionablePlayerCount', 0,
        'playerRequestCreatedCount', 0,
        'playerRequestPreservedCount', 0,
        'playerRequestClosedCount', 0,
        'volunteerRequestCreatedCount', 0,
        'volunteerRequestPreservedCount', 0,
        'volunteerRequestClosedCount', 0,
        'eligibleRecipientCount', 0,
        'queuedCount', 0,
        'finalState', 'player_request_reconciliation_failed'
      );

      update public.calendar_event_notification_commands command
      set result = result_value,
          completed_at = timezone('utc', now())
      where command.id = command_id_value;

      insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
      select command.club_id, auth.uid(), 'match_day_calendar_parent_actions_failed',
        'match_day', command.match_day_id,
        jsonb_build_object(
          'notificationCommandId', command.id,
          'eventRevision', command.event_revision,
          'authoritativePlayerCount', coalesce(array_length(command.player_ids, 1), 0),
          'playerRequestCreatedCount', 0,
          'playerRequestPreservedCount', 0,
          'playerRequestClosedCount', 0,
          'volunteerRequestCreatedCount', 0,
          'volunteerRequestPreservedCount', 0,
          'volunteerRequestClosedCount', 0,
          'eligibleRecipientCount', 0,
          'failureCategory', 'player_request_reconciliation_failed',
          'failureDetail', left(failure_detail, 1000)
        )
      from public.calendar_event_notification_commands command
      where command.id = command_id_value;
    end;
  end if;

  return result_value;
end;
$$;

revoke all on function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[]) from public;
revoke execute on function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[]) from anon;
grant execute on function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[]) to authenticated, service_role;

comment on function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[]) is
  'Runs the server-authoritative Calendar notification command. Match Day sources reconcile actionable availability and volunteer state before action-required email delivery; generic Calendar sources remain informational.';
