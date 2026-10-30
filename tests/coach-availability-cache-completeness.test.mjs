import test from 'node:test'
import assert from 'node:assert/strict'
import { boundCoachOfflineResource, COACH_PHASE_31F_MAX_CACHE_BYTES, getCoachCacheByteLength } from '../apps/mobile-core/src/coachPhase31FCore.js'
import { createCoachOfflineDocument, getCoachOfflineResources, setCoachOfflineResources } from '../apps/mobile-core/src/coachOfflineCore.js'
import { collapseCoachInvitesByPlayer, summarizeCoachInvites } from '../apps/mobile-core/src/coachPhase31ECore.js'
import { hasCompleteCoachAvailabilitySnapshot, restoreCoachAvailabilitySnapshot } from '../apps/mobile-core/src/coachAvailabilityCache.js'

const context = { id: 'team:fixture', teamId: 'team', clubId: 'club', role: 'coach', authorityId: 'authority', authoritySource: 'team_staff' }
const counts = value => summarizeCoachInvites(collapseCoachInvitesByPlayer(value.match.filter(row => row.eventId === 'target')))
function videoPattern() {
  const target = Array.from({ length: 20 }, (_, i) => ({ id: `target-${i}`, eventId: 'target', playerId: `player-${i}`, kind: 'match',
    status: i < 10 ? i < 6 ? 'available' : i < 8 ? 'unavailable' : 'awaiting'
      : i < 16 ? 'available' : i === 16 ? 'unavailable' : i < 19 ? 'awaiting' : 'maybe' }))
  const filler = Array.from({ length: 348 }, (_, i) => ({ id: `other-${i}`, eventId: `other-${i % 19}`, playerId: `other-player-${i}`, status: 'available' }))
  return { matches: [{ id: 'target' }], match: [...filler.slice(0, 170), ...target.slice(0, 10), ...filler.slice(170), ...target.slice(10), ...target.slice(0, 12)], training: [], calendar: [], players: [], trainingCoaches: [] }
}

test('actual saved-resource round trip preserves the video counts beyond 180 raw requests', () => {
  const live = videoPattern()
  assert.equal(live.match.length, 380)
  assert.deepEqual([counts(live).available, counts(live).awaiting], [12, 4])
  const old = { ...live, match: live.match.slice(0, 180) }
  assert.deepEqual([counts(old).available, counts(old).awaiting], [6, 2])
  let document = createCoachOfflineDocument({ userScope: 'coach' })
  for (let cycle = 0; cycle < 3; cycle++) {
    document = setCoachOfflineResources(document, context, { 'phase31e:invites': live })
    document = JSON.parse(JSON.stringify(document))
    const saved = getCoachOfflineResources(document, context).resources['phase31e:invites']
    assert.equal(saved.availabilityCacheVersion, 1)
    assert.equal(saved.match.length, 368, 'Only duplicate event/player requests are removed')
    assert.deepEqual([counts(saved).available, counts(saved).awaiting], [12, 4])
    assert.ok(getCoachCacheByteLength(document) <= COACH_PHASE_31F_MAX_CACHE_BYTES)
  }
})

test('old unversioned cached totals are unknown until a complete live read, not zero or partial', () => {
  const saved = restoreCoachAvailabilitySnapshot({ match: videoPattern().match.slice(0, 180) })
  assert.equal(hasCompleteCoachAvailabilitySnapshot(saved), false)
  assert.equal(hasCompleteCoachAvailabilitySnapshot(saved, 'training'), false)
  assert.equal(hasCompleteCoachAvailabilitySnapshot({ ...saved, matchAvailabilityVerified: true }), true)
  assert.equal(hasCompleteCoachAvailabilitySnapshot({ ...saved, matchAvailabilityVerified: true }, 'training'), false)
  assert.equal(hasCompleteCoachAvailabilitySnapshot(restoreCoachAvailabilitySnapshot(boundCoachOfflineResource('phase31e:invites', videoPattern()))), true)
})

test('Training preserves separate occurrences and filters inactive duplicates before choosing a player request', () => {
  const active = { id: 'active', eventId: 'series', playerId: 'player', occurrenceDate: '2099-11-02', status: 'awaiting', deliveryStatus: 'queued' }
  const saved = boundCoachOfflineResource('phase31e:invites', { match: [], training: [active,
    { ...active, id: 'cancelled', cancelled: true, status: 'available', deliveryStatus: 'delivered' },
    { ...active, id: 'stale', stale: true, status: 'available' },
    { ...active, id: 'next-week', occurrenceDate: '2099-11-09', status: 'available' }] })
  assert.deepEqual(saved.training.map(row => [row.occurrenceDate, row.status]), [['2099-11-02', 'awaiting'], ['2099-11-09', 'available']])
})

test('complete main and focused rosters retain the existing nested metadata bounds', () => {
  const row = { id: 'request', eventId: 'fixture', playerId: 'player', status: 'available', history: Array(500).fill('event'), extra: { choices: Array(500).fill('choice') } }
  const main = boundCoachOfflineResource('phase31e:invites', { match: [row], training: [{ ...row, occurrenceDate: '2099-11-02' }], trainingCoaches: [row] })
  const focused = boundCoachOfflineResource('phase31e:invites:fixture', { fixtureId: 'fixture', rows: [row] })
  for (const actual of [main.match[0], main.training[0], main.trainingCoaches[0], focused.rows[0]]) {
    assert.equal(actual.history.length, 100)
    assert.equal(actual.extra.choices.length, 180)
  }
  assert.equal(focused.availabilityCacheVersion, 1)
})

test('oversized complete snapshots fail atomically without replacing the previous saved copy', () => {
  let document = setCoachOfflineResources(createCoachOfflineDocument({ userScope: 'coach' }), context, { 'phase31e:invites': videoPattern() })
  const before = JSON.stringify(document)
  const oversized = { ...videoPattern(), match: [{ id: 'large', eventId: 'target', playerId: 'player', note: 'x'.repeat(COACH_PHASE_31F_MAX_CACHE_BYTES) }] }
  assert.throws(() => setCoachOfflineResources(document, context, { 'phase31e:invites': oversized }), /offline_cache_payload_too_large/)
  assert.equal(JSON.stringify(document), before)
  assert.equal(getCoachOfflineResources(document, { ...context, authorityId: 'replaced-authority' }), null)
})
