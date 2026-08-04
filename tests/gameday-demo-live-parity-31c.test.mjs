import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createDemoMatchDayAdapter,
  DEMO_MATCH_DAY_FIXTURE_ID,
  DEMO_MATCH_DAY_SUPPORTED_EVENT_TYPES,
  DEMO_MATCH_DAY_TEAM_ID,
} from '../src/lib/demo-matchday-adapter.js'
import {
  createMatchDayExperienceAdapter,
  MATCH_DAY_EXPERIENCE_INTENTIONAL_DIFFERENCES,
} from '../src/lib/matchday-experience-adapter.js'
import {
  MATCH_DAY_CANONICAL_EXPERIENCE_MANIFEST,
  MATCH_DAY_LIVE_EVENT_ACTIONS,
} from '../src/lib/matchday-capability-manifest.js'

function createStorage() {
  const values = new Map()
  return {
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
    removeItem(key) {
      values.delete(key)
    },
  }
}

test('the retired mock practice tree is absent and Parent Portal renders canonical MatchDayPage', async () => {
  const [parentPortalSource, matchDaySource] = await Promise.all([
    readFile(new URL('../src/pages/ParentPortalPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8'),
  ])

  await assert.rejects(access(new URL('../src/components/match-day/PracticeMatchScoring.jsx', import.meta.url)))
  await assert.rejects(access(new URL('../src/lib/matchday-practice.js', import.meta.url)))
  assert.match(parentPortalSource, /<MatchDayPage\s+[\s\S]*experienceMode="demo"/)
  assert.match(parentPortalSource, /<DemoGameDayEntryCard/)
  assert.doesNotMatch(parentPortalSource, /PracticeMatchScoring|PracticeMatchEntryCard/)
  assert.match(matchDaySource, /data-match-day-experience=\{matchDayExperience\.mode\}/)
  assert.equal((matchDaySource.match(/<MatchDayCard/g) || []).length, 1)
})

test('live and Demo resolve the same canonical component, action, state, timeline, confirmation, and accessibility manifest', () => {
  const live = { getMatchDays: async () => [] }
  const liveExperience = createMatchDayExperienceAdapter({ user: { email: 'coach@club.test' }, live })
  const demoExperience = createMatchDayExperienceAdapter({
    user: { email: 'demo@playerfeedback.online' },
    live,
    storage: createStorage(),
  })

  assert.equal(liveExperience.mode, 'live')
  assert.equal(demoExperience.mode, 'demo')
  assert.equal(liveExperience.capabilities.fixtureManagement, true)
  assert.equal(demoExperience.capabilities.fixtureManagement, false)
  assert.equal(demoExperience.capabilities.preparedFixturePractice, true)
  assert.strictEqual(liveExperience.manifest, MATCH_DAY_CANONICAL_EXPERIENCE_MANIFEST)
  assert.strictEqual(demoExperience.manifest, MATCH_DAY_CANONICAL_EXPERIENCE_MANIFEST)
  assert.deepEqual(demoExperience.manifest.actionKeys, MATCH_DAY_LIVE_EVENT_ACTIONS.map((action) => action.key))
  assert.deepEqual(demoExperience.manifest.timelineEventTypes, DEMO_MATCH_DAY_SUPPORTED_EVENT_TYPES)
  assert.ok(MATCH_DAY_LIVE_EVENT_ACTIONS.every((action) => action.demoSupport && action.desktop && action.mobile))
  assert.deepEqual(MATCH_DAY_EXPERIENCE_INTENTIONAL_DIFFERENCES.map((difference) => difference.key), [
    'data_provider',
    'mutation_boundary',
    'communication_policy',
    'fixture_management',
    'reset_control',
    'demo_label',
  ])
  assert.ok(MATCH_DAY_EXPERIENCE_INTENTIONAL_DIFFERENCES.every((difference) => difference.reason.length > 20))
})

test('Demo lifecycle and canonical actions persist only in session-isolated synthetic state', async () => {
  const storage = createStorage()
  const adapter = createDemoMatchDayAdapter({ storage })
  const [initialMatch] = await adapter.getMatchDays()
  const players = await adapter.getPlayers()

  assert.equal(initialMatch.id, DEMO_MATCH_DAY_FIXTURE_ID)
  assert.equal(initialMatch.teamId, DEMO_MATCH_DAY_TEAM_ID)
  assert.equal(initialMatch.status, 'scorer_request')
  assert.equal(adapter.allowsCommunication, false)

  let match = await adapter.startMatchDay({ match: initialMatch })
  assert.equal(match.status, 'live')
  assert.equal(match.currentMatchPhase, 'first_half')
  assert.equal(match.timerStatus, 'running')

  const goal = await adapter.addStaffMatchDayGoal({
    match,
    goal: { teamSide: 'club', minute: 4, scorerName: players[0].playerName, scorerShirtNumber: players[0].shirtNumber },
  })
  match = await adapter.getMatchDay({ matchDayId: match.id })
  assert.equal(goal.eventType, 'goal')
  assert.equal(match.homeScore, 1)

  for (const eventType of ['yellow_card', 'red_card', 'substitution']) {
    await adapter.addStaffMatchDayEvent({
      match,
      event: {
        eventType,
        teamSide: 'club',
        minute: 8,
        playerName: players[0].playerName,
        playerShirtNumber: players[0].shirtNumber,
        playerOnName: eventType === 'substitution' ? players[1].playerName : '',
        playerOnShirtNumber: eventType === 'substitution' ? players[1].shirtNumber : '',
      },
    })
    match = await adapter.getMatchDay({ matchDayId: match.id })
  }

  assert.deepEqual(match.events.map((event) => event.eventType), DEMO_MATCH_DAY_SUPPORTED_EVENT_TYPES)
  await adapter.setMatchDayTimerState({ match, action: 'hydration' })
  match = await adapter.getMatchDay({ matchDayId: match.id })
  assert.equal(match.timerStatus, 'hydration')
  assert.equal(match.events.at(-1).eventType, 'water_break')
  assert.equal(match.events.at(-1).notes, 'Hydration break')
  await adapter.setMatchDayTimerState({ match, action: 'resume' })
  await adapter.setMatchDayTimerState({ match, action: 'half_time' })
  match = await adapter.getMatchDay({ matchDayId: match.id })
  assert.equal(match.status, 'half_time')
  await adapter.setMatchDayTimerState({ match, action: 'resume' })
  match = await adapter.getMatchDay({ matchDayId: match.id })
  assert.equal(match.status, 'second_half')
  await adapter.setMatchDayTimerState({ match, action: 'full_time' })
  match = await adapter.getMatchDay({ matchDayId: match.id })
  assert.equal(match.status, 'full_time')
  await adapter.setMatchDayTimerState({ match, action: 'conclude' })
  match = await adapter.getMatchDay({ matchDayId: match.id })
  assert.ok(match.concludedAt)

  const refreshedAdapter = createDemoMatchDayAdapter({ storage })
  const refreshed = await refreshedAdapter.getMatchDay({ matchDayId: match.id })
  assert.equal(refreshed.events.length, 5)
  assert.equal(refreshed.status, 'full_time')
})

test('Demo corrections, timeline voids, reset, and double reset are deterministic', async () => {
  const storage = createStorage()
  const adapter = createDemoMatchDayAdapter({ storage })
  let match = (await adapter.getMatchDays())[0]
  match = await adapter.startMatchDay({ match })
  const goal = await adapter.addStaffMatchDayGoal({ match, goal: { teamSide: 'club', minute: 6, scorerName: 'Alex Morgan' } })

  const corrected = await adapter.correctStaffMatchDayGoal({
    match: await adapter.getMatchDay({ matchDayId: match.id }),
    event: goal,
    goal: { teamSide: 'club', minute: 7, scorerName: 'Maya Singh' },
    reason: 'Demo correction practice',
  })
  assert.equal(corrected.event.scorerName, 'Maya Singh')
  assert.equal(corrected.event.minute, 7)

  const voided = await adapter.voidStaffMatchDayEvent({
    match: await adapter.getMatchDay({ matchDayId: match.id }),
    event: corrected.event,
    reasonCode: 'incorrect_player',
    note: 'Demo undo practice',
  })
  assert.equal(voided.event.eventStatus, 'voided')
  assert.equal(voided.homeScore, 0)

  const firstReset = await adapter.reset()
  const secondReset = await adapter.reset()
  assert.deepEqual(secondReset, firstReset)
  assert.equal(secondReset[0].events.length, 0)
  assert.equal(secondReset[0].homeScore, 0)
  assert.equal(secondReset[0].timerStatus, 'not_started')
  assert.equal(secondReset[0].currentMatchPhase, 'pre_match')
})

test('Demo rejects production-shaped fixture, Team, Player, event, and volunteer identifiers', async () => {
  const adapter = createDemoMatchDayAdapter({ storage: createStorage() })
  const [match] = await adapter.getMatchDays()

  await assert.rejects(adapter.getMatchDay({ matchDayId: '6a8d2d62-2a18-4ee7-8bed-26bff4f58d84' }), /non-synthetic fixture identifier/)
  await assert.rejects(adapter.createMatchDay({ match: { teamId: 'production-team-id' } }), /prepared synthetic fixture/)
  await assert.rejects(adapter.updateMatchDay({ user: {}, match }), /fixture administration is not available/)
  await assert.rejects(adapter.setMatchDayPlayerSquadDecision({ matchDayId: match.id, playerId: 'production-player-id', decision: 'selected' }), /non-synthetic Player identifier/)
  await assert.rejects(adapter.voidStaffMatchDayEvent({ match, event: { id: 'production-event-id' }, reasonCode: 'other', note: 'Not synthetic' }), /non-synthetic event identifier/)
  await assert.rejects(adapter.selectMatchDayVolunteer({ match, volunteer: { requestId: 'production-request-id' } }), /does not allow scorer requests or volunteer administration/)
  await assert.rejects(adapter.resetPreviousMatchDayResults({ user: {} }), /fixture administration/)
  await assert.rejects(adapter.deletePreviousMatchDay({ user: {}, match }), /fixture deletion/)
})

test('separate Demo sessions do not share mutations', async () => {
  const storage = createStorage()
  const first = createDemoMatchDayAdapter({ scopeKey: 'parent-one', storage })
  const second = createDemoMatchDayAdapter({ scopeKey: 'parent-two', storage })
  const firstMatch = await first.startMatchDay({ match: (await first.getMatchDays())[0] })
  await first.addStaffMatchDayGoal({ match: firstMatch, goal: { teamSide: 'club', minute: 1, scorerName: 'Alex Morgan' } })

  const secondMatch = (await second.getMatchDays())[0]
  assert.equal(secondMatch.status, 'scorer_request')
  assert.equal(secondMatch.events.length, 0)
  assert.equal(secondMatch.homeScore, 0)
})
