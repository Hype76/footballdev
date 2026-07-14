create table if not exists public.match_day_notification_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  match_day_id uuid not null references public.match_days (id) on delete cascade,
  player_id uuid references public.players (id) on delete set null,
  parent_link_id uuid references public.parent_player_links (id) on delete set null,
  recipient_user_id uuid references public.users (id) on delete set null,
  recipient_email text not null,
  event_type text not null,
  transition_key text not null,
  previous_state text not null default '',
  new_state text not null default '',
  subject text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  email_queue_id uuid references public.scheduled_email_queue (id) on delete set null,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint match_day_notification_events_type_check check (
    event_type in ('volunteer_role_accepted_staff', 'player_selected_guardian')
  ),
  constraint match_day_notification_events_status_check check (
    status in ('pending', 'queued', 'failed')
  )
);

create unique index if not exists match_day_notification_events_transition_recipient_key
on public.match_day_notification_events (event_type, transition_key, lower(recipient_email));

create index if not exists match_day_notification_events_fixture_status_idx
on public.match_day_notification_events (match_day_id, status, created_at desc);

alter table public.match_day_notification_events enable row level security;

revoke all privileges on table public.match_day_notification_events from public, anon, authenticated;
grant select, insert, update, delete on table public.match_day_notification_events to service_role;

create or replace function public.get_parent_portal_invitation_summary(parent_link_id_value uuid)
returns table (
  invitation_id text,
  invitation_type text,
  source_record_id uuid,
  source_type text,
  source_event_type text,
  event_id uuid,
  event_type text,
  event_title text,
  event_start timestamptz,
  event_end timestamptz,
  event_location text,
  team_name text,
  child_id uuid,
  child_name text,
  parent_link_id uuid,
  role_type text,
  invitation_state text,
  response_state text,
  selection_state text,
  can_respond boolean,
  can_change_response boolean,
  lock_reason text,
  response_deadline timestamptz,
  last_responded_at timestamptz,
  is_pending boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ranked as (
    select
      invitation.*,
      row_number() over (
        partition by
          invitation.parent_link_id,
          invitation.source_event_type,
          invitation.event_id,
          invitation.child_id,
          invitation.invitation_type,
          coalesce(invitation.role_type, '')
        order by
          invitation.response_deadline desc nulls last,
          invitation.last_responded_at desc nulls last,
          invitation.invitation_id desc
      ) as actionable_rank
    from public.get_parent_portal_invitation_state(parent_link_id_value) invitation
  )
  select
    ranked.invitation_id,
    ranked.invitation_type,
    ranked.source_record_id,
    ranked.source_type,
    ranked.source_event_type,
    ranked.event_id,
    ranked.event_type,
    ranked.event_title,
    ranked.event_start,
    ranked.event_end,
    ranked.event_location,
    ranked.team_name,
    ranked.child_id,
    ranked.child_name,
    ranked.parent_link_id,
    ranked.role_type,
    ranked.invitation_state,
    ranked.response_state,
    ranked.selection_state,
    ranked.can_respond,
    ranked.can_change_response,
    ranked.lock_reason,
    ranked.response_deadline,
    ranked.last_responded_at,
    (
      ranked.actionable_rank = 1
      and ranked.invitation_state in ('active', 'offered')
      and ranked.response_state in ('awaiting_response', 'no_response')
      and ranked.can_respond is true
      and ranked.can_change_response is true
      and (ranked.response_deadline is null or ranked.response_deadline > now())
    ) as is_pending
  from ranked
  order by ranked.event_start asc nulls last, ranked.event_title, ranked.invitation_type, ranked.role_type nulls first;
$$;

revoke all on function public.get_parent_portal_invitation_summary(uuid) from public;
revoke execute on function public.get_parent_portal_invitation_summary(uuid) from anon;
grant execute on function public.get_parent_portal_invitation_summary(uuid) to authenticated, service_role;

create or replace function public.match_day_notification_escape_html(value text)
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

revoke all on function public.match_day_notification_escape_html(text) from public, anon, authenticated;
grant execute on function public.match_day_notification_escape_html(text) to service_role;

create or replace function public.queue_match_day_transition_email(
  club_id_value uuid,
  team_id_value uuid,
  match_day_id_value uuid,
  player_id_value uuid,
  parent_link_id_value uuid,
  recipient_user_id_value uuid,
  recipient_email_value text,
  event_type_value text,
  transition_key_value text,
  previous_state_value text,
  new_state_value text,
  subject_value text,
  payload_value jsonb,
  created_by_value uuid,
  created_by_email_value text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_event_id uuid;
  queue_id_value uuid;
begin
  insert into public.match_day_notification_events (
    club_id,
    team_id,
    match_day_id,
    player_id,
    parent_link_id,
    recipient_user_id,
    recipient_email,
    event_type,
    transition_key,
    previous_state,
    new_state,
    subject,
    payload,
    status
  )
  values (
    club_id_value,
    team_id_value,
    match_day_id_value,
    player_id_value,
    parent_link_id_value,
    recipient_user_id_value,
    lower(btrim(recipient_email_value)),
    event_type_value,
    transition_key_value,
    coalesce(previous_state_value, ''),
    coalesce(new_state_value, ''),
    subject_value,
    coalesce(payload_value, '{}'::jsonb),
    'pending'
  )
  on conflict (event_type, transition_key, lower(recipient_email)) do nothing
  returning id into notification_event_id;

  if notification_event_id is null then
    select notification.id
    into notification_event_id
    from public.match_day_notification_events notification
    where notification.event_type = event_type_value
      and notification.transition_key = transition_key_value
      and lower(notification.recipient_email) = lower(btrim(recipient_email_value))
    limit 1;

    return notification_event_id;
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
    )
    values (
      club_id_value,
      team_id_value,
      created_by_value,
      coalesce(nullif(lower(btrim(created_by_email_value)), ''), 'match-day-system'),
      lower(btrim(recipient_email_value)),
      subject_value,
      'scheduled',
      timezone('utc', now()),
      payload_value
    )
    returning id into queue_id_value;

    update public.match_day_notification_events notification
    set status = 'queued',
        email_queue_id = queue_id_value,
        last_error = null,
        updated_at = timezone('utc', now())
    where notification.id = notification_event_id;
  exception
    when others then
      update public.match_day_notification_events notification
      set status = 'failed',
          last_error = left(sqlerrm, 1000),
          updated_at = timezone('utc', now())
      where notification.id = notification_event_id;
  end;

  return notification_event_id;
end;
$$;

revoke all on function public.queue_match_day_transition_email(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.queue_match_day_transition_email(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, jsonb, uuid, text) to service_role;

alter table public.match_day_event_log
  drop constraint if exists match_day_event_log_event_type_check;

alter table public.match_day_event_log
  add constraint match_day_event_log_event_type_check check (
    event_type in (
      'match_day_created',
      'match_day_updated',
      'player_selected',
      'player_deselected',
      'player_availability_changed',
      'player_squad_decision_changed',
      'player_selection_notification_queued',
      'volunteer_role_accepted',
      'match_role_assigned',
      'match_role_removed',
      'scorer_updated',
      'linesman_updated',
      'invite_prepared',
      'invite_queued',
      'note_updated',
      'yellow_card',
      'red_card',
      'substitution',
      'water_break'
    )
  );

create or replace function public.notify_staff_on_volunteer_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_change record;
  fixture record;
  staff_recipient record;
  parent_link_row public.parent_player_links%rowtype;
  parent_display_name text;
  child_display_name text;
  role_label text;
  fixture_label text;
  fixture_url text;
  transition_key_value text;
  subject_value text;
  html_value text;
  payload_value jsonb;
  notification_event_id uuid;
  queued_count integer;
  failed_count integer;
begin
  for role_change in
    select *
    from (values
      ('scorer'::text, old.volunteer_scorer_response, new.volunteer_scorer_response),
      ('linesman'::text, old.volunteer_linesman_response, new.volunteer_linesman_response),
      ('referee'::text, old.volunteer_referee_response, new.volunteer_referee_response)
    ) response_change(role_type, previous_response, next_response)
  loop
    if coalesce(role_change.previous_response, 'no_response') = 'yes'
      or coalesce(role_change.next_response, 'no_response') <> 'yes' then
      continue;
    end if;

    begin
      select
        match_day.*,
        coalesce(team.name, '') as team_name,
        coalesce(club.name, 'Football Player') as club_name
      into fixture
      from public.match_days match_day
      left join public.teams team on team.id = match_day.team_id
      left join public.clubs club on club.id = match_day.club_id
      where match_day.id = new.match_day_id
        and match_day.club_id = new.club_id
        and (match_day.team_id = new.team_id or match_day.team_id is null)
      limit 1;

      if fixture.id is null then
        continue;
      end if;

      select parent_link.*
      into parent_link_row
      from public.parent_player_links parent_link
      where parent_link.id = new.parent_link_id
        and parent_link.club_id = new.club_id
        and parent_link.player_id = new.player_id
        and parent_link.status = 'active'
      limit 1;

      parent_display_name := coalesce(
        nullif(btrim(new.recipient_name), ''),
        nullif(btrim(parent_link_row.email), ''),
        nullif(btrim(new.recipient_email), ''),
        'A parent or guardian'
      );
      child_display_name := coalesce(nullif(btrim(new.player_name), ''), 'the linked child');
      role_label := initcap(role_change.role_type);
      fixture_label := concat(
        coalesce(nullif(btrim(fixture.team_name), ''), 'Team'),
        ' vs ',
        coalesce(nullif(btrim(fixture.opponent), ''), 'opponent')
      );
      fixture_url := concat('https://footballplayer.online/match-day?matchDayId=', fixture.id);
      transition_key_value := concat(
        new.id,
        ':',
        role_change.role_type,
        ':',
        gen_random_uuid()
      );
      subject_value := concat(parent_display_name, ' accepted the ', lower(role_label), ' role');
      queued_count := 0;
      failed_count := 0;

      for staff_recipient in
        select distinct on (lower(btrim(staff.email)))
          staff.id,
          lower(btrim(staff.email)) as email,
          coalesce(nullif(btrim(staff.display_name), ''), nullif(btrim(staff.name), ''), 'Team staff') as display_name
        from public.users staff
        where staff.club_id = new.club_id
          and coalesce(staff.status, 'active') = 'active'
          and staff.role not in ('parent_portal', 'super_admin')
          and coalesce(staff.role_rank, 0) >= 20
          and nullif(btrim(staff.email), '') is not null
          and btrim(staff.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          and (
            exists (
              select 1
              from public.team_staff assignment
              where assignment.team_id = new.team_id
                and assignment.user_id = staff.id
            )
            or (
              staff.id = fixture.created_by
              and (
                coalesce(staff.role_rank, 0) >= 50
                or exists (
                  select 1
                  from public.team_staff assignment
                  where assignment.team_id = new.team_id
                    and assignment.user_id = staff.id
                )
              )
            )
          )
        order by lower(btrim(staff.email)), case when staff.id = fixture.created_by then 0 else 1 end, staff.id
      loop
        html_value := concat(
          '<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#101828;background:#f7faf8;">',
          '<div style="border:1px solid #d7e5dc;border-radius:12px;background:#ffffff;padding:22px;">',
          '<p style="margin:0 0 8px;color:#047857;font-size:12px;font-weight:900;text-transform:uppercase;">Volunteer response</p>',
          '<h1 style="margin:0 0 16px;font-size:24px;">', public.match_day_notification_escape_html(role_label), ' accepted</h1>',
          '<p style="line-height:1.6;">', public.match_day_notification_escape_html(parent_display_name),
          ' accepted the ', public.match_day_notification_escape_html(lower(role_label)),
          ' role linked to ', public.match_day_notification_escape_html(child_display_name), '.</p>',
          '<p style="line-height:1.6;"><strong>Team:</strong> ', public.match_day_notification_escape_html(coalesce(fixture.team_name, 'Team')), '<br>',
          '<strong>Fixture:</strong> ', public.match_day_notification_escape_html(fixture_label), '<br>',
          '<strong>Date:</strong> ', public.match_day_notification_escape_html(coalesce(to_char(fixture.match_date, 'DD Mon YYYY'), 'Not set')), '<br>',
          '<strong>Kick off:</strong> ', public.match_day_notification_escape_html(coalesce(to_char(fixture.kickoff_time, 'HH24:MI'), 'Not set')), '</p>',
          '<a href="', fixture_url, '" style="display:inline-block;padding:12px 16px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:900;">Open Match Day</a>',
          '</div></div>'
        );
        payload_value := jsonb_build_object(
          'visibleInEmailQueue', false,
          'resendPayload', jsonb_build_object(
            'to', jsonb_build_array(staff_recipient.email),
            'subject', subject_value,
            'html', html_value
          ),
          'displayName', 'Football Player',
          'teamName', coalesce(fixture.team_name, ''),
          'clubName', coalesce(fixture.club_name, 'Football Player'),
          'playerName', child_display_name,
          'parentName', parent_display_name,
          'clubId', new.club_id,
          'teamId', new.team_id,
          'actorId', coalesce(parent_link_row.auth_user_id::text, ''),
          'actorEmail', coalesce(parent_link_row.email, new.recipient_email, ''),
          'actorRole', 'parent_portal',
          'requiredFeature', 'parentEmails',
          'matchDayVolunteerAcceptance', jsonb_build_object(
            'matchDayId', new.match_day_id,
            'requestId', new.id,
            'playerId', new.player_id,
            'parentLinkId', new.parent_link_id,
            'role', role_change.role_type,
            'purpose', 'volunteer_role_accepted_staff'
          )
        );

        notification_event_id := public.queue_match_day_transition_email(
          new.club_id,
          new.team_id,
          new.match_day_id,
          new.player_id,
          new.parent_link_id,
          staff_recipient.id,
          staff_recipient.email,
          'volunteer_role_accepted_staff',
          transition_key_value,
          coalesce(role_change.previous_response, 'no_response'),
          role_change.next_response,
          subject_value,
          payload_value,
          parent_link_row.auth_user_id,
          coalesce(parent_link_row.email, new.recipient_email, 'match-day-system')
        );

        if exists (
          select 1
          from public.match_day_notification_events notification
          where notification.id = notification_event_id
            and notification.status = 'queued'
        ) then
          queued_count := queued_count + 1;
        else
          failed_count := failed_count + 1;
        end if;
      end loop;

      begin
        insert into public.match_day_event_log (
          club_id,
          team_id,
          match_day_id,
          player_id,
          actor_user_id,
          actor_display_name,
          actor_role,
          event_type,
          event_label,
          previous_value,
          new_value,
          metadata
        )
        values (
          new.club_id,
          new.team_id,
          new.match_day_id,
          new.player_id,
          parent_link_row.auth_user_id,
          parent_display_name,
          'Parent volunteer',
          'volunteer_role_accepted',
          concat(parent_display_name, ' accepted ', lower(role_label)),
          jsonb_build_object('response', coalesce(role_change.previous_response, 'no_response')),
          jsonb_build_object('response', role_change.next_response),
          jsonb_build_object(
            'source', 'match_day_availability_response_transition',
            'requestId', new.id,
            'parentLinkId', new.parent_link_id,
            'role', role_change.role_type,
            'queuedNotificationCount', queued_count,
            'failedNotificationCount', failed_count
          )
        );
      exception when others then
        null;
      end;
    exception when others then
      begin
        insert into public.match_day_event_log (
          club_id,
          team_id,
          match_day_id,
          player_id,
          actor_user_id,
          actor_display_name,
          actor_role,
          event_type,
          event_label,
          previous_value,
          new_value,
          metadata
        )
        values (
          new.club_id,
          new.team_id,
          new.match_day_id,
          new.player_id,
          null,
          coalesce(nullif(btrim(new.recipient_name), ''), 'Parent volunteer'),
          'Parent volunteer',
          'volunteer_role_accepted',
          'Volunteer acceptance saved with notification warning',
          jsonb_build_object('response', coalesce(role_change.previous_response, 'no_response')),
          jsonb_build_object('response', role_change.next_response),
          jsonb_build_object(
            'source', 'match_day_availability_response_transition',
            'role', role_change.role_type,
            'notificationError', left(sqlerrm, 1000)
          )
        );
      exception when others then
        null;
      end;
    end;
  end loop;

  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists match_day_volunteer_acceptance_staff_notification on public.match_day_availability_requests;
create trigger match_day_volunteer_acceptance_staff_notification
after update of volunteer_scorer_response, volunteer_linesman_response, volunteer_referee_response
on public.match_day_availability_requests
for each row
execute function public.notify_staff_on_volunteer_acceptance();

create or replace function public.notify_guardians_on_player_selection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fixture record;
  guardian record;
  actor_row public.users%rowtype;
  child_display_name text;
  fixture_label text;
  parent_chat_url text;
  transition_key_value text;
  subject_value text;
  html_value text;
  payload_value jsonb;
  notification_event_id uuid;
  queued_count integer := 0;
  failed_count integer := 0;
begin
  if new.status <> 'selected'
    or (tg_op = 'UPDATE' and old.status = 'selected') then
    return new;
  end if;

  begin
    select
      match_day.*,
      coalesce(team.name, '') as team_name,
      coalesce(club.name, 'Football Player') as club_name,
      coalesce(player.player_name, 'Your child') as player_name
    into fixture
    from public.match_days match_day
    join public.players player
      on player.id = new.player_id
      and player.club_id = new.club_id
      and player.team_id = new.team_id
      and player.section = 'Squad'
      and coalesce(player.status, 'active') <> 'archived'
    left join public.teams team on team.id = match_day.team_id
    left join public.clubs club on club.id = match_day.club_id
    where match_day.id = new.match_day_id
      and match_day.club_id = new.club_id
      and match_day.team_id = new.team_id
    limit 1;

    if fixture.id is null then
      return new;
    end if;

    select staff.*
    into actor_row
    from public.users staff
    where staff.id = new.decided_by
      and staff.club_id = new.club_id
      and coalesce(staff.status, 'active') = 'active'
      and staff.role not in ('parent_portal', 'super_admin')
    limit 1;

    child_display_name := coalesce(nullif(btrim(fixture.player_name), ''), 'Your child');
    fixture_label := concat(
      coalesce(nullif(btrim(fixture.team_name), ''), 'Team'),
      ' vs ',
      coalesce(nullif(btrim(fixture.opponent), ''), 'opponent')
    );
    parent_chat_url := concat('https://parent.footballplayer.online/parent-chat?matchDayId=', fixture.id);
    transition_key_value := concat(new.id, ':selected:', gen_random_uuid());
    subject_value := concat(child_display_name, ' has been selected for ', fixture_label);

    for guardian in
      select distinct on (lower(btrim(parent_link.email)))
        parent_link.id,
        parent_link.auth_user_id,
        lower(btrim(parent_link.email)) as email,
        coalesce(
          nullif(btrim(parent_profile.display_name), ''),
          nullif(btrim(parent_profile.name), ''),
          'Parent or guardian'
        ) as display_name
      from public.parent_player_links parent_link
      left join public.users parent_profile on parent_profile.id = parent_link.auth_user_id
      where parent_link.club_id = new.club_id
        and parent_link.player_id = new.player_id
        and (parent_link.team_id = new.team_id or parent_link.team_id is null)
        and parent_link.status = 'active'
        and parent_link.auth_user_id is not null
        and nullif(btrim(parent_link.email), '') is not null
        and btrim(parent_link.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      order by lower(btrim(parent_link.email)), parent_link.created_at, parent_link.id
    loop
      html_value := concat(
        '<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#101828;background:#f7faf8;">',
        '<div style="border:1px solid #d7e5dc;border-radius:12px;background:#ffffff;padding:22px;">',
        '<p style="margin:0 0 8px;color:#047857;font-size:12px;font-weight:900;text-transform:uppercase;">Match selection</p>',
        '<h1 style="margin:0 0 16px;font-size:24px;">', public.match_day_notification_escape_html(child_display_name), ' has been selected</h1>',
        '<p style="line-height:1.6;">', public.match_day_notification_escape_html(child_display_name),
        ' has been confirmed in the saved squad for this fixture.</p>',
        '<p style="line-height:1.6;"><strong>Team:</strong> ', public.match_day_notification_escape_html(coalesce(fixture.team_name, 'Team')), '<br>',
        '<strong>Opponent:</strong> ', public.match_day_notification_escape_html(coalesce(fixture.opponent, 'Opponent')), '<br>',
        '<strong>Date:</strong> ', public.match_day_notification_escape_html(coalesce(to_char(fixture.match_date, 'DD Mon YYYY'), 'Not set')), '<br>',
        '<strong>Kick off:</strong> ', public.match_day_notification_escape_html(coalesce(to_char(fixture.kickoff_time, 'HH24:MI'), 'TBC')), '<br>',
        '<strong>Meet time:</strong> ', public.match_day_notification_escape_html(coalesce(to_char(fixture.arrival_time, 'HH24:MI'), 'Not set')), '<br>',
        '<strong>Venue:</strong> ', public.match_day_notification_escape_html(coalesce(nullif(btrim(fixture.venue_name), ''), nullif(btrim(fixture.venue_address), ''), 'Not set')), '</p>',
        '<a href="', parent_chat_url, '" style="display:inline-block;padding:12px 16px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:900;">View match details and open Match Chat</a>',
        '</div></div>'
      );
      payload_value := jsonb_build_object(
        'visibleInEmailQueue', false,
        'resendPayload', jsonb_build_object(
          'to', jsonb_build_array(guardian.email),
          'subject', subject_value,
          'html', html_value
        ),
        'displayName', 'Football Player',
        'teamName', coalesce(fixture.team_name, ''),
        'clubName', coalesce(fixture.club_name, 'Football Player'),
        'playerName', child_display_name,
        'parentName', guardian.display_name,
        'clubId', new.club_id,
        'teamId', new.team_id,
        'actorId', coalesce(actor_row.id::text, ''),
        'actorEmail', coalesce(actor_row.email, 'match-day-system'),
        'actorRole', coalesce(actor_row.role, 'system'),
        'requiredFeature', 'parentEmails',
        'matchDayPlayerSelection', jsonb_build_object(
          'matchDayId', new.match_day_id,
          'playerId', new.player_id,
          'parentLinkId', guardian.id,
          'previousState', case when tg_op = 'INSERT' then 'no_saved_decision' else old.status end,
          'nextState', new.status,
          'purpose', 'player_selected_guardian'
        )
      );

      notification_event_id := public.queue_match_day_transition_email(
        new.club_id,
        new.team_id,
        new.match_day_id,
        new.player_id,
        guardian.id,
        guardian.auth_user_id,
        guardian.email,
        'player_selected_guardian',
        transition_key_value,
        case when tg_op = 'INSERT' then 'no_saved_decision' else old.status end,
        new.status,
        subject_value,
        payload_value,
        actor_row.id,
        coalesce(actor_row.email, 'match-day-system')
      );

      if exists (
        select 1
        from public.match_day_notification_events notification
        where notification.id = notification_event_id
          and notification.status = 'queued'
      ) then
        queued_count := queued_count + 1;
      else
        failed_count := failed_count + 1;
      end if;
    end loop;

    begin
      insert into public.match_day_event_log (
        club_id,
        team_id,
        match_day_id,
        player_id,
        actor_user_id,
        actor_display_name,
        actor_role,
        event_type,
        event_label,
        previous_value,
        new_value,
        metadata
      )
      values (
        new.club_id,
        new.team_id,
        new.match_day_id,
        new.player_id,
        actor_row.id,
        coalesce(nullif(btrim(actor_row.display_name), ''), nullif(btrim(actor_row.name), ''), new.decided_by_name, 'Team staff'),
        coalesce(nullif(actor_row.role_label, ''), actor_row.role, 'Staff'),
        'player_selection_notification_queued',
        concat(child_display_name, ' selection notifications prepared'),
        jsonb_build_object('status', case when tg_op = 'INSERT' then 'no_saved_decision' else old.status end),
        jsonb_build_object('status', new.status),
        jsonb_build_object(
          'source', 'authoritative_saved_squad_decision_transition',
          'queuedNotificationCount', queued_count,
          'failedNotificationCount', failed_count,
          'matchChatReconciliationTrigger', 'parent_chat_squad_decision_sync'
        )
      );
    exception when others then
      null;
    end;
  exception when others then
    begin
      insert into public.match_day_event_log (
        club_id,
        team_id,
        match_day_id,
        player_id,
        actor_user_id,
        actor_display_name,
        actor_role,
        event_type,
        event_label,
        previous_value,
        new_value,
        metadata
      )
      values (
        new.club_id,
        new.team_id,
        new.match_day_id,
        new.player_id,
        new.decided_by,
        coalesce(new.decided_by_name, 'Team staff'),
        'Staff',
        'player_selection_notification_queued',
        'Player selection saved with notification warning',
        jsonb_build_object('status', case when tg_op = 'INSERT' then 'no_saved_decision' else old.status end),
        jsonb_build_object('status', new.status),
        jsonb_build_object(
          'source', 'authoritative_saved_squad_decision_transition',
          'notificationError', left(sqlerrm, 1000)
        )
      );
    exception when others then
      null;
    end;
  end;

  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists zz_match_day_selection_parent_email on public.match_day_player_squad_decisions;
create trigger zz_match_day_selection_parent_email
after insert or update of status
on public.match_day_player_squad_decisions
for each row
execute function public.notify_guardians_on_player_selection();

revoke all on function public.notify_staff_on_volunteer_acceptance() from public, anon, authenticated;
revoke all on function public.notify_guardians_on_player_selection() from public, anon, authenticated;
grant execute on function public.notify_staff_on_volunteer_acceptance() to service_role;
grant execute on function public.notify_guardians_on_player_selection() to service_role;

comment on table public.match_day_notification_events is
  'Private transition ledger for idempotent Match Day staff and guardian email queue operations.';

comment on function public.get_parent_portal_invitation_summary(uuid) is
  'Authenticated parent invitation summary with one server-authoritative actionable pending flag per event, child, invitation type, and role.';

comment on function public.notify_staff_on_volunteer_acceptance() is
  'Queues team-scoped staff email once when a volunteer response transitions into yes without reversing the saved response on queue failure.';

comment on function public.notify_guardians_on_player_selection() is
  'Queues one email per current authorised guardian when the saved squad decision transitions into selected without reversing the saved decision on queue failure.';
