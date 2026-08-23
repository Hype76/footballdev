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

  if normalized_source_type = 'match-day' then
    if exists (
      select 1
      from public.event_player_change_commands command
      where command.club_id = source_club_id
        and command.team_id = source_team_id
        and command.source_type = 'match-day'
        and command.match_day_id = event_id_value
    ) then
      select coalesce(array_agg(invite.player_id order by invite.player_id), '{}'::uuid[])
      into current_player_ids
      from public.calendar_event_invites invite
      where invite.club_id = source_club_id
        and invite.team_id = source_team_id
        and invite.match_day_id = event_id_value
        and invite.invite_status <> 'cancelled';
    else
      select coalesce(array_agg(distinct evidence.player_id order by evidence.player_id), '{}'::uuid[])
      into current_player_ids
      from (
        select invite.player_id
        from public.calendar_event_invites invite
        where invite.club_id = source_club_id
          and invite.team_id = source_team_id
          and invite.match_day_id = event_id_value
          and invite.invite_status <> 'cancelled'
        union all
        select request.player_id
        from public.match_day_availability_requests request
        where request.club_id = source_club_id
          and request.team_id = source_team_id
          and request.match_day_id = event_id_value
        union all
        select availability.player_id
        from public.match_day_player_availability availability
        where availability.club_id = source_club_id
          and availability.team_id = source_team_id
          and availability.match_day_id = event_id_value
        union all
        select decision.player_id
        from public.match_day_player_squad_decisions decision
        where decision.club_id = source_club_id
          and decision.team_id = source_team_id
          and decision.match_day_id = event_id_value
      ) evidence
      where exists (
        select 1
        from public.players player
        where player.id = evidence.player_id
          and player.club_id = source_club_id
          and player.team_id = source_team_id
          and coalesce(player.status, 'active') <> 'archived'
      )
        and not exists (
          select 1
          from public.event_player_removal_commands removal
          where removal.club_id = source_club_id
            and removal.team_id = source_team_id
            and removal.source_type = 'match-day'
            and removal.match_day_id = event_id_value
            and removal.player_id = evidence.player_id
            and removal.scope = 'event'
        );
    end if;
  else
    select coalesce(array_agg(invite.player_id order by invite.player_id), '{}'::uuid[])
    into current_player_ids
    from public.calendar_event_invites invite
    where invite.club_id = source_club_id
      and invite.team_id = source_team_id
      and invite.invite_status <> 'cancelled'
      and (
        (normalized_source_type = 'calendar' and invite.calendar_event_id = event_id_value)
        or (normalized_source_type = 'session' and invite.assessment_session_id = event_id_value)
      );
  end if;

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

comment on function public.preview_event_player_changes(text, uuid, uuid[]) is
  'Returns the active event participant delta. Initial Match evidence is limited to the active Team roster, and later managed state follows its saved event-player command and active invitation ledger.';
