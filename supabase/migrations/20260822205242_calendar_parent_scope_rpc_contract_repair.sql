create or replace function public.sync_calendar_event_parent_scope(
  calendar_event_id_value uuid,
  match_day_id_value uuid,
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
  audience_value text;
  parent_visible_value boolean;
  selected_player_ids uuid[] := '{}'::uuid[];
  requested_player_count integer := 0;
  selected_player_count integer := 0;
  existing_portal_count integer := 0;
  portal_created_count integer := 0;
  portal_updated_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to save Calendar parent scope.';
  end if;

  if num_nonnulls(calendar_event_id_value, match_day_id_value) <> 1 then
    raise exception 'Choose exactly one supported Calendar event source.';
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
    raise exception 'Coach or manager access is required to save Calendar parent scope.';
  end if;

  if calendar_event_id_value is not null then
    source_kind := 'calendar';
    source_id := calendar_event_id_value;

    select event.club_id, event.team_id, event.parent_audience, event.parent_visible
    into club_id_value, team_id_value, audience_value, parent_visible_value
    from public.calendar_events event
    where event.id = calendar_event_id_value
      and event.club_id = actor.club_id
    for update;
  else
    source_kind := 'match-day';
    source_id := match_day_id_value;

    select fixture.club_id, fixture.team_id, fixture.parent_audience, fixture.parent_visible
    into club_id_value, team_id_value, audience_value, parent_visible_value
    from public.match_days fixture
    where fixture.id = match_day_id_value
      and fixture.club_id = actor.club_id
    for update;
  end if;

  if source_id is null or club_id_value is null then
    raise exception 'Calendar event was not found in the current club.';
  end if;

  if team_id_value is null then
    raise exception 'Choose a team before sharing this event with parents.';
  end if;

  if actor.role <> 'admin' and not exists (
    select 1 from public.team_staff staff
    where staff.team_id = team_id_value and staff.user_id = actor.id
  ) then
    raise exception 'You do not have permission to share this event with parents for this team.';
  end if;

  if parent_visible_value is true and audience_value = 'all_team_parents' then
    select count(distinct requested_id),
      coalesce(array_agg(distinct requested_id order by requested_id), '{}'::uuid[])
    into requested_player_count, selected_player_ids
    from unnest(coalesce(player_ids_value, '{}'::uuid[])) requested_id;

    select count(*) into selected_player_count
    from public.players player
    where player.id = any(selected_player_ids)
      and player.club_id = club_id_value
      and player.team_id = team_id_value
      and coalesce(player.status, 'active') <> 'archived';

    if selected_player_count <> requested_player_count then
      raise exception 'One or more server-resolved players are outside this event team or are no longer active.';
    end if;
  elsif parent_visible_value is true and audience_value = 'involved_players' then
    select count(distinct requested_id),
      coalesce(array_agg(distinct requested_id order by requested_id), '{}'::uuid[])
    into requested_player_count, selected_player_ids
    from unnest(coalesce(player_ids_value, '{}'::uuid[])) requested_id;

    if requested_player_count = 0 then
      raise exception 'Choose at least one involved player before sharing this event with parents.';
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
  elsif parent_visible_value is true then
    raise exception 'Choose a supported parent audience before sharing this event.';
  elsif coalesce(array_length(player_ids_value, 1), 0) > 0 then
    raise exception 'Parent scope cannot include players while the event is not shared.';
  end if;

  selected_player_count := coalesce(array_length(selected_player_ids, 1), 0);

  select count(*) into existing_portal_count
  from public.calendar_event_invites invite
  where invite.club_id = club_id_value
    and invite.team_id = team_id_value
    and invite.player_id = any(selected_player_ids)
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
    and invite.team_id = team_id_value
    and invite.invite_status <> 'cancelled'
    and (
      selected_player_count = 0
      or invite.player_id <> all(selected_player_ids)
    )
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
    coalesce(primary_link.email, ''), '', '[]'::jsonb, 'active', false, 'informational',
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
      response_requirement = 'informational',
      cancelled_at = null,
      updated_by = excluded.updated_by,
      updated_by_name = excluded.updated_by_name,
      updated_by_email = excluded.updated_by_email;

  portal_updated_count := least(existing_portal_count, selected_player_count);
  portal_created_count := greatest(selected_player_count - existing_portal_count, 0);

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    club_id_value, actor.id, 'calendar_event_parent_scope_saved',
    case source_kind when 'match-day' then 'match_day' else 'calendar_event' end,
    source_id,
    jsonb_build_object(
      'eventSource', source_kind,
      'parentAudience', audience_value,
      'parentVisible', parent_visible_value,
      'portalCreatedCount', portal_created_count,
      'portalUpdatedCount', portal_updated_count,
      'portalRecordCount', selected_player_count,
      'responseRequirement', 'informational'
    )
  );

  return jsonb_build_object(
    'eventId', source_id,
    'eventSource', source_kind,
    'parentAudience', audience_value,
    'parentVisible', parent_visible_value,
    'portalState', case when selected_player_count = 0 then 'empty' else 'ready' end,
    'portalCreatedCount', portal_created_count,
    'portalUpdatedCount', portal_updated_count,
    'portalRecordCount', selected_player_count,
    'responseRequirement', 'informational'
  );
end;
$$;

revoke all on function public.sync_calendar_event_parent_scope(uuid, uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.sync_calendar_event_parent_scope(uuid, uuid, uuid[])
to service_role;

comment on function public.sync_calendar_event_parent_scope(uuid, uuid, uuid[]) is
  'Internal Calendar parent scope materializer. The public v2 function resolves and validates the player scope before delegation.';

create or replace function public.sync_calendar_event_parent_scope_v2(
  calendar_event_id_value uuid,
  include_trial_players_value boolean,
  match_day_id_value uuid,
  player_ids_value uuid[] default '{}'::uuid[],
  selection_mode_value text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  normalized_selection_mode text := lower(btrim(coalesce(selection_mode_value, 'manual')));
  source_club_id uuid;
  source_team_id uuid;
  source_parent_audience text;
  source_parent_visible boolean;
  selected_player_ids uuid[] := '{}'::uuid[];
  result_value jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to save Calendar parent scope.';
  end if;

  if num_nonnulls(calendar_event_id_value, match_day_id_value) <> 1 then
    raise exception 'Choose exactly one supported Calendar event source.';
  end if;

  if normalized_selection_mode not in ('manual', 'whole_squad') then
    raise exception 'Choose a supported Calendar parent selection mode.';
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
    raise exception 'Coach or manager access is required to save Calendar parent scope.';
  end if;

  if calendar_event_id_value is not null then
    select event.club_id, event.team_id, event.parent_audience, event.parent_visible
    into source_club_id, source_team_id, source_parent_audience, source_parent_visible
    from public.calendar_events event
    where event.id = calendar_event_id_value
      and event.club_id = actor.club_id;
  else
    select fixture.club_id, fixture.team_id, fixture.parent_audience, fixture.parent_visible
    into source_club_id, source_team_id, source_parent_audience, source_parent_visible
    from public.match_days fixture
    where fixture.id = match_day_id_value
      and fixture.club_id = actor.club_id;
  end if;

  if source_club_id is null or source_team_id is null then
    raise exception 'Calendar event was not found in the current club and team.';
  end if;

  if actor.role <> 'admin' and not exists (
    select 1
    from public.team_staff staff
    where staff.team_id = source_team_id
      and staff.user_id = actor.id
  ) then
    raise exception 'You do not have permission to share this event with parents for this team.';
  end if;

  if source_parent_visible is true and source_parent_audience = 'all_team_parents'
    and normalized_selection_mode <> 'whole_squad' then
    raise exception 'Whole team parent sharing requires server-resolved whole squad scope.';
  end if;

  if source_parent_visible is true and source_parent_audience = 'involved_players'
    and normalized_selection_mode <> 'manual' then
    raise exception 'Involved player sharing requires manual player scope.';
  end if;

  if normalized_selection_mode = 'whole_squad'
    and not (source_parent_visible is true and source_parent_audience = 'all_team_parents') then
    raise exception 'Whole squad scope is only available for whole team parent sharing.';
  end if;

  if normalized_selection_mode = 'whole_squad' then
    if coalesce(array_length(player_ids_value, 1), 0) > 0 then
      raise exception 'Whole squad player scope is resolved by the server.';
    end if;

    select coalesce(array_agg(player.id order by player.id), '{}'::uuid[])
    into selected_player_ids
    from public.players player
    where player.club_id = source_club_id
      and player.team_id = source_team_id
      and coalesce(player.status, 'active') <> 'archived'
      and (
        lower(btrim(coalesce(player.section, ''))) = 'squad'
        or (
          include_trial_players_value is true
          and lower(btrim(coalesce(player.section, ''))) = 'trial'
        )
      );
  else
    selected_player_ids := coalesce(player_ids_value, '{}'::uuid[]);
  end if;

  result_value := public.sync_calendar_event_parent_scope(
    calendar_event_id_value,
    match_day_id_value,
    selected_player_ids
  );

  return result_value || jsonb_build_object(
    'selectionMode', normalized_selection_mode,
    'includeTrialPlayers', include_trial_players_value is true,
    'selectedPlayerCount', coalesce(array_length(selected_player_ids, 1), 0)
  );
end;
$$;

revoke all on function public.sync_calendar_event_parent_scope_v2(uuid, boolean, uuid, uuid[], text)
from public;
revoke execute on function public.sync_calendar_event_parent_scope_v2(uuid, boolean, uuid, uuid[], text)
from anon;
grant execute on function public.sync_calendar_event_parent_scope_v2(uuid, boolean, uuid, uuid[], text)
to authenticated, service_role;

comment on function public.sync_calendar_event_parent_scope_v2(uuid, boolean, uuid, uuid[], text) is
  'Validates selection mode against event sharing metadata, resolves Whole squad and optional Trial scope server-side, then delegates to the internal materializer.';
