-- FP-V1-FORMATION-BOARD-EDITOR-25B
-- Keep expected optimistic conflicts out of PostgreSQL serialization retry handling.

create or replace function public.save_formation_board_version(
  target_board_id uuid,
  expected_version_number integer,
  game_format_value text,
  preset_key_value text,
  pitch_orientation_value text,
  placements_value jsonb,
  bench_value jsonb,
  notes_value text default '',
  visibility_value text default null,
  version_reason_value text default 'save',
  registry_version_value integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  board public.formation_boards%rowtype;
  previous_version public.formation_board_versions%rowtype;
  next_version public.formation_board_versions%rowtype;
  snapshot jsonb;
  next_visibility text;
  summary jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null for update;
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
    preset_registry_version, pitch_orientation, placements, bench, notes,
    created_by_profile_id, version_reason, source_version_id
  ) values (
    board.id, board.club_id, board.team_id, board.current_version_number + 1,
    game_format_value, preset_key_value, registry_version_value, pitch_orientation_value,
    snapshot->'placements', snapshot->'bench', coalesce(notes_value, ''), actor_id,
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
      'versionReason', btrim(version_reason_value)
    )
  );

  return app_private.formation_board_payload(board.id);
end;
$$;

create or replace function public.set_formation_board_visibility(
  target_board_id uuid,
  expected_version_number integer,
  visibility_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  board public.formation_boards%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'formation_board_not_found'; end if;
  if not app_private.formation_board_can_edit(actor_id, board.id) then
    raise exception using errcode = '42501', message = 'formation_board_edit_forbidden';
  end if;
  if board.current_version_number <> expected_version_number then
    raise exception using errcode = 'P0001', message = 'formation_board_version_conflict';
  end if;
  if visibility_value not in ('draft', 'shared') then
    raise exception using errcode = '22023', message = 'formation_board_visibility_invalid';
  end if;
  update public.formation_boards set visibility_state = visibility_value where id = board.id;
  perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id, 'formation_board_visibility_changed', board.id, jsonb_build_object('from', board.visibility_state, 'to', visibility_value, 'version', board.current_version_number));
  return app_private.formation_board_payload(board.id);
end;
$$;

create or replace function public.rename_formation_board(
  target_board_id uuid,
  expected_version_number integer,
  title_value text,
  description_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  board public.formation_boards%rowtype;
  next_description text;
begin
  if actor_id is null then raise exception using errcode = '28000', message = 'formation_board_auth_required'; end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'formation_board_not_found'; end if;
  if not app_private.formation_board_can_edit(actor_id, board.id) then raise exception using errcode = '42501', message = 'formation_board_edit_forbidden'; end if;
  if board.current_version_number <> expected_version_number then raise exception using errcode = 'P0001', message = 'formation_board_version_conflict'; end if;
  next_description := coalesce(description_value, board.description);
  if char_length(btrim(coalesce(title_value, ''))) not between 1 and 120 or char_length(next_description) > 1000 then
    raise exception using errcode = '22023', message = 'formation_board_title_invalid';
  end if;
  update public.formation_boards set title = btrim(title_value), description = next_description where id = board.id;
  perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id, 'formation_board_renamed', board.id, jsonb_build_object('previousTitle', board.title, 'newTitle', btrim(title_value), 'version', board.current_version_number));
  return app_private.formation_board_payload(board.id);
end;
$$;

create or replace function public.restore_formation_board_version(
  target_board_id uuid,
  target_version_id uuid,
  expected_version_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  board public.formation_boards%rowtype;
  source_version public.formation_board_versions%rowtype;
  next_version public.formation_board_versions%rowtype;
begin
  if actor_id is null then raise exception using errcode = '28000', message = 'formation_board_auth_required'; end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'formation_board_not_found'; end if;
  if not app_private.formation_board_can_edit(actor_id, board.id) then raise exception using errcode = '42501', message = 'formation_board_edit_forbidden'; end if;
  if board.current_version_number <> expected_version_number then raise exception using errcode = 'P0001', message = 'formation_board_version_conflict'; end if;
  select * into source_version from public.formation_board_versions where id = target_version_id and board_id = board.id;
  if not found then raise exception using errcode = 'P0002', message = 'formation_board_version_not_found'; end if;
  insert into public.formation_board_versions (
    board_id, club_id, team_id, version_number, game_format, formation_preset_key,
    preset_registry_version, pitch_orientation, placements, bench, notes,
    created_by_profile_id, version_reason, source_version_id
  ) values (
    board.id, board.club_id, board.team_id, board.current_version_number + 1,
    source_version.game_format, source_version.formation_preset_key, source_version.preset_registry_version,
    source_version.pitch_orientation, source_version.placements, source_version.bench, source_version.notes,
    actor_id, 'restore version ' || source_version.version_number::text, source_version.id
  ) returning * into next_version;
  update public.formation_boards set current_version_id = next_version.id, current_version_number = next_version.version_number, game_format = next_version.game_format, formation_preset_key = next_version.formation_preset_key, preset_registry_version = next_version.preset_registry_version where id = board.id;
  perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id, 'formation_board_version_restored', board.id, jsonb_build_object('previousVersion', board.current_version_number, 'restoredFromVersion', source_version.version_number, 'newVersion', next_version.version_number));
  return app_private.formation_board_payload(board.id);
end;
$$;
