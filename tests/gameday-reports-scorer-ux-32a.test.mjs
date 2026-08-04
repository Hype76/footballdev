import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createDemoMatchDayAdapter,
  DEMO_MATCH_DAY_FIXTURE_ID,
} from '../src/lib/demo-matchday-adapter.js'
import { createMatchDayExperienceAdapter } from '../src/lib/matchday-experience-adapter.js'
import { MATCH_DAY_LIVE_EVENT_ACTIONS } from '../src/lib/matchday-capability-manifest.js'

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

test('32A scorer confirmation template carries the expected branding and deep link', async () => {
  process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key'
  const { buildRoleNotificationEmail } = await import('../netlify/functions/select-match-day-volunteer.js')
  const email = buildRoleNotificationEmail({
    appOrigin: 'https://footballplayer.online',
    logoSource: 'club',
    logoUrl: 'https://cdn.example.test/club-logo.png',
    match: {
      id: 'fixture-32a',
      match_date: '2026-08-09',
      kickoff_time: '10:30',
      arrival_time: '09:45',
      opponent: 'Riverside Juniors',
      venue_name: 'Main Pitch',
      venue_address: '1 Football Road',
      teams: { name: 'FP TEST U16', theme_accent: '#124f2f' },
      clubs: { name: 'FP TEST', logo_url: 'https://cdn.example.test/club-logo.png' },
    },
    parentLinkId: 'parent-link-32a',
    profile: { display_name: 'Test Coach' },
    recipientEmail: 'scorer@example.test',
    recipientName: 'Test Scorer',
    role: 'scorer',
    action: 'selected',
  })

  const expectedUrl = 'https://parent.footballplayer.online/parent-portal?section=matches&matchDayId=fixture-32a&parentLinkId=parent-link-32a'
  assert.equal(email.subject, 'FP TEST: FP TEST U16 v Riverside Juniors scorer confirmed')
  assert.match(email.html, /FP TEST/)
  assert.match(email.html, /FP TEST U16/)
  assert.match(email.html, /Open scorer Game Mode/)
  assert.match(email.html, /https:\/\/cdn\.example\.test\/club-logo\.png/)
  assert.match(email.html, /parent-portal\?section=matches&amp;matchDayId=fixture-32a&amp;parentLinkId=parent-link-32a/)
  assert.match(email.text, new RegExp(`Open scorer Game Mode: ${expectedUrl.replace(/[?&]/g, '\\$&')}`))
  assert.deepEqual(email.to, ['scorer@example.test'])
})

test('32A exposes Hydration only as a timer action and removes the manual Water event action', async () => {
  const source = await readFile(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8')
  const gameModeSource = source.slice(
    source.indexOf('function MatchDayGameModePanel'),
    source.indexOf('function GoalCorrectionModal'),
  )

  assert.deepEqual(MATCH_DAY_LIVE_EVENT_ACTIONS.map((action) => action.key), [
    'goal',
    'yellow_card',
    'red_card',
    'substitution',
  ])
  assert.match(gameModeSource, /data-match-day-timer-action="hydration"/)
  assert.match(gameModeSource, /data-match-day-timer-action="resume"/)
  assert.match(gameModeSource, /isPaused \? \([\s\S]*Resume[\s\S]*\) : \([\s\S]*Pause[\s\S]*Hydration/)
  assert.doesNotMatch(gameModeSource, /data-match-day-action="water_break"|>Water</)
})

test('32A Demo landing uses one prepared fixture and does not render fixture administration', async () => {
  const source = await readFile(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8')
  const demoLandingStart = source.indexOf('{isDemoExperience && !isGameModeActive ? (')
  const demoLandingEnd = source.indexOf('{!isDemoExperience && !selectedMatch', demoLandingStart)
  const demoLandingSource = source.slice(demoLandingStart, demoLandingEnd)
  const gameModeSource = source.slice(
    source.indexOf('function MatchDayGameModePanel'),
    source.indexOf('function GoalCorrectionModal'),
  )

  assert.notEqual(demoLandingStart, -1)
  assert.match(demoLandingSource, /Prepared synthetic fixture/)
  assert.match(demoLandingSource, /Practise Game Day/)
  assert.match(demoLandingSource, /Reset Demo Game Day/)
  assert.match(demoLandingSource, /Exit Demo/)
  assert.doesNotMatch(demoLandingSource, />Create fixture</)
  assert.match(source, /allowsFixtureManagement && isFixtureFormOpen/)
  assert.match(source, /allowsFixtureManagement && squadSelection\.isOpen/)
  assert.match(gameModeSource, /allowFixtureManagement \? \([\s\S]*Manage fixture/)
})

test('32A Demo mutation boundary rejects fixture, volunteer, and deletion administration while reset stays deterministic', async () => {
  const adapter = createDemoMatchDayAdapter({ storage: createStorage() })
  const [match] = await adapter.getMatchDays()

  assert.equal(match.id, DEMO_MATCH_DAY_FIXTURE_ID)
  assert.equal(adapter.capabilities.fixtureManagement, false)
  await assert.rejects(adapter.createMatchDay({}), /prepared synthetic fixture/)
  await assert.rejects(adapter.updateMatchDay({ match }), /fixture administration is not available/)
  await assert.rejects(adapter.selectMatchDayVolunteer({ match }), /does not allow scorer requests or volunteer administration/)
  await assert.rejects(adapter.resetPreviousMatchDayResults({}), /fixture administration/)
  await assert.rejects(adapter.deletePreviousMatchDay({ match }), /fixture deletion/)
  assert.deepEqual(await adapter.reset(), await adapter.reset())
})

test('32A live fixture creation adapter remains available and unchanged in authority', async () => {
  const sentinel = { id: 'live-created-fixture' }
  const live = {
    async getMatchDays() {
      return []
    },
    async createMatchDay(input) {
      assert.equal(input.fixtureName, 'Live fixture')
      return sentinel
    },
  }
  const experience = createMatchDayExperienceAdapter({ user: { email: 'coach@club.test' }, live })

  assert.equal(experience.mode, 'live')
  assert.equal(experience.capabilities.fixtureManagement, true)
  assert.strictEqual(await experience.createMatchDay({ fixtureName: 'Live fixture' }), sentinel)
})
