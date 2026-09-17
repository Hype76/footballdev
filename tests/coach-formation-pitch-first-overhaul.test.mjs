import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  applyMobileFormationPreset,
  createMobileFormationDraft,
  setMobileFormationSquad,
} from '../apps/mobile-core/src/coachFormationBoardCore.js'
import { canEditCoachFormationBoard, getCoachFormationMarkerVisualPosition } from '../apps/coach-mobile/src/coachFormationEntryCore.js'

const players = Array.from({ length: 13 }, (_, index) => ({
  id: `player-${index + 1}`,
  playerName: `Player ${index + 1}`,
  shirtNumber: String(index + 1),
}))
const preset442 = {
  gameFormat: '11v11',
  key: '11v11-4-4-2',
  slots: Array.from({ length: 11 }, (_, index) => ({ id: `slot-${index + 1}`, group: index === 0 ? 'goalkeeper' : 'outfield', x: 0.1 + ((index % 4) * 0.25), y: 0.08 + (index * 0.08) })),
}
const preset433 = {
  ...preset442,
  key: '11v11-4-3-3',
  slots: preset442.slots.map((slot, index) => ({ ...slot, id: `next-${index + 1}`, x: 0.15 + ((index % 3) * 0.35) })),
}

test('Formation panel roles are accepted by the installed Android native view manager', async () => {
  const source = await readFile(new URL('../apps/coach-mobile/src/CoachFormationBoard.js', import.meta.url), 'utf8')
  const native = await readFile(new URL('../apps/coach-mobile/node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/ReactAccessibilityDelegate.java', import.meta.url), 'utf8')
  for (const [prop, enumName] of [['accessibilityRole', 'AccessibilityRole'], ['role', 'Role']]) {
    const constants = native.split(`public enum ${enumName} {`)[1]?.split(';')[0]
    assert.ok(constants, `Android ${enumName} contract is available`)
    const supported = new Set(constants.split(',').map(value => value.trim().toLowerCase()))
    for (const [, value] of source.matchAll(new RegExp(`\\b${prop}="([^"]+)"`, 'g'))) {
      assert.ok(supported.has(value), `Android rejects ${prop}="${value}" when the panel mounts`)
    }
  }
})

test('Coach Formation Board is pitch-first with shirt assets and bottom editing sheets', async () => {
  const source = await readFile(new URL('../apps/coach-mobile/src/CoachFormationBoard.js', import.meta.url), 'utf8')
  await Promise.all([
    access(new URL('../apps/mobile-core/assets/formation-shirt-white.png', import.meta.url)),
    access(new URL('../apps/mobile-core/assets/formation-shirt-gold.png', import.meta.url)),
  ])
  assert.ok(source.indexOf('accessibilityLabel="Formation pitch"') < source.indexOf('accessibilityLabel="Formation Board tools"'))
  for (const label of ['Formation', 'Players', 'Share']) assert.match(source, new RegExp(`label: '${label}'`))
  assert.match(source, /const filteredSlotPlayers = players\.filter/)
  assert.doesNotMatch(source, /selectedIds\.has\(player\.id\) && player\.playerName/)
  assert.match(source, /placeMobileFormationLineup\(draft, currentPreset\)/)
  assert.match(source, /styles\.pitchArcWindowTop/)
  assert.match(source, /styles\.pitchPenaltySpotBottom/)
  assert.match(source, /styles\.pitchCornerRight/)
  assert.doesNotMatch(source, /styles\.pitchOutline/)
  assert.match(source, /Saved on this device|saveLabel/)
  assert.match(source, /Coach or manager plan access is required to edit, save or share/)
  assert.match(source, /share && styles\.dockItemShare/)
  assert.match(source, /accessibilityState=\{\{ disabled: !canEdit, selected \}\}/)
  assert.match(source, /selected\. Tap a starter to swap\./)
  assert.match(source, /benchPlayerButtonSelected/)
  assert.doesNotMatch(source, /Step [1-4] of 4/)
})

test('Coach Formation Board write authority matches the data layer and keeps assistants read-only', () => {
  const base = { activeTeamId: 'team-1', clubId: 'club-1', hasActivePlanAccess: true, id: 'staff-1' }
  assert.equal(canEditCoachFormationBoard({ ...base, roleRank: 20 }), false)
  assert.equal(canEditCoachFormationBoard({ ...base, roleRank: 30 }), true)
  assert.equal(canEditCoachFormationBoard({ ...base, hasActivePlanAccess: false, roleRank: 70 }), false)
  assert.equal(canEditCoachFormationBoard({ ...base, activeTeamId: '', roleRank: 70 }), false)
})

test('Coach marker visuals stay fully inside narrow pitches without changing stored coordinates', () => {
  const stored = { x: 0.05, y: 0.96 }
  const visual = getCoachFormationMarkerVisualPosition(stored, { height: 429, width: 296 })
  assert.equal(stored.x, 0.05)
  assert.equal(stored.y, 0.96)
  assert.equal(visual.x, 39 / 296)
  assert.equal(visual.y, 1 - (53 / 429))
  assert.deepEqual(getCoachFormationMarkerVisualPosition({ x: 0.5, y: 0.5 }, { height: 429, width: 296 }), { x: 0.5, y: 0.5 })
})

test('changing formation keeps the selected XI and moves excess Players to Subs', () => {
  const selected = setMobileFormationSquad(createMobileFormationDraft(), players)
  const first = applyMobileFormationPreset({ ...selected, placements: selected.bench.slice(0, 11), bench: selected.bench.slice(11) }, preset442)
  const next = applyMobileFormationPreset(first, preset433)
  assert.deepEqual(new Set([...next.placements, ...next.bench].map((player) => player.playerId)), new Set(players.map((player) => player.id)))
  assert.equal(next.placements.length, 11)
  assert.equal(next.bench.length, 2)
})
