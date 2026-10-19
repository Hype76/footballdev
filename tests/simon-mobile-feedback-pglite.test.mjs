import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20261018162711_fix_carpool_read_and_5v5_label.sql', import.meta.url), 'utf8')
const coachId = '00000000-0000-4000-8000-000000000001'
const clubId = '00000000-0000-4000-8000-000000000002'
const teamId = '00000000-0000-4000-8000-000000000003'
const matchId = '00000000-0000-4000-8000-000000000004'

test('Simon feedback migration persists custom positions through create and edit', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema app_private;
    create function auth.uid() returns uuid language sql stable as 'select ''${coachId}''::uuid';
    create table public.teams (id uuid primary key, club_id uuid not null, status text not null);
    create table public.match_days (id uuid primary key, club_id uuid not null, team_id uuid not null, deleted_at timestamptz, status text not null);
    create table public.formation_board_presets (registry_version integer, preset_key text, display_name text);
    create table public.formation_boards (
      id uuid primary key default gen_random_uuid(), club_id uuid not null, team_id uuid not null,
      title text not null, description text not null default '', game_format text not null,
      formation_preset_key text not null, preset_registry_version integer not null,
      visibility_state text not null, created_by_profile_id uuid not null,
      current_version_id uuid, current_version_number integer not null default 1,
      linked_match_day_id uuid, deleted_at timestamptz, archived_at timestamptz
    );
    create table public.formation_board_versions (
      id uuid primary key default gen_random_uuid(), board_id uuid not null, club_id uuid not null,
      team_id uuid not null, version_number integer not null, game_format text not null,
      formation_preset_key text not null, preset_registry_version integer not null,
      pitch_orientation text not null, placements jsonb not null, bench jsonb not null,
      notes text not null, created_by_profile_id uuid not null, version_reason text not null,
      source_version_id uuid, created_at timestamptz not null default now()
    );
    create function app_private.reject_formation_board_immutable_change()
    returns trigger language plpgsql as $$
    begin
      raise exception using errcode = '55000', message = 'formation_board_snapshot_immutable';
    end;
    $$;
    create trigger formation_board_versions_immutable
    before update or delete on public.formation_board_versions
    for each row execute function app_private.reject_formation_board_immutable_change();
    create function public.get_team_carpool_default(uuid) returns boolean language sql stable as 'select false';
    create function app_private.formation_board_team_role_rank(uuid, uuid, uuid) returns integer language sql stable as 'select 30';
    create function app_private.formation_board_can_edit(uuid, uuid) returns boolean language sql stable as 'select true';
    create function app_private.formation_board_record_audit(uuid, uuid, uuid, text, uuid, jsonb, text default 'allowed') returns void language sql as 'select';
    create function app_private.formation_board_normalize_snapshot(uuid, uuid, text, text, integer, jsonb, jsonb) returns jsonb language sql immutable as 'select jsonb_build_object(''placements'', $6, ''bench'', $7)';
    create function app_private.formation_board_change_summary(public.formation_board_versions, text, text, jsonb, jsonb) returns jsonb language sql immutable as 'select ''{}''::jsonb';
    create function app_private.formation_board_payload(uuid) returns jsonb language sql stable as 'select jsonb_build_object(''board'', to_jsonb(board), ''currentVersion'', to_jsonb(version)) from public.formation_boards board join public.formation_board_versions version on version.id = board.current_version_id where board.id = $1';
    create function public.rename_formation_board(uuid, integer, text, text) returns jsonb language plpgsql as $$ begin update public.formation_boards set title = $3, description = coalesce($4, description) where id = $1; return app_private.formation_board_payload($1); end $$;
    create function public.link_formation_board_to_match(uuid, uuid) returns jsonb language plpgsql as $$ begin update public.formation_boards set linked_match_day_id = $2 where id = $1; return app_private.formation_board_payload($1); end $$;
    create function public.publish_formation_board_match_plan(uuid, uuid, uuid) returns jsonb language sql as 'select ''{}''::jsonb';
    create function public.withdraw_formation_board_match_plan(uuid, uuid) returns jsonb language sql as 'select ''{}''::jsonb';
    create function public.get_formation_board(uuid) returns jsonb language sql stable as 'select app_private.formation_board_payload($1)';
    insert into public.teams values ('${teamId}', '${clubId}', 'active');
    insert into public.match_days values ('${matchId}', '${clubId}', '${teamId}', null, 'scheduled');
    insert into public.formation_board_presets values (1, '5v5-1-2-1', '1-2-1');
    insert into public.formation_board_versions (
      board_id, club_id, team_id, version_number, game_format, formation_preset_key,
      preset_registry_version, pitch_orientation, placements, bench, notes,
      created_by_profile_id, version_reason
    ) values (
      gen_random_uuid(), '${clubId}', '${teamId}', 1, '5v5', '5v5-custom',
      1, 'portrait', '[]', '[]', '', '${coachId}', 'existing_snapshot'
    );
  `)

  await db.exec(migration)
  assert.equal(
    (await db.query("select custom_slots from public.formation_board_versions where version_reason = 'existing_snapshot'")).rows[0].custom_slots.length,
    0,
  )
  await assert.rejects(
    db.query("update public.formation_board_versions set notes = 'rewrite' where version_reason = 'existing_snapshot'"),
    /formation_board_snapshot_immutable/,
  )
  const customSlots = JSON.stringify([{ id: 'custom-1', x: 0.42, y: 0.88 }])
  const created = await db.query(`select public.create_formation_board_v2(
    '${teamId}', 'Custom', '', '5v5', '5v5-custom', 'portrait', '[]', '[]',
    '${customSlots}'::jsonb, '', 'draft', 1
  ) as value`)
  const boardId = created.rows[0].value.board.id
  const firstVersionId = created.rows[0].value.currentVersion.id
  assert.deepEqual(created.rows[0].value.currentVersion.custom_slots, [{ id: 'custom-1', x: 0.42, y: 0.88 }])

  const legacyVersion = await db.query(`
    insert into public.formation_board_versions (
      board_id, club_id, team_id, version_number, game_format, formation_preset_key,
      preset_registry_version, pitch_orientation, placements, bench, notes,
      created_by_profile_id, version_reason, source_version_id
    ) values (
      '${boardId}', '${clubId}', '${teamId}', 2, '5v5', '5v5-custom',
      1, 'portrait', '[]', '[]', '', '${coachId}', 'legacy_save', '${firstVersionId}'
    ) returning id, custom_slots
  `)
  assert.deepEqual(legacyVersion.rows[0].custom_slots, [{ id: 'custom-1', x: 0.42, y: 0.88 }])
  await db.query('update public.formation_boards set current_version_id = $1, current_version_number = 2 where id = $2', [legacyVersion.rows[0].id, boardId])

  const updatedSlots = JSON.stringify([{ id: 'custom-1', x: 0.25, y: 0.75 }])
  const saved = await db.query(`select public.save_formation_board_editor_v2(
    '${boardId}', 2, 'Custom', '', '5v5', '5v5-custom', 'portrait', '[]', '[]',
    '${updatedSlots}'::jsonb, '', 'draft', 'mobile_test', 1
  ) as value`)
  assert.equal(saved.rows[0].value.board.current_version_number, 3)
  assert.deepEqual(saved.rows[0].value.currentVersion.custom_slots, [{ id: 'custom-1', x: 0.25, y: 0.75 }])

  const cleared = await db.query(`select public.save_formation_board_editor_v2(
    '${boardId}', 3, 'Fixed', '', '5v5', '5v5-1-2-1', 'portrait', '[]', '[]',
    '[]'::jsonb, '', 'draft', 'mobile_test', 1
  ) as value`)
  assert.deepEqual(cleared.rows[0].value.currentVersion.custom_slots, [])
  assert.equal((await db.query("select display_name from public.formation_board_presets where preset_key = '5v5-1-2-1'")).rows[0].display_name, '2-1-1')
})
