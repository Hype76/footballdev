-- Keep Match removal result counts aligned with the broader Team-removal preview
-- when Match participation is represented by a squad decision or response link
-- without a calendar_event_invites row.

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
  normalized_source_type text := lower(btrim(coalesce(source_type_value, '')));
  event_team_id uuid;
  event_club_id uuid;
  original_team_id uuid;
  original_team_name text;
  event_team_name text;
  result_value jsonb;
  has_event_participation boolean := false;
  command_id_value uuid;
begin
  if normalized_source_type = 'calendar' then
    select event.club_id, event.team_id, team.name
    into event_club_id, event_team_id, event_team_name
    from public.calendar_events event
    join public.teams team on team.id = event.team_id and team.club_id = event.club_id
    where event.id = event_id_value and event.cancelled_at is null;

    select exists (
      select 1 from public.calendar_event_invites invite
      where invite.calendar_event_id = event_id_value
        and invite.player_id = player_id_value
        and invite.club_id = event_club_id
        and invite.team_id = event_team_id
        and invite.invite_status <> 'cancelled'
        and invite.cancelled_at is null
    ) into has_event_participation;
  elsif normalized_source_type = 'match-day' then
    select fixture.club_id, fixture.team_id, team.name
    into event_club_id, event_team_id, event_team_name
    from public.match_days fixture
    join public.teams team on team.id = fixture.team_id and team.club_id = fixture.club_id
    where fixture.id = event_id_value and fixture.deleted_at is null;

    select
      exists (
        select 1 from public.calendar_event_invites invite
        where invite.match_day_id = event_id_value
          and invite.player_id = player_id_value
          and invite.club_id = event_club_id
          and invite.team_id = event_team_id
          and invite.invite_status <> 'cancelled'
          and invite.cancelled_at is null
      )
      or exists (
        select 1 from public.match_day_player_squad_decisions decision
        where decision.match_day_id = event_id_value
          and decision.player_id = player_id_value
          and decision.club_id = event_club_id
          and decision.team_id = event_team_id
          and decision.status = 'selected'
      )
      or exists (
        select 1 from public.match_day_availability_requests request
        where request.match_day_id = event_id_value
          and request.player_id = player_id_value
          and request.club_id = event_club_id
          and request.team_id = event_team_id
          and request.token_revoked_at is null
      )
    into has_event_participation;
  end if;

  select player.team_id, player.team
  into original_team_id, original_team_name
  from public.players player
  where player.id = player_id_value
    and player.club_id = event_club_id
    and coalesce(player.status, 'active') <> 'archived'
  for update;

  if original_team_id is distinct from event_team_id and has_event_participation then
    perform pg_catalog.set_config('app.preserve_player_team_memberships', 'on', true);
    update public.players
    set team_id = event_team_id, team = coalesce(event_team_name, team)
    where id = player_id_value and club_id = event_club_id;
    perform pg_catalog.set_config('app.preserve_player_team_memberships', 'off', true);
  end if;

  result_value := public.remove_player_from_event_membership_26b_internal(
    source_type_value,
    event_id_value,
    player_id_value,
    occurrence_date_value,
    scope_value,
    request_token_value,
    confirm_in_progress_value
  );

  if normalized_source_type = 'match-day'
    and has_event_participation
    and coalesce((result_value ->> 'affectedOccurrenceCount')::integer, 0) = 0 then
    result_value := result_value || jsonb_build_object('affectedOccurrenceCount', 1);
    command_id_value := nullif(result_value ->> 'commandId', '')::uuid;

    if command_id_value is not null then
      update public.event_player_removal_commands command
      set affected_occurrence_count = 1,
          result = command.result || jsonb_build_object('affectedOccurrenceCount', 1)
      where command.id = command_id_value;

      update public.audit_logs audit
      set metadata = audit.metadata || jsonb_build_object('affectedOccurrenceCount', 1)
      where audit.action = 'event_player_removed'
        and audit.metadata ->> 'commandId' = command_id_value::text;
    end if;
  end if;

  if original_team_id is distinct from event_team_id and has_event_participation then
    perform pg_catalog.set_config('app.preserve_player_team_memberships', 'on', true);
    update public.players
    set team_id = original_team_id, team = original_team_name
    where id = player_id_value and club_id = event_club_id;
    perform pg_catalog.set_config('app.preserve_player_team_memberships', 'off', true);
  end if;

  return result_value;
end;
$$;

revoke all on function public.remove_player_from_event(text, uuid, uuid, date, text, uuid, boolean)
from public, anon;
grant execute on function public.remove_player_from_event(text, uuid, uuid, date, text, uuid, boolean)
to authenticated, service_role;

comment on function public.remove_player_from_event(text, uuid, uuid, date, text, uuid, boolean) is
  'Preserves event-removal authority after Team membership ends and reports a Match participation removal when squad or response state exists without a calendar invite row.';
