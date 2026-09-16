import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COACH_PHASE_31F_MAX_CACHE_BYTES,
  getCoachCacheByteLength,
  getCoachCacheFingerprint,
} from '../apps/mobile-core/src/coachPhase31FCore.js'
import {
  createCoachOfflineDocument,
  setCoachOfflineProfile,
  setCoachOfflineResources,
} from '../apps/mobile-core/src/coachOfflineCore.js'

const userScope = 'coach-cache-recovery'
const context = (id) => ({ authorityId: `authority-${id}`, authoritySource: 'team_staff', clubId: `club-${id}`, id, role: 'coach', teamId: `team-${id}` })
const profile = (contexts) => ({ coachContexts: contexts, id: userScope })
const cachedEntry = (item, savedAt) => ({
  authorityId: item.authorityId,
  authoritySource: item.authoritySource,
  clubId: item.clubId,
  contextId: item.id,
  resourceMetadata: { calendar: { checkedAt: savedAt, savedAt, fingerprint: `calendar:${item.id}` } },
  resources: { calendar: { payload: 'x'.repeat(760_000) } },
  role: item.role,
  savedAt,
  teamId: item.teamId,
})

test('resource saves evict the oldest reconstructible cache first and retain newly fetched resources', () => {
  const oldest = context('oldest')
  const newer = context('newer')
  const target = context('target')
  const document = {
    ...createCoachOfflineDocument({ userScope }),
    contexts: {
      [oldest.id]: cachedEntry(oldest, '2026-09-01T10:00:00Z'),
      [newer.id]: cachedEntry(newer, '2026-09-02T10:00:00Z'),
    },
    profile: { retrievedAt: '2026-09-03T10:00:00Z', value: profile([oldest, newer, target]) },
  }
  const saved = setCoachOfflineResources(document, target, { sessions: [{ id: 'new-session', notes: 'Latest session data' }] }, '2026-09-03T11:00:00Z')
  assert.equal(saved.contexts[oldest.id].resources.calendar, undefined)
  assert.ok(saved.contexts[newer.id].resources.calendar)
  assert.equal(saved.contexts[target.id].resources.sessions[0].id, 'new-session')
  assert.ok(getCoachCacheByteLength(saved) <= COACH_PHASE_31F_MAX_CACHE_BYTES)
})

test('a full bounded Sessions batch fits after stale cache recovery without dropping fetched records', () => {
  const stale = context('sessions-stale')
  const target = context('sessions-target')
  const document = {
    ...createCoachOfflineDocument({ userScope }),
    contexts: { [stale.id]: cachedEntry(stale, '2026-09-01T10:00:00Z') },
    profile: { retrievedAt: '2026-09-03T10:00:00Z', value: profile([stale, target]) },
  }
  document.contexts[stale.id].resources.calendar.payload = 'x'.repeat(1_200_000)
  const sessions = Array.from({ length: 180 }, (_, index) => ({ id: `session-${index}`, notes: 'Session plan and coaching note. '.repeat(45), title: `Session ${index}` }))
  const sessionPlayers = Array.from({ length: 300 }, (_, index) => ({ id: `player-${index}`, notes: 'Player session observation. '.repeat(35), playerName: `Player ${index}` }))
  const trainingEvents = Array.from({ length: 180 }, (_, index) => ({ id: `event-${index}`, notes: 'Training event note. '.repeat(35), title: `Training ${index}` }))
  const trainingLocations = Array.from({ length: 80 }, (_, index) => `Training venue ${index}`)
  const saved = setCoachOfflineResources(document, target, { sessionPlayers, sessions, trainingEvents, trainingLocations }, '2026-09-03T11:00:00Z')
  assert.equal(saved.contexts[target.id].resources.sessions.length, sessions.length)
  assert.equal(saved.contexts[target.id].resources.sessionPlayers.length, sessionPlayers.length)
  assert.equal(saved.contexts[target.id].resources.trainingEvents.length, trainingEvents.length)
  assert.equal(saved.contexts[target.id].resources.trainingLocations.length, trainingLocations.length)
  assert.equal(saved.contexts[stale.id].resources.calendar, undefined)
  assert.ok(getCoachCacheByteLength(saved) <= COACH_PHASE_31F_MAX_CACHE_BYTES)
})

test('an unchanged requested resource retries cache recovery after other offline state grows', () => {
  const stale = context('unchanged-stale')
  const target = context('unchanged-target')
  const sessions = [{ id: 'same-session', notes: 'Unchanged payload' }]
  const document = {
    ...createCoachOfflineDocument({ userScope }),
    contexts: {
      [stale.id]: cachedEntry(stale, '2026-09-01T10:00:00Z'),
      [target.id]: {
        ...cachedEntry(target, '2026-09-03T10:00:00Z'),
        resourceMetadata: { sessions: { checkedAt: '2026-09-03T10:00:00Z', savedAt: '2026-09-03T10:00:00Z', fingerprint: getCoachCacheFingerprint(sessions) } },
        resources: { sessions },
      },
    },
    profile: { retrievedAt: '2026-09-03T10:00:00Z', value: profile([stale, target]) },
  }
  document.contexts[stale.id].resources.calendar.payload = 'x'.repeat(1_600_000)
  const saved = setCoachOfflineResources(document, target, { sessions }, '2026-09-03T10:00:01Z')
  assert.deepEqual(saved.contexts[target.id].resources.sessions, sessions)
  assert.equal(saved.contexts[stale.id].resources.calendar, undefined)
})

test('cache recovery keeps pending Formation saves, Match Day outbox work, and Development drafts', () => {
  const target = context('protected-target')
  const stale = context('stale')
  const formation = { board: { id: 'board' }, pendingSave: { id: 'formation-save', placements: [{ id: 'player' }] }, payload: 'f'.repeat(760_000) }
  const document = {
    ...createCoachOfflineDocument({ userScope }),
    contexts: {
      [target.id]: {
        ...cachedEntry(target, '2026-09-02T10:00:00Z'),
        resourceMetadata: { formation: { savedAt: '2026-09-02T10:00:00Z', fingerprint: 'formation:pending' } },
        resources: { formation },
      },
      [stale.id]: cachedEntry(stale, '2026-09-01T10:00:00Z'),
    },
    developmentDrafts: { [target.id]: { authority: 'draft-authority', items: { draft: { status: 'pending', values: { score: 8 } } } } },
    matchDayOutboxes: { [target.id]: { match: { pending: [{ id: 'goal' }] } } },
    profile: { retrievedAt: '2026-09-03T10:00:00Z', value: profile([target, stale]) },
  }
  const saved = setCoachOfflineResources(document, target, { sessions: [{ id: 'new-session' }] }, '2026-09-03T11:00:00Z')
  assert.deepEqual(saved.contexts[target.id].resources.formation, formation)
  assert.deepEqual(saved.matchDayOutboxes, document.matchDayOutboxes)
  assert.deepEqual(saved.developmentDrafts, document.developmentDrafts)
  assert.equal(saved.contexts[stale.id].resources.calendar, undefined)
})

test('cache recovery preserves a local Formation draft even before a save is pending', () => {
  const target = context('formation-draft')
  const stale = context('formation-stale')
  const formation = { draft: { bench: ['player-1'], placements: [{ playerId: 'player-2', slotId: 'slot-1' }] }, payload: 'f'.repeat(760_000) }
  const document = {
    ...createCoachOfflineDocument({ userScope }),
    contexts: {
      [target.id]: {
        ...cachedEntry(target, '2026-09-02T10:00:00Z'),
        resourceMetadata: { formation: { savedAt: '2026-09-02T10:00:00Z', fingerprint: 'formation:draft' } },
        resources: { formation },
      },
      [stale.id]: cachedEntry(stale, '2026-09-01T10:00:00Z'),
    },
    profile: { retrievedAt: '2026-09-03T10:00:00Z', value: profile([target, stale]) },
  }
  const saved = setCoachOfflineResources(document, target, { sessions: [{ id: 'new-session' }] }, '2026-09-03T11:00:00Z')
  assert.deepEqual(saved.contexts[target.id].resources.formation, formation)
  assert.equal(saved.contexts[stale.id].resources.calendar, undefined)
})

test('cache writes fail atomically when requested or protected data cannot fit', () => {
  const target = context('atomic')
  const document = {
    ...createCoachOfflineDocument({ userScope }),
    contexts: {
      [target.id]: {
        ...cachedEntry(target, '2026-09-01T10:00:00Z'),
        resourceMetadata: { formation: { savedAt: '2026-09-01T10:00:00Z', fingerprint: 'formation:pending' } },
        resources: { formation: { pendingSave: { id: 'unsynced' }, payload: 'f'.repeat(900_000) } },
      },
    },
    profile: { retrievedAt: '2026-09-02T10:00:00Z', value: profile([target]) },
  }
  const before = structuredClone(document)
  assert.throws(() => setCoachOfflineResources(document, target, { sessions: Array.from({ length: 180 }, (_, index) => ({ id: index, notes: 's'.repeat(5_000) })) }), /offline_cache_payload_too_large/)
  assert.deepEqual(document, before)
})

test('profile saves recover reconstructible resources before enforcing the cache limit', () => {
  const target = context('profile-recovery')
  const document = {
    ...createCoachOfflineDocument({ userScope }),
    contexts: { [target.id]: cachedEntry(target, '2026-09-01T10:00:00Z') },
  }
  document.contexts[target.id].resources.calendar.payload = 'x'.repeat(1_600_000)
  const saved = setCoachOfflineProfile(document, profile([target]), '2026-09-03T10:00:00Z')
  assert.equal(saved.contexts[target.id].resources.calendar, undefined)
  assert.equal(saved.profile.value.id, userScope)
  assert.ok(getCoachCacheByteLength(saved) <= COACH_PHASE_31F_MAX_CACHE_BYTES)
})
