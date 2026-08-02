create table if not exists public.event_player_occurrence_exclusions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  calendar_event_id uuid not null references public.calendar_events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  scope text not null check (scope in ('occurrence', 'this_and_future')),
  effective_from_date date not null,
  removed_by uuid references auth.users(id) on delete set null,
  removed_by_name text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  constraint event_player_occurrence_exclusions_scope_date_key
    unique (calendar_event_id, player_id, scope, effective_from_date)
);

create index if not exists event_player_occurrence_exclusions_lookup_idx
on public.event_player_occurrence_exclusions (
  calendar_event_id,
  player_id,
  effective_from_date,
  scope
);

create table if not exists public.event_player_removal_commands (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  calendar_event_id uuid references public.calendar_events(id) on delete cascade,
  match_day_id uuid references public.match_days(id) on delete cascade,
  source_type text not null check (source_type in ('calendar', 'match-day')),
  player_id uuid not null references public.players(id) on delete restrict,
  scope text not null check (scope in ('event', 'occurrence', 'this_and_future')),
  occurrence_date date,
  request_token uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  affected_occurrence_count integer not null default 0 check (affected_occurrence_count >= 0),
  suppressed_invitation_count integer not null default 0 check (suppressed_invitation_count >= 0),
  revoked_token_count integer not null default 0 check (revoked_token_count >= 0),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint event_player_removal_commands_source_check check (
    (source_type = 'calendar' and calendar_event_id is not null and match_day_id is null)
    or (source_type = 'match-day' and calendar_event_id is null and match_day_id is not null)
  ),
  constraint event_player_removal_commands_actor_request_key
    unique (requested_by, request_token)
);

create index if not exists event_player_removal_commands_source_player_idx
on public.event_player_removal_commands (
  club_id,
  team_id,
  source_type,
  coalesce(calendar_event_id, match_day_id),
  player_id,
  created_at desc
);

alter table public.event_player_occurrence_exclusions enable row level security;
alter table public.event_player_removal_commands enable row level security;

revoke all on public.event_player_occurrence_exclusions from public, anon, authenticated;
revoke all on public.event_player_removal_commands from public, anon, authenticated;
grant select on public.event_player_occurrence_exclusions to authenticated, service_role;
grant select on public.event_player_removal_commands to authenticated, service_role;
grant insert, update, delete on public.event_player_occurrence_exclusions to service_role;
grant insert, update, delete on public.event_player_removal_commands to service_role;

drop policy if exists event_player_occurrence_exclusions_select_scoped
on public.event_player_occurrence_exclusions;
create policy event_player_occurrence_exclusions_select_scoped
on public.event_player_occurrence_exclusions
for select
to authenticated
using (
  club_id = public.current_user_club_id()
  and (
    (
      public.current_user_role_rank() >= 20
      and public.current_user_role() <> 'super_admin'
      and (
        public.current_user_role() = 'admin'
        or exists (
          select 1
          from public.team_staff assignment
          where assignment.team_id = event_player_occurrence_exclusions.team_id
            and assignment.user_id = auth.uid()
        )
      )
    )
    or exists (
      select 1
      from public.parent_player_links link
      where link.player_id = event_player_occurrence_exclusions.player_id
        and link.club_id = event_player_occurrence_exclusions.club_id
        and link.team_id = event_player_occurrence_exclusions.team_id
        and link.auth_user_id = auth.uid()
        and link.status = 'active'
    )
    or exists (
      select 1
      from public.adult_player_account_links link
      where link.player_id = event_player_occurrence_exclusions.player_id
        and link.club_id = event_player_occurrence_exclusions.club_id
        and link.team_id = event_player_occurrence_exclusions.team_id
        and link.user_id = auth.uid()
        and link.status = 'active'
        and link.revoked_at is null
    )
  )
);

drop policy if exists event_player_removal_commands_select_scoped
on public.event_player_removal_commands;
create policy event_player_removal_commands_select_scoped
on public.event_player_removal_commands
for select
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 20
  and public.current_user_role() <> 'super_admin'
  and (
    public.current_user_role() = 'admin'
    or exists (
      select 1
      from public.team_staff assignment
      where assignment.team_id = event_player_removal_commands.team_id
        and assignment.user_id = auth.uid()
    )
  )
);

create or replace function public.is_calendar_event_player_excluded_internal(
  calendar_event_id_value uuid,
  player_id_value uuid,
  occurrence_date_value date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.event_player_occurrence_exclusions exclusion
    where exclusion.calendar_event_id = calendar_event_id_value
      and exclusion.player_id = player_id_value
      and (
        (exclusion.scope = 'occurrence' and exclusion.effective_from_date = occurrence_date_value)
        or (exclusion.scope = 'this_and_future' and exclusion.effective_from_date <= occurrence_date_value)
      )
  );
$$;

revoke all on function public.is_calendar_event_player_excluded_internal(uuid, uuid, date)
from public, anon, authenticated;
grant execute on function public.is_calendar_event_player_excluded_internal(uuid, uuid, date)
to service_role;

create or replace function public.preview_event_player_removal(
  source_type_value text,
  event_id_value uuid,
  player_id_value uuid,
  occurrence_date_value date default null,
  scope_value text default 'event'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  normalized_source_type text := lower(btrim(coalesce(source_type_value, '')));
  normalized_scope text := lower(btrim(coalesce(scope_value, '')));
  source_club_id uuid;
  source_team_id uuid;
  source_title text;
  source_event_type text;
  source_start timestamptz;
  source_end timestamptz;
  recurrence_frequency_value text := 'none';
  recurrence_until_value date;
  first_occurrence_date date;
  cursor_date date;
  cursor_start timestamptz;
  cursor_end timestamptz;
  occurrence_duration interval := interval '1 hour';
  active_participation boolean := false;
  already_removed boolean := false;
  affected_occurrence_count integer := 0;
  pending_invitation_count integer := 0;
  active_token_count integer := 0;
  requires_in_progress_confirmation boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to remove a Player from an event.';
  end if;

  if normalized_source_type not in ('calendar', 'match-day') then
    raise exception 'Choose a supported saved event before removing a Player.';
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
    raise exception 'Coach or manager access is required to remove a Player from an event.';
  end if;

  if normalized_source_type = 'calendar' then
    select
      event.club_id,
      event.team_id,
      coalesce(nullif(btrim(event.title), ''), 'Calendar event'),
      lower(btrim(coalesce(event.event_type, 'general'))),
      event.starts_at,
      coalesce(event.ends_at, event.starts_at + interval '1 hour'),
      lower(btrim(coalesce(event.recurrence_frequency, 'none'))),
      event.recurrence_until
    into
      source_club_id,
      source_team_id,
      source_title,
      source_event_type,
      source_start,
      source_end,
      recurrence_frequency_value,
      recurrence_until_value
    from public.calendar_events event
    where event.id = event_id_value
      and event.club_id = actor.club_id
      and event.cancelled_at is null;
  else
    select
      fixture.club_id,
      fixture.team_id,
      concat('Match vs ', coalesce(nullif(btrim(fixture.opponent), ''), 'Opponent')),
      'match',
      case
        when fixture.kickoff_time_tbc is true or fixture.kickoff_time is null
          then fixture.match_date::timestamp at time zone 'Europe/London'
        else (fixture.match_date + fixture.kickoff_time)::timestamp at time zone 'Europe/London'
      end,
      case
        when fixture.kickoff_time_tbc is true or fixture.kickoff_time is null
          then fixture.match_date::timestamp at time zone 'Europe/London' + interval '2 hours'
        else (fixture.match_date + fixture.kickoff_time)::timestamp at time zone 'Europe/London' + interval '2 hours'
      end,
      'none',
      null
    into
      source_club_id,
      source_team_id,
      source_title,
      source_event_type,
      source_start,
      source_end,
      recurrence_frequency_value,
      recurrence_until_value
    from public.match_days fixture
    where fixture.id = event_id_value
      and fixture.club_id = actor.club_id
      and fixture.deleted_at is null
      and fixture.status not in ('cancelled', 'full_time');
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
    raise exception 'You do not have permission to remove Players from this event team.';
  end if;

  if not exists (
    select 1
    from public.players player
    where player.id = player_id_value
      and player.club_id = source_club_id
      and player.team_id = source_team_id
      and coalesce(player.status, 'active') <> 'archived'
  ) then
    raise exception 'The Player is outside the event team or is no longer active.';
  end if;

  select exists (
    select 1
    from public.calendar_event_invites invite
    where invite.club_id = source_club_id
      and invite.team_id = source_team_id
      and invite.player_id = player_id_value
      and invite.invite_status <> 'cancelled'
      and invite.cancelled_at is null
      and (
        (normalized_source_type = 'calendar' and invite.calendar_event_id = event_id_value)
        or (normalized_source_type = 'match-day' and invite.match_day_id = event_id_value)
      )
  ) into active_participation;

  first_occurrence_date := (source_start at time zone 'Europe/London')::date;
  occurrence_duration := greatest(source_end - source_start, interval '1 minute');

  if normalized_source_type = 'match-day' or recurrence_frequency_value = 'none' then
    if normalized_scope <> 'event' then
      raise exception 'Use Remove from event for a standalone event.';
    end if;

    if source_end <= timezone('utc', now()) then
      raise exception 'Completed event participation cannot be removed from history.';
    end if;

    requires_in_progress_confirmation := source_start <= timezone('utc', now());
    already_removed := not active_participation;
    affected_occurrence_count := case when active_participation then 1 else 0 end;
  else
    if normalized_scope not in ('occurrence', 'this_and_future') then
      raise exception 'Choose Remove from this occurrence or Remove from this and future occurrences.';
    end if;

    if occurrence_date_value is null then
      raise exception 'Choose the recurring event occurrence to remove.';
    end if;

    cursor_date := first_occurrence_date;
    while cursor_date <= coalesce(recurrence_until_value, first_occurrence_date) loop
      if cursor_date = occurrence_date_value then
        exit;
      end if;

      cursor_date := case recurrence_frequency_value
        when 'weekly' then cursor_date + 7
        when 'fortnightly' then cursor_date + 14
        when 'monthly' then (cursor_date + interval '1 month')::date
        else coalesce(recurrence_until_value, first_occurrence_date) + 1
      end;
    end loop;

    if cursor_date <> occurrence_date_value then
      raise exception 'The selected date is not an occurrence in this recurring series.';
    end if;

    cursor_start := source_start + (occurrence_date_value - first_occurrence_date) * interval '1 day';
    cursor_end := cursor_start + occurrence_duration;

    if cursor_end <= timezone('utc', now()) then
      raise exception 'Completed event participation cannot be removed from history.';
    end if;

    requires_in_progress_confirmation := cursor_start <= timezone('utc', now());
    already_removed := public.is_calendar_event_player_excluded_internal(
      event_id_value,
      player_id_value,
      occurrence_date_value
    );

    if not active_participation and not already_removed then
      raise exception 'The Player is not currently attached to this event.';
    end if;

    cursor_date := occurrence_date_value;
    while cursor_date <= coalesce(recurrence_until_value, occurrence_date_value) loop
      cursor_start := source_start + (cursor_date - first_occurrence_date) * interval '1 day';
      cursor_end := cursor_start + occurrence_duration;

      if cursor_end > timezone('utc', now())
        and not public.is_calendar_event_player_excluded_internal(event_id_value, player_id_value, cursor_date) then
        affected_occurrence_count := affected_occurrence_count + 1;
      end if;

      if normalized_scope = 'occurrence' then
        exit;
      end if;

      cursor_date := case recurrence_frequency_value
        when 'weekly' then cursor_date + 7
        when 'fortnightly' then cursor_date + 14
        when 'monthly' then (cursor_date + interval '1 month')::date
        else coalesce(recurrence_until_value, occurrence_date_value) + 1
      end;
    end loop;
  end if;

  if normalized_source_type = 'match-day' then
    select count(*) into active_token_count
    from public.match_day_availability_requests request
    where request.match_day_id = event_id_value
      and request.club_id = source_club_id
      and request.team_id = source_team_id
      and request.player_id = player_id_value
      and request.token_revoked_at is null;

    select count(*) into pending_invitation_count
    from public.scheduled_email_queue queue
    join public.match_day_availability_requests request
      on request.id::text = queue.payload #>> '{matchDayAvailability,requestId}'
    where request.match_day_id = event_id_value
      and request.player_id = player_id_value
      and queue.provider_message_id is null
      and queue.provider_accepted_at is null
      and queue.delivery_state not in ('cancelled', 'delivered', 'bounced', 'failed');
  elsif source_event_type = 'training' then
    select count(*) into active_token_count
    from public.training_availability_request_players recipient
    join public.training_availability_requests request on request.id = recipient.request_id
    where request.calendar_event_id = event_id_value
      and recipient.player_id = player_id_value
      and recipient.token_revoked_at is null
      and (
        recurrence_frequency_value = 'none'
        or (normalized_scope = 'occurrence' and request.occurrence_date = occurrence_date_value)
        or (normalized_scope = 'this_and_future' and request.occurrence_date >= occurrence_date_value)
      );

    select count(*) into pending_invitation_count
    from public.scheduled_email_queue queue
    join public.training_availability_request_players recipient on recipient.email_queue_id = queue.id
    join public.training_availability_requests request on request.id = recipient.request_id
    where request.calendar_event_id = event_id_value
      and recipient.player_id = player_id_value
      and queue.provider_message_id is null
      and queue.provider_accepted_at is null
      and queue.delivery_state not in ('cancelled', 'delivered', 'bounced', 'failed')
      and (
        recurrence_frequency_value = 'none'
        or (normalized_scope = 'occurrence' and request.occurrence_date = occurrence_date_value)
        or (normalized_scope = 'this_and_future' and request.occurrence_date >= occurrence_date_value)
      );
  end if;

  if recurrence_frequency_value = 'none' or normalized_scope = 'this_and_future' then
    select pending_invitation_count + count(*) into pending_invitation_count
    from public.event_player_notification_events notification
    join public.event_player_change_commands command on command.id = notification.command_id
    join public.scheduled_email_queue queue on queue.id = notification.email_queue_id
    where command.club_id = source_club_id
      and command.team_id = source_team_id
      and notification.player_id = player_id_value
      and notification.status = 'queued'
      and queue.provider_message_id is null
      and queue.provider_accepted_at is null
      and queue.delivery_state not in ('cancelled', 'delivered', 'bounced', 'failed')
      and (
        (normalized_source_type = 'calendar' and command.calendar_event_id = event_id_value)
        or (normalized_source_type = 'match-day' and command.match_day_id = event_id_value)
      );
  end if;

  return jsonb_build_object(
    'eventId', event_id_value,
    'playerId', player_id_value,
    'clubId', source_club_id,
    'teamId', source_team_id,
    'eventTitle', source_title,
    'eventType', source_event_type,
    'sourceType', normalized_source_type,
    'scope', normalized_scope,
    'occurrenceDate', occurrence_date_value,
    'recurring', recurrence_frequency_value <> 'none',
    'alreadyRemoved', already_removed,
    'affectedOccurrenceCount', affected_occurrence_count,
    'suppressedInvitationCount', pending_invitation_count,
    'revokedTokenCount', active_token_count,
    'requiresInProgressConfirmation', requires_in_progress_confirmation,
    'teamMembershipUnchanged', true,
    'playerRecordPreserved', true,
    'historyPreserved', true,
    'communicationWillBeSent', false
  );
end;
$$;

revoke all on function public.preview_event_player_removal(text, uuid, uuid, date, text)
from public, anon;
grant execute on function public.preview_event_player_removal(text, uuid, uuid, date, text)
to authenticated, service_role;

create or replace function public.remove_player_from_event(
  source_type_value text,
  event_id_value uuid,
  player_id_value uuid,
  occurrence_date_value date default null,
  scope_value text default 'event',
  request_token_value uuid default null,
  confirm_in_progress_value boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  normalized_source_type text := lower(btrim(coalesce(source_type_value, '')));
  normalized_scope text := lower(btrim(coalesce(scope_value, '')));
  preview jsonb;
  existing_command public.event_player_removal_commands%rowtype;
  source_club_id uuid;
  source_team_id uuid;
  actor_name text;
  suppressed_count integer := 0;
  changed_count integer := 0;
  revoked_count integer := 0;
  queue_count integer := 0;
  result_value jsonb;
  previous_state_value jsonb;
  command_id_value uuid;
begin
  if request_token_value is null then
    raise exception 'A removal request token is required.';
  end if;

  select profile.* into actor
  from public.users profile
  where profile.id = auth.uid()
  limit 1;

  if actor.id is null then
    raise exception 'Authentication is required to remove a Player from an event.';
  end if;

  select command.* into existing_command
  from public.event_player_removal_commands command
  where command.requested_by = actor.id
    and command.request_token = request_token_value
  limit 1;

  if existing_command.id is not null then
    if existing_command.source_type <> normalized_source_type
      or coalesce(existing_command.calendar_event_id, existing_command.match_day_id) <> event_id_value
      or existing_command.player_id <> player_id_value
      or existing_command.scope <> normalized_scope
      or existing_command.occurrence_date is distinct from occurrence_date_value then
      raise exception 'This removal request token was already used for another action.';
    end if;

    return existing_command.result || jsonb_build_object('duplicate', true, 'commandId', existing_command.id);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      concat('event-player-removal:', normalized_source_type, ':', event_id_value::text, ':', player_id_value::text),
      0
    )
  );

  select command.* into existing_command
  from public.event_player_removal_commands command
  where command.requested_by = actor.id
    and command.request_token = request_token_value
  limit 1;

  if existing_command.id is not null then
    return existing_command.result || jsonb_build_object('duplicate', true, 'commandId', existing_command.id);
  end if;

  preview := public.preview_event_player_removal(
    normalized_source_type,
    event_id_value,
    player_id_value,
    occurrence_date_value,
    normalized_scope
  );

  if coalesce((preview ->> 'requiresInProgressConfirmation')::boolean, false)
    and confirm_in_progress_value is not true then
    raise exception 'Confirm removal from the event currently in progress.';
  end if;

  source_club_id := (preview ->> 'clubId')::uuid;
  source_team_id := (preview ->> 'teamId')::uuid;
  actor_name := coalesce(
    nullif(btrim(actor.display_name), ''),
    nullif(btrim(actor.name), ''),
    nullif(btrim(actor.email), ''),
    'Team staff'
  );
  previous_state_value := jsonb_build_object(
    'participation', case when coalesce((preview ->> 'alreadyRemoved')::boolean, false) then 'removed' else 'active' end,
    'teamMembership', 'active',
    'currentResponseRetainedAsHistory', true
  );

  if normalized_source_type = 'calendar' and coalesce((preview ->> 'recurring')::boolean, false) then
    insert into public.event_player_occurrence_exclusions (
      club_id,
      team_id,
      calendar_event_id,
      player_id,
      scope,
      effective_from_date,
      removed_by,
      removed_by_name
    ) values (
      source_club_id,
      source_team_id,
      event_id_value,
      player_id_value,
      normalized_scope,
      occurrence_date_value,
      actor.id,
      actor_name
    )
    on conflict on constraint event_player_occurrence_exclusions_scope_date_key do nothing;
  else
    update public.calendar_event_invites invite
    set invite_status = 'cancelled',
        notify_requested = false,
        cancelled_at = coalesce(invite.cancelled_at, timezone('utc', now())),
        updated_by = actor.id,
        updated_by_name = actor_name,
        updated_by_email = coalesce(actor.email, ''),
        updated_at = timezone('utc', now())
    where invite.club_id = source_club_id
      and invite.team_id = source_team_id
      and invite.player_id = player_id_value
      and invite.invite_status <> 'cancelled'
      and invite.cancelled_at is null
      and (
        (normalized_source_type = 'calendar' and invite.calendar_event_id = event_id_value)
        or (normalized_source_type = 'match-day' and invite.match_day_id = event_id_value)
      );
  end if;

  if normalized_source_type = 'match-day' then
    with changed as (
      update public.match_day_availability_requests request
      set token_revoked_at = coalesce(request.token_revoked_at, timezone('utc', now())),
          token_revoked_reason = coalesce(request.token_revoked_reason, 'event_participation_removed'),
          token_revoked_by = coalesce(request.token_revoked_by, actor.id),
          token_revoked_source = coalesce(request.token_revoked_source, 'remove_player_from_event'),
          updated_at = timezone('utc', now())
      where request.match_day_id = event_id_value
        and request.club_id = source_club_id
        and request.team_id = source_team_id
        and request.player_id = player_id_value
        and request.token_revoked_at is null
      returning request.id
    )
    select count(*) into revoked_count from changed;

    with cancelled as (
      update public.scheduled_email_queue queue
      set status = 'failed',
          delivery_state = 'cancelled',
          retry_enabled = false,
          next_retry_at = null,
          lease_owner = null,
          leased_at = null,
          lease_expires_at = null,
          terminal_at = coalesce(queue.terminal_at, timezone('utc', now())),
          failure_category = 'authorization',
          safe_error_code = 'event_participation_removed',
          last_error = 'Cancelled because the Player was removed from the event.',
          updated_at = timezone('utc', now())
      where queue.provider_message_id is null
        and queue.provider_accepted_at is null
        and queue.delivery_state not in ('cancelled', 'delivered', 'bounced', 'failed')
        and exists (
          select 1
          from public.match_day_availability_requests request
          where request.match_day_id = event_id_value
            and request.player_id = player_id_value
            and request.id::text = queue.payload #>> '{matchDayAvailability,requestId}'
        )
      returning queue.id
    )
    select count(*) into queue_count from cancelled;

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
      player_id_value,
      'not_selected',
      actor.id,
      actor_name,
      timezone('utc', now()),
      timezone('utc', now())
    where exists (
      select 1
      from public.match_day_player_squad_decisions decision
      where decision.match_day_id = event_id_value
        and decision.player_id = player_id_value
        and decision.status = 'selected'
    )
    on conflict on constraint match_day_player_squad_decisions_match_player_key
    do update set
      status = 'not_selected',
      decided_by = actor.id,
      decided_by_name = actor_name,
      decided_at = timezone('utc', now()),
      updated_at = timezone('utc', now());
  else
    with affected_recipients as (
      select recipient.id, recipient.email_queue_id
      from public.training_availability_request_players recipient
      join public.training_availability_requests request on request.id = recipient.request_id
      where request.calendar_event_id = event_id_value
        and recipient.club_id = source_club_id
        and recipient.team_id = source_team_id
        and recipient.player_id = player_id_value
        and (
          not coalesce((preview ->> 'recurring')::boolean, false)
          or (normalized_scope = 'occurrence' and request.occurrence_date = occurrence_date_value)
          or (normalized_scope = 'this_and_future' and request.occurrence_date >= occurrence_date_value)
        )
    ), changed as (
      update public.training_availability_request_players recipient
      set status = case
            when recipient.status in ('pending', 'queued', 'failed') then 'cancelled'
            else recipient.status
          end,
          token_revoked_at = coalesce(recipient.token_revoked_at, timezone('utc', now())),
          token_revoked_reason = coalesce(recipient.token_revoked_reason, 'event_participation_removed'),
          token_revoked_by = coalesce(recipient.token_revoked_by, actor.id),
          token_revoked_source = coalesce(recipient.token_revoked_source, 'remove_player_from_event'),
          updated_at = timezone('utc', now())
      from affected_recipients affected
      where recipient.id = affected.id
        and (recipient.status <> 'cancelled' or recipient.token_revoked_at is null)
      returning recipient.email_queue_id
    )
    select count(*) into revoked_count from changed;

    with affected_queue as (
      select distinct recipient.email_queue_id
      from public.training_availability_request_players recipient
      join public.training_availability_requests request on request.id = recipient.request_id
      where request.calendar_event_id = event_id_value
        and recipient.player_id = player_id_value
        and recipient.email_queue_id is not null
        and (
          not coalesce((preview ->> 'recurring')::boolean, false)
          or (normalized_scope = 'occurrence' and request.occurrence_date = occurrence_date_value)
          or (normalized_scope = 'this_and_future' and request.occurrence_date >= occurrence_date_value)
        )
    ), cancelled as (
      update public.scheduled_email_queue queue
      set status = 'failed',
          delivery_state = 'cancelled',
          retry_enabled = false,
          next_retry_at = null,
          lease_owner = null,
          leased_at = null,
          lease_expires_at = null,
          terminal_at = coalesce(queue.terminal_at, timezone('utc', now())),
          failure_category = 'authorization',
          safe_error_code = 'event_participation_removed',
          last_error = 'Cancelled because the Player was removed from the event occurrence.',
          updated_at = timezone('utc', now())
      from affected_queue affected
      where queue.id = affected.email_queue_id
        and queue.provider_message_id is null
        and queue.provider_accepted_at is null
        and queue.delivery_state not in ('cancelled', 'delivered', 'bounced', 'failed')
      returning queue.id
    )
    select count(*) into queue_count from cancelled;
  end if;

  with revoked_trials as (
    update public.calendar_trial_event_invitations invitation
    set status = 'revoked',
        revoked_at = coalesce(invitation.revoked_at, timezone('utc', now())),
        revoked_reason = coalesce(invitation.revoked_reason, 'event_participation_removed'),
        updated_at = timezone('utc', now())
    where invitation.club_id = source_club_id
      and invitation.team_id = source_team_id
      and invitation.player_id = player_id_value
      and invitation.status <> 'revoked'
      and (
        (normalized_source_type = 'calendar' and invitation.calendar_event_id = event_id_value)
        or (normalized_source_type = 'match-day' and invitation.match_day_id = event_id_value)
      )
      and not (
        normalized_source_type = 'calendar'
        and coalesce((preview ->> 'recurring')::boolean, false)
        and normalized_scope = 'occurrence'
      )
    returning invitation.email_queue_id
  ), cancelled_trials as (
    update public.scheduled_email_queue queue
    set status = 'failed',
        delivery_state = 'cancelled',
        retry_enabled = false,
        next_retry_at = null,
        lease_owner = null,
        leased_at = null,
        lease_expires_at = null,
        terminal_at = coalesce(queue.terminal_at, timezone('utc', now())),
        failure_category = 'authorization',
        safe_error_code = 'event_participation_removed',
        last_error = 'Cancelled because the Player was removed from the event.',
        updated_at = timezone('utc', now())
    from revoked_trials trial
    where queue.id = trial.email_queue_id
      and queue.provider_message_id is null
      and queue.provider_accepted_at is null
      and queue.delivery_state not in ('cancelled', 'delivered', 'bounced', 'failed')
    returning queue.id
  )
  select count(*) into changed_count from cancelled_trials;

  suppressed_count := queue_count + changed_count;

  if not coalesce((preview ->> 'recurring')::boolean, false) or normalized_scope = 'this_and_future' then
    with affected_notifications as (
      select notification.id, notification.email_queue_id
      from public.event_player_notification_events notification
      join public.event_player_change_commands command on command.id = notification.command_id
      where command.club_id = source_club_id
        and command.team_id = source_team_id
        and notification.player_id = player_id_value
        and notification.status = 'queued'
        and (
          (normalized_source_type = 'calendar' and command.calendar_event_id = event_id_value)
          or (normalized_source_type = 'match-day' and command.match_day_id = event_id_value)
        )
    ), cancelled_notifications as (
      update public.event_player_notification_events notification
      set status = 'failed',
          last_error = 'Cancelled because the Player was removed from event participation.'
      from affected_notifications affected
      where notification.id = affected.id
      returning affected.email_queue_id
    ), cancelled_notification_queue as (
      update public.scheduled_email_queue queue
      set status = 'failed',
          delivery_state = 'cancelled',
          retry_enabled = false,
          next_retry_at = null,
          lease_owner = null,
          leased_at = null,
          lease_expires_at = null,
          terminal_at = coalesce(queue.terminal_at, timezone('utc', now())),
          failure_category = 'authorization',
          safe_error_code = 'event_participation_removed',
          last_error = 'Cancelled because the Player was removed from event participation.',
          updated_at = timezone('utc', now())
      from cancelled_notifications notification
      where queue.id = notification.email_queue_id
        and queue.provider_message_id is null
        and queue.provider_accepted_at is null
        and queue.delivery_state not in ('cancelled', 'delivered', 'bounced', 'failed')
      returning queue.id
    )
    select count(*) into changed_count from cancelled_notification_queue;

    suppressed_count := suppressed_count + changed_count;
  end if;
  result_value := preview || jsonb_build_object(
    'duplicate', false,
    'affectedOccurrenceCount', coalesce((preview ->> 'affectedOccurrenceCount')::integer, 0),
    'suppressedInvitationCount', suppressed_count,
    'revokedTokenCount', revoked_count,
    'teamMembershipUnchanged', true,
    'playerRecordPreserved', true,
    'historyPreserved', true,
    'communicationSent', false,
    'status', 'completed'
  );

  insert into public.event_player_removal_commands (
    club_id,
    team_id,
    calendar_event_id,
    match_day_id,
    source_type,
    player_id,
    scope,
    occurrence_date,
    request_token,
    requested_by,
    previous_state,
    new_state,
    affected_occurrence_count,
    suppressed_invitation_count,
    revoked_token_count,
    result
  ) values (
    source_club_id,
    source_team_id,
    case when normalized_source_type = 'calendar' then event_id_value else null end,
    case when normalized_source_type = 'match-day' then event_id_value else null end,
    normalized_source_type,
    player_id_value,
    normalized_scope,
    occurrence_date_value,
    request_token_value,
    actor.id,
    previous_state_value,
    jsonb_build_object(
      'participation', 'removed',
      'scope', normalized_scope,
      'teamMembership', 'active',
      'playerRecord', 'preserved',
      'history', 'preserved'
    ),
    coalesce((result_value ->> 'affectedOccurrenceCount')::integer, 0),
    suppressed_count,
    revoked_count,
    result_value
  )
  returning id into command_id_value;

  result_value := result_value || jsonb_build_object('commandId', command_id_value);

  update public.event_player_removal_commands
  set result = result_value
  where id = command_id_value;

  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    outcome,
    metadata
  ) values (
    source_club_id,
    actor.id,
    'event_player_removed',
    normalized_source_type,
    event_id_value,
    'success',
    jsonb_build_object(
      'commandId', command_id_value,
      'eventId', event_id_value,
      'playerId', player_id_value,
      'clubId', source_club_id,
      'teamId', source_team_id,
      'scope', normalized_scope,
      'occurrenceDate', occurrence_date_value,
      'previousState', previous_state_value,
      'newState', result_value,
      'affectedOccurrenceCount', coalesce((result_value ->> 'affectedOccurrenceCount')::integer, 0),
      'suppressedInvitationCount', suppressed_count,
      'revokedTokenCount', revoked_count,
      'communicationSent', false,
      'source', 'remove_player_from_event'
    )
  );

  return result_value;
end;
$$;

revoke all on function public.remove_player_from_event(text, uuid, uuid, date, text, uuid, boolean)
from public, anon;
grant execute on function public.remove_player_from_event(text, uuid, uuid, date, text, uuid, boolean)
to authenticated, service_role;

comment on table public.event_player_occurrence_exclusions is
  'Canonical Player participation exclusions for one recurring occurrence or the selected and future occurrences.';

comment on table public.event_player_removal_commands is
  'Immutable idempotent audit commands for staff-authorised event participation removal. Team membership and Player records are never changed.';

comment on function public.preview_event_player_removal(text, uuid, uuid, date, text) is
  'Calculates server-authoritative event removal impact without changing participation, tokens, queues, Team membership, or history.';

comment on function public.remove_player_from_event(text, uuid, uuid, date, text, uuid, boolean) is
  'Atomically removes Player participation, suppresses unsent work, revokes response authority, and preserves Team membership and history.';
