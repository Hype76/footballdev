import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildMatchDayActionableInvitationEmail } from '../netlify/functions/lib/_match-day-actionable-invitation.js'
import { buildFootballCalendarEvents } from '../src/lib/football-calendar-events.js'
import {
  assertMatchDayShirtChoice,
  getMatchDayShirtChoiceLabel,
  normalizeMatchDayShirtChoice,
} from '../src/lib/matchday-model.js'
import { createCoachFixtureForm, validateCoachFixtureForm } from '../apps/mobile-core/src/coachFixtureCore.js'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('shirt choice has a safe legacy default and strict new fixture validation', () => {
  assert.equal(normalizeMatchDayShirtChoice(''), 'home')
  assert.equal(normalizeMatchDayShirtChoice('AWAY'), 'away')
  assert.equal(assertMatchDayShirtChoice('home'), 'home')
  assert.equal(getMatchDayShirtChoiceLabel('away'), 'Away shirts')
  assert.throws(() => assertMatchDayShirtChoice('third'), /Choose Home shirts or Away shirts/)

  const form = createCoachFixtureForm()
  assert.equal(form.shirtChoice, 'home')
  assert.equal(validateCoachFixtureForm({
    ...form,
    fixtureType: 'friendly',
    opponent: 'Rovers',
    selectedPlayerIds: [],
  }).shirtChoice, 'home')
})

test('Calendar and actionable invitations include the selected shirts', () => {
  const match = {
    id: 'match-1',
    matchDate: '2026-09-01',
    kickoffTime: '10:00',
    opponent: 'Rovers',
    shirtChoice: 'away',
    status: 'scheduled',
    teamName: 'U15 Green',
  }
  const [event] = buildFootballCalendarEvents({ matchDays: [match] })
  assert.match(event.description, /Away shirts/)

  const email = buildMatchDayActionableInvitationEmail({
    appOrigin: 'https://footballplayer.online',
    match: {
      ...match,
      match_date: match.matchDate,
      kickoff_time: '10:00:00',
      shirt_choice: 'away',
      teams: { name: match.teamName },
    },
    player: { player_name: 'Alex Player' },
    recipient: { email: 'parent@example.test', name: 'Parent' },
    responseUrl: 'https://footballplayer.online/respond?token=test',
  })
  assert.match(email.html, /Shirts/)
  assert.match(email.html, /Away shirts/)
  assert.match(email.text, /Shirts: Away shirts/)
})

test('shirt choice is persisted and rendered across Coach, Parent, Calendar, and response flows', async () => {
  const [
    migration,
    domain,
    matchPage,
    sessionsPage,
    coachForm,
    coachData,
    parentData,
    parentScreens,
    parentApp,
    responseFunction,
  ] = await Promise.all([
    read('../supabase/migrations/20260826120000_match_day_shirt_choice.sql'),
    read('../src/lib/domain/match-day.js'),
    read('../src/pages/MatchDayPage.jsx'),
    read('../src/pages/SessionsPage.jsx'),
    read('../apps/coach-mobile/src/CoachFixtureForm.js'),
    read('../apps/mobile-core/src/coachMatchDayData.js'),
    read('../apps/parent-mobile/src/parentPortalData.js'),
    read('../apps/parent-mobile/src/ParentPortalScreens.js'),
    read('../apps/parent-mobile/App.js'),
    read('../netlify/functions/match-day-availability-confirm.js'),
  ])

  assert.match(migration, /add column if not exists shirt_choice text not null default 'home'/)
  assert.match(migration, /check \(shirt_choice in \('home', 'away'\)\)/)
  assert.match(migration, /get_parent_portal_match_shirt_choices/)
  assert.match(migration, /get_match_day_availability_shirt_choice/)
  assert.match(domain, /shirt_choice: shirtChoice/)
  assert.match(domain, /payload\.shirt_choice = assertMatchDayShirtChoice/)
  assert.match(matchPage, /MATCH_DAY_SHIRT_CHOICE_OPTIONS/)
  assert.match(sessionsPage, /name="shirtChoice"/)
  assert.match(coachForm, />Shirts</)
  assert.match(coachData, /shirt_choice: fixture\.shirtChoice/)
  assert.match(parentData, /get_parent_portal_match_shirt_choices/)
  assert.match(parentScreens, /Away shirts/)
  assert.match(parentApp, /InfoRow label="Shirts"/)
  assert.match(responseFunction, /get_match_day_availability_shirt_choice/)
  assert.match(responseFunction, /Shirts/)
})
