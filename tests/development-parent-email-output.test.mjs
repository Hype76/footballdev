import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  getParentVisibleDevelopmentResponses,
  getParentVisibleDevelopmentEmailSections,
  resolveDevelopmentRecipientFromRows,
} from '../netlify/functions/lib/_development-parent-email-output.js'

const clubId = '11111111-1111-4111-8111-111111111111'
const otherClubId = '22222222-2222-4222-8222-222222222222'
const teamId = '33333333-3333-4333-8333-333333333333'
const playerId = '44444444-4444-4444-8444-444444444444'
const evaluationId = '55555555-5555-4555-8555-555555555555'
const guardianId = '66666666-6666-4666-8666-666666666666'

function evaluation(overrides = {}) {
  return {
    id: evaluationId,
    club_id: clubId,
    team_id: teamId,
    player_id: playerId,
    form_responses: {
      Technical: 7,
      'Parent focus': 'Use both feet.',
      'Staff note': 'Internal only.',
    },
    feedback_form_snapshot: {
      fields: [
        { label: 'Technical', type: 'score_1_10', isDefault: true, includeInProgressChart: true },
        { label: 'Parent focus', parentVisible: true },
        { label: 'Staff note', parentVisible: false },
      ],
    },
    ...overrides,
  }
}

function player(overrides = {}) {
  return {
    id: playerId,
    club_id: clubId,
    team_id: teamId,
    ...overrides,
  }
}

function link(overrides = {}) {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    club_id: clubId,
    team_id: teamId,
    player_id: playerId,
    guardian_id: guardianId,
    email: '',
    relationship: 'Parent',
    primary_contact: true,
    receives_communications: true,
    status: 'active',
    ...overrides,
  }
}

function guardian(overrides = {}) {
  return {
    id: guardianId,
    club_id: clubId,
    first_name: 'FP TEST',
    last_name: 'Parent',
    email: 'fp.test.parent@example.test',
    status: 'active',
    ...overrides,
  }
}

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

test('valid linked parent email succeeds through server-authoritative resolution', async () => {
  const result = resolveDevelopmentRecipientFromRows({
    evaluation: evaluation(),
    player: player(),
    links: [link()],
    guardians: [guardian()],
    requestedEmail: 'browser-controlled@example.test',
  })
  const functionSource = await source('../netlify/functions/send-parent-email.js')
  const netlifyConfig = await source('../netlify.toml')

  assert.equal(result.outcome, 'ready')
  assert.equal(result.recipient.email, 'fp.test.parent@example.test')
  assert.equal(result.recipient.name, 'FP TEST Parent')
  assert.match(functionSource, /loadDevelopmentParentEmailContext/)
  assert.match(netlifyConfig, /external_node_modules = \["@sparticuz\/chromium"\]/)
})

test('no linked parent produces a truthful no-recipient result', () => {
  const result = resolveDevelopmentRecipientFromRows({
    evaluation: evaluation(),
    player: player(),
    links: [],
    guardians: [],
  })

  assert.equal(result.outcome, 'no_recipient')
  assert.equal(result.code, 'DEVELOPMENT_PARENT_EMAIL_NO_LINKED_RECIPIENT')
})

test('linked parent with no email produces a truthful no-recipient result', () => {
  const result = resolveDevelopmentRecipientFromRows({
    evaluation: evaluation(),
    player: player(),
    links: [link({ email: '' })],
    guardians: [guardian({ email: '' })],
  })

  assert.equal(result.outcome, 'no_recipient')
})

test('invalid linked parent email is handled without selecting a recipient', () => {
  const result = resolveDevelopmentRecipientFromRows({
    evaluation: evaluation(),
    player: player(),
    links: [link()],
    guardians: [guardian({ email: 'not-an-email' })],
    requestedEmail: 'not-an-email',
  })

  assert.equal(result.outcome, 'no_recipient')
  assert.equal(result.recipient, null)
})

test('cross-club parent cannot be selected', () => {
  const result = resolveDevelopmentRecipientFromRows({
    evaluation: evaluation(),
    player: player(),
    links: [link({ club_id: otherClubId })],
    guardians: [guardian({ club_id: otherClubId })],
    requestedEmail: 'fp.test.parent@example.test',
  })

  assert.equal(result.outcome, 'no_recipient')
})

test('parent-visible fields only are taken from the saved evaluation', () => {
  const responses = getParentVisibleDevelopmentResponses(evaluation(), [
    { label: 'Technical', value: 10 },
    { label: 'Parent focus', value: 'Tampered browser value.' },
    { label: 'Staff note', value: 'Attempted leak.' },
  ])

  assert.deepEqual(responses, [
    { label: 'Technical', value: 7 },
    { label: 'Parent focus', value: 'Use both feet.' },
  ])
})

test('safe email sections are reconstructed from saved evaluation history', () => {
  const sections = getParentVisibleDevelopmentEmailSections({
    evaluation: evaluation(),
    evaluations: [
      evaluation({
        average_score: 6,
        created_at: '2026-07-01T12:00:00.000Z',
        date: '01/07/2026',
        form_responses: { Technical: 6 },
      }),
      evaluation({
        id: '88888888-8888-4888-8888-888888888888',
        average_score: 7,
        created_at: '2026-07-26T12:00:00.000Z',
        date: '26/07/2026',
      }),
    ],
    requestedSections: [
      {
        key: 'attendanceSummary',
        title: 'Browser title',
        body: 'Attempted browser-controlled content.',
      },
      {
        key: 'progressionChart',
        title: 'Browser title',
        body: 'Attempted private note.',
        chartPoints: [{ label: 'Browser point', value: 10, internalId: 'private' }],
      },
      {
        key: 'coachComments',
        title: 'Staff only',
        body: 'Attempted staff-only content.',
      },
    ],
  })

  assert.deepEqual(sections.map((section) => section.key), ['attendanceSummary', 'progressionChart'])
  assert.doesNotMatch(JSON.stringify(sections), /Attempted|Staff only|internalId|Browser point/)
  assert.deepEqual(
    sections.find((section) => section.key === 'progressionChart')?.chartPoints.map((point) => point.value),
    [6, 7],
  )
})

test('provider failure preserves the evaluation and maps to an optional-output result', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')
  const createIndex = pageSource.indexOf('const savedEvaluation = editingEvaluation')
  const sendIndex = pageSource.indexOf('const emailResults = await Promise.all')
  const optionalCatchIndex = pageSource.indexOf("completionOutcome = emailSendMode === 'scheduled' ? 'schedule_failed' : 'send_failed'")

  assert.ok(createIndex >= 0)
  assert.ok(sendIndex > createIndex)
  assert.ok(optionalCatchIndex > sendIndex)
  assert.match(pageSource, /Development Record was saved, but the parent email could not be sent\. \$\{emailErrorMessage/)
})

test('queue failure preserves the evaluation and keeps scheduling optional', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')
  const functionSource = await source('../netlify/functions/send-parent-email.js')

  assert.ok(pageSource.indexOf('const savedEvaluation = editingEvaluation') < pageSource.indexOf('scheduledAt'))
  assert.match(pageSource, /completionOutcome = emailSendMode === 'scheduled' \? 'schedule_failed' : 'send_failed'/)
  assert.match(functionSource, /Email could not be added to the queue\./)
})

test('retry sends the optional output only', async () => {
  const retrySource = await source('../netlify/functions/retry-failed-emails.js')

  assert.match(retrySource, /getFailedEmailLogs/)
  assert.match(retrySource, /sendEmail\(resendPayload/)
  assert.doesNotMatch(retrySource, /\.from\('evaluations'\)|createEvaluation|updateEvaluation/)
})

test('retry does not duplicate the evaluation', async () => {
  const retrySource = await source('../netlify/functions/retry-failed-emails.js')
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')

  assert.doesNotMatch(retrySource, /evaluations/)
  assert.match(pageSource, /const savedEvaluation = editingEvaluation[\s\S]*const emailResults = await Promise\.all/)
})

test('retry and repeated scheduling do not duplicate queue rows', async () => {
  const functionSource = await source('../netlify/functions/send-parent-email.js')

  assert.match(functionSource, /storedPayload\.outputKey/)
  assert.match(functionSource, /deterministicQueueId/)
  assert.match(functionSource, /error\?\.code === '23505'/)
  assert.match(functionSource, /duplicate: true/)
})

test('double submission creates one evaluation and one optional-output action', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')
  const functionSource = await source('../netlify/functions/send-parent-email.js')

  assert.match(pageSource, /if \(submissionPromiseRef\.current\) \{\s*return\s*\}/)
  assert.match(pageSource, /submissionPromiseRef\.current = true/)
  assert.match(functionSource, /idempotencySeed: preparedEmail\.storedPayload\.outputKey/)
  assert.match(functionSource, /const finalIdempotencyKey = preparedEmail\.storedPayload\.outputKey/)
})

test('manual Save Draft remains unchanged and does not invoke optional output', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')
  const start = pageSource.indexOf('const handleSaveDraft = async () =>')
  const end = pageSource.indexOf('const handleDiscardPrivateDraft = async () =>', start)
  const draftSource = pageSource.slice(start, end)

  assert.match(draftSource, /saveServerEvaluationDraft/)
  assert.match(draftSource, /manualDraftSavePromiseRef/)
  assert.doesNotMatch(draftSource, /sendParentEmail|createEvaluation/)
})

test('final submission without optional email remains Green', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')

  assert.match(pageSource, /let completionOutcome = 'saved'/)
  assert.match(pageSource, /if \(previewMode === 'email'\)/)
  assert.match(pageSource, /message: `\$\{playerName\} Development Record has been saved\.`/)
})
