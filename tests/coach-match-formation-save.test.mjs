import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const sourceUrl = new URL('../apps/mobile-core/src/coachFormationBoardData.js', import.meta.url)
const migration = await readFile(new URL('../supabase/migrations/20261018162711_fix_carpool_read_and_5v5_label.sql', import.meta.url), 'utf8')
const rpcSignature = migration.match(/create or replace function public\.save_coach_match_formation_v2\(([\s\S]*?)\)\s*returns jsonb/i)
assert.ok(rpcSignature, 'The deployed match-formation RPC contract must be present')
const requiredParameters = rpcSignature[1].split(',').map((parameter) => parameter.trim().split(/\s+/)[0]).sort()
const calls = []
let failure = null
globalThis.__matchFormationRpc = { rpc: async (name, params) => {
  calls.push({ name, params })
  if (name === 'save_coach_match_formation_v2' && JSON.stringify(Object.keys(params).sort()) !== JSON.stringify(requiredParameters)) {
    return { data: null, error: new Error('Could not find save_coach_match_formation_v2 with these named arguments') }
  }
  return { data: { board: { id: params.target_board_id || 'new-board', linked_match_day_id: params.target_match_day_id, title: params.title_value } }, error: failure }
} }
const source = (await readFile(sourceUrl, 'utf8'))
  .replace("import { supabase } from './supabase'", 'const supabase = globalThis.__matchFormationRpc')
  .replaceAll("'./coachFormationBoardPayload.js'", JSON.stringify(new URL('../apps/mobile-core/src/coachFormationBoardPayload.js', import.meta.url).href))
const { saveCoachMatchFormationBoard } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const user = { id: 'coach', clubId: 'club', activeTeamId: 'team', roleRank: 30, hasActivePlanAccess: true }
const match = { id: 'match-a', teamName: 'Team', opponent: 'Visitors' }
const draft = { gameFormat: '11v11', presetKey: '11v11-custom', placements: [{ playerId: 'one', x: 0.5, y: 0.5 }], bench: [], customSlots: [{ id: 'custom-1', x: 0.42, y: 0.88 }] }

test('new match lineup uses one atomic RPC with private audience by default', async () => {
  calls.length = 0
  const saved = await saveCoachMatchFormationBoard(user, match, null, draft, 'Starting lineup')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'save_coach_match_formation_v2')
  assert.deepEqual(calls[0].params.custom_slots_value, draft.customSlots)
  assert.equal(calls[0].params.shared_value, false)
  assert.equal(calls[0].params.target_match_day_id, 'match-a')
  assert.equal(calls[0].params.target_board_id, null)
  assert.equal(calls[0].params.expected_version_number, null)
  assert.equal(calls[0].params.version_reason_value, 'coach_mobile_save')
  assert.equal(saved.linkedMatchDayId, 'match-a')
})
test('new shared match lineup supplies the full RPC contract and retains the draft roster', async () => {
  calls.length = 0
  const rosterDraft = {
    ...draft,
    notes: 'Keep the shape',
    bench: [{ playerId: 'two', displayName: 'Bench player' }],
    unplaced: [{ playerId: 'three', displayName: 'Unplaced player', x: 0.2, y: 0.3 }],
  }
  await saveCoachMatchFormationBoard(user, match, null, rosterDraft, 'Shared lineup', true)
  assert.equal(calls.length, 1)
  const { params } = calls[0]
  assert.deepEqual(Object.keys(params).sort(), requiredParameters)
  assert.equal(params.shared_value, true)
  assert.equal(params.version_reason_value, 'coach_mobile_save')
  assert.equal(params.notes_value, 'Keep the shape')
  assert.deepEqual(params.placements_value, rosterDraft.placements)
  assert.deepEqual(params.custom_slots_value, rosterDraft.customSlots)
  assert.deepEqual(params.bench_value, [
    { playerId: 'two', displayName: 'Bench player', state: 'bench' },
    { playerId: 'three', displayName: 'Unplaced player', state: 'unplaced' },
  ])
})
test('existing lineup preserves identity and optimistic version guard while changing audience', async () => {
  calls.length = 0
  await saveCoachMatchFormationBoard(user, match, { id: 'lineup-2', linkedMatchDayId: 'match-a', currentVersionNumber: 4, currentVersion: { notes: 'Coach notes' } }, draft, 'Second half', true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].params.target_board_id, 'lineup-2')
  assert.equal(calls[0].params.expected_version_number, 4)
  assert.equal(calls[0].params.shared_value, true)
  assert.equal(calls[0].params.notes_value, 'Coach notes')
  assert.equal(calls[0].params.version_reason_value, 'coach_mobile_save')
})
test('missing match, cross-match save and unauthorised roles never call the server', async () => {
  calls.length = 0
  await assert.rejects(saveCoachMatchFormationBoard(user, null, null, draft, 'Lineup'), /Choose a match/)
  await assert.rejects(saveCoachMatchFormationBoard(user, match, { id: 'other', linkedMatchDayId: 'match-b' }, draft, 'Lineup'), /another match/)
  await assert.rejects(saveCoachMatchFormationBoard({ ...user, roleRank: 20 }, match, null, draft, 'Lineup'), /Coach or manager/)
  assert.equal(calls.length, 0)
})
test('atomic RPC failures are surfaced without any follow-up publish or withdrawal', async () => {
  calls.length = 0
  failure = new Error('formation_board_version_conflict')
  try { await assert.rejects(saveCoachMatchFormationBoard(user, match, null, draft, 'Lineup', true), /version_conflict/) }
  finally { failure = null }
  assert.equal(calls.length, 1)
})
