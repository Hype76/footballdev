import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createMobileFormationDraft, moveMobileFormationPlayersToBench, placeMobileFormationPlayer, setMobileFormationSquad, toggleMobileFormationSquadPlayer } from '../apps/mobile-core/src/coachFormationBoardCore.js'
import { findFormationLocalDraft, formationContentKey, formationDraftKey, formationMatchesBoard, getActiveFormationPublication, getFormationSaveLabel, updateFormationLocalDraft } from '../apps/mobile-core/src/coachFormationDraftCore.js'
import { createCoachOfflineDocument, getCoachOfflineResources, setCoachOfflineProfile, setCoachOfflineResources } from '../apps/mobile-core/src/coachOfflineCore.js'

const player = { playerId: 'p1', displayName: 'Alex', shirtNumber: '1', slotId: 'gk', positionGroup: 'goalkeeper', x: 0.5, y: 0.92 }
const board = { id: 'b1', title: 'Saturday', currentVersionId: 'v1', currentVersionNumber: 1, gameFormat: '11v11', formationPresetKey: '11v11-4-4-2', currentVersion: { placements: [player], bench: [], formationPresetKey: '11v11-4-4-2', gameFormat: '11v11' } }
const draft = createMobileFormationDraft({ board })

test('saved state distinguishes device draft, server save and older Parent publication', () => {
  assert.equal(getFormationSaveLabel({ board: null, dirty: false }), 'Not saved')
  assert.equal(getFormationSaveLabel({ board, dirty: true, localState: 'saving' }), 'Unsaved changes')
  assert.equal(getFormationSaveLabel({ board, dirty: true, localState: 'saved', publication: { board_version_id: 'v1' } }), 'Saved on this device')
  assert.equal(getFormationSaveLabel({ board, dirty: true, localState: 'failed' }), 'Not saved on this device')
  assert.equal(getFormationSaveLabel({ board, dirty: false }), 'Saved to team')
  assert.equal(getFormationSaveLabel({ board, dirty: false, publication: { board_version_id: 'v0' } }), 'Parent update needed')
  assert.equal(getFormationSaveLabel({ board, dirty: false, publication: { board_version_id: 'v1' } }), 'Published to Parents')
})

test('a same-title board is not a confirmed save unless lineup content matches', () => {
  assert.equal(formationMatchesBoard(draft, board.title, board), true)
  assert.equal(formationMatchesBoard({ ...draft, placements: [] }, board.title, board), false)
  assert.equal(formationMatchesBoard(draft, 'Different plan', board), false)
  assert.equal(formationMatchesBoard({ ...draft, placements: [{ ...player, x: 0.7 }] }, board.title, board), false)
  assert.equal(formationContentKey({ ...draft, baseVersionNumber: 8 }, board.title), formationContentKey(draft, board.title))
})

test('unplaced Players stay visible on the Bench until intentionally moved, then become normal Bench Players', () => {
  const unplacedBoard = {
    ...board,
    currentVersion: {
      ...board.currentVersion,
      bench: [{ playerId: 'p2', displayName: 'Bench Player', state: 'bench' }],
      unplaced: [{ playerId: 'p3', displayName: 'Unplaced Player', state: 'unplaced' }],
    },
  }
  const loaded = createMobileFormationDraft({ board: unplacedBoard, gameFormat: '11v11', presetKey: '11v11-4-4-2' })
  assert.deepEqual(loaded.bench.map((item) => item.playerId), ['p2', 'p3'])
  assert.deepEqual(loaded.unplaced.map((item) => item.playerId), ['p3'])
  assert.notEqual(formationContentKey(loaded, board.title), formationContentKey({ ...loaded, unplaced: [] }, board.title))

  const pitched = placeMobileFormationPlayer(loaded, 'p3', { id: 'slot-2', group: 'defender', x: 0.5, y: 0.7 })
  assert.deepEqual(pitched.unplaced, [])
  assert.equal(pitched.bench.some((item) => item.playerId === 'p3'), false)
  assert.equal(pitched.placements.some((item) => item.playerId === 'p3'), true)

  const benched = moveMobileFormationPlayersToBench(pitched, ['p3'])
  assert.deepEqual(benched.unplaced, [])
  assert.equal(benched.bench.find((item) => item.playerId === 'p3')?.state, undefined)

  const squad = setMobileFormationSquad(loaded, [
    { id: 'p1', playerName: 'Alex', shirtNumber: '1' },
    { id: 'p2', playerName: 'Bench Player', shirtNumber: '2' },
    { id: 'p3', playerName: 'Unplaced Player', shirtNumber: '3' },
  ])
  assert.deepEqual(squad.unplaced.map((item) => item.playerId), ['p3'])
  const removed = toggleMobileFormationSquadPlayer(squad, { id: 'p3', playerName: 'Unplaced Player' })
  assert.deepEqual(removed.unplaced, [])

  const explicitBench = toggleMobileFormationSquadPlayer({ ...loaded, unplaced: [] }, { id: 'p4', playerName: 'New Player' })
  assert.equal(explicitBench.bench.find((item) => item.playerId === 'p3')?.state, undefined)
})

test('drafts are isolated by board and fixture and deleting one retains others', () => {
  let cache = { pendingSave: { title: 'Legacy pending plan' } }
  cache = updateFormationLocalDraft(cache, formationDraftKey('b1'), { board, draft, title: 'Saturday', matchDayId: 'm1', savedAt: '2026-09-17T08:00:00Z' })
  cache = updateFormationLocalDraft(cache, formationDraftKey('', 'm2'), { draft, title: 'Sunday', matchDayId: 'm2', savedAt: '2026-09-17T09:00:00Z' })
  assert.equal(findFormationLocalDraft(cache, 'm1')[1].title, 'Saturday')
  assert.equal(findFormationLocalDraft(cache, 'm2')[1].title, 'Sunday')
  assert.equal(findFormationLocalDraft(cache, ''), null)
  cache = updateFormationLocalDraft(cache, formationDraftKey('b1'), null)
  assert.equal(findFormationLocalDraft(cache, 'm1'), null)
  assert.equal(findFormationLocalDraft(cache, 'm2')[1].title, 'Sunday')
  assert.equal(cache.pendingSave.title, 'Legacy pending plan')
})

test('encrypted cache document retains journal in its authorised context only', () => {
  const context = { id: 'team:c1:t1:coach', clubId: 'c1', teamId: 't1', role: 'coach' }
  let document = setCoachOfflineProfile(createCoachOfflineDocument({ userScope: 'u1' }), { id: 'u1', coachContexts: [context] })
  const formation = updateFormationLocalDraft({}, 'board:b1', { board, draft, title: board.title, matchDayId: 'm1' })
  document = setCoachOfflineResources(document, context, { formation })
  assert.deepEqual(getCoachOfflineResources(document, context).resources.formation.localDrafts['board:b1'].draft, draft)
  assert.equal(getCoachOfflineResources(document, { ...context, teamId: 't2' }), null)
})

test('screen recovery keeps explicit team save, guarded replacement, and automatic device drafts', async () => {
  const screen = await readFile(new URL('../apps/coach-mobile/src/CoachFormationBoard.js', import.meta.url), 'utf8')
  assert.doesNotMatch(screen, /workflowStep ===/)
  assert.match(screen, /label=\{busy \? 'Saving\.\.\.' : 'Save Formation Board'\}/)
  assert.match(screen, /activeSheet === 'share'/)
  assert.match(screen, /confirmDraftReplacement\(startNewBoard\)/)
  assert.match(screen, /confirmDraftReplacement\(\(\) => applyBoard\(item\)\)/)
  assert.match(screen, /saveCoachFormationLocalDraft\(user.id, context, currentDraftKey, entry\)/)
  assert.match(screen, /createdByProfileId: normalize\(previousPendingSave\?\.createdByProfileId\) \|\| normalize\(board\?\.createdByProfileId\) \|\| user.id/)
  assert.match(screen, /candidate\.createdByProfileId === createdByProfileId/)
  assert.doesNotMatch(screen, /activePublication \? 'Shared' : board \? 'Saved'/)
})

test('withdrawing the latest Parent publication does not revive an older published badge', () => {
  const older = { publication_number: 1, match_day_id: 'm1', board_version_id: 'v1' }
  const withdrawn = { publication_number: 2, match_day_id: 'm1', withdrawn_at: '2026-09-17T08:00:00Z' }
  assert.equal(getActiveFormationPublication([older, withdrawn], 'm1'), null)
  assert.equal(getActiveFormationPublication([older], 'different-match'), null)
  assert.equal(getActiveFormationPublication([older], 'm1'), older)
})
