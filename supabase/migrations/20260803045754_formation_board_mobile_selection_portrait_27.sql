-- FP-V1-FORMATION-BOARD-MOBILE-SELECTION-PORTRAIT-27
-- Preserve an explicit Unplaced Player state in the existing immutable roster JSON
-- and make portrait the canonical orientation for every new board version.

create or replace function app_private.formation_board_normalize_snapshot(
  target_club_id uuid,
  target_team_id uuid,
  game_format_value text,
  preset_key_value text,
  registry_version_value integer,
  placements_value jsonb,
  bench_value jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  placement_limit integer;
  combined jsonb;
  item jsonb;
  player_uuid uuid;
  normalized_placements jsonb := '[]'::jsonb;
  normalized_bench jsonb := '[]'::jsonb;
  target_player public.players%rowtype;
  index_value integer := 0;
  display_number text;
  roster_state text;
begin
  if jsonb_typeof(coalesce(placements_value, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(bench_value, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'formation_board_snapshot_must_be_arrays';
  end if;

  select preset.player_count
  into placement_limit
  from public.formation_board_presets preset
  where preset.registry_version = registry_version_value
    and preset.preset_key = preset_key_value
    and preset.game_format = game_format_value
    and preset.readiness_state = 'ready';

  if placement_limit is null then
    raise exception using errcode = '22023', message = 'formation_board_preset_invalid';
  end if;

  if jsonb_array_length(coalesce(placements_value, '[]'::jsonb)) > placement_limit then
    raise exception using errcode = '22023', message = 'formation_board_pitch_player_limit_exceeded';
  end if;

  if jsonb_array_length(coalesce(bench_value, '[]'::jsonb)) > 50 then
    raise exception using errcode = '22023', message = 'formation_board_bench_limit_exceeded';
  end if;

  combined := coalesce(placements_value, '[]'::jsonb) || coalesce(bench_value, '[]'::jsonb);
  if exists (
    select 1
    from jsonb_array_elements(combined) entry
    group by entry->>'playerId'
    having entry->>'playerId' is null or count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'formation_board_player_duplicate';
  end if;

  for item in select value from jsonb_array_elements(coalesce(placements_value, '[]'::jsonb)) loop
    if jsonb_typeof(item) <> 'object'
      or coalesce(item->>'playerId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'x') <> 'number'
      or jsonb_typeof(item->'y') <> 'number'
      or (item->>'x')::numeric < 0 or (item->>'x')::numeric > 1
      or (item->>'y')::numeric < 0 or (item->>'y')::numeric > 1 then
      raise exception using errcode = '22023', message = 'formation_board_placement_invalid';
    end if;

    player_uuid := (item->>'playerId')::uuid;
    select * into target_player
    from public.players player
    where player.id = player_uuid
      and player.club_id = target_club_id
      and player.team_id = target_team_id
      and coalesce(player.status, 'active') <> 'archived';

    if not found then
      raise exception using errcode = '42501', message = 'formation_board_player_out_of_scope';
    end if;

    display_number := coalesce(
      nullif(btrim(item->>'displayedShirtNumber'), ''),
      nullif(btrim(item->>'shirtNumber'), ''),
      nullif(btrim(target_player.shirt_number), ''),
      ''
    );
    if display_number <> '' and display_number !~ '^[0-9]{1,3}$' then
      raise exception using errcode = '22023', message = 'formation_board_shirt_number_invalid';
    end if;

    index_value := index_value + 1;
    normalized_placements := normalized_placements || jsonb_build_array(jsonb_build_object(
      'playerId', target_player.id,
      'displayName', coalesce(nullif(btrim(target_player.preferred_name), ''), nullif(btrim(concat_ws(' ', target_player.first_name, target_player.last_name)), ''), target_player.player_name),
      'shirtNumber', display_number,
      'x', (item->>'x')::numeric,
      'y', (item->>'y')::numeric,
      'slotId', left(coalesce(item->>'slotId', ''), 60),
      'positionGroup', case when item->>'positionGroup' in ('goalkeeper', 'defender', 'midfielder', 'forward') then item->>'positionGroup' else '' end,
      'state', 'pitch',
      'displayOrder', index_value
    ));
  end loop;

  index_value := 0;
  for item in select value from jsonb_array_elements(coalesce(bench_value, '[]'::jsonb)) loop
    if jsonb_typeof(item) <> 'object'
      or coalesce(item->>'playerId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'formation_board_bench_player_invalid';
    end if;

    roster_state := coalesce(nullif(btrim(item->>'state'), ''), 'bench');
    if roster_state not in ('bench', 'unplaced') then
      raise exception using errcode = '22023', message = 'formation_board_roster_state_invalid';
    end if;

    player_uuid := (item->>'playerId')::uuid;
    select * into target_player
    from public.players player
    where player.id = player_uuid
      and player.club_id = target_club_id
      and player.team_id = target_team_id
      and coalesce(player.status, 'active') <> 'archived';

    if not found then
      raise exception using errcode = '42501', message = 'formation_board_player_out_of_scope';
    end if;

    display_number := coalesce(
      nullif(btrim(item->>'displayedShirtNumber'), ''),
      nullif(btrim(item->>'shirtNumber'), ''),
      nullif(btrim(target_player.shirt_number), ''),
      ''
    );
    if display_number <> '' and display_number !~ '^[0-9]{1,3}$' then
      raise exception using errcode = '22023', message = 'formation_board_shirt_number_invalid';
    end if;

    index_value := index_value + 1;
    normalized_bench := normalized_bench || jsonb_build_array(jsonb_build_object(
      'playerId', target_player.id,
      'displayName', coalesce(nullif(btrim(target_player.preferred_name), ''), nullif(btrim(concat_ws(' ', target_player.first_name, target_player.last_name)), ''), target_player.player_name),
      'shirtNumber', display_number,
      'state', roster_state,
      'displayOrder', index_value
    ));
  end loop;

  return jsonb_build_object('placements', normalized_placements, 'bench', normalized_bench);
end;
$$;

revoke all on function app_private.formation_board_normalize_snapshot(uuid, uuid, text, text, integer, jsonb, jsonb)
from public, anon, authenticated;

create or replace function app_private.canonicalize_new_formation_board_version()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.pitch_orientation = 'landscape'
    and position('portrait adaptation' in lower(coalesce(new.version_reason, ''))) = 0 then
    new.version_reason := left(coalesce(new.version_reason, 'Formation Board save') || ' | portrait adaptation', 200);
  end if;

  -- Stored coordinates are normalized against unchanged tactical axes. Keeping
  -- x and y preserves side to side and defensive to attacking relationships.
  new.pitch_orientation := 'portrait';
  return new;
end;
$$;

revoke all on function app_private.canonicalize_new_formation_board_version()
from public, anon, authenticated;

drop trigger if exists formation_board_versions_canonical_portrait
on public.formation_board_versions;

create trigger formation_board_versions_canonical_portrait
before insert on public.formation_board_versions
for each row execute function app_private.canonicalize_new_formation_board_version();

comment on function app_private.formation_board_normalize_snapshot(uuid, uuid, text, text, integer, jsonb, jsonb)
is 'Validates Team-scoped Formation Board snapshots and preserves explicit bench or unplaced roster state.';

comment on function app_private.canonicalize_new_formation_board_version()
is 'Preserves historical versions while making portrait canonical for every newly inserted Formation Board version.';
