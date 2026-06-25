import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= 'test-publishable-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { submitTesterFeedbackResult, FEEDBACK_SAVE_ERROR_MESSAGE } = await import('../netlify/functions/submit-tester-feedback.js')

const pageSource = readFileSync('src/pages/TesterFeedbackPage.jsx', 'utf8')
const sidebarSource = readFileSync('src/components/layout/Sidebar.jsx', 'utf8')
const domainSource = readFileSync('src/lib/domain/tester-feedback.js', 'utf8')
const functionSource = readFileSync('netlify/functions/submit-tester-feedback.js', 'utf8')
const migrationSource = readFileSync('supabase/migrations/20260531162038_tester_feedback_reports.sql', 'utf8')

const userId = '11111111-1111-4111-8111-111111111111'
const clubId = '22222222-2222-4222-8222-222222222222'
const teamId = '33333333-3333-4333-8333-333333333333'
const otherTeamId = '44444444-4444-4444-8444-444444444444'

function createEvent(body = {}, headers = {}) {
  return {
    httpMethod: 'POST',
    headers: {
      authorization: 'Bearer feedback-token',
      ...headers,
    },
    body: JSON.stringify({
      report: {
        feedbackType: 'bug',
        severity: 'high',
        module: 'Coach dashboard',
        phase: 'production',
        route: '/coach',
        pageTitle: 'Coach',
        title: 'Fixture feedback title',
        summary: 'Fixture feedback summary',
        reproductionSteps: 'Open the route',
        expectedResult: 'Feedback saves',
        actualResult: 'Feedback failed',
        browserDevice: 'Fixture browser | 1280x720',
        screenshotUrl: 'https://example.test/screenshot.png',
        logReference: 'log-fixture',
        submitted_by_user_id: 'spoofed-user',
        submittedByEmail: 'spoofed@example.test',
      },
      context: {
        activeTeamId: teamId,
      },
      ...body,
    }),
  }
}

function parseResponse(response) {
  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.body),
  }
}

function createMockSupabase({
  authUser = { id: userId, email: 'coach@example.test' },
  profile = {
    id: userId,
    email: 'coach@example.test',
    username: 'Fixture Coach',
    name: 'Fixture Coach',
    display_name: 'Fixture Coach',
    role: 'coach',
    role_label: 'Coach',
    role_rank: 20,
    club_id: clubId,
  },
  team = { id: teamId, club_id: clubId },
  assignment = { id: '55555555-5555-4555-8555-555555555555' },
  insertError = null,
} = {}) {
  const calls = []

  class Query {
    constructor(table) {
      this.table = table
      this.action = 'select'
      this.payload = null
    }

    select(columns) {
      calls.push({ table: this.table, action: this.action || 'select', columns })
      return this
    }

    or(expression) {
      calls.push({ table: this.table, action: 'or', expression })
      return this
    }

    limit(value) {
      calls.push({ table: this.table, action: 'limit', value })
      return this
    }

    eq(column, value) {
      calls.push({ table: this.table, action: this.action || 'eq', column, value })
      return this
    }

    insert(payload) {
      this.action = 'insert'
      this.payload = payload
      calls.push({ table: this.table, action: 'insert', payload })
      return this
    }

    maybeSingle() {
      if (this.table === 'users') {
        return Promise.resolve({ data: profile, error: null })
      }

      if (this.table === 'teams') {
        return Promise.resolve({ data: team, error: null })
      }

      if (this.table === 'team_staff') {
        return Promise.resolve({ data: assignment, error: null })
      }

      return Promise.resolve({ data: null, error: null })
    }

    single() {
      if (this.table === 'tester_feedback_reports') {
        return Promise.resolve(insertError
          ? { data: null, error: insertError }
          : { data: { id: '66666666-6666-4666-8666-666666666666', created_at: '2026-06-25T10:00:00.000Z' }, error: null })
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

test('production feedback page and sidebar use production Report issue wording', () => {
  assert.match(pageSource, /<h1[^>]*>Report issue<\/h1>/)
  assert.match(pageSource, /Send bugs, confusion, and missing setup details to the Football Player support team\./)
  assert.match(pageSource, /phase: 'production'/)
  assert.doesNotMatch(pageSource, /staging database/i)
  assert.doesNotMatch(pageSource, /recovery testing/i)
  assert.match(sidebarSource, /const feedbackRoute = `\/feedback\/new\?route=\$\{encodeURIComponent/)
  assert.match(sidebarSource, />\s*Report issue\s*<\/NavLink>/)
})

test('client submits through the protected Netlify function and not a direct browser table insert', () => {
  assert.match(domainSource, /supabase\.auth\.getSession\(\)/)
  assert.match(domainSource, /fetch\('\/\.netlify\/functions\/submit-tester-feedback'/)
  assert.match(domainSource, /Authorization: `Bearer \$\{accessToken\}`/)
  assert.doesNotMatch(domainSource, /\.from\('tester_feedback_reports'\)/)
})

test('submitTesterFeedbackResult inserts valid signed-in feedback with server-derived identity and context', async () => {
  const mock = createMockSupabase()
  const response = await submitTesterFeedbackResult(createEvent(), {
    supabaseAdmin: mock.supabaseAdmin,
  })
  const parsed = parseResponse(response)
  const insertCall = mock.calls.find((call) => call.table === 'tester_feedback_reports' && call.action === 'insert')

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(insertCall.payload.submitted_by_user_id, userId)
  assert.equal(insertCall.payload.submitted_by_email, 'coach@example.test')
  assert.equal(insertCall.payload.submitted_by_name, 'Fixture Coach')
  assert.equal(insertCall.payload.role, 'coach')
  assert.equal(insertCall.payload.club_id, clubId)
  assert.equal(insertCall.payload.team_id, teamId)
  assert.equal(insertCall.payload.route, '/coach')
  assert.equal(insertCall.payload.page_title, 'Coach')
  assert.equal(insertCall.payload.browser_device, 'Fixture browser | 1280x720')
  assert.equal(insertCall.payload.status, 'new')
  assert.equal(insertCall.payload.resolution_state, '')
  assert.equal(JSON.stringify(insertCall.payload).includes('spoofed-user'), false)
  assert.equal(JSON.stringify(insertCall.payload).includes('spoofed@example.test'), false)
})

test('submitTesterFeedbackResult rejects missing required title and summary before insert', async () => {
  for (const report of [
    { title: '', summary: 'Summary exists' },
    { title: 'Title exists', summary: '' },
  ]) {
    const mock = createMockSupabase()
    const response = await withMutedConsole(() => submitTesterFeedbackResult(createEvent({ report }), {
      supabaseAdmin: mock.supabaseAdmin,
    }))
    const parsed = parseResponse(response)

    assert.equal(parsed.statusCode, 400)
    assert.equal(mock.calls.some((call) => call.table === 'tester_feedback_reports' && call.action === 'insert'), false)
  }
})

test('submitTesterFeedbackResult maps schema cache and table failures to a safe user message', async () => {
  const mock = createMockSupabase({
    insertError: Object.assign(new Error("Could not find the table 'public.tester_feedback_reports' in the schema cache"), {
      code: 'PGRST205',
      details: "Could not find the table 'public.tester_feedback_reports'",
    }),
  })
  const response = await withMutedConsole(() => submitTesterFeedbackResult(createEvent(), {
    supabaseAdmin: mock.supabaseAdmin,
  }))
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 503)
  assert.equal(parsed.body.code, 'feedback_storage_unavailable')
  assert.equal(parsed.body.message, FEEDBACK_SAVE_ERROR_MESSAGE)
  assert.doesNotMatch(JSON.stringify(parsed.body), /schema cache|tester_feedback_reports/i)
})

test('submitTesterFeedbackResult blocks unauthenticated and cross-club team context', async () => {
  const unauthenticatedMock = createMockSupabase({ authUser: null })
  const unauthenticatedResponse = await withMutedConsole(() => submitTesterFeedbackResult(createEvent(), {
    supabaseAdmin: unauthenticatedMock.supabaseAdmin,
  }))
  const unauthenticatedParsed = parseResponse(unauthenticatedResponse)

  assert.equal(unauthenticatedParsed.statusCode, 401)
  assert.equal(unauthenticatedMock.calls.some((call) => call.table === 'tester_feedback_reports' && call.action === 'insert'), false)

  const crossClubMock = createMockSupabase({
    team: { id: otherTeamId, club_id: '77777777-7777-4777-8777-777777777777' },
  })
  const crossClubResponse = await withMutedConsole(() => submitTesterFeedbackResult(createEvent({
    context: { activeTeamId: otherTeamId },
  }), {
    supabaseAdmin: crossClubMock.supabaseAdmin,
  }))
  const crossClubParsed = parseResponse(crossClubResponse)

  assert.equal(crossClubParsed.statusCode, 403)
  assert.equal(crossClubParsed.body.code, 'invalid_team_context')
  assert.equal(crossClubMock.calls.some((call) => call.table === 'tester_feedback_reports' && call.action === 'insert'), false)
})

test('tester feedback migration defines production table with RLS and spoofing protections', () => {
  assert.match(migrationSource, /create table if not exists public\.tester_feedback_reports/)
  assert.match(migrationSource, /alter table public\.tester_feedback_reports enable row level security/)
  assert.match(migrationSource, /create policy tester_feedback_reports_insert_own/)
  assert.match(migrationSource, /submitted_by_user_id = auth\.uid\(\)/)
  assert.match(migrationSource, /status = 'new'/)
  assert.match(migrationSource, /resolution_state = ''/)
  assert.match(migrationSource, /admin_notes is null/)
  assert.match(migrationSource, /team\.club_id = current_user_club_id\(\)/)
  assert.match(migrationSource, /from public\.team_staff staff/)
  assert.match(migrationSource, /create policy tester_feedback_reports_select_scoped/)
  assert.doesNotMatch(migrationSource, /for select[\s\S]{0,120}using \(true\)/i)
  assert.doesNotMatch(migrationSource, /grant .* on public\.tester_feedback_reports to anon/i)
})

test('server function never trusts privileged client-supplied feedback fields', () => {
  assert.match(functionSource, /submitted_by_user_id: profile\.id/)
  assert.match(functionSource, /club_id: profile\.clubId/)
  assert.match(functionSource, /status: 'new'/)
  assert.match(functionSource, /resolution_state: ''/)
  assert.doesNotMatch(functionSource, /submittedByEmail/)
  assert.doesNotMatch(functionSource, /report\?\.clubId/)
  assert.doesNotMatch(functionSource, /report\?\.status/)
})
