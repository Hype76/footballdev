import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const sourceUrl = new URL('../apps/mobile-core/src/coachFormationBoardData.js', import.meta.url)
const calls = []
let failure = null
globalThis.__matchFormationRpc = { rpc: async (name, params) => {
  calls.push({ name, params })
  return { data: { board: { id: params.target_board_id || 'new-board', linked_match_day_id: params.target_match_day_id, title: params.title_value } }, error: failure }
} }
const source = (await readFile(sourceUrl, 'utf8'))
  .replace("import { supabase } from './supabase'", 'const supabase = globalThis.__matchFormationRpc')
  .replaceAll("'./coachFormationBoardPayload.js'", JSON.stringify(new URL('../apps/mobile-core/src/coachFormationBoardPayload.js', import.meta.url).href))
const { saveCoachMatchFormationBoard } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const user = { id: 'coach', clubId: 'club', activeTeamId: 'team', roleRank: 30, hasActivePlanAccess: true }
const match = { id: 'match-a', teamName: 'Team', opponent: 'Visitors' }
const draft = { gameFormat: '11v11', presetKey: '11v11-4-4-2', placements: [{ playerId: 'one', x: 0.5, y: 0.5 }], bench: [] }

test('new match lineup uses one atomic RPC with private audience by default', async () => {
  calls.length = 0
  const saved = await saveCoachMatchFormationBoard(user, match, null, draft, 'Starting lineup')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'save_coach_match_formation')
  assert.equal(calls[0].params.shared_value, false)
  assert.equal(calls[0].params.target_match_day_id, 'match-a')
  assert.equal(calls[0].params.target_board_id, null)
  assert.equal(saved.linkedMatchDayId, 'match-a')
})
test('existing lineup preserves identity and optimistic version guard while changing audience', async () => {
  calls.length = 0
  await saveCoachMatchFormationBoard(user, match, { id: 'lineup-2', linkedMatchDayId: 'match-a', currentVersionNumber: 4, currentVersion: { notes: 'Coach notes' } }, draft, 'Second half', true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].params.target_board_id, 'lineup-2')
  assert.equal(calls[0].params.expected_version_number, 4)
  assert.equal(calls[0].params.shared_value, true)
  assert.equal(calls[0].params.notes_value, 'Coach notes')
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
