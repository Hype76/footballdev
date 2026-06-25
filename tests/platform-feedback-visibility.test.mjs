import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= 'test-publishable-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { platformFeedbackReportsResult } = await import('../netlify/functions/platform-feedback-reports.js')
const { getFeedbackStats } = await import('../src/lib/platform-admin-stats.js')
const { getPlatformFeedbackReports } = await import('../src/lib/domain/feedback.js')

const platformAdminPageSource = readFileSync('src/pages/PlatformAdminPage.jsx', 'utf8')
const platformFeedbackSectionSource = readFileSync('src/components/platform/PlatformFeedbackSection.jsx', 'utf8')
const feedbackDomainSource = readFileSync('src/lib/domain/feedback.js', 'utf8')
const testerFeedbackFunctionSource = readFileSync('netlify/functions/submit-tester-feedback.js', 'utf8')
const reportsFunctionSource = readFileSync('netlify/functions/platform-feedback-reports.js', 'utf8')
const migrationSource = readFileSync('supabase/migrations/20260531162038_tester_feedback_reports.sql', 'utf8')
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
      clubs: { name: 'Fixture Club' },
      teams: { name: 'U12 Fixture' },
    },
  ],
  reportError = null,
} = {}) {
  const calls = []

  class Query {
    constructor(table) {
      this.table = table
      this.action = 'select'
      this.payload = null
    }

    select(columns) {
      calls.push({ table: this.table, action: 'select', columns })
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
  assert.match(platformAdminPageSource, /feedbackReports/)
  assert.match(platformFeedbackSectionSource, /Issue reports/)
  assert.match(platformFeedbackSectionSource, /Report ID: \{report\.id\}/)
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
  assert.equal(parsed.body.stats.total, 1)
  assert.equal(parsed.body.stats.open, 1)
  assert.equal(parsed.body.stats.production, 1)
  assert.match(reportQuery.columns, /title/)
  assert.match(reportQuery.columns, /summary/)
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
  assert.equal(parsed.body.message, 'Feedback reports could not be loaded. Please contact support with reference FPO-V1-FEEDBACK-VISIBILITY-011.')
  assert.doesNotMatch(JSON.stringify(parsed.body), /schema cache|tester_feedback_reports/i)
})

test('Platform Feedback stats and empty state include support reports', () => {
  const stats = getFeedbackStats([], [
    { id: reportId, status: 'new', phase: 'production' },
  ])

  assert.equal(stats[0].label, 'Feedback items')
  assert.equal(stats[0].value, 1)
  assert.equal(stats[1].label, 'Open items')
  assert.equal(stats[1].value, 1)
  assert.match(platformFeedbackSectionSource, /feedbackItems\.length === 0 && supportReports\.length === 0/)
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

test('tester feedback RLS and copy remain production-safe', () => {
  assert.match(migrationSource, /create policy tester_feedback_reports_select_scoped/)
  assert.match(migrationSource, /current_user_role\(\) = 'super_admin'/)
  assert.match(migrationSource, /submitted_by_user_id = auth\.uid\(\)/)
  assert.doesNotMatch(migrationSource, /grant .* on public\.tester_feedback_reports to anon/i)
  assert.match(testerFeedbackPageSource, /Report issue/)
  assert.doesNotMatch(testerFeedbackPageSource, /staging database/i)
  assert.doesNotMatch(testerFeedbackPageSource, /recovery testing/i)
  assert.match(reportsFunctionSource, /profile\.role !== 'super_admin'/)
  assert.doesNotMatch(reportsFunctionSource, /serviceRoleKey/)
})
