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
  normalized_selection_mode text := lower(btrim(coalesce(selection_mode_value, 'manual')));
  delegated_player_ids uuid[] := coalesce(player_ids_value, '{}'::uuid[]);
  result_value jsonb;
  selected_player_count integer := 0;
begin
  if normalized_selection_mode not in ('manual', 'whole_squad') then
    raise exception 'Choose a supported Calendar parent selection mode.';
  end if;

  if normalized_selection_mode = 'whole_squad' then
    if coalesce(array_length(player_ids_value, 1), 0) > 0 then
      raise exception 'Whole squad player scope is resolved by the server.';
    end if;

    delegated_player_ids := '{}'::uuid[];
  end if;

  result_value := public.sync_calendar_event_parent_scope(
    calendar_event_id_value,
    match_day_id_value,
    delegated_player_ids
  );

  selected_player_count := coalesce(
    nullif(result_value ->> 'portalRecordCount', '')::integer,
    coalesce(array_length(delegated_player_ids, 1), 0)
  );

  return result_value || jsonb_build_object(
    'selectionMode', normalized_selection_mode,
    'includeTrialPlayers', include_trial_players_value is true,
    'selectedPlayerCount', selected_player_count
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
  'Delegates manual player scope or an empty Whole squad request to the canonical server-side Calendar parent scope authority.';
