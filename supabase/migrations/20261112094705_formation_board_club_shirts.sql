-- The selected club shirt is part of each immutable board version.
alter table public.formation_board_versions add column shirt_kit jsonb;

create function app_private.formation_board_resolve_shirt_kit(target_club_id uuid, kit_type_value text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  kit jsonb;
begin
  if kit_type_value is null then
    return null;
  end if;
  if kit_type_value not in ('home', 'away') then
    raise exception using errcode = '22023', message = 'formation_board_shirt_kit_invalid';
  end if;

  select jsonb_build_object('type', kit_row.kit_type, 'colour', kit_row.colour, 'imagePath', kit_row.image_path)
  into kit
  from public.club_kits kit_row
  where kit_row.club_id = target_club_id and kit_row.kit_type = kit_type_value
  for share;

  if kit is null then
    raise exception using errcode = '22023', message = 'formation_board_shirt_kit_unavailable';
  end if;
  return kit;
end;
$$;

create function app_private.formation_board_inherit_shirt_kit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.shirt_kit is null and new.source_version_id is not null then
    select source.shirt_kit
    into new.shirt_kit
    from public.formation_board_versions source
    where source.id = new.source_version_id and source.club_id = new.club_id and source.team_id = new.team_id;
  end if;
  return new;
end;
$$;

revoke all on function app_private.formation_board_resolve_shirt_kit(uuid, text) from public, anon, authenticated, service_role;
revoke all on function app_private.formation_board_inherit_shirt_kit() from public, anon, authenticated, service_role;

create trigger formation_board_versions_inherit_shirt_kit
before insert on public.formation_board_versions
for each row execute function app_private.formation_board_inherit_shirt_kit();

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
  registry_version_value integer,
  shirt_kit_type_value text
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
  shirt_kit_snapshot jsonb;
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
  shirt_kit_snapshot := app_private.formation_board_resolve_shirt_kit(target_team.club_id, shirt_kit_type_value);

  insert into public.formation_boards (
    club_id, team_id, title, description, game_format, formation_preset_key,
    preset_registry_version, visibility_state, created_by_profile_id
  ) values (
    target_team.club_id, target_team.id, btrim(title_value), coalesce(description_value, ''),
    game_format_value, preset_key_value, registry_version_value, visibility_value, actor_id
  ) returning * into board;

  insert into public.formation_board_versions (
    board_id, club_id, team_id, version_number, game_format, formation_preset_key,
    preset_registry_version, pitch_orientation, placements, bench, custom_slots, shirt_kit, notes,
    created_by_profile_id, version_reason
  ) values (
    board.id, board.club_id, board.team_id, 1, game_format_value, preset_key_value,
    registry_version_value, pitch_orientation_value, snapshot->'placements', snapshot->'bench',
    custom_slots_snapshot, shirt_kit_snapshot, coalesce(notes_value, ''), actor_id, 'create'
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

revoke all on function public.create_formation_board_v2(uuid, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, integer, text) from public, anon, service_role;
grant execute on function public.create_formation_board_v2(uuid, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, integer, text) to authenticated;

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
language sql
security definer
set search_path = ''
as $$
  select public.create_formation_board_v2(
    target_team_id,
    title_value,
    description_value,
    game_format_value,
    preset_key_value,
    pitch_orientation_value,
    placements_value,
    bench_value,
    custom_slots_value,
    notes_value,
    visibility_value,
    registry_version_value,
    null::text
  );
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
  registry_version_value integer,
  shirt_kit_type_value text
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
  shirt_kit_snapshot jsonb;
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
  shirt_kit_snapshot := app_private.formation_board_resolve_shirt_kit(board.club_id, shirt_kit_type_value);
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
    preset_registry_version, pitch_orientation, placements, bench, custom_slots, shirt_kit, notes,
    created_by_profile_id, version_reason, source_version_id
  ) values (
    board.id, board.club_id, board.team_id, board.current_version_number + 1,
    game_format_value, preset_key_value, registry_version_value, pitch_orientation_value,
    snapshot->'placements', snapshot->'bench', custom_slots_snapshot, shirt_kit_snapshot, coalesce(notes_value, ''), actor_id,
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

revoke all on function public.save_formation_board_version_v2(uuid, integer, text, text, text, jsonb, jsonb, jsonb, text, text, text, integer, text) from public, anon, service_role;
grant execute on function public.save_formation_board_version_v2(uuid, integer, text, text, text, jsonb, jsonb, jsonb, text, text, text, integer, text) to authenticated;

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
language sql
security definer
set search_path = ''
as $$
  select public.save_formation_board_version_v2(
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
    registry_version_value,
    null::text
  );
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
  registry_version_value integer,
  shirt_kit_type_value text
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
    registry_version_value,
    shirt_kit_type_value
  );

  return public.rename_formation_board(
    target_board_id,
    expected_version_number + 1,
    title_value,
    description_value
  );
end;
$$;

revoke all on function public.save_formation_board_editor_v2(uuid, integer, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, text, integer, text) from public, anon, service_role;
grant execute on function public.save_formation_board_editor_v2(uuid, integer, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, text, integer, text) to authenticated;

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
language sql
security definer
set search_path = ''
as $$
  select public.save_formation_board_editor_v2(
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
    visibility_value,
    version_reason_value,
    registry_version_value,
    null::text
  );
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
  version_reason_value text,
  shirt_kit_type_value text
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
      registry_version_value,
      shirt_kit_type_value
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
      registry_version_value,
      shirt_kit_type_value
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

revoke all on function public.save_coach_match_formation_v2(text, text, text, text, text, jsonb, jsonb, jsonb, text, integer, uuid, uuid, integer, boolean, text, text) from public, anon, service_role;
grant execute on function public.save_coach_match_formation_v2(text, text, text, text, text, jsonb, jsonb, jsonb, text, integer, uuid, uuid, integer, boolean, text, text) to authenticated;

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
language sql
security definer
set search_path = ''
as $$
  select public.save_coach_match_formation_v2(
    title_value,
    description_value,
    game_format_value,
    preset_key_value,
    pitch_orientation_value,
    placements_value,
    bench_value,
    custom_slots_value,
    notes_value,
    registry_version_value,
    target_match_day_id,
    target_board_id,
    expected_version_number,
    shared_value,
    version_reason_value,
    null::text
  );
$$;

create or replace function public.list_formation_board_match_publications(target_board_id uuid)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not app_private.formation_board_can_view(actor_id, target_board_id) then
    raise exception using errcode = '42501', message = 'formation_board_forbidden';
  end if;

  return query
  select to_jsonb(publication) || jsonb_build_object(
    'game_format', version.game_format,
    'formation_preset_key', version.formation_preset_key,
    'pitch_orientation', version.pitch_orientation,
    'shirt_kit', version.shirt_kit,
    'placements', version.placements,
    'bench', (
      select coalesce(jsonb_agg((player - 'state') || jsonb_build_object('state', 'bench') order by ordinal), '[]'::jsonb)
      from jsonb_array_elements(version.bench) with ordinality roster(player, ordinal)
    )
  )
  from public.formation_board_match_publications publication
  join public.formation_board_versions version on version.id = publication.board_version_id
  where publication.board_id = target_board_id
  order by publication.published_at desc;
end;
$$;

create or replace function public.publish_formation_board_match_plan(
  target_board_id uuid,
  target_version_id uuid,
  target_match_day_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_name text;
  board public.formation_boards%rowtype;
  version public.formation_board_versions%rowtype;
  fixture public.match_days%rowtype;
  publication public.formation_board_match_publications%rowtype;
  next_number integer;
begin
  select item.* into board
  from public.formation_boards item
  where item.id = target_board_id
    and item.deleted_at is null
    and item.archived_at is null
  for update;

  if actor_id is null or board.id is null
    or not app_private.formation_board_can_edit(actor_id, board.id) then
    raise exception using errcode = '42501', message = 'formation_board_publish_forbidden';
  end if;

  if board.linked_match_day_id is distinct from target_match_day_id then
    raise exception using errcode = '22023', message = 'formation_board_match_link_required';
  end if;

  select item.* into fixture
  from public.match_days item
  where item.id = target_match_day_id
    and item.club_id = board.club_id
    and item.team_id = board.team_id
    and item.deleted_at is null
    and item.status not in ('cancelled', 'postponed')
  for key share;

  select item.* into version
  from public.formation_board_versions item
  where item.id = target_version_id
    and item.board_id = board.id
    and item.id = board.current_version_id
  for key share;

  if fixture.id is null then
    raise exception using errcode = '22023', message = 'formation_board_match_invalid';
  end if;
  if version.id is null then
    raise exception using errcode = '22023', message = 'formation_board_version_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_match_day_id::text, 0));
  select coalesce(max(item.publication_number), 0) + 1 into next_number
  from public.formation_board_match_publications item
  where item.match_day_id = target_match_day_id;

  select coalesce(app_user.name, app_user.display_name, app_user.username, app_user.email, '')
  into actor_name
  from public.users app_user
  where app_user.id = actor_id;

  insert into public.formation_board_match_publications (
    board_id,
    board_version_id,
    club_id,
    team_id,
    match_day_id,
    publication_number,
    board_title_snapshot,
    published_by_profile_id,
    published_by_name
  ) values (
    board.id,
    version.id,
    board.club_id,
    board.team_id,
    fixture.id,
    next_number,
    board.title,
    actor_id,
    actor_name
  ) returning * into publication;

  perform app_private.formation_board_record_audit(
    actor_id,
    board.club_id,
    board.team_id,
    'formation_board_match_plan_published',
    board.id,
    jsonb_build_object(
      'matchDayId', fixture.id,
      'boardVersionId', version.id,
      'publicationId', publication.id,
      'publicationNumber', publication.publication_number,
      'parentVisible', true,
      'notificationSent', false
    )
  );

  return to_jsonb(publication) || jsonb_build_object(
    'game_format', version.game_format,
    'formation_preset_key', version.formation_preset_key,
    'pitch_orientation', version.pitch_orientation,
    'shirt_kit', version.shirt_kit,
    'placements', version.placements,
    'bench', version.bench
  );
end;
$$;

-- Add the shirt snapshot to the existing parent payload. The owned-link and
-- visible-match checks remain in the same query.
drop function public.get_parent_portal_match_formation_plans(uuid);

create function public.get_parent_portal_match_formation_plans(parent_link_id_value uuid)
returns table (
  match_day_id uuid,
  board_id uuid,
  publication_id uuid,
  publication_number integer,
  board_title_snapshot text,
  published_at timestamptz,
  game_format text,
  formation_preset_key text,
  pitch_orientation text,
  placements jsonb,
  bench jsonb,
  shirt_kit jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with parent_link as (
    select link.*
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = (select auth.uid())
      and link.status = 'active'
      and public.current_user_can_access_parent_link(link.id, link.player_id)
    limit 1
  ),
  ranked as (
    select
      publication.*,
      row_number() over (
        partition by publication.match_day_id, publication.board_id
        order by publication.publication_number desc
      ) as publication_rank
    from public.formation_board_match_publications publication
    join parent_link link
      on link.club_id = publication.club_id
     and link.team_id = publication.team_id
  )
  select
    publication.match_day_id,
    publication.board_id,
    publication.id,
    publication.publication_number,
    publication.board_title_snapshot,
    publication.published_at,
    version.game_format,
    version.formation_preset_key,
    version.pitch_orientation,
    version.placements,
    (
      select coalesce(jsonb_agg((player - 'state') || jsonb_build_object('state', 'bench') order by ordinal), '[]'::jsonb)
      from jsonb_array_elements(version.bench) with ordinality roster(player, ordinal)
    ),
    version.shirt_kit
  from ranked publication
  join public.formation_board_versions version on version.id = publication.board_version_id
  where publication.publication_rank = 1
    and publication.withdrawn_at is null
    and exists (
      select 1
      from public.get_parent_portal_match_days(parent_link_id_value) visible_match
      where visible_match.id = publication.match_day_id
    )
  order by publication.published_at desc;
$$;

alter function public.get_parent_portal_match_formation_plans(uuid) owner to postgres;
revoke all on function public.get_parent_portal_match_formation_plans(uuid) from public, anon, service_role;
grant execute on function public.get_parent_portal_match_formation_plans(uuid) to authenticated;

-- Kit replacement removes the previous storage object only if no board uses it.
-- The save RPC locks the current kit row while taking the snapshot.
create index formation_board_versions_shirt_artwork_idx
on public.formation_board_versions ((shirt_kit->>'imagePath'))
where shirt_kit->>'imagePath' is not null;

create function app_private.club_kit_artwork_is_referenced(target_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.club_kits kit
    where kit.club_id = public.current_user_club_id() and kit.image_path = target_path
  ) or exists (
    select 1 from public.formation_board_versions version
    where version.club_id = public.current_user_club_id()
      and version.shirt_kit->>'imagePath' = target_path
  );
$$;

revoke all on function app_private.club_kit_artwork_is_referenced(text) from public, anon, service_role;
grant execute on function app_private.club_kit_artwork_is_referenced(text) to authenticated;

alter policy club_kit_objects_admin_delete on storage.objects
using (
  bucket_id = 'club-kits'
  and public.current_user_role() = 'admin'
  and (storage.foldername(name))[1] = public.current_user_club_id()::text
  and not app_private.club_kit_artwork_is_referenced(name)
);

notify pgrst, 'reload schema';
