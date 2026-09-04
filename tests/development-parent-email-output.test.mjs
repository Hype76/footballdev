import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  getDevelopmentParentReport,
  getParentVisibleDevelopmentResponses,
  getParentVisibleDevelopmentEmailSections,
  resolveDevelopmentParentReport,
  resolveDevelopmentRecipientFromRows,
} from '../netlify/functions/lib/_development-parent-email-output.js'
import {
  createResponseItems,
  isExportableResponseValue,
} from '../src/hooks/evaluations/evaluationFormUtils.js'

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
    parent_contacts: [
      {
        name: 'FP TEST Parent',
        email: 'fp.test.parent@example.test',
      },
    ],
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
    email: 'fp.test.parent@example.test',
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
    selectedParentLinkIds: [link().id],
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
    selectedParentLinkIds: [link().id],
  })

  assert.equal(result.outcome, 'no_recipient')
  assert.equal(result.code, 'DEVELOPMENT_PARENT_EMAIL_SELECTED_LINK_UNAVAILABLE')
})

test('linked parent with no email produces a truthful no-recipient result', () => {
  const result = resolveDevelopmentRecipientFromRows({
    evaluation: evaluation(),
    player: player(),
    links: [link({ email: '' })],
    selectedParentLinkIds: [link().id],
  })

  assert.equal(result.outcome, 'no_recipient')
})

test('invalid linked parent email is handled without selecting a recipient', () => {
  const result = resolveDevelopmentRecipientFromRows({
    evaluation: evaluation(),
    player: player(),
    links: [link({ email: 'not-an-email' })],
    selectedParentLinkIds: [link().id],
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
    selectedParentLinkIds: [link().id],
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

test('legacy default Development records reconstruct the selected parent report fields', () => {
  const formResponses = {
    Technical: 6,
    Tactical: 7,
    Physical: 8,
    Mentality: 9,
    Coachability: 10,
    Strengths: 'Reliable first touch.',
    Improvements: 'Scan earlier.',
    'Overall Comments': 'Positive progress.',
    'Staff note': 'Private.',
  }
  const requestedResponses = Object.entries(formResponses).map(([label, value], index) => ({
    fieldId: `default-field-${index + 1}`,
    label,
    value: `Browser value ${value}`,
  }))
  const report = resolveDevelopmentParentReport({
    club: { id: clubId, name: 'FP TEST Club' },
    team: { id: teamId, name: 'FP TEST Team' },
    player: player(),
    requestedResponses,
    evaluation: evaluation({
      feedback_form_snapshot: {},
      form_responses: formResponses,
    }),
  })

  assert.equal(report.responseItems.length, 8)
  assert.deepEqual(
    report.responseItems.map((item) => item.label),
    [
      'Technical',
      'Tactical',
      'Physical',
      'Mentality',
      'Coachability',
      'Strengths',
      'Improvements',
      'Overall Comments',
    ],
  )
  assert.equal(report.responseItems[0].rawValue, 6)
  assert.equal(report.responseItems[0].displayValue, '6 / 10 - Slightly Above Expected')
  assert.doesNotMatch(JSON.stringify(report), /Staff note|Private|Browser value/)
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

test('canonical report preserves selected Development data and excludes private staff notes', () => {
  const ratingFields = Array.from({ length: 9 }, (_, index) => ({
    id: `rating-${index + 1}`,
    label: `Rating ${index + 1}`,
    type: 'score_1_10',
    includeInProgressChart: true,
    metricKey: `fp-test.rating-${index + 1}`,
    categoryKey: 'fp-test',
    parentVisible: true,
    orderIndex: index + 1,
    value: index + 1,
  }))
  const narrativeFields = [
    {
      id: 'short-text',
      label: 'Short parent note',
      type: 'text',
      parentVisible: true,
      orderIndex: 10,
      value: 'Keep scanning before receiving.',
    },
    {
      id: 'long-text',
      label: 'Long parent narrative',
      type: 'textarea',
      parentVisible: true,
      orderIndex: 11,
      value: 'The player is building confidence and should keep practising on both feet.',
    },
    {
      id: 'summary',
      label: 'Parent summary',
      type: 'textarea',
      parentVisible: true,
      orderIndex: 12,
      value: 'A positive review with clear next steps.',
    },
    {
      id: 'private-notes',
      label: 'Private staff notes',
      type: 'textarea',
      parentVisible: false,
      orderIndex: 13,
      value: 'Do not disclose this note.',
    },
  ]
  const fields = [...ratingFields, ...narrativeFields]
  const formResponses = Object.fromEntries(fields.map((field) => [field.label, field.value]))
  const requestedResponses = fields.map((field) => ({
    fieldId: field.id,
    label: field.label,
    value: 'Browser-controlled value',
  }))
  const report = resolveDevelopmentParentReport({
    club: { id: clubId, name: 'FP TEST Club' },
    team: { id: teamId, name: 'FP TEST Team' },
    player: { id: playerId, player_name: 'FP TEST Player' },
    recipients: [{ linkId: link().id, name: 'FP TEST Parent' }],
    requestedResponses,
    requestedSections: [
      { key: 'attendanceSummary' },
      { key: 'progressionChart' },
    ],
    evaluation: evaluation({
      average_score: 5,
      coach_id: '99999999-9999-4999-8999-999999999999',
      coach: 'FP TEST Coach',
      created_by_name: 'FP TEST Coach',
      created_by_email: 'fp.test.coach@example.test',
      created_at: '2026-07-29T12:00:00.000Z',
      date: '29/07/2026',
      feedback_form_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      feedback_form_name: 'FP TEST Full Development Form',
      feedback_form_version: 3,
      feedback_form_snapshot: {
        formId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        formName: 'FP TEST Full Development Form',
        formVersion: 3,
        templateKey: 'fp-test-full-development',
        fields,
      },
      form_responses: formResponses,
    }),
    evaluations: [
      evaluation({
        average_score: 4,
        created_at: '2026-07-01T12:00:00.000Z',
        date: '01/07/2026',
        feedback_form_snapshot: { fields },
        form_responses: formResponses,
      }),
      evaluation({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        average_score: 5,
        created_at: '2026-07-29T12:00:00.000Z',
        date: '29/07/2026',
        feedback_form_snapshot: { fields },
        form_responses: formResponses,
      }),
    ],
  })

  assert.equal(report.version, 1)
  assert.equal(report.responseItems.length, 12)
  assert.deepEqual(report.responseItems.slice(0, 9).map((item) => item.fieldId), ratingFields.map((field) => field.id))
  assert.equal(report.responseItems[0].rawValue, 1)
  assert.equal(report.responseItems[0].displayValue, '1 / 10 - Well Below Standard')
  assert.equal(report.responseItems[8].ratingLabel, 'Excellent')
  assert.equal(report.responseItems[9].rawValue, 'Keep scanning before receiving.')
  assert.equal(report.overallScore, 5)
  assert.equal(report.form.version, 3)
  assert.equal(report.author.name, 'FP TEST Coach')
  assert.equal(report.recipients[0].linkId, link().id)
  assert.equal(report.historyCutoffAt, '2026-07-29T12:00:00.000Z')
  assert.deepEqual(report.emailSections.map((section) => section.key), [
    'attendanceSummary',
    'progressionChart',
  ])
  assert.doesNotMatch(JSON.stringify(report), /Do not disclose|Browser-controlled/)
})

test('zero and false responses remain exportable and reconstruct from saved values', () => {
  const fields = [
    {
      id: 'number-zero',
      label: 'Number zero',
      type: 'number',
      parentVisible: true,
      orderIndex: 1,
    },
    {
      id: 'boolean-false',
      label: 'Boolean false',
      type: 'boolean',
      parentVisible: true,
      orderIndex: 2,
    },
  ]
  const responseItems = createResponseItems(fields, {
    'number-zero': 0,
    'boolean-false': false,
  })
  const report = resolveDevelopmentParentReport({
    club: { id: clubId, name: 'FP TEST Club' },
    team: { id: teamId, name: 'FP TEST Team' },
    player: player(),
    requestedResponses: responseItems,
    evaluation: evaluation({
      form_responses: {
        'Number zero': 0,
        'Boolean false': false,
      },
      feedback_form_snapshot: { fields },
    }),
  })

  assert.equal(isExportableResponseValue(0), true)
  assert.equal(isExportableResponseValue(false), true)
  assert.equal(responseItems.length, 2)
  assert.equal(report.responseItems[0].rawValue, 0)
  assert.equal(report.responseItems[0].displayValue, '0')
  assert.equal(report.responseItems[1].rawValue, false)
  assert.equal(report.responseItems[1].displayValue, 'false')
})

test('saved canonical report wins over later browser requests and historical rows reconstruct safely', () => {
  const savedReport = resolveDevelopmentParentReport({
    club: { id: clubId, name: 'FP TEST Club' },
    team: { id: teamId, name: 'FP TEST Team' },
    player: player(),
    recipients: [{ linkId: link().id, name: 'FP TEST Parent' }],
    requestedResponses: [{ fieldId: 'technical', label: 'Technical' }],
    evaluation: evaluation({
      feedback_form_snapshot: {
        fields: [
          {
            id: 'technical',
            label: 'Technical',
            type: 'score_1_10',
            isDefault: true,
            orderIndex: 1,
            value: 7,
          },
          {
            id: 'private',
            label: 'Staff note',
            type: 'textarea',
            parentVisible: false,
            orderIndex: 2,
            value: 'Internal only.',
          },
        ],
      },
    }),
  })
  const saved = getDevelopmentParentReport({
    context: {
      club: { id: clubId, name: 'FP TEST Club' },
      team: { id: teamId, name: 'FP TEST Team' },
      player: player(),
      evaluation: evaluation({
        development_parent_report: savedReport,
      }),
      evaluations: [],
      recipient: { linkId: link().id, name: 'FP TEST Parent' },
    },
    requestedResponses: [{ label: 'Staff note', value: 'Attempted leak.' }],
  })
  const reconstructed = getDevelopmentParentReport({
    context: {
      club: { id: clubId, name: 'FP TEST Club' },
      team: { id: teamId, name: 'FP TEST Team' },
      player: player(),
      evaluation: evaluation({
        development_parent_report: {},
      }),
      evaluations: [evaluation()],
      recipient: { linkId: link().id, name: 'FP TEST Parent' },
    },
    requestedResponses: [{ label: 'Technical', value: 10 }],
  })

  assert.deepEqual(saved, savedReport)
  assert.equal(saved.responseItems[0].rawValue, 7)
  assert.equal(reconstructed.responseItems[0].rawValue, 7)
  assert.doesNotMatch(JSON.stringify(saved), /Attempted leak|Internal only/)
})

test('finalization runs after record persistence and before any parent output', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')
  const functionSource = await source('../netlify/functions/send-parent-email.js')
  const migrationSource = await source('../supabase/migrations/20260729160000_development_parent_report_snapshot.sql')
  const saveIndex = pageSource.indexOf('const savedEvaluation = canReusePersistedEvaluation')
  const finalizeIndex = pageSource.indexOf('await finalizeDevelopmentParentReport')
  const emailIndex = pageSource.indexOf('const emailResults = await Promise.all')

  assert.ok(saveIndex >= 0)
  assert.ok(finalizeIndex > saveIndex)
  assert.ok(emailIndex > finalizeIndex)
  assert.match(functionSource, /action.*finalize_development_parent_report/)
  assert.match(functionSource, /finalizeDevelopmentParentReportSnapshot/)
  assert.match(functionSource, /const developmentReport = developmentContext/)
  assert.match(functionSource, /enrichDevelopmentParentReportWithScores/)
  assert.match(functionSource, /content: developmentPdfContent/)
  assert.match(migrationSource, /create table if not exists public\.development_parent_reports/)
  assert.match(migrationSource, /revoke all on table public\.development_parent_reports from anon, authenticated/)
  assert.match(migrationSource, /grant select, insert, update, delete on table public\.development_parent_reports to service_role/)
})

test('provider failure preserves the evaluation and maps to an optional-output result', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')
  const createIndex = pageSource.indexOf('const savedEvaluation = canReusePersistedEvaluation')
  const sendIndex = pageSource.indexOf('const emailResults = await Promise.all')
  const optionalCatchIndex = pageSource.indexOf("completionOutcome = emailSendMode === 'scheduled' ? 'schedule_failed' : 'send_failed'")

  assert.ok(createIndex >= 0)
  assert.ok(sendIndex > createIndex)
  assert.ok(optionalCatchIndex > sendIndex)
  assert.match(pageSource, /was saved, but the requested parent email did not complete\. Retry is available without creating another record\./)
})

test('queue failure preserves the evaluation and keeps scheduling optional', async () => {
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')
  const functionSource = await source('../netlify/functions/send-parent-email.js')

  assert.ok(
    pageSource.indexOf('const savedEvaluation = canReusePersistedEvaluation') <
    pageSource.indexOf('const emailResults = await Promise.all'),
  )
  assert.match(pageSource, /completionOutcome = emailSendMode === 'scheduled' \? 'schedule_failed' : 'send_failed'/)
  assert.match(functionSource, /Email could not be added to the queue\./)
})

test('retry sends the optional output only', async () => {
  const retrySource = await source('../netlify/functions/retry-failed-emails.js')

  assert.match(retrySource, /getFailedEmailLogs/)
  assert.match(retrySource, /reauthorizePreparedDevelopmentParentEmail/)
  assert.match(retrySource, /sendEmail\(resendPayload/)
  assert.doesNotMatch(retrySource, /\.from\('evaluations'\)|createEvaluation|updateEvaluation/)
})

test('retry does not duplicate the evaluation', async () => {
  const retrySource = await source('../netlify/functions/retry-failed-emails.js')
  const pageSource = await source('../src/pages/CreateEvaluationPage.jsx')

  assert.doesNotMatch(retrySource, /evaluations/)
  assert.match(pageSource, /const savedEvaluation = canReusePersistedEvaluation[\s\S]*const emailResults = await Promise\.all/)
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
  assert.match(pageSource, /buildDevelopmentCompletionItems\(\{/)
})
