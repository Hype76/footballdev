-- FP-PARENT-RESET-SQUAD-LIFECYCLE-122
-- Allow active Trial and Squad families to accept Parent app access.
-- Archive a Player and remove future participation in one transaction while preserving history.

create or replace function public.accept_parent_player_link(invite_token_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  player_id uuid,
  parent_link_id uuid,
  link_type text,
  email text,
  auth_user_id uuid,
  invite_token uuid,
  status text,
  invited_by uuid,
  invited_by_name text,
  accepted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_email text := lower(btrim(coalesce((auth.jwt() ->> 'email'), '')));
  target_link public.parent_player_links%rowtype;
  target_email text;
begin
  if auth.uid() is null then
    raise exception 'Login is required before opening this Parent app link.';
  end if;

  if auth_email = '' then
    raise exception 'A verified Parent email is required before opening this link.';
  end if;

  select link.*
  into target_link
  from public.parent_player_links link
  where link.invite_token = invite_token_value
    and link.status <> 'revoked'
    and (
      exists (
        select 1
        from public.players player
        where player.id = link.player_id
          and lower(btrim(coalesce(player.section, ''))) in ('trial', 'squad')
          and lower(btrim(coalesce(player.status, 'active'))) <> 'archived'
          and player.archived_at is null
      )
      or (
        link.link_type = 'family'
        and exists (
          select 1
          from public.parent_player_links parent_link
          where parent_link.id = link.parent_link_id
            and parent_link.player_id = link.player_id
            and parent_link.status = 'active'
        )
      )
    )
  limit 1;

  if target_link.id is null then
    raise exception 'This Parent app link is only available for an active Trial or Squad player.';
  end if;

  target_email := lower(btrim(coalesce(target_link.email, '')));

  if target_link.expires_at is not null and target_link.expires_at <= timezone('utc', now()) then
    raise exception 'This Parent app link has expired. Ask the team to send a new link.';
  end if;

  if target_email <> '' and target_email <> auth_email then
    raise exception 'This Parent app link is for a different email address.';
  end if;

  if target_link.status = 'active' then
    if target_link.auth_user_id is distinct from auth.uid() then
      raise exception 'This Parent app link is already connected to another account.';
    end if;

    return query
    select
      target_link.id,
      target_link.club_id,
      target_link.team_id,
      target_link.player_id,
      target_link.parent_link_id,
      target_link.link_type,
      target_link.email,
      target_link.auth_user_id,
      target_link.invite_token,
      target_link.status,
      target_link.invited_by,
      target_link.invited_by_name,
      target_link.accepted_at,
      target_link.created_at,
      target_link.updated_at;
    return;
  end if;

  return query
  with existing_link as (
    select existing.*
    from public.parent_player_links existing
    where existing.id <> target_link.id
      and existing.status = 'active'
      and existing.team_id is not distinct from target_link.team_id
      and existing.player_id = target_link.player_id
      and existing.link_type = target_link.link_type
      and existing.auth_user_id = auth.uid()
      and lower(btrim(coalesce(existing.email, ''))) = auth_email
    order by existing.accepted_at desc nulls last, existing.created_at desc
    limit 1
  ),
  revoke_target as (
    update public.parent_player_links link
    set
      status = 'revoked',
      updated_at = timezone('utc', now())
    where link.id = target_link.id
      and exists (select 1 from existing_link)
    returning link.id
  ),
  accept_target as (
    update public.parent_player_links link
    set
      auth_user_id = auth.uid(),
      email = coalesce(nullif(link.email, ''), auth_email),
      status = 'active',
      accepted_at = coalesce(link.accepted_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
    where link.id = target_link.id
      and not exists (select 1 from existing_link)
    returning link.*
  ),
  selected_link as (
    select * from existing_link
    union all
    select * from accept_target
    limit 1
  )
  select
    selected_link.id,
    selected_link.club_id,
    selected_link.team_id,
    selected_link.player_id,
    selected_link.parent_link_id,
    selected_link.link_type,
    selected_link.email,
    selected_link.auth_user_id,
    selected_link.invite_token,
    selected_link.status,
    selected_link.invited_by,
    selected_link.invited_by_name,
    selected_link.accepted_at,
    selected_link.created_at,
    selected_link.updated_at
  from selected_link;
end;
$$;

revoke all on function public.accept_parent_player_link(uuid) from public, anon;
grant execute on function public.accept_parent_player_link(uuid) to authenticated, service_role;

comment on function public.accept_parent_player_link(uuid) is
  'Accepts active Trial or Squad Parent app access for the intended signed-in email while retaining family-link idempotency.';

create or replace function public.archive_player_with_future_events(
  player_id_value uuid,
  reason_value text,
  request_token_value uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  target_player public.players%rowtype;
  normalized_reason text := btrim(coalesce(reason_value, ''));
  event_row record;
  removal_result jsonb;
  first_date date;
  cursor_date date;
  cursor_start timestamptz;
  cursor_end timestamptz;
  duration_value interval;
  child_hash text;
  child_token uuid;
  affected_count integer := 0;
  suppressed_count integer := 0;
  revoked_count integer := 0;
  ended_membership_count integer := 0;
  archived_at_value timestamptz := timezone('utc', now());
  result_value jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to archive a Player.';
  end if;

  if request_token_value is null then
    raise exception 'A safe archive request token is required.';
  end if;

  if normalized_reason = '' then
    raise exception 'Add an archive reason before continuing.';
  end if;

  select profile.* into actor
  from public.users profile
  where profile.id = auth.uid()
  limit 1;

  if actor.id is null
    or actor.club_id is null
    or actor.role in ('parent_portal', 'adult_player', 'super_admin')
    or coalesce(actor.status, 'active') <> 'active'
    or coalesce(actor.role_rank, 0) < 20 then
    raise exception 'Coach or manager access is required to archive a Player.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(concat('player-archive:', player_id_value::text), 0)
  );

  select player.* into target_player
  from public.players player
  where player.id = player_id_value
    and player.club_id = actor.club_id
  for update;

  if target_player.id is null then
    raise exception 'The Player was not found in the active club.';
  end if;

  if actor.role <> 'admin'
    and not exists (
      select 1
      from public.team_staff assignment
      where assignment.team_id = target_player.team_id
        and assignment.user_id = actor.id
    ) then
    raise exception 'You do not have permission to archive this Player.';
  end if;

  if lower(btrim(coalesce(target_player.status, 'active'))) = 'archived' then
    return jsonb_build_object(
      'playerId', target_player.id,
      'duplicate', true,
      'status', 'archived',
      'playerRecordPreserved', true,
      'historyPreserved', true,
      'parentLinkRecordsPreserved', true,
      'pastEventsPreserved', true,
      'futureParticipationRemoved', true
    );
  end if;

  for event_row in
    select fixture.id
    from public.match_days fixture
    where fixture.club_id = actor.club_id
      and fixture.deleted_at is null
      and coalesce(fixture.status, 'scheduled') not in ('cancelled', 'full_time', 'postponed')
      and (
        case
          when fixture.kickoff_time_tbc or fixture.kickoff_time is null
            then fixture.match_date::timestamp at time zone 'Europe/London' + interval '2 hours'
          else (fixture.match_date + fixture.kickoff_time)::timestamp at time zone 'Europe/London' + interval '2 hours'
        end
      ) > timezone('utc', now())
      and (
        exists (
          select 1 from public.calendar_event_invites invite
          where invite.match_day_id = fixture.id
            and invite.player_id = target_player.id
            and invite.invite_status <> 'cancelled'
            and invite.cancelled_at is null
        )
        or exists (
          select 1 from public.match_day_player_squad_decisions decision
          where decision.match_day_id = fixture.id
            and decision.player_id = target_player.id
            and decision.status = 'selected'
        )
        or exists (
          select 1 from public.match_day_availability_requests request
          where request.match_day_id = fixture.id
            and request.player_id = target_player.id
            and request.token_revoked_at is null
        )
      )
  loop
    child_hash := md5(request_token_value::text || ':match-day:' || event_row.id::text);
    child_token := (
      substr(child_hash, 1, 8) || '-' || substr(child_hash, 9, 4) || '-' ||
      substr(child_hash, 13, 4) || '-' || substr(child_hash, 17, 4) || '-' ||
      substr(child_hash, 21, 12)
    )::uuid;
    removal_result := public.remove_player_from_event(
      'match-day', event_row.id, target_player.id, null, 'event', child_token, true
    );
    affected_count := affected_count + coalesce((removal_result ->> 'affectedOccurrenceCount')::integer, 0);
    suppressed_count := suppressed_count + coalesce((removal_result ->> 'suppressedInvitationCount')::integer, 0);
    revoked_count := revoked_count + coalesce((removal_result ->> 'revokedTokenCount')::integer, 0);
  end loop;

  for event_row in
    select event.*
    from public.calendar_events event
    where event.club_id = actor.club_id
      and event.cancelled_at is null
      and exists (
        select 1 from public.calendar_event_invites invite
        where invite.calendar_event_id = event.id
          and invite.player_id = target_player.id
          and invite.invite_status <> 'cancelled'
          and invite.cancelled_at is null
      )
  loop
    first_date := (event_row.starts_at at time zone 'Europe/London')::date;
    duration_value := greatest(
      coalesce(event_row.ends_at, event_row.starts_at + interval '1 hour') - event_row.starts_at,
      interval '1 minute'
    );
    cursor_date := null;

    if lower(coalesce(event_row.recurrence_frequency, 'none')) = 'none' then
      if coalesce(event_row.ends_at, event_row.starts_at + interval '1 hour') <= timezone('utc', now()) then
        continue;
      end if;

      child_hash := md5(request_token_value::text || ':calendar:' || event_row.id::text);
      child_token := (
        substr(child_hash, 1, 8) || '-' || substr(child_hash, 9, 4) || '-' ||
        substr(child_hash, 13, 4) || '-' || substr(child_hash, 17, 4) || '-' ||
        substr(child_hash, 21, 12)
      )::uuid;
      removal_result := public.remove_player_from_event(
        'calendar', event_row.id, target_player.id, null, 'event', child_token, true
      );
    else
      cursor_date := first_date;
      while cursor_date <= coalesce(event_row.recurrence_until, first_date) loop
        cursor_start := event_row.starts_at + (cursor_date - first_date) * interval '1 day';
        cursor_end := cursor_start + duration_value;
        exit when cursor_end > timezone('utc', now())
          and not public.is_calendar_event_player_excluded_internal(event_row.id, target_player.id, cursor_date);
        cursor_date := case lower(event_row.recurrence_frequency)
          when 'weekly' then cursor_date + 7
          when 'fortnightly' then cursor_date + 14
          when 'monthly' then (cursor_date + interval '1 month')::date
          else coalesce(event_row.recurrence_until, first_date) + 1
        end;
      end loop;

      if cursor_date > coalesce(event_row.recurrence_until, first_date) then
        continue;
      end if;

      child_hash := md5(
        request_token_value::text || ':calendar:' || event_row.id::text || ':' || cursor_date::text
      );
      child_token := (
        substr(child_hash, 1, 8) || '-' || substr(child_hash, 9, 4) || '-' ||
        substr(child_hash, 13, 4) || '-' || substr(child_hash, 17, 4) || '-' ||
        substr(child_hash, 21, 12)
      )::uuid;
      removal_result := public.remove_player_from_event(
        'calendar', event_row.id, target_player.id, cursor_date, 'this_and_future', child_token, true
      );
    end if;

    affected_count := affected_count + coalesce((removal_result ->> 'affectedOccurrenceCount')::integer, 0);
    suppressed_count := suppressed_count + coalesce((removal_result ->> 'suppressedInvitationCount')::integer, 0);
    revoked_count := revoked_count + coalesce((removal_result ->> 'revokedTokenCount')::integer, 0);
  end loop;

  update public.player_team_memberships membership
  set
    status = 'inactive',
    ended_at = archived_at_value,
    ended_by = actor.id,
    ended_reason = 'Player record archived.',
    ended_source = 'archive_player_with_future_events'
  where membership.player_id = target_player.id
    and membership.club_id = actor.club_id
    and membership.status = 'active';
  get diagnostics ended_membership_count = row_count;

  update public.players player
  set
    status = 'archived',
    archived_reason = normalized_reason,
    archived_at = archived_at_value,
    archived_delete_at = archived_at_value + interval '3 months',
    archived_by = actor.id,
    archived_previous_status = coalesce(nullif(target_player.status, 'archived'), 'active'),
    updated_by = actor.id,
    updated_by_name = coalesce(
      nullif(btrim(actor.display_name), ''),
      nullif(btrim(actor.name), ''),
      'Team staff'
    ),
    updated_by_email = coalesce(actor.email, '')
  where player.id = target_player.id
    and player.club_id = actor.club_id;

  result_value := jsonb_build_object(
    'playerId', target_player.id,
    'duplicate', false,
    'status', 'archived',
    'affectedOccurrenceCount', affected_count,
    'suppressedInvitationCount', suppressed_count,
    'revokedTokenCount', revoked_count,
    'endedTeamMembershipCount', ended_membership_count,
    'playerRecordPreserved', true,
    'historyPreserved', true,
    'parentLinkRecordsPreserved', true,
    'pastEventsPreserved', true,
    'futureParticipationRemoved', true,
    'communicationSent', false
  );

  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    outcome,
    metadata
  ) values (
    actor.club_id,
    actor.id,
    'player_archived',
    'player',
    target_player.id,
    'success',
    result_value || jsonb_build_object(
      'playerName', target_player.player_name,
      'section', target_player.section,
      'team', target_player.team,
      'reason', normalized_reason,
      'requestToken', request_token_value,
      'source', 'archive_player_with_future_events'
    )
  );

  return result_value;
end;
$$;

revoke all on function public.archive_player_with_future_events(uuid, text, uuid) from public, anon;
grant execute on function public.archive_player_with_future_events(uuid, text, uuid) to authenticated, service_role;

comment on function public.archive_player_with_future_events(uuid, text, uuid) is
  'Atomically removes a Player from every future event, ends active Team memberships, and archives the Player while preserving the Player row, Parent link records, development history, and past events.';
