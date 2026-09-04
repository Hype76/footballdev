import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildParentDevelopmentHistory,
  getParentDevelopmentReport,
  ParentDevelopmentHistoryError,
  validateParentDevelopmentScope,
} from '../netlify/functions/lib/_parent-development-history.js'
import {
  createDevelopmentOutputKey,
  createDevelopmentOutputQueueId,
} from '../netlify/functions/lib/_development-parent-email-output.js'

const parentLinkId = '11111111-1111-4111-8111-111111111111'
const otherParentLinkId = '22222222-2222-4222-8222-222222222222'
const authUserId = '33333333-3333-4333-8333-333333333333'
const playerId = '44444444-4444-4444-8444-444444444444'
const otherPlayerId = '55555555-5555-4555-8555-555555555555'
const clubId = '66666666-6666-4666-8666-666666666666'
const teamId = '77777777-7777-4777-8777-777777777777'
const evaluationId = '88888888-8888-4888-8888-888888888888'

function buildParentLink(overrides = {}) {
  return {
    id: parentLinkId,
    auth_user_id: authUserId,
    club_id: clubId,
    team_id: teamId,
    player_id: playerId,
    status: 'active',
    ...overrides,
  }
}

function buildPlayer(overrides = {}) {
  return {
    id: playerId,
    club_id: clubId,
    team_id: teamId,
    status: 'active',
    archived_at: null,
    ...overrides,
  }
}

function buildSnapshot(overrides = {}) {
  return {
    version: 1,
    finalizedAt: '2026-07-30T10:00:00.000Z',
    evaluationId,
    club: { id: clubId, name: 'FP TEST' },
    team: { id: teamId, name: 'U17 Green' },
    player: { id: playerId, name: 'Test Player' },
    author: { id: authUserId, name: 'Test Coach' },
    section: 'Development',
    recordDate: '2026-07-29',
    form: {
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Player Development Review',
      version: 3,
      templateKey: 'development-review',
    },
    recipients: [{ linkId: parentLinkId, name: 'Test Parent', email: 'hidden@example.com' }],
    responseItems: [
      {
        fieldId: 'technical',
        label: 'Technical',
        type: 'score_1_10',
        displayValue: 'Strong',
        numericScore: 8,
        ratingLabel: 'Strong',
        order: 1,
        parentVisible: true,
        selected: true,
      },
      {
        fieldId: 'private',
        label: 'Private staff note',
        type: 'textarea',
        displayValue: 'Never expose this',
        order: 2,
        parentVisible: false,
        selected: true,
      },
    ],
    overallScore: 8,
    attendanceIncluded: true,
    progressionIncluded: true,
    emailSections: [
      {
        key: 'attendanceSummary',
        title: 'Attendance',
        body: 'Attended 9 of 10 sessions.',
      },
      {
        key: 'progressionChart',
        title: 'Progression',
        body: 'Steady improvement.',
        chartPoints: [
          { label: 'June', value: 7 },
          { label: 'July', value: 8 },
        ],
      },
    ],
    ...overrides,
  }
}

function buildReportRow(snapshot = buildSnapshot()) {
  return {
    evaluation_id: snapshot.evaluationId,
    club_id: clubId,
    report_snapshot: snapshot,
    finalized_at: snapshot.finalizedAt,
  }
}

function buildCommunication({
  action = 'parent_email_sent',
  hasAttachment = true,
  linkId = parentLinkId,
  snapshotEvaluationId = evaluationId,
} = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    evaluation_id: snapshotEvaluationId,
    channel: 'email',
    action,
    created_at: '2026-07-30T11:00:00.000Z',
    metadata: {
      developmentOutputKey: createDevelopmentOutputKey(snapshotEvaluationId, linkId),
      recipientLinkId: linkId,
      hasAttachment,
      privateProviderError: 'must not be returned',
    },
  }
}

test('parent Development scope requires the authenticated active link and matching child', () => {
  assert.equal(validateParentDevelopmentScope({
    authUserId,
    parentLink: buildParentLink(),
    player: buildPlayer(),
  }), true)

  assert.throws(() => validateParentDevelopmentScope({
    authUserId: otherParentLinkId,
    parentLink: buildParentLink(),
    player: buildPlayer(),
  }), ParentDevelopmentHistoryError)
  assert.throws(() => validateParentDevelopmentScope({
    authUserId,
    parentLink: buildParentLink({ status: 'revoked' }),
    player: buildPlayer(),
  }), ParentDevelopmentHistoryError)
  assert.throws(() => validateParentDevelopmentScope({
    authUserId,
    parentLink: buildParentLink(),
    player: buildPlayer({ id: otherPlayerId }),
  }), ParentDevelopmentHistoryError)
})

test('parent Development history exposes only immutable shared snapshot fields', () => {
  const history = buildParentDevelopmentHistory({
    parentLink: buildParentLink(),
    reportRows: [buildReportRow()],
    communicationLogs: [buildCommunication()],
    queues: [],
  })

  assert.equal(history.length, 1)
  assert.equal(history[0].deliveryLabel, 'Sent')
  assert.equal(history[0].pdfLabel, 'PDF attached')
  assert.equal(history[0].canDownloadPdf, true)
  assert.deepEqual(history[0].responseItems.map((item) => item.label), ['Technical'])
  assert.equal(history[0].sections[0].body, 'Attended 9 of 10 sessions.')
  assert.equal(JSON.stringify(history).includes('hidden@example.com'), false)
  assert.equal(JSON.stringify(history).includes('Never expose this'), false)
  assert.equal(JSON.stringify(history).includes('privateProviderError'), false)
})

test('parent Development history exposes an explicitly recipient-scoped in-app snapshot without requiring email', () => {
  const history = buildParentDevelopmentHistory({
    parentLink: buildParentLink(),
    reportRows: [buildReportRow()],
    communicationLogs: [],
    queues: [],
  })

  assert.equal(history.length, 1)
  assert.equal(history[0].deliveryLabel, 'Shared in app')
  assert.equal(history[0].pdfLabel, 'PDF available')
  assert.equal(history[0].canDownloadPdf, true)
})

test('parent Development history isolates reports by exact child and recipient link', () => {
  const crossChildSnapshot = buildSnapshot({
    evaluationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    player: { id: otherPlayerId, name: 'Other Child' },
  })
  const crossRecipientSnapshot = buildSnapshot({
    evaluationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    recipients: [{ linkId: otherParentLinkId, name: 'Other Parent' }],
  })
  const history = buildParentDevelopmentHistory({
    parentLink: buildParentLink(),
    reportRows: [
      buildReportRow(),
      buildReportRow(crossChildSnapshot),
      buildReportRow(crossRecipientSnapshot),
    ],
    communicationLogs: [
      buildCommunication(),
      buildCommunication({
        snapshotEvaluationId: crossChildSnapshot.evaluationId,
      }),
      buildCommunication({
        linkId: otherParentLinkId,
        snapshotEvaluationId: crossRecipientSnapshot.evaluationId,
      }),
    ],
    queues: [],
  })

  assert.deepEqual(history.map((report) => report.id), [evaluationId])
  assert.throws(
    () => getParentDevelopmentReport(history, crossChildSnapshot.evaluationId),
    ParentDevelopmentHistoryError,
  )
})

test('parent Development history reports scheduled, failed, and unavailable delivery truthfully', () => {
  const scheduledLog = buildCommunication({
    action: 'parent_email_scheduled',
    hasAttachment: false,
  })
  const outputKey = createDevelopmentOutputKey(evaluationId, parentLinkId)
  const queueId = createDevelopmentOutputQueueId(outputKey)
  const scheduled = buildParentDevelopmentHistory({
    parentLink: buildParentLink(),
    reportRows: [buildReportRow()],
    communicationLogs: [scheduledLog],
    queues: [{ id: queueId, status: 'scheduled' }],
  })
  const failed = buildParentDevelopmentHistory({
    parentLink: buildParentLink(),
    reportRows: [buildReportRow()],
    communicationLogs: [scheduledLog],
    queues: [{ id: queueId, status: 'failed', last_error: 'provider detail' }],
  })
  const unavailable = buildParentDevelopmentHistory({
    parentLink: buildParentLink(),
    reportRows: [buildReportRow()],
    communicationLogs: [scheduledLog],
    queues: [],
  })

  assert.equal(scheduled[0].deliveryLabel, 'Scheduled')
  assert.equal(scheduled[0].pdfLabel, 'PDF available')
  assert.equal(scheduled[0].canDownloadPdf, true)
  assert.equal(failed[0].deliveryLabel, 'Delivery failed')
  assert.equal(JSON.stringify(failed).includes('provider detail'), false)
  assert.equal(unavailable[0].deliveryLabel, 'Delivery status unavailable')
})

test('parent Development source provides navigation, child clearing, direct report URLs, and protected PDF access', () => {
  const pageSource = readFileSync(
    new URL('../src/pages/ParentPortalPage.jsx', import.meta.url),
    'utf8',
  )
  const shellSource = readFileSync(
    new URL('../src/components/parent-portal/ParentPortalShell.jsx', import.meta.url),
    'utf8',
  )
  const endpointSource = readFileSync(
    new URL('../netlify/functions/parent-development-history.js', import.meta.url),
    'utf8',
  )

  assert.match(shellSource, /id: 'development'.*label: 'Development'/)
  assert.match(pageSource, /nextSearchParams\.delete\('reportId'\)/)
  assert.match(pageSource, /setDevelopmentReports\(\[\]\)/)
  assert.match(pageSource, /requestedDevelopmentReportId/)
  assert.match(pageSource, /getParentPortalDevelopmentHistory/)
  assert.match(endpointSource, /supabaseAdmin\.auth\.getUser\(accessToken\)/)
  assert.match(endpointSource, /MAX_REQUEST_BYTES/)
  assert.match(endpointSource, /Content-Type must be application\/json/)
  assert.match(endpointSource, /parent_player_links/)
  assert.match(endpointSource, /development_parent_reports/)
  assert.match(endpointSource, /communication_logs/)
  assert.match(endpointSource, /buildDevelopmentParentReportContent\(resolvedReportSnapshot\)/)
  assert.match(endpointSource, /repairReportSnapshot/)
  assert.match(endpointSource, /\.eq\('id', report\.id\)/)
  assert.match(endpointSource, /\.eq\('club_id', parentLink\.club_id\)/)
  assert.match(endpointSource, /\.eq\('player_id', parentLink\.player_id\)/)
  assert.match(endpointSource, /requestedResponses: undefined/)
  assert.match(endpointSource, /Content-Security-Policy': "sandbox; default-src 'none'"/)
  assert.doesNotMatch(endpointSource, /privateProviderError/)
})
