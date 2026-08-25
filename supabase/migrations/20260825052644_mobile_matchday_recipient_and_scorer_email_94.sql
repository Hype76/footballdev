create or replace function public.get_match_day_parent_notification_link_ids(
  match_day_id_value uuid
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct parent_link.id), array[]::uuid[])
  from public.match_days match_day
  join public.player_team_memberships membership
    on membership.club_id = match_day.club_id
   and membership.team_id = match_day.team_id
   and membership.status = 'active'
   and membership.ended_at is null
  join public.players player
    on player.id = membership.player_id
   and player.club_id = membership.club_id
   and coalesce(player.status, 'active') <> 'archived'
   and player.archived_at is null
  join public.parent_player_links parent_link
    on parent_link.club_id = match_day.club_id
   and parent_link.player_id = player.id
   and parent_link.status = 'active'
   and parent_link.auth_user_id is not null
  where match_day.id = match_day_id_value
    and match_day.deleted_at is null;
$$;

revoke all on function public.get_match_day_parent_notification_link_ids(uuid) from public, anon, authenticated;
grant execute on function public.get_match_day_parent_notification_link_ids(uuid) to service_role;

comment on function public.get_match_day_parent_notification_link_ids(uuid) is
  'Returns every installed Parent account link for active Players who belong to the Match team. Active app context and Match squad selection are intentionally not recipient filters.';

alter function public.authorize_match_day_push(uuid, uuid, uuid, text, uuid)
rename to authorize_match_day_push_before_recipient_fanout_94;

create or replace function public.authorize_match_day_push(
  actor_user_id_value uuid,
  match_day_id_value uuid,
  parent_link_id_value uuid,
  notification_type_value text,
  event_id_value uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  authorization_result jsonb;
  normalized_type text := lower(trim(coalesce(notification_type_value, '')));
begin
  authorization_result := public.authorize_match_day_push_before_recipient_fanout_94(
    actor_user_id_value,
    match_day_id_value,
    parent_link_id_value,
    normalized_type,
    event_id_value
  );

  if coalesce((authorization_result ->> 'allowed')::boolean, false)
    and normalized_type <> 'scorer_selected' then
    authorization_result := jsonb_set(
      authorization_result,
      '{targetParentLinkIds}',
      to_jsonb(public.get_match_day_parent_notification_link_ids(match_day_id_value)),
      true
    );
  end if;

  return authorization_result;
end;
$$;

revoke all on function public.authorize_match_day_push(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.authorize_match_day_push(uuid, uuid, uuid, text, uuid) to service_role;
revoke all on function public.authorize_match_day_push_before_recipient_fanout_94(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.authorize_match_day_push_before_recipient_fanout_94(uuid, uuid, uuid, text, uuid) to service_role;

alter function public.authorize_match_day_push_v2(uuid, uuid, uuid, text, uuid)
rename to authorize_match_day_push_v2_before_recipient_fanout_94;

create or replace function public.authorize_match_day_push_v2(
  actor_user_id_value uuid,
  match_day_id_value uuid,
  parent_link_id_value uuid,
  notification_type_value text,
  event_id_value uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  authorization_result jsonb;
  normalized_type text := lower(trim(coalesce(notification_type_value, '')));
begin
  authorization_result := public.authorize_match_day_push_v2_before_recipient_fanout_94(
    actor_user_id_value,
    match_day_id_value,
    parent_link_id_value,
    normalized_type,
    event_id_value
  );

  if coalesce((authorization_result ->> 'allowed')::boolean, false)
    and normalized_type <> 'scorer_selected' then
    authorization_result := jsonb_set(
      authorization_result,
      '{targetParentLinkIds}',
      to_jsonb(public.get_match_day_parent_notification_link_ids(match_day_id_value)),
      true
    );
  end if;

  return authorization_result;
end;
$$;

revoke all on function public.authorize_match_day_push_v2(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.authorize_match_day_push_v2(uuid, uuid, uuid, text, uuid) to service_role;
revoke all on function public.authorize_match_day_push_v2_before_recipient_fanout_94(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.authorize_match_day_push_v2_before_recipient_fanout_94(uuid, uuid, uuid, text, uuid) to service_role;

alter function public.schedule_match_day_scorer_reminder(uuid, uuid)
rename to schedule_match_day_scorer_reminder_before_branding_94;

create or replace function public.schedule_match_day_scorer_reminder(
  match_day_id_value uuid,
  role_assignment_id_value uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  schedule_result jsonb;
  queue_id_value uuid;
  match_row public.match_days%rowtype;
  assignment_row public.match_day_role_assignments%rowtype;
  parent_link_row public.parent_player_links%rowtype;
  club_row public.clubs%rowtype;
  team_name_value text := '';
  club_name_value text := 'Football Player';
  fixture_name_value text := '';
  fixture_date_value text := '';
  kickoff_value text := 'Time TBC';
  arrival_value text := 'Not set';
  venue_value text := 'Not set';
  address_value text := 'Not set';
  accent_value text := '#047857';
  deep_link_value text := '';
  logo_markup text := '';
  email_subject_value text := '';
  email_text_value text := '';
  email_html_value text := '';
begin
  schedule_result := public.schedule_match_day_scorer_reminder_before_branding_94(
    match_day_id_value,
    role_assignment_id_value
  );

  if not coalesce((schedule_result ->> 'scheduled')::boolean, false) then
    return schedule_result;
  end if;

  queue_id_value := nullif(schedule_result ->> 'emailQueueId', '')::uuid;
  if queue_id_value is null then
    return schedule_result;
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value;

  select * into assignment_row
  from public.match_day_role_assignments
  where id = role_assignment_id_value
    and match_day_id = match_day_id_value
    and role = 'scorer';

  select * into parent_link_row
  from public.parent_player_links
  where id = assignment_row.parent_link_id;

  select * into club_row
  from public.clubs
  where id = match_row.club_id;

  select coalesce(nullif(trim(team.name), ''), 'Your team')
  into team_name_value
  from public.teams team
  where team.id = match_row.team_id;

  if match_row.id is null or assignment_row.id is null or parent_link_row.id is null then
    return schedule_result;
  end if;

  club_name_value := coalesce(nullif(trim(club_row.name), ''), 'Football Player');
  fixture_name_value := concat(
    coalesce(nullif(team_name_value, ''), 'Your team'),
    ' v ',
    coalesce(nullif(trim(match_row.opponent), ''), 'Opponent')
  );
  fixture_date_value := coalesce(to_char(match_row.match_date, 'Dy DD Mon YYYY'), 'Date TBC');
  kickoff_value := coalesce(to_char(match_row.kickoff_time, 'HH24:MI'), 'Time TBC');
  arrival_value := coalesce(to_char(match_row.arrival_time, 'HH24:MI'), 'Not set');
  venue_value := coalesce(nullif(trim(match_row.venue_name), ''), 'Not set');
  address_value := coalesce(nullif(trim(match_row.venue_address), ''), 'Not set');
  accent_value := coalesce(
    nullif(trim((select team.theme_accent from public.teams team where team.id = match_row.team_id)), ''),
    nullif(trim(club_row.theme_accent), ''),
    '#047857'
  );
  if accent_value !~ '^#[0-9A-Fa-f]{6}$' then
    accent_value := '#047857';
  end if;

  deep_link_value := concat(
    'https://parent.footballplayer.online/parent-portal?section=matches&parentLinkId=',
    parent_link_row.id,
    '&matchDayId=',
    match_row.id
  );
  if nullif(trim(club_row.logo_url), '') is not null then
    logo_markup := concat(
      '<img src="', public.calendar_event_notification_escape_html(club_row.logo_url),
      '" alt="', public.calendar_event_notification_escape_html(club_name_value),
      ' badge" style="display:block;max-height:72px;max-width:180px;margin:0 0 18px;" />'
    );
  end if;

  email_subject_value := concat(club_name_value, ': ', fixture_name_value, ' scorer reminder');
  email_text_value := concat(
    club_name_value, E'\n',
    'You are scoring today', E'\n\n',
    fixture_name_value, E'\n',
    'Date: ', fixture_date_value, E'\n',
    'Kick off: ', kickoff_value, E'\n',
    'Arrival: ', arrival_value, E'\n',
    'Venue: ', venue_value, E'\n',
    'Address: ', address_value, E'\n\n',
    'Open scorer Game Mode: ', deep_link_value
  );
  email_html_value := concat(
    '<div style="font-family:Arial,sans-serif;color:#142018;background:#ffffff;padding:24px;line-height:1.55;max-width:680px;margin:0 auto;color-scheme:light;">',
    logo_markup,
    '<p style="margin:0 0 6px;color:', public.calendar_event_notification_escape_html(accent_value), ';font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">', public.calendar_event_notification_escape_html(club_name_value), '</p>',
    '<h1 style="margin:0 0 4px;color:#142018;font-size:26px;line-height:1.25;">You are scoring today</h1>',
    '<p style="margin:0 0 22px;color:#52635a;font-size:15px;font-weight:700;">', public.calendar_event_notification_escape_html(team_name_value), '</p>',
    '<p style="margin:0 0 18px;color:#142018;font-size:16px;">Your club has confirmed you as the Match Day scorer. Open Game Mode before kick off so the full team can follow live updates.</p>',
    '<div style="margin:0 0 22px;padding:18px;border:1px solid #d8e5dc;border-radius:12px;background:#f7faf8;">',
    '<p style="margin:0 0 10px;color:#142018;font-size:18px;font-weight:800;">', public.calendar_event_notification_escape_html(fixture_name_value), '</p>',
    '<table style="width:100%;border-collapse:collapse;">',
    '<tr><td style="padding:7px 12px 7px 0;color:#52635a;font-size:13px;font-weight:700;">Date</td><td style="padding:7px 0;color:#142018;font-size:14px;font-weight:800;">', public.calendar_event_notification_escape_html(fixture_date_value), '</td></tr>',
    '<tr><td style="padding:7px 12px 7px 0;color:#52635a;font-size:13px;font-weight:700;">Kick off</td><td style="padding:7px 0;color:#142018;font-size:14px;font-weight:800;">', public.calendar_event_notification_escape_html(kickoff_value), '</td></tr>',
    '<tr><td style="padding:7px 12px 7px 0;color:#52635a;font-size:13px;font-weight:700;">Arrival</td><td style="padding:7px 0;color:#142018;font-size:14px;font-weight:800;">', public.calendar_event_notification_escape_html(arrival_value), '</td></tr>',
    '<tr><td style="padding:7px 12px 7px 0;color:#52635a;font-size:13px;font-weight:700;">Venue</td><td style="padding:7px 0;color:#142018;font-size:14px;font-weight:800;">', public.calendar_event_notification_escape_html(venue_value), '</td></tr>',
    '<tr><td style="padding:7px 12px 7px 0;color:#52635a;font-size:13px;font-weight:700;">Address</td><td style="padding:7px 0;color:#142018;font-size:14px;font-weight:800;">', public.calendar_event_notification_escape_html(address_value), '</td></tr>',
    '</table></div>',
    '<a href="', public.calendar_event_notification_escape_html(deep_link_value), '" style="display:inline-block;padding:13px 20px;background:', public.calendar_event_notification_escape_html(accent_value), ';color:#ffffff;text-decoration:none;border-radius:10px;font-weight:800;">Open scorer Game Mode</a>',
    '<div style="border-top:1px solid #e7ece3;margin-top:26px;padding-top:14px;"><p style="margin:0;color:#64748b;font-size:11px;line-height:1.45;">Delivered securely through Footballplayer.online.</p></div>',
    '</div>'
  );

  update public.scheduled_email_queue queue
  set subject = email_subject_value,
      payload = coalesce(queue.payload, '{}'::jsonb) || jsonb_build_object(
        'displayName', club_name_value,
        'teamName', team_name_value,
        'clubName', club_name_value,
        'resendPayload', coalesce(queue.payload -> 'resendPayload', '{}'::jsonb) || jsonb_build_object(
          'to', jsonb_build_array(parent_link_row.email),
          'subject', email_subject_value,
          'html', email_html_value,
          'text', email_text_value
        )
      )
  where queue.id = queue_id_value
    and queue.status = 'scheduled';

  return schedule_result || jsonb_build_object('branded', true);
end;
$$;

revoke all on function public.schedule_match_day_scorer_reminder(uuid, uuid) from public, anon, authenticated;
grant execute on function public.schedule_match_day_scorer_reminder(uuid, uuid) to service_role;
revoke all on function public.schedule_match_day_scorer_reminder_before_branding_94(uuid, uuid) from public, anon, authenticated;
grant execute on function public.schedule_match_day_scorer_reminder_before_branding_94(uuid, uuid) to service_role;

comment on function public.schedule_match_day_scorer_reminder(uuid, uuid) is
  'Preserves scorer reminder idempotency while applying club branding, fixture context, and a clear Game Mode action to every queued reminder.';

do $$
declare
  queued_operation record;
begin
  for queued_operation in
    select operation.match_day_id, operation.role_assignment_id
    from public.match_day_scorer_reminder_operations operation
    join public.scheduled_email_queue queue on queue.id = operation.email_queue_id
    where operation.status = 'queued'
      and queue.status = 'scheduled'
  loop
    perform public.schedule_match_day_scorer_reminder(
      queued_operation.match_day_id,
      queued_operation.role_assignment_id
    );
  end loop;
end;
$$;
