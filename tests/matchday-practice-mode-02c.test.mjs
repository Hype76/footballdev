import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  addPracticeGoal,
  advancePracticeMatch,
  createPracticeSession,
  getPracticeStorageKey,
  loadPracticeSession,
  pausePracticeTimer,
  resetPracticeSession,
  resumePracticeTimer,
  savePracticeSession,
  startPracticeMatch,
} from '../src/lib/matchday-practice.js'

function createStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  }
}

test('practice storage is isolated by exact authenticated parent identity', () => {
  const storage = createStorage()
  const firstParentSession = addPracticeGoal(
    startPracticeMatch(createPracticeSession({ now: 1_000 }), { now: 2_000 }),
    { now: 3_000, playerId: 'practice-player-alex', side: 'team' },
  )
  const secondParentSession = createPracticeSession({ now: 4_000 })

  savePracticeSession(storage, 'parent-one', firstParentSession)
  savePracticeSession(storage, 'parent-two', secondParentSession)

  assert.notEqual(getPracticeStorageKey('parent-one'), getPracticeStorageKey('parent-two'))
  assert.equal(loadPracticeSession(storage, 'parent-one', { now: 5_000 }).match.homeScore, 1)
  assert.equal(loadPracticeSession(storage, 'parent-two', { now: 5_000 }).match.homeScore, 0)
  assert.equal(storage.values.size, 2)
})

test('practice sessions use only synthetic identities and an isolated template', () => {
  const session = createPracticeSession({ now: 1_000 })

  assert.equal(session.match.id, 'practice-match-template-v1')
  assert.equal(session.match.teamId, 'practice-team-home')
  assert.equal(session.players.length, 3)
  assert.ok(session.players.every((player) => player.id.startsWith('practice-player-')))
  assert.ok(session.players.every((player) => !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(player.id)))
})

test('practice scoring is blocked before shared start and start is idempotent', () => {
  const session = createPracticeSession({ now: 1_000 })

  assert.throws(
    () => addPracticeGoal(session, { playerId: 'practice-player-alex', side: 'team', now: 2_000 }),
    /Start or resume the practice match/i,
  )

  const started = startPracticeMatch(session, { now: 2_000 })
  const retried = startPracticeMatch(started, { now: 3_000 })
  assert.equal(retried, started)
  assert.equal(started.events.filter((event) => event.label === 'Practice match started').length, 1)
})

test('practice goals, timer and lifecycle remain inside the private session', () => {
  let session = startPracticeMatch(createPracticeSession({ now: 1_000 }), { now: 2_000 })
  session = addPracticeGoal(session, { playerId: 'practice-player-jordan', side: 'team', now: 62_000 })
  session = addPracticeGoal(session, { side: 'opponent', now: 63_000 })
  session = pausePracticeTimer(session, { now: 64_000 })
  session = resumePracticeTimer(session, { now: 65_000 })
  session = advancePracticeMatch(session, { now: 66_000 })
  session = advancePracticeMatch(session, { now: 67_000 })
  session = advancePracticeMatch(session, { now: 68_000 })
  session = advancePracticeMatch(session, { now: 69_000 })

  assert.deepEqual([session.match.homeScore, session.match.awayScore], [1, 1])
  assert.equal(session.match.currentMatchPhase, 'completed')
  assert.equal(session.match.status, 'practice_complete')
  assert.ok(session.events.some((event) => event.type === 'timer_paused'))
  assert.ok(session.events.some((event) => event.type === 'timer_resumed'))
  assert.ok(session.events.every((event) => event.id.startsWith('practice-event-')))
})

test('practice reset is deterministic and expired sessions are replaced', () => {
  const storage = createStorage()
  const original = startPracticeMatch(createPracticeSession({ now: 1_000 }), { now: 2_000 })
  const reset = resetPracticeSession(original, { now: 3_000 })

  assert.notEqual(reset.sessionId, original.sessionId)
  assert.equal(reset.match.currentMatchPhase, 'pre_match')
  assert.equal(reset.match.homeScore, 0)
  assert.deepEqual(reset.events, [])

  storage.setItem(getPracticeStorageKey('expired-parent'), JSON.stringify({ ...original, expiresAt: new Date(2_500).toISOString() }))
  const recovered = loadPracticeSession(storage, 'expired-parent', { now: 3_000 })
  assert.notEqual(recovered.sessionId, original.sessionId)
  assert.equal(recovered.match.currentMatchPhase, 'pre_match')
})

test('tampered storage cannot inject real team or player identities into practice', () => {
  const storage = createStorage()
  const original = createPracticeSession({ now: 1_000 })
  storage.setItem(getPracticeStorageKey('tampered-parent'), JSON.stringify({
    ...original,
    match: { ...original.match, teamName: 'Real Team Name' },
    players: [{ id: 'real-player-id', playerName: 'Real Player', shirtNumber: '1' }],
  }))

  const recovered = loadPracticeSession(storage, 'tampered-parent', { now: 2_000 })
  assert.notEqual(recovered.sessionId, original.sessionId)
  assert.equal(recovered.match.teamName, 'Practice Rovers')
  assert.ok(recovered.players.every((player) => player.id.startsWith('practice-player-')))
})

test('practice UI reuses the shared start safeguard and imports no production mutation service', async () => {
  const component = await readFile(new URL('../src/components/match-day/PracticeMatchScoring.jsx', import.meta.url), 'utf8')
  const practiceDomain = await readFile(new URL('../src/lib/matchday-practice.js', import.meta.url), 'utf8')
  const parentPortal = await readFile(new URL('../src/pages/ParentPortalPage.jsx', import.meta.url), 'utf8')
  const parentPortalShell = await readFile(new URL('../src/components/parent-portal/ParentPortalShell.jsx', import.meta.url), 'utf8')

  assert.match(component, /import \{ StartMatchConfirmModal \}/)
  assert.match(component, /data-practice-boundary="browser-only"/)
  assert.doesNotMatch(component, /from ['"][^'"]*supabase/i)
  assert.doesNotMatch(component, /\bfetch\s*\(/)
  assert.doesNotMatch(practiceDomain, /\bfetch\s*\(|\.rpc\s*\(|match_day_events|scheduled_email_queue/i)
  assert.match(parentPortal, /<ParentPortalRouteShell[\s\S]*<ParentMatchDayHero[\s\S]*<PracticeMatchEntryCard/)
  assert.match(parentPortalShell, /<ParentPortalSectionNav/)
  assert.match(parentPortal, /searchParams\.get\('practice'\) === 'match-scoring'/)
})
