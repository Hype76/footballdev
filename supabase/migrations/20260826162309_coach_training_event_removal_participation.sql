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

  select (
    exists (
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
    )
    or (
      normalized_source_type = 'calendar'
      and source_event_type = 'training'
      and exists (
        select 1
        from public.training_availability_request_players recipient
        join public.training_availability_requests request on request.id = recipient.request_id
        where request.calendar_event_id = event_id_value
          and recipient.club_id = source_club_id
          and recipient.team_id = source_team_id
          and recipient.player_id = player_id_value
          and recipient.token_revoked_at is null
          and lower(coalesce(recipient.status, 'pending')) not in ('cancelled', 'expired')
          and (
            recurrence_frequency_value = 'none'
            or (normalized_scope = 'occurrence' and request.occurrence_date = occurrence_date_value)
            or (normalized_scope = 'this_and_future' and request.occurrence_date >= occurrence_date_value)
          )
      )
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

comment on function public.preview_event_player_removal(text, uuid, uuid, date, text) is
  'Previews history-preserving event participation removal, including Training occurrence recipients without a separate Calendar invite row.';
