import { migrationSourceUrl } from './helpers/migration-source.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= 'test-publishable-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { platformFeedbackReportsResult } = await import('../netlify/functions/platform-feedback-reports.js')
const { platformFeedbackReportUpdateResult } = await import('../netlify/functions/platform-feedback-report-update.js')
const { platformFeedbackAttachmentUrlResult } = await import('../netlify/functions/platform-feedback-attachment-url.js')
const { getFeedbackStats } = await import('../src/lib/platform-admin-stats.js')
const { getFeedbackStats: getRouteFeedbackStats } = await import('../src/lib/platform-feedback-utils.js')
const {
  getPlatformFeedbackAttachmentUrl,
  getPlatformFeedbackReports,
  updatePlatformFeedbackReportStatus,
} = await import('../src/lib/domain/feedback.js')

const platformAdminPageSource = readFileSync('src/pages/PlatformAdminPage.jsx', 'utf8')
const platformFeedbackPageSource = readFileSync('src/pages/PlatformFeedbackPage.jsx', 'utf8')
const platformFeedbackSectionSource = readFileSync('src/components/platform/PlatformFeedbackSection.jsx', 'utf8')
const issueReportsSectionSource = readFileSync('src/components/platform-feedback/IssueReportsSection.jsx', 'utf8')
const platformFeedbackBoardSectionSource = readFileSync('src/components/platform-feedback/PlatformFeedbackBoardSection.jsx', 'utf8')
const feedbackDomainSource = readFileSync('src/lib/domain/feedback.js', 'utf8')
const testerFeedbackFunctionSource = readFileSync('netlify/functions/submit-tester-feedback.js', 'utf8')
const reportsFunctionSource = readFileSync('netlify/functions/platform-feedback-reports.js', 'utf8')
const attachmentUrlFunctionSource = readFileSync('netlify/functions/platform-feedback-attachment-url.js', 'utf8')
const reportUpdateFunctionSource = readFileSync('netlify/functions/platform-feedback-report-update.js', 'utf8')
const migrationSource = readFileSync(migrationSourceUrl('20260625083617_tester_feedback_reports.sql', 'active'), 'utf8')
const testerFeedbackPageSource = readFileSync('src/pages/TesterFeedbackPage.jsx', 'utf8')

const reportId = '06d29475-ded1-4b7c-b893-28e3237072e9'

function createEvent(headers = {}) {
  return {
    httpMethod: 'GET',
    headers: {
      authorization: 'Bearer platform-admin-token',
      ...headers,
    },
  }
}

function createUpdateEvent(body = {}, headers = {}) {
  return {
    httpMethod: 'POST',
    headers: {
      authorization: 'Bearer platform-admin-token',
      ...headers,
    },
    body: JSON.stringify(body),
  }
}

function parseResponse(response) {
  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.body),
  }
}

function createMockSupabase({
  authUser = { id: 'admin-1', email: 'admin@example.test' },
  profile = {
    id: 'admin-1',
    email: 'admin@example.test',
    role: 'super_admin',
    role_label: 'Super Admin',
    role_rank: 100,
  },
  reports = [
    {
      id: reportId,
      created_at: '2026-06-25T08:49:38.769Z',
      submitted_by_user_id: 'user-1',
      submitted_by_email: 'coach@example.test',
      submitted_by_name: 'Fixture Coach',
      role: 'coach',
      club_id: 'club-1',
      team_id: 'team-1',
      module: 'Shell/auth/workspace',
      phase: 'production',
      route: '/platform-feedback',
      page_title: 'Platform Feedback',
      feedback_type: 'confusion',
      severity: 'medium',
      status: 'new',
      resolution_state: '',
      title: 'Fixture feedback title',
      summary: 'Fixture feedback summary',
      reproduction_steps: 'Open the page',
      expected_result: 'Report appears',
      actual_result: 'Report was hidden',
      browser_device: 'Fixture browser',
      log_reference: 'fixture-log',
      admin_notes: '',
      screenshot_storage_bucket: 'tester-feedback-attachments',
      screenshot_storage_path: `${reportId}/fixture.png`,
      screenshot_original_filename: 'fixture.png',
      screenshot_mime_type: 'image/png',
      screenshot_file_size: 1234,
      screenshot_uploaded_at: '2026-06-25T08:50:00.000Z',
      clubs: { name: 'Fixture Club' },
      teams: { name: 'U12 Fixture' },
    },
  ],
  reportError = null,
  updateError = null,
} = {}) {
  const calls = []

  class Query {
    constructor(table) {
      this.table = table
      this.action = 'select'
      this.payload = null
      this.filters = []
    }

    select(columns) {
      calls.push({ table: this.table, action: 'select', columns })

      if (this.table === 'tester_feedback_reports' && this.action === 'update') {
        const updatedReport = {
          ...reports[0],
          status: this.payload.status,
          resolution_state: this.payload.resolution_state,
        }

        return {
          maybeSingle: () => Promise.resolve({ data: updatedReport, error: updateError }),
        }
      }

      return this
    }

    insert(payload) {
      this.action = 'insert'
      this.payload = payload
      calls.push({ table: this.table, action: 'insert', payload })
      return Promise.resolve({ data: null, error: null })
    }

    update(payload) {
      this.action = 'update'
      this.payload = payload
      calls.push({ table: this.table, action: 'update', payload })
      return this
    }

    eq(column, value) {
      this.filters.push({ column, value })
      calls.push({ table: this.table, action: 'eq', column, value })
      return this
    }

    or(expression) {
      calls.push({ table: this.table, action: 'or', expression })
      return this
    }

    limit(value) {
      calls.push({ table: this.table, action: 'limit', value })

      if (this.table === 'tester_feedback_reports') {
        return Promise.resolve({ data: reports, error: reportError })
      }

      return this
    }

    order(column, options) {
      calls.push({ table: this.table, action: 'order', column, options })
      return this
    }

    maybeSingle() {
      if (this.table === 'users') {
        return Promise.resolve({ data: profile, error: null })
      }

      if (this.table === 'tester_feedback_reports') {
        return Promise.resolve({ data: reports[0] ?? null, error: reportError })
      }

      return Promise.resolve({ data: null, error: null })
    }
  }

  return {
    calls,
    supabaseAdmin: {
      auth: {
        getUser: async () => (
          authUser
            ? { data: { user: authUser }, error: null }
            : { data: { user: null }, error: new Error('Invalid token') }
        ),
      },
      from: (table) => new Query(table),
      storage: {
        from: (bucket) => ({
          createSignedUrl: async (path, expiresIn, options) => {
            calls.push({ action: 'create_signed_url', bucket, path, expiresIn, options })
            return { data: { signedUrl: 'https://signed.example.test/fixture.png' }, error: null }
          },
        }),
      },
    },
  }
}

async function withMutedConsole(callback) {
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    return await callback()
  } finally {
    console.error = originalConsoleError
  }
}

test('documents the live mismatch between Report Issue storage and legacy Platform Feedback reads', () => {
  assert.match(testerFeedbackFunctionSource, /\.from\('tester_feedback_reports'\)/)
  assert.match(feedbackDomainSource, /\.from\('platform_feedback'\)/)
  assert.match(platformAdminPageSource, /getPlatformFeedbackReports/)
  assert.match(platformFeedbackPageSource, /getPlatformFeedbackReports/)
  assert.match(platformAdminPageSource, /feedbackReports/)
  assert.match(platformFeedbackPageSource, /feedbackReports/)
  assert.match(platformFeedbackSectionSource, /IssueReportsSection/)
  assert.match(issueReportsSectionSource, /Issue reports/)
  assert.match(issueReportsSectionSource, /Report ID: \{report\.id\}/)
})

test('platform admin review function reads submitted tester feedback reports with display fields', async () => {
  const mock = createMockSupabase()
  const response = await platformFeedbackReportsResult(createEvent(), {
    supabaseAdmin: mock.supabaseAdmin,
  })
  const parsed = parseResponse(response)
  const reportQuery = mock.calls.find((call) => call.table === 'tester_feedback_reports' && call.action === 'select')

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(parsed.body.reports.length, 1)
  assert.equal(parsed.body.reports[0].id, reportId)
  assert.equal(parsed.body.reports[0].title, 'Fixture feedback title')
  assert.equal(parsed.body.reports[0].summary, 'Fixture feedback summary')
  assert.equal(parsed.body.reports[0].feedbackType, 'confusion')
  assert.equal(parsed.body.reports[0].severity, 'medium')
  assert.equal(parsed.body.reports[0].module, 'Shell/auth/workspace')
  assert.equal(parsed.body.reports[0].route, '/platform-feedback')
  assert.equal(parsed.body.reports[0].phase, 'production')
  assert.equal(parsed.body.reports[0].clubName, 'Fixture Club')
  assert.equal(parsed.body.reports[0].attachment.hasAttachment, true)
  assert.equal(parsed.body.reports[0].attachment.originalFilename, 'fixture.png')
  assert.equal(parsed.body.stats.total, 1)
  assert.equal(parsed.body.stats.open, 1)
  assert.equal(parsed.body.stats.production, 1)
  assert.match(reportQuery.columns, /title/)
  assert.match(reportQuery.columns, /summary/)
  assert.match(reportQuery.columns, /screenshot_storage_path/)
})

test('platform admin can request a short-lived signed screenshot URL', async () => {
  const mock = createMockSupabase()
  const response = await platformFeedbackAttachmentUrlResult(createUpdateEvent({
    reportId,
  }), {
    supabaseAdmin: mock.supabaseAdmin,
  })
  const parsed = parseResponse(response)
  const signedUrlCall = mock.calls.find((call) => call.action === 'create_signed_url')

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(parsed.body.signedUrl, 'https://signed.example.test/fixture.png')
  assert.equal(parsed.body.expiresIn, 60)
  assert.equal(signedUrlCall.bucket, 'tester-feedback-attachments')
  assert.equal(signedUrlCall.path, `${reportId}/fixture.png`)
})

test('normal user cannot request a signed screenshot URL', async () => {
  const mock = createMockSupabase({
    profile: {
      id: 'user-1',
      email: 'coach@example.test',
      role: 'coach',
      role_label: 'Coach',
      role_rank: 20,
    },
  })
  const response = await withMutedConsole(() => platformFeedbackAttachmentUrlResult(createUpdateEvent({
    reportId,
  }), {
    supabaseAdmin: mock.supabaseAdmin,
  }))
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 403)
  assert.equal(parsed.body.code, 'forbidden')
  assert.equal(mock.calls.some((call) => call.table === 'tester_feedback_reports'), false)
  assert.equal(mock.calls.some((call) => call.action === 'create_signed_url'), false)
})

test('platform admin review function denies normal users before report query', async () => {
  const mock = createMockSupabase({
    profile: {
      id: 'user-1',
      email: 'coach@example.test',
      role: 'coach',
      role_label: 'Coach',
      role_rank: 20,
    },
  })
  const response = await withMutedConsole(() => platformFeedbackReportsResult(createEvent(), {
    supabaseAdmin: mock.supabaseAdmin,
  }))
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 403)
  assert.equal(parsed.body.code, 'forbidden')
  assert.equal(mock.calls.some((call) => call.table === 'tester_feedback_reports'), false)
})

test('platform admin review function maps schema failures to safe admin message', async () => {
  const mock = createMockSupabase({
    reportError: Object.assign(new Error("Could not find the table 'public.tester_feedback_reports' in the schema cache"), {
      code: 'PGRST205',
      details: "Could not find the table 'public.tester_feedback_reports'",
    }),
  })
  const response = await withMutedConsole(() => platformFeedbackReportsResult(createEvent(), {
    supabaseAdmin: mock.supabaseAdmin,
  }))
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 503)
  assert.equal(parsed.body.message, 'Issue reports could not be loaded. Please contact support with reference FPO-V1-FEEDBACK-ADMIN-FIX-012.')
  assert.doesNotMatch(JSON.stringify(parsed.body), /schema cache|tester_feedback_reports/i)
})

test('Platform Feedback stats and empty states separate support reports from product ideas', () => {
  const stats = getFeedbackStats([], [
    { id: reportId, status: 'new', phase: 'production' },
  ])
  const routeStats = getRouteFeedbackStats([], [
    { id: reportId, status: 'new', phase: 'production' },
  ])

  assert.equal(stats[0].label, 'Feedback items')
  assert.equal(stats[0].value, 1)
  assert.equal(stats[1].label, 'Open items')
  assert.equal(stats[1].value, 1)
  assert.equal(routeStats[0].value, 1)
  assert.match(platformFeedbackSectionSource, /No product ideas have been submitted yet/)
  assert.match(platformFeedbackBoardSectionSource, /No product ideas have been submitted yet/)
  assert.match(issueReportsSectionSource, /No issue reports have been submitted yet/)
  assert.doesNotMatch(platformFeedbackBoardSectionSource, /No feedback has been submitted yet/)
})

test('client review loader calls the protected function with bearer token and blocks non-admin callers', async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      json: async () => ({
        success: true,
        reports: [{ id: reportId }],
      }),
    }
  }

  try {
    const reports = await getPlatformFeedbackReports({
      user: { id: 'admin-1', role: 'super_admin' },
      accessToken: 'token-123',
    })
    const blockedReports = await getPlatformFeedbackReports({
      user: { id: 'user-1', role: 'coach' },
      accessToken: 'token-456',
    })

    assert.equal(reports[0].id, reportId)
    assert.equal(blockedReports.length, 0)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/.netlify/functions/platform-feedback-reports')
    assert.equal(calls[0].options.headers.Authorization, 'Bearer token-123')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('client attachment helper calls protected signed URL function and blocks non-admin callers', async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      json: async () => ({
        success: true,
        signedUrl: 'https://signed.example.test/fixture.png',
      }),
    }
  }

  try {
    const result = await getPlatformFeedbackAttachmentUrl({
      user: { id: 'admin-1', role: 'super_admin' },
      accessToken: 'token-123',
      reportId,
    })

    assert.equal(result.signedUrl, 'https://signed.example.test/fixture.png')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/.netlify/functions/platform-feedback-attachment-url')
    assert.equal(calls[0].options.headers.Authorization, 'Bearer token-123')
    assert.equal(JSON.parse(calls[0].options.body).reportId, reportId)

    await assert.rejects(
      () => getPlatformFeedbackAttachmentUrl({
        user: { id: 'user-1', role: 'coach' },
        accessToken: 'token-456',
        reportId,
      }),
      /Only platform admins/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('direct Platform Feedback route displays issue reports through the protected admin report loader', () => {
  assert.match(platformFeedbackPageSource, /getPlatformFeedbackReports/)
  assert.match(platformFeedbackPageSource, /IssueReportsSection/)
  assert.match(platformFeedbackPageSource, /updatePlatformFeedbackReportStatus/)
  assert.match(platformFeedbackPageSource, /reports=\{feedbackReports\}/)
  assert.match(platformFeedbackPageSource, /getFeedbackStats\(feedbackItems, feedbackReports\)/)
})

test('issue report container uses dark theme styling and renders required metadata', () => {
  assert.match(issueReportsSectionSource, /bg-\[#0f1f18\]/)
  assert.match(issueReportsSectionSource, /bg-\[#0b1712\]/)
  assert.doesNotMatch(issueReportsSectionSource, /bg-\[#eff6ff\]|bg-white/)
  assert.match(issueReportsSectionSource, /Production Report Issue submissions/)
  assert.match(issueReportsSectionSource, /report\.title/)
  assert.match(issueReportsSectionSource, /report\.summary/)
  assert.match(issueReportsSectionSource, /report\.feedbackType/)
  assert.match(issueReportsSectionSource, /report\.severity/)
  assert.match(issueReportsSectionSource, /report\.module/)
  assert.match(issueReportsSectionSource, /report\.route/)
  assert.match(issueReportsSectionSource, /report\.submittedByName/)
  assert.match(issueReportsSectionSource, /formatPlatformDate\(report\.createdAt\)/)
  assert.match(issueReportsSectionSource, /Report ID: \{report\.id\}/)
  assert.match(issueReportsSectionSource, /View screenshot/)
  assert.match(issueReportsSectionSource, /report\.attachment/)
})

test('platform admin can mark an issue report reviewed or closed through protected update function', async () => {
  const reviewedMock = createMockSupabase()
  const reviewedResponse = await platformFeedbackReportUpdateResult(createUpdateEvent({
    reportId,
    action: 'reviewed',
  }), {
    supabaseAdmin: reviewedMock.supabaseAdmin,
  })
  const reviewedParsed = parseResponse(reviewedResponse)
  const reviewedUpdate = reviewedMock.calls.find((call) => call.table === 'tester_feedback_reports' && call.action === 'update')

  assert.equal(reviewedParsed.statusCode, 200)
  assert.equal(reviewedParsed.body.report.status, 'triaged')
  assert.equal(reviewedUpdate.payload.status, 'triaged')
  assert.equal(reviewedUpdate.payload.resolution_state, 'reviewed')
  assert.equal(reviewedMock.calls.some((call) => call.table === 'audit_logs' && call.action === 'insert'), true)

  const closedMock = createMockSupabase()
  const closedResponse = await platformFeedbackReportUpdateResult(createUpdateEvent({
    reportId,
    action: 'closed',
  }), {
    supabaseAdmin: closedMock.supabaseAdmin,
  })
  const closedParsed = parseResponse(closedResponse)
  const closedUpdate = closedMock.calls.find((call) => call.table === 'tester_feedback_reports' && call.action === 'update')

  assert.equal(closedParsed.statusCode, 200)
  assert.equal(closedParsed.body.report.status, 'fixed')
  assert.equal(closedUpdate.payload.status, 'fixed')
  assert.equal(closedUpdate.payload.resolution_state, 'closed')
})

test('normal user cannot update issue report status and cannot reach report update query', async () => {
  const mock = createMockSupabase({
    profile: {
      id: 'user-1',
      email: 'coach@example.test',
      role: 'coach',
      role_label: 'Coach',
      role_rank: 20,
    },
  })
  const response = await withMutedConsole(() => platformFeedbackReportUpdateResult(createUpdateEvent({
    reportId,
    action: 'reviewed',
  }), {
    supabaseAdmin: mock.supabaseAdmin,
  }))
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 403)
  assert.equal(parsed.body.code, 'forbidden')
  assert.equal(mock.calls.some((call) => call.table === 'tester_feedback_reports' && call.action === 'update'), false)
})

test('client status update helper calls protected function and blocks non-admin callers', async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      json: async () => ({
        success: true,
        report: { id: reportId, status: 'triaged' },
      }),
    }
  }

  try {
    const report = await updatePlatformFeedbackReportStatus({
      user: { id: 'admin-1', role: 'super_admin' },
      accessToken: 'token-123',
      reportId,
      action: 'reviewed',
    })

    assert.equal(report.status, 'triaged')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/.netlify/functions/platform-feedback-report-update')
    assert.equal(calls[0].options.headers.Authorization, 'Bearer token-123')
    assert.equal(JSON.parse(calls[0].options.body).reportId, reportId)

    await assert.rejects(
      () => updatePlatformFeedbackReportStatus({
        user: { id: 'user-1', role: 'coach' },
        accessToken: 'token-456',
        reportId,
        action: 'reviewed',
      }),
      /Only platform admins/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tester feedback RLS and copy remain production-safe', () => {
  assert.match(migrationSource, /create policy tester_feedback_reports_select_scoped/)
  assert.match(migrationSource, /current_user_role\(\) = 'super_admin'/)
  assert.match(migrationSource, /submitted_by_user_id = auth\.uid\(\)/)
  assert.doesNotMatch(migrationSource, /grant .* on public\.tester_feedback_reports to anon/i)
  assert.match(testerFeedbackPageSource, /Report issue/)
  assert.doesNotMatch(testerFeedbackPageSource, /staging database/i)
  assert.doesNotMatch(testerFeedbackPageSource, /recovery testing/i)
  assert.match(reportsFunctionSource, /profile\.role !== 'super_admin'/)
  assert.match(attachmentUrlFunctionSource, /profile\.role !== 'super_admin'/)
  assert.match(attachmentUrlFunctionSource, /createSignedUrl/)
  assert.match(reportUpdateFunctionSource, /profile\.role !== 'super_admin'/)
  assert.match(reportUpdateFunctionSource, /tester_feedback_report_status_updated/)
  assert.doesNotMatch(reportsFunctionSource, /serviceRoleKey/)
  assert.doesNotMatch(reportUpdateFunctionSource, /serviceRoleKey/)
})
