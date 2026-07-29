create table if not exists public.event_player_change_commands (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  calendar_event_id uuid references public.calendar_events(id) on delete cascade,
  match_day_id uuid references public.match_days(id) on delete cascade,
  assessment_session_id uuid references public.assessment_sessions(id) on delete cascade,
  source_type text not null,
  event_type text not null,
  request_token uuid not null,
  selected_player_ids uuid[] not null default '{}'::uuid[],
  added_player_ids uuid[] not null default '{}'::uuid[],
  removed_player_ids uuid[] not null default '{}'::uuid[],
  unchanged_player_ids uuid[] not null default '{}'::uuid[],
  communication_mode text not null default 'none',
  requested_by uuid not null references auth.users(id) on delete restrict,
  result jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  constraint event_player_change_commands_source_check
    check (source_type in ('calendar', 'match-day', 'session')),
  constraint event_player_change_commands_source_id_check
    check (num_nonnulls(calendar_event_id, match_day_id, assessment_session_id) = 1),
  constraint event_player_change_commands_communication_check
    check (communication_mode in ('none', 'notify_added', 'notify_removed', 'resend_all')),
  constraint event_player_change_commands_actor_token_key
    unique (requested_by, request_token)
);

create index if not exists event_player_change_commands_calendar_idx
on public.event_player_change_commands(calendar_event_id, created_at desc)
where calendar_event_id is not null;

create index if not exists event_player_change_commands_match_idx
on public.event_player_change_commands(match_day_id, created_at desc)
where match_day_id is not null;

create index if not exists event_player_change_commands_session_idx
on public.event_player_change_commands(assessment_session_id, created_at desc)
where assessment_session_id is not null;

create table if not exists public.event_player_notification_events (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null references public.event_player_change_commands(id) on delete restrict,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  parent_link_id uuid references public.parent_player_links(id) on delete set null,
  recipient_type text not null default 'parent',
  recipient_email text not null,
  notification_kind text not null,
  email_queue_id uuid references public.scheduled_email_queue(id) on delete set null,
  status text not null default 'queued',
  requested_at timestamptz not null default timezone('utc', now()),
  last_error text,
  constraint event_player_notification_events_recipient_check
    check (btrim(recipient_email) <> ''),
  constraint event_player_notification_events_kind_check
    check (notification_kind in ('player_added', 'player_removed', 'resend_all')),
  constraint event_player_notification_events_status_check
    check (status in ('queued', 'sent', 'failed')),
  constraint event_player_notification_events_command_recipient_key
    unique (command_id, player_id, recipient_email, notification_kind)
);

create index if not exists event_player_notification_events_queue_idx
on public.event_player_notification_events(email_queue_id)
where email_queue_id is not null;

alter table public.event_player_change_commands enable row level security;
alter table public.event_player_change_commands force row level security;
alter table public.event_player_notification_events enable row level security;
alter table public.event_player_notification_events force row level security;

revoke all on public.event_player_change_commands from public, anon, authenticated;
revoke all on public.event_player_notification_events from public, anon, authenticated;

grant select on public.event_player_change_commands to authenticated;
grant select on public.event_player_notification_events to authenticated;
grant select, insert, update on public.event_player_change_commands to service_role;
grant select, insert, update on public.event_player_notification_events to service_role;

drop policy if exists event_player_change_commands_staff_read
on public.event_player_change_commands;

create policy event_player_change_commands_staff_read
on public.event_player_change_commands
for select
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 20
  and (
    exists (
      select 1
      from public.users actor
      where actor.id = (select auth.uid())
        and actor.club_id = event_player_change_commands.club_id
        and actor.role = 'admin'
        and coalesce(actor.status, 'active') = 'active'
    )
    or exists (
      select 1
      from public.team_staff assignment
      where assignment.team_id = event_player_change_commands.team_id
        and assignment.user_id = (select auth.uid())
    )
  )
);

drop policy if exists event_player_notification_events_staff_read
on public.event_player_notification_events;

create policy event_player_notification_events_staff_read
on public.event_player_notification_events
for select
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 20
  and (
    exists (
      select 1
      from public.users actor
      where actor.id = (select auth.uid())
        and actor.club_id = event_player_notification_events.club_id
        and actor.role = 'admin'
        and coalesce(actor.status, 'active') = 'active'
    )
    or exists (
      select 1
      from public.team_staff assignment
      where assignment.team_id = event_player_notification_events.team_id
        and assignment.user_id = (select auth.uid())
    )
  )
);

create or replace function public.event_player_eligible_recipients(
  club_id_value uuid,
  team_id_value uuid,
  player_ids_value uuid[]
)
returns table (
  player_id uuid,
  player_name text,
  recipient_email text,
  recipient_name text,
  recipient_type text,
  parent_link_id uuid
)
language sql
security definer
set search_path = ''
stable
as $$
  with selected_players as (
    select
      player.id,
      coalesce(nullif(btrim(player.player_name), ''), 'Player') as player_name,
      lower(btrim(coalesce(player.parent_email, ''))) as fallback_email,
      coalesce(nullif(btrim(player.parent_name), ''), player.player_name, 'Player contact') as fallback_name,
      coalesce(player.parent_contacts, '[]'::jsonb) as parent_contacts,
      lower(btrim(coalesce(player.contact_type, 'parent'))) as contact_type
    from public.players player
    where player.club_id = club_id_value
      and player.team_id = team_id_value
      and player.id = any(coalesce(player_ids_value, '{}'::uuid[]))
      and coalesce(player.status, 'active') <> 'archived'
  ),
  active_links as (
    select
      player.id as player_id,
      player.player_name,
      lower(btrim(link.email)) as recipient_email,
      coalesce(
        nullif(btrim(parent_profile.display_name), ''),
        nullif(btrim(parent_profile.name), ''),
        nullif(btrim(player.fallback_name), ''),
        'Parent or guardian'
      ) as recipient_name,
      'parent'::text as recipient_type,
      link.id as parent_link_id,
      1 as priority
    from selected_players player
    join public.parent_player_links link
      on link.club_id = club_id_value
      and link.team_id = team_id_value
      and link.player_id = player.id
      and link.status = 'active'
    left join public.users parent_profile on parent_profile.id = link.auth_user_id
    where player.contact_type in ('parent', 'both')
      and btrim(coalesce(link.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  json_contacts as (
    select
      player.id as player_id,
      player.player_name,
      lower(btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))) as recipient_email,
      coalesce(
        nullif(btrim(coalesce(contact.value ->> 'name', contact.value ->> 'parentName', '')), ''),
        player.fallback_name
      ) as recipient_name,
      case
        when lower(btrim(coalesce(contact.value ->> 'type', contact.value ->> 'contactType', ''))) = 'self'
          then 'player'
        else 'parent'
      end as recipient_type,
      null::uuid as parent_link_id,
      2 as priority
    from selected_players player
    cross join lateral jsonb_array_elements(player.parent_contacts) contact(value)
    where (
      player.contact_type = 'both'
      or (
        player.contact_type = 'self'
        and (
          lower(btrim(coalesce(contact.value ->> 'type', contact.value ->> 'contactType', ''))) = 'self'
          or jsonb_array_length(player.parent_contacts) = 1
        )
      )
      or (
        player.contact_type = 'parent'
        and lower(btrim(coalesce(contact.value ->> 'type', contact.value ->> 'contactType', 'parent'))) <> 'self'
      )
    )
      and btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))
        ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  fallback_contacts as (
    select
      player.id as player_id,
      player.player_name,
      player.fallback_email as recipient_email,
      player.fallback_name as recipient_name,
      case when player.contact_type = 'self' then 'player' else 'parent' end as recipient_type,
      null::uuid as parent_link_id,
      3 as priority
    from selected_players player
    where player.fallback_email ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  candidates as (
    select * from active_links
    union all
    select * from json_contacts
    union all
    select * from fallback_contacts
  )
  select distinct on (candidate.player_id, candidate.recipient_email)
    candidate.player_id,
    candidate.player_name,
    candidate.recipient_email,
    candidate.recipient_name,
    candidate.recipient_type,
    candidate.parent_link_id
  from candidates candidate
  where candidate.recipient_email <> ''
  order by candidate.player_id, candidate.recipient_email, candidate.priority, candidate.parent_link_id nulls last;
$$;

revoke all on function public.event_player_eligible_recipients(uuid, uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.event_player_eligible_recipients(uuid, uuid, uuid[])
to service_role;

create or replace function public.preview_event_player_changes(
  source_type_value text,
  event_id_value uuid,
  selected_player_ids_value uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  normalized_source_type text := lower(btrim(coalesce(source_type_value, '')));
  source_club_id uuid;
  source_team_id uuid;
  source_event_type text;
  selected_player_ids uuid[] := '{}'::uuid[];
  current_player_ids uuid[] := '{}'::uuid[];
  added_player_ids uuid[] := '{}'::uuid[];
  removed_player_ids uuid[] := '{}'::uuid[];
  unchanged_player_ids uuid[] := '{}'::uuid[];
  selected_removal_player_ids uuid[] := '{}'::uuid[];
  invalid_player_count integer := 0;
  added_recipient_count integer := 0;
  removed_recipient_count integer := 0;
  current_recipient_count integer := 0;
  added_contact_player_ids uuid[] := '{}'::uuid[];
  removed_contact_player_ids uuid[] := '{}'::uuid[];
  current_contact_player_ids uuid[] := '{}'::uuid[];
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to manage event players.';
  end if;

  if normalized_source_type not in ('calendar', 'match-day', 'session') then
    raise exception 'Choose a supported event source before managing players.';
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
    raise exception 'Coach or manager access is required to manage event players.';
  end if;

  if normalized_source_type = 'calendar' then
    select event.club_id, event.team_id, lower(btrim(coalesce(event.event_type, 'general')))
    into source_club_id, source_team_id, source_event_type
    from public.calendar_events event
    where event.id = event_id_value
      and event.club_id = actor.club_id
      and event.cancelled_at is null;
  elsif normalized_source_type = 'match-day' then
    select fixture.club_id, fixture.team_id, 'match'
    into source_club_id, source_team_id, source_event_type
    from public.match_days fixture
    where fixture.id = event_id_value
      and fixture.club_id = actor.club_id
      and fixture.deleted_at is null
      and fixture.status <> 'cancelled';
  else
    select session.club_id, session.team_id,
      case when lower(btrim(coalesce(session.session_type, 'training'))) = 'match' then 'match' else 'training' end
    into source_club_id, source_team_id, source_event_type
    from public.assessment_sessions session
    where session.id = event_id_value
      and session.club_id = actor.club_id;
  end if;

  if source_club_id is null or source_team_id is null then
    raise exception 'The event was not found in the active club and team.';
  end if;

  if actor.role <> 'admin' and not exists (
    select 1
    from public.team_staff assignment
    where assignment.team_id = source_team_id
      and assignment.user_id = actor.id
  ) then
    raise exception 'You do not have permission to manage players for this event team.';
  end if;

  select coalesce(array_agg(distinct selected_id order by selected_id), '{}'::uuid[])
  into selected_player_ids
  from unnest(coalesce(selected_player_ids_value, '{}'::uuid[])) selected_id
  where selected_id is not null;

  select count(*)
  into invalid_player_count
  from unnest(selected_player_ids) selected_id
  where not exists (
    select 1
    from public.players player
    where player.id = selected_id
      and player.club_id = source_club_id
      and player.team_id = source_team_id
      and coalesce(player.status, 'active') <> 'archived'
  );

  if invalid_player_count > 0 then
    raise exception 'One or more selected players are outside the event team or are no longer active.';
  end if;

  select coalesce(array_agg(invite.player_id order by invite.player_id), '{}'::uuid[])
  into current_player_ids
  from public.calendar_event_invites invite
  where invite.club_id = source_club_id
    and invite.team_id = source_team_id
    and invite.invite_status <> 'cancelled'
    and (
      (normalized_source_type = 'calendar' and invite.calendar_event_id = event_id_value)
      or (normalized_source_type = 'match-day' and invite.match_day_id = event_id_value)
      or (normalized_source_type = 'session' and invite.assessment_session_id = event_id_value)
    );

  select coalesce(array_agg(player_id order by player_id), '{}'::uuid[])
  into added_player_ids
  from unnest(selected_player_ids) player_id
  where not (player_id = any(current_player_ids));

  select coalesce(array_agg(player_id order by player_id), '{}'::uuid[])
  into removed_player_ids
  from unnest(current_player_ids) player_id
  where not (player_id = any(selected_player_ids));

  select coalesce(array_agg(player_id order by player_id), '{}'::uuid[])
  into unchanged_player_ids
  from unnest(selected_player_ids) player_id
  where player_id = any(current_player_ids);

  if normalized_source_type = 'match-day' then
    select coalesce(array_agg(decision.player_id order by decision.player_id), '{}'::uuid[])
    into selected_removal_player_ids
    from public.match_day_player_squad_decisions decision
    where decision.match_day_id = event_id_value
      and decision.player_id = any(removed_player_ids)
      and decision.status = 'selected';
  end if;

  select
    count(*),
    coalesce(array_agg(distinct recipient.player_id order by recipient.player_id), '{}'::uuid[])
  into added_recipient_count, added_contact_player_ids
  from public.event_player_eligible_recipients(source_club_id, source_team_id, added_player_ids) recipient;

  select
    count(*),
    coalesce(array_agg(distinct recipient.player_id order by recipient.player_id), '{}'::uuid[])
  into removed_recipient_count, removed_contact_player_ids
  from public.event_player_eligible_recipients(source_club_id, source_team_id, removed_player_ids) recipient;

  select
    count(*),
    coalesce(array_agg(distinct recipient.player_id order by recipient.player_id), '{}'::uuid[])
  into current_recipient_count, current_contact_player_ids
  from public.event_player_eligible_recipients(source_club_id, source_team_id, selected_player_ids) recipient;

  return jsonb_build_object(
    'eventId', event_id_value,
    'sourceType', normalized_source_type,
    'eventType', source_event_type,
    'teamId', source_team_id,
    'currentPlayerIds', to_jsonb(current_player_ids),
    'selectedPlayerIds', to_jsonb(selected_player_ids),
    'addedPlayerIds', to_jsonb(added_player_ids),
    'removedPlayerIds', to_jsonb(removed_player_ids),
    'unchangedPlayerIds', to_jsonb(unchanged_player_ids),
    'selectedRemovalPlayerIds', to_jsonb(selected_removal_player_ids),
    'addedRecipientCount', added_recipient_count,
    'removedRecipientCount', removed_recipient_count,
    'currentRecipientCount', current_recipient_count,
    'addedMissingContactPlayerIds', to_jsonb(array(
      select player_id from unnest(added_player_ids) player_id
      where not (player_id = any(added_contact_player_ids))
      order by player_id
    )),
    'removedMissingContactPlayerIds', to_jsonb(array(
      select player_id from unnest(removed_player_ids) player_id
      where not (player_id = any(removed_contact_player_ids))
      order by player_id
    )),
    'currentMissingContactPlayerIds', to_jsonb(array(
      select player_id from unnest(selected_player_ids) player_id
      where not (player_id = any(current_contact_player_ids))
      order by player_id
    ))
  );
end;
$$;

revoke all on function public.preview_event_player_changes(text, uuid, uuid[])
from public, anon;
grant execute on function public.preview_event_player_changes(text, uuid, uuid[])
to authenticated, service_role;

create or replace function public.apply_event_player_changes(
  source_type_value text,
  event_id_value uuid,
  selected_player_ids_value uuid[] default '{}'::uuid[],
  communication_mode_value text default 'none',
  request_token_value uuid default null,
  confirm_selected_removals_value boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  preview jsonb;
  normalized_source_type text := lower(btrim(coalesce(source_type_value, '')));
  normalized_communication_mode text := lower(btrim(coalesce(communication_mode_value, 'none')));
  source_club_id uuid;
  source_team_id uuid;
  source_event_type text;
  source_title text;
  source_starts_at timestamptz;
  source_location text;
  source_status text;
  team_name_value text;
  club_name_value text;
  selected_player_ids uuid[] := '{}'::uuid[];
  added_player_ids uuid[] := '{}'::uuid[];
  removed_player_ids uuid[] := '{}'::uuid[];
  unchanged_player_ids uuid[] := '{}'::uuid[];
  selected_removal_player_ids uuid[] := '{}'::uuid[];
  target_player_ids uuid[] := '{}'::uuid[];
  missing_contact_player_ids uuid[] := '{}'::uuid[];
  command_record public.event_player_change_commands%rowtype;
  existing_command public.event_player_change_commands%rowtype;
  notification_kind_value text;
  recipient record;
  queue_id_value uuid;
  queued_count integer := 0;
  failed_count integer := 0;
  recipient_count integer := 0;
  result_value jsonb;
  subject_value text;
  html_value text;
  actor_name text;
begin
  if request_token_value is null then
    raise exception 'A player-management request token is required.';
  end if;

  if normalized_communication_mode not in ('none', 'notify_added', 'notify_removed', 'resend_all') then
    raise exception 'Choose a supported event communication option.';
  end if;

  select profile.*
  into actor
  from public.users profile
  where profile.id = auth.uid()
  limit 1;

  if actor.id is null then
    raise exception 'Authentication is required to manage event players.';
  end if;

  select command.*
  into existing_command
  from public.event_player_change_commands command
  where command.requested_by = actor.id
    and command.request_token = request_token_value
  limit 1;

  if existing_command.id is not null then
    if existing_command.source_type <> normalized_source_type
      or coalesce(existing_command.calendar_event_id, existing_command.match_day_id, existing_command.assessment_session_id) <> event_id_value then
      raise exception 'This player-management request token was already used for another event.';
    end if;

    return coalesce(existing_command.result, '{}'::jsonb)
      || jsonb_build_object('duplicate', true, 'commandId', existing_command.id);
  end if;

  preview := public.preview_event_player_changes(
    normalized_source_type,
    event_id_value,
    selected_player_ids_value
  );

  source_team_id := nullif(preview ->> 'teamId', '')::uuid;
  source_event_type := coalesce(preview ->> 'eventType', 'general');
  selected_player_ids := coalesce(
    array(select jsonb_array_elements_text(preview -> 'selectedPlayerIds')::uuid),
    '{}'::uuid[]
  );
  added_player_ids := coalesce(
    array(select jsonb_array_elements_text(preview -> 'addedPlayerIds')::uuid),
    '{}'::uuid[]
  );
  removed_player_ids := coalesce(
    array(select jsonb_array_elements_text(preview -> 'removedPlayerIds')::uuid),
    '{}'::uuid[]
  );
  unchanged_player_ids := coalesce(
    array(select jsonb_array_elements_text(preview -> 'unchangedPlayerIds')::uuid),
    '{}'::uuid[]
  );
  selected_removal_player_ids := coalesce(
    array(select jsonb_array_elements_text(preview -> 'selectedRemovalPlayerIds')::uuid),
    '{}'::uuid[]
  );

  if cardinality(selected_removal_player_ids) > 0 and confirm_selected_removals_value is not true then
    raise exception 'Confirm that selected match players will be removed from the squad decision.';
  end if;

  if normalized_communication_mode = 'notify_added' and cardinality(added_player_ids) = 0 then
    raise exception 'There are no newly added players to notify.';
  end if;

  if normalized_communication_mode = 'notify_removed' and cardinality(removed_player_ids) = 0 then
    raise exception 'There are no removed players to notify.';
  end if;

  if normalized_communication_mode = 'resend_all' and cardinality(selected_player_ids) = 0 then
    raise exception 'There are no current players to notify.';
  end if;

  if normalized_source_type = 'calendar' then
    select
      event.club_id,
      event.team_id,
      coalesce(nullif(btrim(event.title), ''), 'Calendar event'),
      event.starts_at,
      coalesce(event.location, ''),
      case when event.cancelled_at is null then 'active' else 'cancelled' end
    into source_club_id, source_team_id, source_title, source_starts_at, source_location, source_status
    from public.calendar_events event
    where event.id = event_id_value
      and event.club_id = actor.club_id
    for update;
  elsif normalized_source_type = 'match-day' then
    select
      fixture.club_id,
      fixture.team_id,
      concat('Match vs ', coalesce(nullif(btrim(fixture.opponent), ''), 'Opponent')),
      case
        when fixture.kickoff_time_tbc is true or fixture.kickoff_time is null
          then fixture.match_date::timestamp at time zone 'Europe/London'
        else (fixture.match_date + fixture.kickoff_time)::timestamp at time zone 'Europe/London'
      end,
      coalesce(fixture.venue_name, ''),
      fixture.status
    into source_club_id, source_team_id, source_title, source_starts_at, source_location, source_status
    from public.match_days fixture
    where fixture.id = event_id_value
      and fixture.club_id = actor.club_id
      and fixture.deleted_at is null
    for update;
  else
    select
      session.club_id,
      session.team_id,
      coalesce(nullif(btrim(session.title), ''), 'Training session'),
      (session.session_date + coalesce(session.start_time, '00:00'::time))::timestamp at time zone 'Europe/London',
      coalesce(session.location, ''),
      coalesce(session.status, 'scheduled')
    into source_club_id, source_team_id, source_title, source_starts_at, source_location, source_status
    from public.assessment_sessions session
    where session.id = event_id_value
      and session.club_id = actor.club_id
    for update;
  end if;

  if source_club_id is null or source_team_id is null then
    raise exception 'The event was not found in the active club and team.';
  end if;

  if normalized_source_type = 'match-day'
    and cardinality(selected_removal_player_ids) > 0
    and source_status not in ('scheduled', 'scorer_request') then
    raise exception 'Selected players cannot be removed after the fixture selection is locked.';
  end if;

  actor_name := coalesce(
    nullif(btrim(actor.display_name), ''),
    nullif(btrim(actor.name), ''),
    nullif(btrim(actor.email), ''),
    'Team staff'
  );

  insert into public.event_player_change_commands (
    club_id,
    team_id,
    calendar_event_id,
    match_day_id,
    assessment_session_id,
    source_type,
    event_type,
    request_token,
    selected_player_ids,
    added_player_ids,
    removed_player_ids,
    unchanged_player_ids,
    communication_mode,
    requested_by
  ) values (
    source_club_id,
    source_team_id,
    case when normalized_source_type = 'calendar' then event_id_value else null end,
    case when normalized_source_type = 'match-day' then event_id_value else null end,
    case when normalized_source_type = 'session' then event_id_value else null end,
    normalized_source_type,
    source_event_type,
    request_token_value,
    selected_player_ids,
    added_player_ids,
    removed_player_ids,
    unchanged_player_ids,
    normalized_communication_mode,
    actor.id
  )
  returning *
  into command_record;

  update public.calendar_event_invites invite
  set
    invite_status = 'cancelled',
    cancelled_at = coalesce(invite.cancelled_at, timezone('utc', now())),
    updated_by = actor.id,
    updated_by_name = actor_name,
    updated_by_email = coalesce(actor.email, '')
  where invite.club_id = source_club_id
    and invite.team_id = source_team_id
    and invite.invite_status <> 'cancelled'
    and invite.player_id = any(removed_player_ids)
    and (
      (normalized_source_type = 'calendar' and invite.calendar_event_id = event_id_value)
      or (normalized_source_type = 'match-day' and invite.match_day_id = event_id_value)
      or (normalized_source_type = 'session' and invite.assessment_session_id = event_id_value)
    );

  insert into public.calendar_event_invites (
    club_id,
    team_id,
    calendar_event_id,
    assessment_session_id,
    match_day_id,
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
    response_requirement,
    cancelled_at,
    created_by,
    created_by_name,
    created_by_email,
    updated_by,
    updated_by_name,
    updated_by_email
  )
  select
    source_club_id,
    source_team_id,
    case when normalized_source_type = 'calendar' then event_id_value else null end,
    case when normalized_source_type = 'session' then event_id_value else null end,
    case when normalized_source_type = 'match-day' then event_id_value else null end,
    player.id,
    primary_contact.parent_link_id,
    coalesce(player.section, ''),
    coalesce(primary_contact.recipient_type, case when player.contact_type = 'self' then 'player' else 'parent_guardian' end),
    coalesce(primary_contact.recipient_name, player.parent_name, ''),
    case when coalesce(primary_contact.recipient_type, '') = 'player' then '' else coalesce(primary_contact.recipient_email, '') end,
    case when coalesce(primary_contact.recipient_type, '') = 'player' then coalesce(primary_contact.recipient_email, '') else '' end,
    coalesce(player.parent_contacts, '[]'::jsonb),
    'active',
    false,
    case when normalized_source_type = 'match-day' then 'response_required' else 'informational' end,
    null,
    actor.id,
    actor_name,
    coalesce(actor.email, ''),
    actor.id,
    actor_name,
    coalesce(actor.email, '')
  from public.players player
  left join lateral (
    select eligible_recipient.*
    from public.event_player_eligible_recipients(
      source_club_id,
      source_team_id,
      array[player.id]
    ) eligible_recipient
    order by eligible_recipient.recipient_type, eligible_recipient.recipient_email
    limit 1
  ) primary_contact on true
  where player.id = any(selected_player_ids)
    and player.club_id = source_club_id
    and player.team_id = source_team_id
  on conflict (club_id, player_id, calendar_event_id, assessment_session_id, match_day_id)
  do update
  set
    team_id = excluded.team_id,
    parent_link_id = excluded.parent_link_id,
    player_status_at_invite = excluded.player_status_at_invite,
    recipient_type = excluded.recipient_type,
    parent_contact_name = excluded.parent_contact_name,
    parent_contact_email = excluded.parent_contact_email,
    player_contact_email = excluded.player_contact_email,
    recipient_contacts = excluded.recipient_contacts,
    invite_status = case
      when public.calendar_event_invites.responded_at is not null
        and public.calendar_event_invites.invite_status <> 'cancelled'
        then public.calendar_event_invites.invite_status
      else 'active'
    end,
    notify_requested = case
      when public.calendar_event_invites.invite_status = 'cancelled' then false
      else public.calendar_event_invites.notify_requested
    end,
    response_requirement = excluded.response_requirement,
    cancelled_at = null,
    updated_by = actor.id,
    updated_by_name = actor_name,
    updated_by_email = coalesce(actor.email, '');

  if normalized_source_type = 'match-day' and cardinality(selected_removal_player_ids) > 0 then
    insert into public.match_day_player_squad_decisions (
      match_day_id,
      club_id,
      team_id,
      player_id,
      status,
      decided_by,
      decided_by_name,
      decided_at,
      updated_at
    )
    select
      event_id_value,
      source_club_id,
      source_team_id,
      removed_id,
      'not_selected',
      actor.id,
      actor_name,
      timezone('utc', now()),
      timezone('utc', now())
    from unnest(selected_removal_player_ids) removed_id
    on conflict on constraint match_day_player_squad_decisions_match_player_key
    do update
    set
      status = 'not_selected',
      decided_by = actor.id,
      decided_by_name = actor_name,
      decided_at = timezone('utc', now()),
      updated_at = timezone('utc', now());

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
    select
      source_club_id,
      source_team_id,
      event_id_value,
      removed_id,
      actor.id,
      actor_name,
      coalesce(nullif(actor.role_label, ''), actor.role, ''),
      'player_squad_decision_changed',
      'Selected player removed from event participants',
      jsonb_build_object('status', 'selected'),
      jsonb_build_object('status', 'not_selected'),
      jsonb_build_object(
        'source', 'event_player_management',
        'commandId', command_record.id,
        'participantRemoved', true
      )
    from unnest(selected_removal_player_ids) removed_id;
  end if;

  if normalized_source_type = 'calendar'
    and source_event_type = 'training'
    and cardinality(removed_player_ids) > 0 then
    update public.training_availability_request_players request_player
    set
      status = 'cancelled',
      updated_at = timezone('utc', now())
    where request_player.calendar_event_id = event_id_value
      and request_player.club_id = source_club_id
      and request_player.team_id = source_team_id
      and request_player.player_id = any(removed_player_ids)
      and request_player.status in ('pending', 'queued', 'sent', 'failed');
  end if;

  if normalized_communication_mode = 'notify_added' then
    target_player_ids := added_player_ids;
    missing_contact_player_ids := coalesce(
      array(select jsonb_array_elements_text(preview -> 'addedMissingContactPlayerIds')::uuid),
      '{}'::uuid[]
    );
    notification_kind_value := 'player_added';
    recipient_count := coalesce((preview ->> 'addedRecipientCount')::integer, 0);
  elsif normalized_communication_mode = 'notify_removed' then
    target_player_ids := removed_player_ids;
    missing_contact_player_ids := coalesce(
      array(select jsonb_array_elements_text(preview -> 'removedMissingContactPlayerIds')::uuid),
      '{}'::uuid[]
    );
    notification_kind_value := 'player_removed';
    recipient_count := coalesce((preview ->> 'removedRecipientCount')::integer, 0);
  elsif normalized_communication_mode = 'resend_all' then
    target_player_ids := selected_player_ids;
    missing_contact_player_ids := coalesce(
      array(select jsonb_array_elements_text(preview -> 'currentMissingContactPlayerIds')::uuid),
      '{}'::uuid[]
    );
    notification_kind_value := 'resend_all';
    recipient_count := coalesce((preview ->> 'currentRecipientCount')::integer, 0);
  end if;

  select coalesce(club.name, ''), coalesce(team.name, '')
  into club_name_value, team_name_value
  from public.clubs club
  join public.teams team on team.id = source_team_id
  where club.id = source_club_id;

  if normalized_communication_mode <> 'none'
    and not (
      normalized_source_type = 'match-day'
      and normalized_communication_mode in ('notify_added', 'resend_all')
    ) then
    if not public.can_use_plan_feature(source_club_id, 'parentEmails') then
      raise exception 'The current club plan does not include event email notifications.';
    end if;

    subject_value := case normalized_communication_mode
      when 'notify_added' then concat('Added to event: ', source_title)
      when 'notify_removed' then concat('Event participant update: ', source_title)
      else concat('Event reminder: ', source_title)
    end;

    for recipient in
      select *
      from public.event_player_eligible_recipients(
        source_club_id,
        source_team_id,
        target_player_ids
      )
      order by player_id, recipient_email
    loop
      queue_id_value := null;

      begin
        insert into public.event_player_notification_events (
          command_id,
          club_id,
          team_id,
          player_id,
          parent_link_id,
          recipient_type,
          recipient_email,
          notification_kind,
          status
        ) values (
          command_record.id,
          source_club_id,
          source_team_id,
          recipient.player_id,
          recipient.parent_link_id,
          recipient.recipient_type,
          recipient.recipient_email,
          notification_kind_value,
          'queued'
        )
        on conflict on constraint event_player_notification_events_command_recipient_key
        do nothing;

        if not found then
          continue;
        end if;

        html_value := concat(
          '<div style="font-family:Arial,sans-serif;color:#142018;background:#ffffff;padding:28px;line-height:1.55;max-width:720px;margin:0 auto;">',
          '<p style="margin:0 0 10px;color:#047857;font-size:12px;font-weight:700;text-transform:uppercase;">Event participant update</p>',
          '<h1 style="margin:0 0 14px;font-size:24px;">',
          public.calendar_event_notification_escape_html(source_title),
          '</h1><p style="margin:0 0 18px;font-size:15px;">Hi ',
          public.calendar_event_notification_escape_html(recipient.recipient_name),
          ', ',
          case normalized_communication_mode
            when 'notify_added' then concat(
              public.calendar_event_notification_escape_html(recipient.player_name),
              ' has been added to this event.'
            )
            when 'notify_removed' then concat(
              public.calendar_event_notification_escape_html(recipient.player_name),
              ' is no longer listed for this event.'
            )
            else concat(
              'this is a reminder about the event for ',
              public.calendar_event_notification_escape_html(recipient.player_name),
              '.'
            )
          end,
          '</p><div style="border:1px solid #e7ece3;border-radius:12px;background:#fbfcf9;padding:14px 16px;margin:0 0 20px;">',
          '<p><strong>Team:</strong> ', public.calendar_event_notification_escape_html(team_name_value), '</p>',
          '<p><strong>Event:</strong> ', public.calendar_event_notification_escape_html(source_title), '</p>',
          '<p><strong>When:</strong> ', public.calendar_event_notification_escape_html(
            coalesce(to_char(source_starts_at at time zone 'Europe/London', 'Dy DD Mon YYYY at HH24:MI'), 'Not set')
          ), '</p>',
          case when btrim(coalesce(source_location, '')) = '' then '' else concat(
            '<p><strong>Location:</strong> ',
            public.calendar_event_notification_escape_html(source_location),
            '</p>'
          ) end,
          '</div><p style="margin:0;color:#5a6b5b;font-size:13px;">',
          public.calendar_event_notification_escape_html(coalesce(club_name_value, 'Football Player')),
          ' | ',
          public.calendar_event_notification_escape_html(coalesce(team_name_value, 'Team')),
          '</p></div>'
        );

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
          source_club_id,
          source_team_id,
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
            'displayName', actor_name,
            'teamName', team_name_value,
            'clubName', club_name_value,
            'playerName', recipient.player_name,
            'parentName', recipient.recipient_name,
            'clubId', source_club_id,
            'teamId', source_team_id,
            'actorId', actor.id,
            'actorEmail', coalesce(actor.email, ''),
            'actorRole', actor.role,
            'requiredFeature', 'parentEmails',
            'visibleInEmailQueue', true,
            'communicationLog', jsonb_build_object(
              'clubId', source_club_id,
              'playerId', recipient.player_id,
              'userId', actor.id,
              'userName', actor_name,
              'userEmail', coalesce(actor.email, ''),
              'recipientEmail', recipient.recipient_email,
              'metadata', jsonb_build_object(
                'source', 'event_player_change_notification',
                'eventSource', normalized_source_type,
                'eventId', event_id_value,
                'eventPlayerChangeCommandId', command_record.id,
                'notificationKind', notification_kind_value,
                'idempotencyKey', concat(
                  'event-player-change:',
                  command_record.id,
                  ':',
                  recipient.player_id,
                  ':',
                  recipient.recipient_email
                )
              )
            )
          )
        )
        returning id
        into queue_id_value;

        update public.event_player_notification_events notification
        set email_queue_id = queue_id_value
        where notification.command_id = command_record.id
          and notification.player_id = recipient.player_id
          and notification.recipient_email = recipient.recipient_email
          and notification.notification_kind = notification_kind_value;

        queued_count := queued_count + 1;
      exception when others then
        failed_count := failed_count + 1;

        update public.event_player_notification_events notification
        set
          status = 'failed',
          last_error = left(sqlerrm, 1000)
        where notification.command_id = command_record.id
          and notification.player_id = recipient.player_id
          and notification.recipient_email = recipient.recipient_email
          and notification.notification_kind = notification_kind_value;
      end;
    end loop;
  end if;

  if normalized_communication_mode in ('notify_added', 'resend_all') then
    update public.calendar_event_invites invite
    set
      notify_requested = true,
      updated_by = actor.id,
      updated_by_name = actor_name,
      updated_by_email = coalesce(actor.email, '')
    where invite.club_id = source_club_id
      and invite.team_id = source_team_id
      and invite.player_id = any(target_player_ids)
      and invite.invite_status <> 'cancelled'
      and (
        (normalized_source_type = 'calendar' and invite.calendar_event_id = event_id_value)
        or (normalized_source_type = 'match-day' and invite.match_day_id = event_id_value)
        or (normalized_source_type = 'session' and invite.assessment_session_id = event_id_value)
      );
  elsif normalized_communication_mode = 'notify_removed' then
    update public.calendar_event_invites invite
    set
      notify_requested = true,
      updated_by = actor.id,
      updated_by_name = actor_name,
      updated_by_email = coalesce(actor.email, '')
    where invite.club_id = source_club_id
      and invite.team_id = source_team_id
      and invite.player_id = any(target_player_ids)
      and invite.invite_status = 'cancelled'
      and (
        (normalized_source_type = 'calendar' and invite.calendar_event_id = event_id_value)
        or (normalized_source_type = 'match-day' and invite.match_day_id = event_id_value)
        or (normalized_source_type = 'session' and invite.assessment_session_id = event_id_value)
      );
  end if;

  result_value := preview || jsonb_build_object(
    'commandId', command_record.id,
    'communicationMode', normalized_communication_mode,
    'recipientCount', recipient_count,
    'missingContactCount', cardinality(missing_contact_player_ids),
    'queuedCount', queued_count,
    'failedCount', failed_count,
    'duplicate', false
  );

  update public.event_player_change_commands command
  set
    result = result_value,
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
    source_club_id,
    actor.id,
    'event_players_changed',
    case normalized_source_type
      when 'calendar' then 'calendar_event'
      when 'match-day' then 'match_day'
      else 'assessment_session'
    end,
    event_id_value,
    jsonb_build_object(
      'commandId', command_record.id,
      'teamId', source_team_id,
      'eventType', source_event_type,
      'sourceType', normalized_source_type,
      'addedPlayerIds', to_jsonb(added_player_ids),
      'removedPlayerIds', to_jsonb(removed_player_ids),
      'unchangedPlayerIds', to_jsonb(unchanged_player_ids),
      'selectedRemovalPlayerIds', to_jsonb(selected_removal_player_ids),
      'communicationMode', normalized_communication_mode,
      'recipientCount', recipient_count,
      'queuedCount', queued_count,
      'failedCount', failed_count,
      'missingContactPlayerIds', to_jsonb(missing_contact_player_ids),
      'deliverySource', case
        when normalized_source_type = 'match-day'
          and normalized_communication_mode in ('notify_added', 'resend_all')
          then 'match_day_availability_command'
        when normalized_communication_mode = 'none'
          then 'none'
        else 'scheduled_email_queue'
      end,
      'selectedRemovalConfirmed', confirm_selected_removals_value is true
    )
  );

  return result_value;
end;
$$;

revoke all on function public.apply_event_player_changes(text, uuid, uuid[], text, uuid, boolean)
from public, anon;
grant execute on function public.apply_event_player_changes(text, uuid, uuid[], text, uuid, boolean)
to authenticated, service_role;

comment on table public.event_player_change_commands is
  'Idempotent server-authoritative event participant delta and communication commands.';

comment on table public.event_player_notification_events is
  'Per-player delivery ledger for explicit event participant change notifications.';

comment on function public.preview_event_player_changes(text, uuid, uuid[]) is
  'Returns the authoritative event participant delta, selected-player removal risk, and exact server-resolved contact counts.';

comment on function public.apply_event_player_changes(text, uuid, uuid[], text, uuid, boolean) is
  'Applies participant changes separately from communications, preserves historical invite rows, and records an idempotent audit command.';
