import assert from 'node:assert/strict'
import test from 'node:test'
import { createFormationMarkerTapRecognizer } from '../apps/coach-mobile/src/formationMarkerTapCore.js'
import { moveMobileFormationPlayersToBench } from '../apps/mobile-core/src/coachFormationBoardCore.js'

function tapClock() {
  const timers = new Map()
  let nextId = 0
  return {
    schedule(callback) { const id = ++nextId; timers.set(id, callback); return id },
    cancelTimer(id) { timers.delete(id) },
    flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach((callback) => callback()) },
  }
}

test('three quick marker taps move only that starter to Subs without a normal tap action', () => {
  const clock = tapClock()
  const starter = { playerId: 'starter', displayName: 'Starter', slotId: 'left-back', x: 0.2, y: 0.6 }
  const teammate = { playerId: 'teammate', displayName: 'Teammate', slotId: 'right-back', x: 0.8, y: 0.6 }
  let draft = { gameFormat: '5v5', presetKey: '5v5-2-2', placements: [starter, teammate], bench: [], unplaced: [] }
  let normalTaps = 0
  const taps = createFormationMarkerTapRecognizer({
    ...clock,
    onSingleTap: () => { normalTaps += 1 },
    onTripleTap: () => { draft = moveMobileFormationPlayersToBench(draft, [starter.playerId]) },
  })
  taps.tap(); taps.tap(); taps.tap(); clock.flush()
  assert.equal(normalTaps, 0)
  assert.deepEqual(draft.placements.map((player) => player.playerId), ['teammate'])
  assert.deepEqual(draft.bench.map((player) => player.playerId), ['starter'])
})

test('single tap keeps its normal action and dragging cancels a pending tap', () => {
  const clock = tapClock()
  let normalTaps = 0, removals = 0
  const taps = createFormationMarkerTapRecognizer({
    ...clock,
    onSingleTap: () => { normalTaps += 1 },
    onTripleTap: () => { removals += 1 },
  })
  taps.tap(); taps.cancel(); clock.flush()
  assert.equal(normalTaps, 0)
  taps.tap(); clock.flush()
  assert.equal(normalTaps, 1)
  assert.equal(removals, 0)
})
