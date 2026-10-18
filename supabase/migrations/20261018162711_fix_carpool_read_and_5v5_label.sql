-- The read RPC calls an authority helper that takes row locks. Marking the
-- wrapper STABLE makes PostgreSQL reject that safe authority check.
alter function public.get_team_carpool_default(uuid) volatile;

update public.formation_board_presets
set display_name = '2-1-1'
where registry_version = 1
  and preset_key = '5v5-1-2-1'
  and display_name = '1-2-1';

-- Custom Formation positions are part of the immutable saved version so they
-- survive a save, another device opening the board, and later edits.
alter table public.formation_board_versions
  add column custom_slots jsonb not null default '[]'::jsonb;

alter table public.formation_board_versions
  add constraint formation_board_versions_custom_slots_check
  check (jsonb_typeof(custom_slots) = 'array' and jsonb_array_length(custom_slots) <= 11);

create or replace function app_private.formation_board_normalize_custom_slots(custom_slots_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized jsonb;
begin
  if jsonb_typeof(coalesce(custom_slots_value, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(custom_slots_value, '[]'::jsonb)) > 11
    or exists (
      select 1
      from jsonb_array_elements(coalesce(custom_slots_value, '[]'::jsonb)) item
      where jsonb_typeof(item) <> 'object'
        or coalesce(item->>'id', '') !~ '^custom-([1-9]|1[01])$'
        or jsonb_typeof(item->'x') <> 'number'
        or jsonb_typeof(item->'y') <> 'number'
        or (item->>'x')::numeric < 0.04
        or (item->>'x')::numeric > 0.96
        or (item->>'y')::numeric < 0.04
        or (item->>'y')::numeric > 0.96
    )
    or (
      select count(*) <> count(distinct item->>'id')
      from jsonb_array_elements(coalesce(custom_slots_value, '[]'::jsonb)) item
    ) then
    raise exception using errcode = '22023', message = 'formation_board_custom_slots_invalid';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', item->>'id',
        'x', round((item->>'x')::numeric, 4),
        'y', round((item->>'y')::numeric, 4)
      ) order by ordinal
    ),
    '[]'::jsonb
  )
  into normalized
  from jsonb_array_elements(coalesce(custom_slots_value, '[]'::jsonb)) with ordinality slots(item, ordinal);

  return normalized;
end;
$$;

create or replace function public.create_formation_board_v2(
  target_team_id uuid,
  title_value text,
  description_value text,
  game_format_value text,
  preset_key_value text,
  pitch_orientation_value text,
  placements_value jsonb,
  bench_value jsonb,
  custom_slots_value jsonb,
  notes_value text,
  visibility_value text,
  registry_version_value integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_team public.teams%rowtype;
  board public.formation_boards%rowtype;
  version public.formation_board_versions%rowtype;
  snapshot jsonb;
  custom_slots_snapshot jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;

  select * into target_team
  from public.teams
  where id = target_team_id and status = 'active';

  if not found then
    raise exception using errcode = 'P0002', message = 'formation_board_team_not_found';
  end if;
  if app_private.formation_board_team_role_rank(actor_id, target_team.id, target_team.club_id) < 30 then
    perform app_private.formation_board_record_audit(actor_id, target_team.club_id, target_team.id, 'formation_board_create_denied', target_team.id, jsonb_build_object('reason', 'role_ceiling'), 'denied');
    raise exception using errcode = '42501', message = 'formation_board_create_forbidden';
  end if;
  if char_length(btrim(coalesce(title_value, ''))) not between 1 and 120
    or char_length(coalesce(description_value, '')) > 1000
    or char_length(coalesce(notes_value, '')) > 2000
    or coalesce(pitch_orientation_value, '') not in ('portrait', 'landscape')
    or coalesce(visibility_value, '') not in ('draft', 'shared') then
    raise exception using errcode = '22023', message = 'formation_board_payload_invalid';
  end if;

  snapshot := app_private.formation_board_normalize_snapshot(
    target_team.club_id,
    target_team.id,
    game_format_value,
    preset_key_value,
    registry_version_value,
    placements_value,
    bench_value
  );
  custom_slots_snapshot := app_private.formation_board_normalize_custom_slots(custom_slots_value);

  insert into public.formation_boards (
    club_id, team_id, title, description, game_format, formation_preset_key,
    preset_registry_version, visibility_state, created_by_profile_id
  ) values (
    target_team.club_id, target_team.id, btrim(title_value), coalesce(description_value, ''),
    game_format_value, preset_key_value, registry_version_value, visibility_value, actor_id
  ) returning * into board;

  insert into public.formation_board_versions (
    board_id, club_id, team_id, version_number, game_format, formation_preset_key,
    preset_registry_version, pitch_orientation, placements, bench, custom_slots, notes,
    created_by_profile_id, version_reason
  ) values (
    board.id, board.club_id, board.team_id, 1, game_format_value, preset_key_value,
    registry_version_value, pitch_orientation_value, snapshot->'placements', snapshot->'bench',
    custom_slots_snapshot, coalesce(notes_value, ''), actor_id, 'create'
  ) returning * into version;

  update public.formation_boards
  set current_version_id = version.id
  where id = board.id;

  perform app_private.formation_board_record_audit(
    actor_id,
    board.club_id,
    board.team_id,
    'formation_board_created',
    board.id,
    jsonb_build_object(
      'newVersion', 1,
      'gameFormat', game_format_value,
      'presetKey', preset_key_value,
      'visibility', visibility_value,
      'customSlots', custom_slots_snapshot,
      'pitchPlayerIds', (select coalesce(jsonb_agg(item->>'playerId'), '[]'::jsonb) from jsonb_array_elements(snapshot->'placements') item),
      'benchPlayerIds', (select coalesce(jsonb_agg(item->>'playerId'), '[]'::jsonb) from jsonb_array_elements(snapshot->'bench') item)
    )
  );

  return app_private.formation_board_payload(board.id);
end;
$$;

create or replace function public.save_formation_board_version_v2(
  target_board_id uuid,
  expected_version_number integer,
  game_format_value text,
  preset_key_value text,
  pitch_orientation_value text,
  placements_value jsonb,
  bench_value jsonb,
  custom_slots_value jsonb,
  notes_value text,
  visibility_value text,
  version_reason_value text,
  registry_version_value integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  board public.formation_boards%rowtype;
  previous_version public.formation_board_versions%rowtype;
  next_version public.formation_board_versions%rowtype;
  snapshot jsonb;
  custom_slots_snapshot jsonb;
  next_visibility text;
  summary jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;

  select * into board
  from public.formation_boards
  where id = target_board_id and deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'formation_board_not_found';
  end if;
  if not app_private.formation_board_can_edit(actor_id, board.id) then
    perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id, 'formation_board_save_denied', board.id, jsonb_build_object('reason', 'authority'), 'denied');
    raise exception using errcode = '42501', message = 'formation_board_edit_forbidden';
  end if;
  if board.current_version_number <> expected_version_number then
    raise exception using errcode = 'P0001', message = 'formation_board_version_conflict', detail = jsonb_build_object('expectedVersion', expected_version_number, 'currentVersion', board.current_version_number)::text;
  end if;
  if char_length(coalesce(notes_value, '')) > 2000
    or char_length(btrim(coalesce(version_reason_value, ''))) not between 1 and 200
    or coalesce(pitch_orientation_value, '') not in ('portrait', 'landscape')
    or (visibility_value is not null and visibility_value not in ('draft', 'shared')) then
    raise exception using errcode = '22023', message = 'formation_board_payload_invalid';
  end if;

  snapshot := app_private.formation_board_normalize_snapshot(
    board.club_id,
    board.team_id,
    game_format_value,
    preset_key_value,
    registry_version_value,
    placements_value,
    bench_value
  );
  custom_slots_snapshot := app_private.formation_board_normalize_custom_slots(custom_slots_value);
  select * into previous_version from public.formation_board_versions where id = board.current_version_id;
  next_visibility := coalesce(visibility_value, board.visibility_state);
  summary := app_private.formation_board_change_summary(
    previous_version,
    game_format_value,
    preset_key_value,
    snapshot->'placements',
    snapshot->'bench'
  );

  insert into public.formation_board_versions (
    board_id, club_id, team_id, version_number, game_format, formation_preset_key,
    preset_registry_version, pitch_orientation, placements, bench, custom_slots, notes,
    created_by_profile_id, version_reason, source_version_id
  ) values (
    board.id, board.club_id, board.team_id, board.current_version_number + 1,
    game_format_value, preset_key_value, registry_version_value, pitch_orientation_value,
    snapshot->'placements', snapshot->'bench', custom_slots_snapshot, coalesce(notes_value, ''), actor_id,
    btrim(version_reason_value), previous_version.id
  ) returning * into next_version;

  update public.formation_boards
  set game_format = game_format_value,
      formation_preset_key = preset_key_value,
      preset_registry_version = registry_version_value,
      visibility_state = next_visibility,
      current_version_id = next_version.id,
      current_version_number = next_version.version_number
  where id = board.id;

  perform app_private.formation_board_record_audit(
    actor_id,
    board.club_id,
    board.team_id,
    'formation_board_version_saved',
    board.id,
    summary || jsonb_build_object(
      'previousVersion', previous_version.version_number,
      'newVersion', next_version.version_number,
      'previousVisibility', board.visibility_state,
      'newVisibility', next_visibility,
      'versionReason', btrim(version_reason_value),
      'customSlots', custom_slots_snapshot
    )
  );

  return app_private.formation_board_payload(board.id);
end;
$$;

create or replace function public.save_formation_board_editor_v2(
  target_board_id uuid,
  expected_version_number integer,
  title_value text,
  description_value text,
  game_format_value text,
  preset_key_value text,
  pitch_orientation_value text,
  placements_value jsonb,
  bench_value jsonb,
  custom_slots_value jsonb,
  notes_value text,
  visibility_value text,
  version_reason_value text,
  registry_version_value integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.save_formation_board_version_v2(
    target_board_id,
    expected_version_number,
    game_format_value,
    preset_key_value,
    pitch_orientation_value,
    placements_value,
    bench_value,
    custom_slots_value,
    notes_value,
    visibility_value,
    version_reason_value,
    registry_version_value
  );

  return public.rename_formation_board(
    target_board_id,
    expected_version_number + 1,
    title_value,
    description_value
  );
end;
$$;

create or replace function public.save_coach_match_formation_v2(
  title_value text,
  description_value text,
  game_format_value text,
  preset_key_value text,
  pitch_orientation_value text,
  placements_value jsonb,
  bench_value jsonb,
  custom_slots_value jsonb,
  notes_value text,
  registry_version_value integer,
  target_match_day_id uuid,
  target_board_id uuid,
  expected_version_number integer,
  shared_value boolean,
  version_reason_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  fixture public.match_days%rowtype;
  existing_board public.formation_boards%rowtype;
  saved_board jsonb;
  board_id_value uuid;
  current_version_id_value uuid;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;

  select item.* into fixture
  from public.match_days item
  where item.id = target_match_day_id
    and item.deleted_at is null
    and item.status not in ('cancelled', 'postponed')
  for key share;

  if fixture.id is null then
    raise exception using errcode = '22023', message = 'formation_board_match_invalid';
  end if;

  if target_board_id is null then
    saved_board := public.create_formation_board_v2(
      fixture.team_id,
      title_value,
      coalesce(description_value, ''),
      game_format_value,
      preset_key_value,
      pitch_orientation_value,
      placements_value,
      bench_value,
      custom_slots_value,
      coalesce(notes_value, ''),
      'shared',
      registry_version_value
    );
  else
    select item.* into existing_board
    from public.formation_boards item
    where item.id = target_board_id
      and item.deleted_at is null
      and item.archived_at is null
    for update;

    if existing_board.id is null
      or existing_board.club_id <> fixture.club_id
      or existing_board.team_id <> fixture.team_id then
      raise exception using errcode = '22023', message = 'formation_board_match_invalid';
    end if;

    if exists (
      select 1
      from public.formation_boards item
      where item.id = target_board_id
        and item.linked_match_day_id is not null
        and item.linked_match_day_id <> target_match_day_id
    ) then
      raise exception using errcode = '22023', message = 'formation_board_match_already_linked';
    end if;

    saved_board := public.save_formation_board_editor_v2(
      target_board_id,
      expected_version_number,
      title_value,
      description_value,
      game_format_value,
      preset_key_value,
      pitch_orientation_value,
      placements_value,
      bench_value,
      custom_slots_value,
      notes_value,
      'shared',
      coalesce(version_reason_value, 'coach_match_save'),
      registry_version_value
    );
  end if;

  board_id_value := (saved_board->'board'->>'id')::uuid;
  current_version_id_value := (saved_board->'board'->>'current_version_id')::uuid;

  if board_id_value is null or current_version_id_value is null then
    raise exception using errcode = 'P0002', message = 'formation_board_not_found';
  end if;

  perform public.link_formation_board_to_match(board_id_value, target_match_day_id);

  if coalesce(shared_value, false) then
    perform public.publish_formation_board_match_plan(board_id_value, current_version_id_value, target_match_day_id);
  else
    begin
      perform public.withdraw_formation_board_match_plan(board_id_value, target_match_day_id);
    exception
      when sqlstate '22023' then
        if sqlerrm <> 'formation_board_match_publication_not_found' then
          raise;
        end if;
    end;
  end if;

  return public.get_formation_board(board_id_value);
end;
$$;

revoke all on function app_private.formation_board_normalize_custom_slots(jsonb) from public, anon, authenticated;

revoke all on function public.create_formation_board_v2(uuid, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, integer) from public, anon, service_role;
grant execute on function public.create_formation_board_v2(uuid, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, integer) to authenticated;

revoke all on function public.save_formation_board_version_v2(uuid, integer, text, text, text, jsonb, jsonb, jsonb, text, text, text, integer) from public, anon, service_role;
grant execute on function public.save_formation_board_version_v2(uuid, integer, text, text, text, jsonb, jsonb, jsonb, text, text, text, integer) to authenticated;

revoke all on function public.save_formation_board_editor_v2(uuid, integer, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, text, integer) from public, anon, service_role;
grant execute on function public.save_formation_board_editor_v2(uuid, integer, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, text, integer) to authenticated;

revoke all on function public.save_coach_match_formation_v2(text, text, text, text, text, jsonb, jsonb, jsonb, text, integer, uuid, uuid, integer, boolean, text) from public, anon, service_role;
grant execute on function public.save_coach_match_formation_v2(text, text, text, text, text, jsonb, jsonb, jsonb, text, integer, uuid, uuid, integer, boolean, text) to authenticated;

comment on column public.formation_board_versions.custom_slots is 'Saved custom Formation position coordinates for empty and populated slots.';
comment on function public.save_coach_match_formation_v2(text, text, text, text, text, jsonb, jsonb, jsonb, text, integer, uuid, uuid, integer, boolean, text) is 'Atomically saves a Coach Match Formation, including movable custom slot coordinates.';
