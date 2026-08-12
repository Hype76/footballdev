import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createMobileFormationDraft,
  moveMobileFormationPlayersToBench,
  parseMobileFormationPreferences,
  placeMobileFormationLineup,
  serializeMobileFormationPreferences,
  setMobileFormationSquad,
} from '../apps/mobile-core/src/coachFormationBoardCore.js'
import {
  createCoachOfflineDocument,
  getCoachOfflineProfile,
  setCoachOfflineProfile,
} from '../apps/mobile-core/src/coachOfflineCore.js'
import { MOBILE_STARTUP_STATES, runMobileStartup } from '../apps/mobile-core/src/startupStateCore.js'

const preset442 = {
  gameFormat: '11v11',
  key: '11v11-4-4-2',
  registryVersion: 1,
  slots: Array.from({ length: 11 }, (_, index) => ({ group: index === 0 ? 'goalkeeper' : 'outfield', id: `slot-${index + 1}`, x: 10 + ((index % 4) * 25), y: 5 + (index * 8) })),
}
const players = Array.from({ length: 16 }, (_, index) => ({ id: `player-${index + 1}`, playerName: `Player ${index + 1}`, shirtNumber: String(index + 1) }))

test('Coach formation defaults are 11v11 and 4-4-2 and round-trip through local preferences', () => {
  const draft = createMobileFormationDraft()
  assert.equal(draft.gameFormat, '11v11')
  assert.equal(draft.presetKey, '11v11-4-4-2')
  assert.deepEqual(parseMobileFormationPreferences(serializeMobileFormationPreferences(draft)), { gameFormat: '11v11', presetKey: '11v11-4-4-2' })
})

test('Select all, Place all, and taking multiple Players off use one Bench and formation capacity', () => {
  let draft = setMobileFormationSquad(createMobileFormationDraft(), players)
  assert.equal(draft.bench.length, 16)
  draft = placeMobileFormationLineup(draft, preset442)
  assert.equal(draft.placements.length, 11)
  assert.equal(draft.bench.length, 5)
  draft = moveMobileFormationPlayersToBench(draft, ['player-1', 'player-2'])
  assert.equal(draft.placements.length, 9)
  assert.equal(draft.bench.length, 7)
})

test('Coach encrypted cache stores the minimum staff profile required for offline context restoration', () => {
  const profile = { accountStatus: 'active', coachContexts: [{ clubId: 'club-1', id: 'team:team-1', role: 'coach', teamId: 'team-1' }], id: 'user-1', role: 'coach' }
  const document = setCoachOfflineProfile(createCoachOfflineDocument({ userScope: 'user-1' }), profile, '2026-08-11T20:00:00Z')
  assert.deepEqual(getCoachOfflineProfile(document, 'user-1'), profile)
  assert.equal(getCoachOfflineProfile(document, 'user-2'), null)
})

test('Coach startup failures use Coach diagnostics', async () => {
  const result = await runMobileStartup({
    appRole: 'coach',
    clearInvalidSession: async () => {},
    config: { isUsable: true },
    getBiometricEnabled: async () => false,
    getSession: () => new Promise(() => {}),
    loadProfile: async () => {},
    onSession: async () => {},
    prepare: async () => {},
    timeoutMs: 5,
  })
  assert.equal(result.state, MOBILE_STARTUP_STATES.RECOVERABLE_ERROR)
  assert.equal(result.diagnosticCode, 'COACH_STARTUP_TIMEOUT')
})

test('Coach app exposes simplified Formation save and Parent publication through canonical RPCs', async () => {
  const [data, screen, matchDay] = await Promise.all([
    readFile(new URL('../apps/mobile-core/src/coachFormationBoardData.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachFormationBoard.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8'),
  ])
  for (const rpc of ['create_formation_board', 'save_formation_board_editor', 'link_formation_board_to_match', 'publish_formation_board_match_plan', 'withdraw_formation_board_match_plan', 'publish_formation_board_version']) assert.match(data, new RegExp(rpc))
  for (const copy of ['Select all', 'Use full squad & build team', 'Take Players off', 'Move ${removalIds.length || \'\'} selected to Bench', 'Move to pitch', 'Save private Formation Board', 'Save and link to match', 'Save and publish to Team Resources']) assert.match(screen, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(screen, /#[0-9a-f]{3,8}/i)
  assert.match(matchDay, /label: 'Formation'/)
})

test('Coach Poll creation supports exact options, unlimited multiple choice, and answer changes', async () => {
  const [screen, data] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8'),
  ])
  assert.match(screen, /Create Poll/)
  assert.match(screen, /Leave blank for unlimited/)
  assert.match(screen, /tap again to remove one/)
  assert.match(screen, /allowVoteChanges/)
  assert.match(screen, /Remove my answer/)
  assert.doesNotMatch(screen, /Create availability Poll/)
  assert.match(data, /p_max_choices: poll\.allowMultiple \? Number\(poll\.maxChoices \|\| 0\) \|\| null : null/)
  assert.match(data, /submit_staff_poll_vote/)
})
