-- Match automatic selection to the active-team-player rule used by staff selection.
-- An active fixture invitation is still required. Existing responses are not replayed.

create or replace function public.handle_match_day_available_auto_selection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  player_row public.players%rowtype;
  previous_decision public.match_day_player_squad_decisions%rowtype;
  request_recipient_type text := '';
  previous_availability_status text := 'pending';
  response_source text := 'availability_response';
  actor_user_id uuid := null;
  actor_display_name text := '';
  actor_role text := '';
  automatic_selection_enabled boolean := false;
  automatic_selection_succeeded boolean := false;
  selection_record_created boolean := false;
  failure_category text := '';
  failure_reason text := '';
  event_label text := 'Automatic match selection not run';
  response_time timestamptz := coalesce(new.selected_at, timezone('utc', now()));
  error_constraint text := '';
begin
  if new.status <> 'available' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    previous_availability_status := coalesce(nullif(old.status, ''), 'pending');

    if old.status = 'available' then
      return new;
    end if;
  end if;

  if new.selected_by_request_id is not null then
    select coalesce(request.recipient_type, '')
    into request_recipient_type
    from public.match_day_availability_requests request
    where request.id = new.selected_by_request_id
      and request.match_day_id = new.match_day_id
      and request.player_id = new.player_id
    limit 1;
  end if;

  if new.selected_by_parent_link_id is not null then
    response_source := 'parent_managed';

    select link.auth_user_id
    into actor_user_id
    from public.parent_player_links link
    where link.id = new.selected_by_parent_link_id
      and link.player_id = new.player_id
      and link.status = 'active'
    limit 1;
  elsif request_recipient_type = 'player' then
    response_source := 'adult_direct';
    actor_user_id := auth.uid();
  elsif new.selected_by_request_id is not null then
    response_source := 'parent_managed';
    actor_user_id := auth.uid();
  elsif auth.uid() is not null then
    response_source := 'staff_on_behalf';
    actor_user_id := auth.uid();
  else
    response_source := 'availability_response';
  end if;

  actor_display_name := coalesce(nullif(btrim(new.selected_by_name), ''), 'Availability responder');

  if actor_user_id is not null then
    select coalesce(nullif(profile.role_label, ''), nullif(profile.role, ''), response_source)
    into actor_role
    from public.users profile
    where profile.id = actor_user_id
    limit 1;
  end if;

  actor_role := coalesce(nullif(actor_role, ''), response_source);

  select fixture.*
  into match_row
  from public.match_days fixture
  where fixture.id = new.match_day_id
  for update;

  automatic_selection_enabled := coalesce(match_row.auto_select_available_players, false);

  if match_row.id is null then
    failure_category := 'invalid_fixture';
    failure_reason := 'The fixture is not available for automatic selection.';
  elsif not automatic_selection_enabled then
    failure_category := 'disabled';
    failure_reason := 'Automatic selection is disabled for this fixture.';
  elsif match_row.deleted_at is not null or match_row.previous_hidden_at is not null then
    failure_category := 'archived_fixture';
    failure_reason := 'The fixture is archived.';
  elsif match_row.status not in ('scheduled', 'scorer_request') then
    failure_category := 'lifecycle_locked';
    failure_reason := 'Squad selection is locked for this fixture lifecycle.';
  elsif match_row.club_id is distinct from new.club_id
    or match_row.team_id is distinct from new.team_id then
    failure_category := 'scope_mismatch';
    failure_reason := 'The availability response is outside the fixture scope.';
  else
    select player.*
    into player_row
    from public.players player
    where player.id = new.player_id
    limit 1;

    if player_row.id is null
      or player_row.club_id is distinct from match_row.club_id
      or player_row.team_id is distinct from match_row.team_id
      or coalesce(player_row.status, 'active') = 'archived' then
      failure_category := 'ineligible_player';
      failure_reason := 'The player is not an active player for the fixture team.';
    elsif not exists (
      select 1
      from public.calendar_event_invites invite
      where invite.match_day_id = match_row.id
        and invite.club_id = match_row.club_id
        and invite.team_id = match_row.team_id
        and invite.player_id = player_row.id
        and invite.invite_status <> 'cancelled'
        and invite.cancelled_at is null
      union all
      select 1
      from public.match_day_availability_requests request
      where request.match_day_id = match_row.id
        and request.club_id = match_row.club_id
        and request.team_id is not distinct from match_row.team_id
        and request.player_id = player_row.id
        and request.status not in ('expired')
      limit 1
    ) then
      failure_category := 'not_invited';
      failure_reason := 'The player does not have an active fixture invitation.';
    else
      begin
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(
            concat('auto_selection:', match_row.id::text, ':', player_row.id::text),
            0
          )
        );

        select decision.*
        into previous_decision
        from public.match_day_player_squad_decisions decision
        where decision.match_day_id = match_row.id
          and decision.player_id = player_row.id
        for update;

        if previous_decision.id is not null and previous_decision.status = 'selected' then
          automatic_selection_succeeded := true;
          selection_record_created := false;
        else
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
          values (
            match_row.id,
            match_row.club_id,
            match_row.team_id,
            player_row.id,
            'selected',
            actor_user_id,
            actor_display_name,
            response_time,
            response_time
          )
          on conflict on constraint match_day_player_squad_decisions_match_player_key
          do update
          set status = 'selected',
              club_id = excluded.club_id,
              team_id = excluded.team_id,
              decided_by = excluded.decided_by,
              decided_by_name = excluded.decided_by_name,
              decided_at = excluded.decided_at,
              updated_at = excluded.updated_at;

          automatic_selection_succeeded := true;
          selection_record_created := previous_decision.id is null;
        end if;
      exception
        when others then
          get stacked diagnostics error_constraint = constraint_name;
          automatic_selection_succeeded := false;
          selection_record_created := false;
          failure_category := case
            when error_constraint <> '' then 'selection_constraint'
            else 'unexpected_selection_error'
          end;
          failure_reason := case
            when error_constraint <> '' then 'A match selection constraint prevented automatic selection.'
            else 'Automatic selection could not be completed safely.'
          end;
      end;
    end if;
  end if;

  event_label := case
    when automatic_selection_succeeded then 'Available player automatically selected'
    when failure_category = 'disabled' then 'Available response retained without automatic selection'
    else 'Available player automatic selection failed'
  end;

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
      metadata,
      created_at
    )
    values (
      new.club_id,
      new.team_id,
      new.match_day_id,
      new.player_id,
      actor_user_id,
      actor_display_name,
      actor_role,
      'player_squad_decision_changed',
      event_label,
      jsonb_build_object(
        'availabilityStatus', previous_availability_status,
        'squadDecision', coalesce(previous_decision.status, 'undecided')
      ),
      jsonb_build_object(
        'availabilityStatus', 'available',
        'squadDecision', case
          when automatic_selection_succeeded then 'selected'
          else coalesce(previous_decision.status, 'undecided')
        end
      ),
      jsonb_build_object(
        'source', 'availability_auto_selection',
        'responseSource', response_source,
        'previousAvailabilityStatus', previous_availability_status,
        'newAvailabilityStatus', 'available',
        'automaticSelectionEnabled', automatic_selection_enabled,
        'automaticSelectionSucceeded', automatic_selection_succeeded,
        'selectionRecordCreated', selection_record_created,
        'failureCategory', nullif(failure_category, ''),
        'failureReason', nullif(failure_reason, ''),
        'actorUserId', actor_user_id,
        'respondedAt', response_time
      ),
      response_time
    );
  exception
    when others then
      null;
  end;

  begin
    insert into public.audit_logs (
      club_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata,
      created_at
    )
    values (
      new.club_id,
      actor_user_id,
      case
        when automatic_selection_succeeded then 'match_day_available_auto_selection_succeeded'
        when failure_category = 'disabled' then 'match_day_available_auto_selection_skipped'
        else 'match_day_available_auto_selection_failed'
      end,
      'match_day',
      new.match_day_id,
      jsonb_build_object(
        'fixtureId', new.match_day_id,
        'teamId', new.team_id,
        'playerId', new.player_id,
        'responseSource', response_source,
        'previousAvailabilityStatus', previous_availability_status,
        'newAvailabilityStatus', 'available',
        'automaticSelectionEnabled', automatic_selection_enabled,
        'automaticSelectionSucceeded', automatic_selection_succeeded,
        'selectionRecordCreated', selection_record_created,
        'failureCategory', nullif(failure_category, ''),
        'failureReason', nullif(failure_reason, ''),
        'respondedAt', response_time
      ),
      response_time
    );
  exception
    when others then
      null;
  end;

  return new;
exception
  when others then
    return new;
end;
$$;

revoke all on function public.handle_match_day_available_auto_selection()
  from public, anon, authenticated, service_role;

comment on function public.handle_match_day_available_auto_selection() is
  'Trigger-only selection for newly Available, invited active team players, including Trial players. Preserves fixture lifecycle, invitation, audit and one-way response rules.';
