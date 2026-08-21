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
    select event.club_id, event.team_id
    into source_club_id, source_team_id
    from public.calendar_events event
    where event.id = calendar_event_id_value
      and event.club_id = actor.club_id;
  else
    select fixture.club_id, fixture.team_id
    into source_club_id, source_team_id
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
  'Resolves Whole squad and optional Trial player scope server-side before delegating to the canonical Calendar parent scope authority.';
