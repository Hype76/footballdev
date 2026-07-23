import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  DEFAULT_MATCH_DAY_VOLUNTEER_REQUEST_TEMPLATES,
  EMAIL_TEMPLATE_AUDIENCES,
  MATCH_DAY_VOLUNTEER_TEMPLATE_SECTION,
  resolveMatchDayVolunteerRequestMessages,
} from '../src/lib/email-templates.js'
import {
  buildMatchDayActionableInvitationEmail,
  getRequestedMatchDayRoles,
} from '../netlify/functions/lib/_match-day-actionable-invitation.js'

const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const matchDayDomainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const sendRequestsFunctionUrl = new URL('../netlify/functions/send-match-day-availability-requests.js', import.meta.url)

test('Create Fixture removes the scorer-only input and keeps the complete volunteer flow contiguous', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const modalStart = source.indexOf('function FixtureSetupModal')
  const modalEnd = source.indexOf('function FixtureSquadSelectionModal', modalStart)
  const modal = source.slice(modalStart, modalEnd)

  assert.notEqual(modalStart, -1)
  assert.notEqual(modalEnd, -1)
  assert.doesNotMatch(modal, /Scorer request message/)
  assert.doesNotMatch(modal, /form\.scorerRequestMessage/)
  assert.match(modal, />Venue</)
  assert.match(modal, />Address</)
  assert.match(modal, />Parent volunteer requests</)
  assert.match(modal, /Request scorer/)
  assert.match(modal, /Request linesman/)
  assert.match(modal, /Request referee/)
  assert.match(modal, />Match notes</)
  assert.match(modal, /Continue to squad/)
  assert.ok(modal.indexOf('>Address<') < modal.indexOf('>Parent volunteer requests<'))
  assert.ok(modal.indexOf('>Parent volunteer requests<') < modal.indexOf('>Match notes<'))
})

test('all three role defaults live in the existing Message Templates architecture', () => {
  assert.equal(MATCH_DAY_VOLUNTEER_TEMPLATE_SECTION, 'Match Day')
  assert.deepEqual(
    DEFAULT_MATCH_DAY_VOLUNTEER_REQUEST_TEMPLATES.map((template) => template.body),
    [
      'Can anyone help as live scorer for this match?',
      'Can anyone help as linesman for this match?',
      'Can anyone help as referee for this match?',
    ],
  )
  assert.ok(DEFAULT_MATCH_DAY_VOLUNTEER_REQUEST_TEMPLATES.every((template) =>
    template.sectionAvailability.includes(MATCH_DAY_VOLUNTEER_TEMPLATE_SECTION)))
})

test('saved team template overrides are respected and disabled overrides fall back safely', () => {
  const messages = resolveMatchDayVolunteerRequestMessages([
    {
      audience: EMAIL_TEMPLATE_AUDIENCES.parent,
      body: 'Could somebody run the score from the touchline?',
      isEnabled: true,
      key: 'scorer-request',
      label: 'Scorer request',
      sectionAvailability: [MATCH_DAY_VOLUNTEER_TEMPLATE_SECTION],
    },
    {
      audience: EMAIL_TEMPLATE_AUDIENCES.parent,
      body: 'Disabled referee wording',
      isEnabled: false,
      key: 'match-day-volunteer-referee',
      label: 'Match Day referee request',
      sectionAvailability: [MATCH_DAY_VOLUNTEER_TEMPLATE_SECTION],
    },
    {
      audience: EMAIL_TEMPLATE_AUDIENCES.parent,
      body: 'Wrong section linesman wording',
      isEnabled: true,
      key: 'match-day-volunteer-linesman',
      label: 'Match Day linesman request',
      sectionAvailability: ['Direct Email'],
    },
  ])

  assert.equal(messages.scorer, 'Could somebody run the score from the touchline?')
  assert.equal(messages.linesman, 'Can anyone help as linesman for this match?')
  assert.equal(messages.referee, 'Can anyone help as referee for this match?')
})

test('single and multiple role selections resolve the correct central wording without sending', () => {
  const scorerOnly = getRequestedMatchDayRoles({ request_scorer: true })
  const allRoles = getRequestedMatchDayRoles({
    request_scorer: true,
    request_linesman: true,
    request_referee: true,
  })

  assert.deepEqual(scorerOnly.map((role) => role.key), ['scorer'])
  assert.deepEqual(allRoles.map((role) => role.key), ['scorer', 'linesman', 'referee'])
  assert.deepEqual(
    allRoles.map((role) => role.message),
    [
      'Can anyone help as live scorer for this match?',
      'Can anyone help as linesman for this match?',
      'Can anyone help as referee for this match?',
    ],
  )
})

test('actionable invitation output uses saved role wording and preserves role links', () => {
  const email = buildMatchDayActionableInvitationEmail({
    appOrigin: 'https://footballplayer.online',
    match: {
      clubs: { name: 'FP TEST' },
      match_date: '2026-07-30',
      opponent: 'Test United',
      request_scorer: true,
      request_linesman: true,
      request_referee: true,
      teams: { name: 'FP TEST Team' },
    },
    player: { player_name: 'Test Player' },
    recipient: { email: 'parent@example.test', type: 'parent' },
    responseUrl: 'https://footballplayer.online/.netlify/functions/match-day-availability-confirm?token=test',
    volunteerTemplates: [{
      audience: 'parent',
      body: 'Custom scorer wording',
      is_enabled: true,
      template_key: 'match-day-volunteer-scorer',
    }],
  })

  assert.match(email.text, /Custom scorer wording/)
  assert.match(email.text, /Can anyone help as linesman for this match\?/)
  assert.match(email.text, /Can anyone help as referee for this match\?/)
  assert.match(email.text, /#volunteer-scorer/)
  assert.match(email.text, /#volunteer-linesman/)
  assert.match(email.text, /#volunteer-referee/)
})

test('checkbox selection does not perform communication and deliberate send remains gated', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const modalStart = source.indexOf('function FixtureSetupModal')
  const modalEnd = source.indexOf('function FixtureSquadSelectionModal', modalStart)
  const modal = source.slice(modalStart, modalEnd)
  const confirmStart = source.indexOf('const handleConfirmCreateMatch = async () => {')
  const confirmEnd = source.indexOf('const getTimerActionForStatus', confirmStart)
  const confirmHandler = source.slice(confirmStart, confirmEnd)

  assert.doesNotMatch(modal, /fetch\(|sendMatchDay|scheduled_email_queue|sendParentEmail/)
  assert.match(modal, /onChange=\{\(event\) => updateForm\(\{ requestScorer: event\.target\.checked \}\)\}/)
  assert.match(modal, /onChange=\{\(event\) => updateForm\(\{ requestLinesman: event\.target\.checked \}\)\}/)
  assert.match(modal, /onChange=\{\(event\) => updateForm\(\{ requestReferee: event\.target\.checked \}\)\}/)
  assert.match(confirmHandler, /shouldSendMatchdayAvailabilityRequests/)
  assert.match(confirmHandler, /if \(canSendAvailabilityRequests\)/)
  assert.match(confirmHandler, /send-match-day-availability-requests/)
})

test('legacy scorer message data remains readable and writable only through compatibility paths', async () => {
  const domainSource = await readFile(matchDayDomainUrl, 'utf8')

  assert.match(domainSource, /scorerRequestMessage: normalizeText\(row\.scorer_request_message/)
  assert.match(domainSource, /requestScorer: normalizeBoolean\(row\.request_scorer/)
  assert.match(domainSource, /scorer_request_message: normalizeText\(match\?\.scorerRequestMessage\)/)
  assert.match(domainSource, /if \(updates\.scorerRequestMessage !== undefined\) payload\.scorer_request_message/)
})

test('template lookup stays team scoped and communication creation stays in the deliberate server function', async () => {
  const source = await readFile(sendRequestsFunctionUrl, 'utf8')
  const templateLoaderStart = source.indexOf('async function getVolunteerRequestTemplates')
  const templateLoaderEnd = source.indexOf('function getAppOrigin', templateLoaderStart)
  const templateLoader = source.slice(templateLoaderStart, templateLoaderEnd)

  assert.match(templateLoader, /\.from\('parent_email_templates'\)/)
  assert.match(templateLoader, /\.eq\('club_id', match\.club_id\)/)
  assert.match(templateLoader, /\.eq\('team_id', match\.team_id\)/)
  assert.match(templateLoader, /\.eq\('audience', 'parent'\)/)
  assert.match(source, /buildMatchDayActionableInvitationEmail\(\{[\s\S]*volunteerTemplates/)
  assert.match(source, /\.from\('scheduled_email_queue'\)/)
})
