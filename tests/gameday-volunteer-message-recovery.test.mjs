import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  DEFAULT_MATCH_DAY_VOLUNTEER_REQUEST_TEMPLATES,
  EMAIL_TEMPLATE_AUDIENCES,
  MATCH_DAY_VOLUNTEER_TEMPLATE_SECTION,
  resolveMatchDayVolunteerRequestMessages,
} from '../src/lib/email-templates.js'
import { applyScorerRequestMessageUpdate } from '../src/lib/domain/match-day.js'
import {
  buildMatchDayActionableInvitationEmail,
  getRequestedMatchDayRoles,
} from '../netlify/functions/lib/_match-day-actionable-invitation.js'

const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const matchDayDomainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const sendRequestsFunctionUrl = new URL('../netlify/functions/send-match-day-availability-requests.js', import.meta.url)

test('Calendar Match Day editing omits scorerRequestMessage when the screen has no replacement control', async () => {
  const source = await readFile(sessionsPageUrl, 'utf8')
  const branchStart = source.indexOf("} else if (sourceType === 'match-day') {")
  const updateStart = source.indexOf('const savedMatch = await updateMatchDay', branchStart)
  const branch = source.slice(branchStart, updateStart)

  assert.notEqual(branchStart, -1)
  assert.notEqual(updateStart, -1)
  assert.match(branch, /requestScorer: calendarForm\.requestScorer/)
  assert.match(branch, /requestLinesman: calendarForm\.requestLinesman/)
  assert.match(branch, /requestReferee: calendarForm\.requestReferee/)
  assert.doesNotMatch(branch, /scorerRequestMessage/)
})

test('omitted scorer message preserves a historical nonblank value byte for byte', () => {
  const historicalMessage = 'Historical scorer wording: keep punctuation,  spaces and CASE.'
  const payload = { notes: 'Calendar note changed' }
  const existingRow = {
    notes: 'Old note',
    scorer_request_message: historicalMessage,
  }

  applyScorerRequestMessageUpdate(payload, {
    notes: 'Calendar note changed',
    requestScorer: true,
  })

  const storedRow = { ...existingRow, ...payload }
  assert.equal(Object.hasOwn(payload, 'scorer_request_message'), false)
  assert.equal(storedRow.scorer_request_message, historicalMessage)
  assert.equal(storedRow.notes, 'Calendar note changed')
})

test('omitted scorer message preserves historical blank and null values', () => {
  for (const historicalMessage of ['', null]) {
    const payload = { request_scorer: true, request_linesman: true, request_referee: true }
    applyScorerRequestMessageUpdate(payload, {
      requestScorer: true,
      requestLinesman: true,
      requestReferee: true,
    })

    const storedRow = {
      scorer_request_message: historicalMessage,
      ...payload,
    }
    assert.equal(Object.hasOwn(payload, 'scorer_request_message'), false)
    assert.equal(storedRow.scorer_request_message, historicalMessage)
    assert.equal(storedRow.request_scorer, true)
    assert.equal(storedRow.request_linesman, true)
    assert.equal(storedRow.request_referee, true)
  }
})

test('an explicit authorised scorer message replacement is applied while undefined remains omitted', () => {
  const explicitPayload = {}
  applyScorerRequestMessageUpdate(explicitPayload, {
    scorerRequestMessage: 'Replacement scorer wording',
  })
  assert.equal(explicitPayload.scorer_request_message, 'Replacement scorer wording')

  const explicitBlankPayload = {}
  applyScorerRequestMessageUpdate(explicitBlankPayload, {
    scorerRequestMessage: '',
  })
  assert.equal(explicitBlankPayload.scorer_request_message, '')

  const undefinedPayload = {}
  applyScorerRequestMessageUpdate(undefinedPayload, {
    scorerRequestMessage: undefined,
  })
  assert.equal(Object.hasOwn(undefinedPayload, 'scorer_request_message'), false)
})

test('server update semantics remain field-specific and do not rewrite unrelated empty fields', async () => {
  const source = await readFile(matchDayDomainUrl, 'utf8')
  const helperStart = source.indexOf('export function applyScorerRequestMessageUpdate')
  const helperEnd = source.indexOf('export async function updateMatchDay', helperStart)
  const helper = source.slice(helperStart, helperEnd)

  assert.match(helper, /hasOwnProperty\.call\(updates \?\? \{\}, 'scorerRequestMessage'\)/)
  assert.match(helper, /payload\.scorer_request_message = normalizeText\(updates\.scorerRequestMessage\)/)
  assert.doesNotMatch(helper, /Object\.entries|every empty|all empty/)
  assert.match(source, /if \(updates\.notes !== undefined\) payload\.notes = normalizeText\(updates\.notes\)/)
  assert.match(source, /if \(updates\.venueAddress !== undefined\) payload\.venue_address = normalizeText\(updates\.venueAddress\)/)
})

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

test('new scorer fixtures resolve approved wording through the existing template architecture', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const confirmStart = source.indexOf('const handleConfirmCreateMatch = async () => {')
  const confirmEnd = source.indexOf('const getTimerActionForStatus', confirmStart)
  const confirmHandler = source.slice(confirmStart, confirmEnd)

  assert.match(confirmHandler, /scorerRequestMessage: form\.requestScorer \? volunteerRequestMessages\.scorer : ''/)
  assert.equal(MATCH_DAY_VOLUNTEER_TEMPLATE_SECTION, 'Match Day')
  assert.deepEqual(
    DEFAULT_MATCH_DAY_VOLUNTEER_REQUEST_TEMPLATES.map((template) => template.body),
    [
      'Can anyone help as live scorer for this match?',
      'Can anyone help as linesman for this match?',
      'Can anyone help as referee for this match?',
    ],
  )
})

test('saved team templates override defaults while disabled or wrong-section templates fall back safely', () => {
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
      sectionAvailability: [MATCH_DAY_VOLUNTEER_TEMPLATE_SECTION],
    },
    {
      audience: EMAIL_TEMPLATE_AUDIENCES.parent,
      body: 'Wrong section linesman wording',
      isEnabled: true,
      key: 'match-day-volunteer-linesman',
      sectionAvailability: ['Direct Email'],
    },
  ])

  assert.equal(messages.scorer, 'Could somebody run the score from the touchline?')
  assert.equal(messages.linesman, 'Can anyone help as linesman for this match?')
  assert.equal(messages.referee, 'Can anyone help as referee for this match?')
})

test('single and multiple role selections resolve correct central wording', () => {
  const scorerOnly = getRequestedMatchDayRoles({ request_scorer: true })
  const linesmanOnly = getRequestedMatchDayRoles({ request_linesman: true })
  const refereeOnly = getRequestedMatchDayRoles({ request_referee: true })
  const allRoles = getRequestedMatchDayRoles({
    request_scorer: true,
    request_linesman: true,
    request_referee: true,
  })

  assert.deepEqual(scorerOnly.map((role) => role.key), ['scorer'])
  assert.deepEqual(linesmanOnly.map((role) => role.key), ['linesman'])
  assert.deepEqual(refereeOnly.map((role) => role.key), ['referee'])
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

test('actionable invitation output uses saved role wording and preserves every role link', () => {
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

test('checkbox selection performs no communication and deliberate send remains gated', async () => {
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

test('template lookup remains team scoped and communication creation stays in the deliberate function', async () => {
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
