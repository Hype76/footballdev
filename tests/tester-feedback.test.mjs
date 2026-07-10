import { migrationSourceUrl } from './helpers/migration-source.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= 'test-publishable-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const {
  FEEDBACK_ATTACHMENT_BUCKET_NAME,
  FEEDBACK_SAVE_ERROR_MESSAGE,
  submitTesterFeedbackResult,
} = await import('../netlify/functions/submit-tester-feedback.js')

const pageSource = readFileSync('src/pages/TesterFeedbackPage.jsx', 'utf8')
const sidebarSource = readFileSync('src/components/layout/Sidebar.jsx', 'utf8')
const domainSource = readFileSync('src/lib/domain/tester-feedback.js', 'utf8')
const functionSource = readFileSync('netlify/functions/submit-tester-feedback.js', 'utf8')
const compatibilityWrapperSource = readFileSync('netlify/functions/_t-tester-feedback.js', 'utf8')
const contactRequestFunctionSource = readFileSync('netlify/functions/send-contact-request.js', 'utf8')
const parentEmailFunctionSource = readFileSync('netlify/functions/send-parent-email.js', 'utf8')
const parentInviteFunctionSource = readFileSync('netlify/functions/send-parent-portal-invite.js', 'utf8')
const checkoutFunctionSource = readFileSync('netlify/functions/create-checkout-session.js', 'utf8')
const migrationSource = [
  migrationSourceUrl('20260625083617_tester_feedback_reports.sql', 'active'),
  migrationSourceUrl('20260625083639_harden_tester_feedback_reports_grants.sql', 'active'),
  migrationSourceUrl('20260625083714_restrict_tester_feedback_reports_authenticated_grants.sql', 'active'),
].map((url) => readFileSync(url, 'utf8')).join('\n')
const uploadEmailMigrationSource = readFileSync(migrationSourceUrl('20260629090541_v1_feedback_upload_email.sql', 'active'), 'utf8')

const userId = '11111111-1111-4111-8111-111111111111'
const clubId = '22222222-2222-4222-8222-222222222222'
const teamId = '33333333-3333-4333-8333-333333333333'
const otherTeamId = '44444444-4444-4444-8444-444444444444'
const validPngBuffer = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082', 'hex')

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
  storageUploadError = null,
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

    update(payload) {
      this.action = 'update'
      this.payload = payload
      calls.push({ table: this.table, action: 'update', payload })
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
      storage: {
        from: (bucket) => ({
          remove: async (paths) => {
            calls.push({ action: 'storage_remove', bucket, paths })
            return { data: null, error: null }
          },
          upload: async (path, fileBody, options) => {
            calls.push({ action: 'storage_upload', bucket, path, fileBody, options })
            return { data: { path }, error: storageUploadError }
          },
        }),
      },
    },
  }
}

function createScreenshotAttachment({
  buffer = validPngBuffer,
  fileName = '{BE0AD2EE-BA45-4190-BD7A-4666BDCAC9A8}.png',
  mimeType = 'image/png',
  size = buffer.length,
} = {}) {
  return {
    contentBase64: buffer.toString('base64'),
    fileName,
    mimeType,
    size,
  }
}

async function createMultipartEvent({
  file = new File([validPngBuffer], '{BE0AD2EE-BA45-4190-BD7A-4666BDCAC9A8}.png', { type: 'image/png' }),
  isBase64Encoded = true,
} = {}) {
  const jsonEvent = createEvent()
  const jsonBody = JSON.parse(jsonEvent.body)
  const formData = new FormData()
  formData.set('report', JSON.stringify(jsonBody.report))
  formData.set('context', JSON.stringify(jsonBody.context))

  if (file) {
    formData.set('screenshot', file, file.name || 'screenshot')
  }

  const request = new Request('https://footballplayer.online/.netlify/functions/submit-tester-feedback', {
    method: 'POST',
    body: formData,
  })

  return {
    ...jsonEvent,
    headers: {
      ...jsonEvent.headers,
      'content-type': request.headers.get('content-type'),
    },
    body: isBase64Encoded
      ? Buffer.from(await request.arrayBuffer()).toString('base64')
      : Buffer.from(await request.arrayBuffer()).toString('latin1'),
    isBase64Encoded,
  }
}

const emailEnv = {
  FEEDBACK_NOTIFY_TO: 'support@jelumalabs.com',
  RESEND_API_KEY: 'resend-test-key',
  RESEND_FROM_EMAIL: 'feedback@footballplayer.online',
}

function createEmailSender({ shouldFail = false } = {}) {
  const calls = []
  const emailSender = async (payload, options) => {
    calls.push({ payload, options })

    if (shouldFail) {
      throw new Error('Email provider failed')
    }

    return { data: { id: 'email-1' } }
  }

  return { calls, emailSender }
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
  assert.match(pageSource, /Upload screenshot/)
  assert.match(pageSource, /type="file"/)
  assert.doesNotMatch(pageSource, /Screenshot URL/)
  assert.doesNotMatch(pageSource, /staging database/i)
  assert.doesNotMatch(pageSource, /recovery testing/i)
  assert.match(sidebarSource, /const feedbackRoute = `\/feedback\/new\?route=\$\{encodeURIComponent/)
  assert.match(sidebarSource, />\s*Report issue\s*<\/NavLink>/)
})

test('client submits through the protected Netlify function and not a direct browser table insert', () => {
  assert.match(domainSource, /supabase\.auth\.getSession\(\)/)
  assert.match(domainSource, /fetch\('\/\.netlify\/functions\/submit-tester-feedback'/)
  assert.match(domainSource, /Authorization: `Bearer \$\{accessToken\}`/)
  assert.match(domainSource, /screenshotAttachment/)
  assert.match(domainSource, /Content-Type': 'application\/json'/)
  assert.doesNotMatch(domainSource, /new FormData/)
  assert.doesNotMatch(domainSource, /\.from\('tester_feedback_reports'\)/)
})

test('submitTesterFeedbackResult inserts valid signed-in feedback with server-derived identity and context', async () => {
  const mock = createMockSupabase()
  const email = createEmailSender()
  const response = await submitTesterFeedbackResult(createEvent(), {
    emailSender: email.emailSender,
    env: emailEnv,
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
  assert.equal(insertCall.payload.screenshot_url, null)
  assert.equal(JSON.stringify(insertCall.payload).includes('spoofed-user'), false)
  assert.equal(JSON.stringify(insertCall.payload).includes('spoofed@example.test'), false)
  assert.equal(email.calls.length, 1)
  assert.deepEqual(email.calls[0].payload.to, ['support@jelumalabs.com'])
  assert.match(email.calls[0].payload.subject, /Report Issue: Fixture feedback title/)
  assert.equal(mock.calls.some((call) => call.action === 'storage_upload'), false)
})

test('submitTesterFeedbackResult uploads a JSON screenshot to private storage and updates metadata after insert', async () => {
  const mock = createMockSupabase()
  const email = createEmailSender()
  const response = await submitTesterFeedbackResult(createEvent({
    screenshotAttachment: createScreenshotAttachment(),
  }), {
    emailSender: email.emailSender,
    env: emailEnv,
    supabaseAdmin: mock.supabaseAdmin,
  })
  const parsed = parseResponse(response)
  const uploadCall = mock.calls.find((call) => call.action === 'storage_upload')
  const insertCall = mock.calls.find((call) => call.table === 'tester_feedback_reports' && call.action === 'insert')
  const metadataUpdateCall = mock.calls.find((call) => (
    call.table === 'tester_feedback_reports'
    && call.action === 'update'
    && call.payload.screenshot_storage_path
  ))

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.attachment.uploaded, true)
  assert.equal(parsed.body.attachment.warning, '')
  assert.equal(uploadCall.bucket, FEEDBACK_ATTACHMENT_BUCKET_NAME)
  assert.match(uploadCall.path, /^tester-feedback\/[0-9a-f-]+\/[0-9a-f-]+\.png$/)
  assert.equal(uploadCall.options.contentType, 'image/png')
  assert.equal(insertCall.payload.screenshot_storage_path, undefined)
  assert.equal(metadataUpdateCall.payload.screenshot_storage_bucket, FEEDBACK_ATTACHMENT_BUCKET_NAME)
  assert.equal(metadataUpdateCall.payload.screenshot_storage_path, uploadCall.path)
  assert.equal(metadataUpdateCall.payload.screenshot_original_filename, '{BE0AD2EE-BA45-4190-BD7A-4666BDCAC9A8}.png')
  assert.equal(metadataUpdateCall.payload.screenshot_mime_type, 'image/png')
  assert.equal(metadataUpdateCall.payload.screenshot_uploaded_by, userId)
  assert.equal(insertCall.payload.screenshot_url, null)
  assert.deepEqual(email.calls[0].payload.to, ['support@jelumalabs.com'])
})

test('submitTesterFeedbackResult defaults tester feedback notifications to the Jeluma Labs support inbox', async () => {
  const mock = createMockSupabase()
  const email = createEmailSender()
  const response = await submitTesterFeedbackResult(createEvent(), {
    emailSender: email.emailSender,
    env: {
      CONTACT_REQUEST_RECIPIENT: 'info@footballplayer.online',
      FEEDBACK_NOTIFICATION_EMAIL: 'info@footballplayer.online',
      RESEND_API_KEY: 'resend-test-key',
      RESEND_FROM_EMAIL: 'feedback@footballplayer.online',
    },
    supabaseAdmin: mock.supabaseAdmin,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.deepEqual(email.calls[0].payload.to, ['support@jelumalabs.com'])
  assert.equal(email.calls[0].payload.to.includes('info@footballplayer.online'), false)
})

test('submitTesterFeedbackResult uses FEEDBACK_NOTIFY_TO as the only configurable tester feedback recipient', async () => {
  const mock = createMockSupabase()
  const email = createEmailSender()
  const response = await submitTesterFeedbackResult(createEvent({
    screenshotAttachment: createScreenshotAttachment(),
  }), {
    emailSender: email.emailSender,
    env: {
      CONTACT_REQUEST_RECIPIENT: 'info@footballplayer.online',
      FEEDBACK_NOTIFY_TO: 'support@jelumalabs.com',
      RESEND_API_KEY: 'resend-test-key',
      RESEND_FROM_EMAIL: 'feedback@footballplayer.online',
    },
    supabaseAdmin: mock.supabaseAdmin,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.deepEqual(email.calls[0].payload.to, ['support@jelumalabs.com'])
})

test('tester feedback compatibility wrapper uses the same submit handler recipient path', () => {
  assert.equal(compatibilityWrapperSource.trim(), "export { handler } from './submit-tester-feedback.js'")
  assert.match(functionSource, /FEEDBACK_NOTIFY_TO/)
  assert.doesNotMatch(functionSource, /CONTACT_REQUEST_RECIPIENT \|\| 'info@footballplayer\.online'/)
})

test('submitTesterFeedbackResult rejects invalid screenshot uploads before insert', async () => {
  const mock = createMockSupabase()
  const event = createEvent({
    screenshotAttachment: createScreenshotAttachment({
      buffer: Buffer.from('plain text'),
      fileName: 'notes.txt',
      mimeType: 'text/plain',
    }),
  })
  const response = await withMutedConsole(() => submitTesterFeedbackResult(event, {
      emailSender: createEmailSender().emailSender,
      env: emailEnv,
      supabaseAdmin: mock.supabaseAdmin,
    }))
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 400)
  assert.equal(parsed.body.code, 'invalid_attachment_type')
  assert.equal(mock.calls.some((call) => call.table === 'tester_feedback_reports' && call.action === 'insert'), false)
  assert.equal(mock.calls.some((call) => call.action === 'storage_upload'), false)
})

test('submitTesterFeedbackResult rejects screenshot content that does not match the claimed type', async () => {
  const mock = createMockSupabase()
  const response = await withMutedConsole(() => submitTesterFeedbackResult(createEvent({
    screenshotAttachment: createScreenshotAttachment({
      buffer: Buffer.from('plain text'),
      mimeType: 'image/png',
    }),
  }), {
    emailSender: createEmailSender().emailSender,
    env: emailEnv,
    supabaseAdmin: mock.supabaseAdmin,
  }))
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 400)
  assert.equal(parsed.body.code, 'invalid_attachment_content')
  assert.equal(mock.calls.some((call) => call.table === 'tester_feedback_reports' && call.action === 'insert'), false)
  assert.equal(mock.calls.some((call) => call.action === 'storage_upload'), false)
})

test('submitTesterFeedbackResult keeps text feedback saved when screenshot storage upload fails', async () => {
  const mock = createMockSupabase({
    storageUploadError: new Error('Storage unavailable'),
  })
  const email = createEmailSender()
  const response = await withMutedConsole(() => submitTesterFeedbackResult(createEvent({
    screenshotAttachment: createScreenshotAttachment(),
  }), {
    emailSender: email.emailSender,
    env: emailEnv,
    supabaseAdmin: mock.supabaseAdmin,
  }))
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(parsed.body.attachment.uploaded, false)
  assert.equal(parsed.body.attachment.warning, 'Feedback was saved, but screenshot upload failed.')
  assert.equal(mock.calls.some((call) => call.table === 'tester_feedback_reports' && call.action === 'insert'), true)
  assert.equal(mock.calls.some((call) => call.action === 'storage_upload'), true)
  assert.equal(mock.calls.some((call) => call.payload?.screenshot_storage_path), false)
  assert.equal(email.calls.length, 1)
})

test('submitTesterFeedbackResult still parses Netlify-style multipart screenshots', async () => {
  const mock = createMockSupabase()
  const response = await submitTesterFeedbackResult(await createMultipartEvent({ isBase64Encoded: false }), {
    emailSender: createEmailSender().emailSender,
    env: emailEnv,
    supabaseAdmin: mock.supabaseAdmin,
  })
  const parsed = parseResponse(response)
  const uploadCall = mock.calls.find((call) => call.action === 'storage_upload')

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.attachment.uploaded, true)
  assert.equal(uploadCall.options.contentType, 'image/png')
})

test('submitTesterFeedbackResult keeps saved feedback when notification email fails', async () => {
  const mock = createMockSupabase()
  const email = createEmailSender({ shouldFail: true })
  const response = await withMutedConsole(() => submitTesterFeedbackResult(createEvent(), {
    emailSender: email.emailSender,
    env: emailEnv,
    supabaseAdmin: mock.supabaseAdmin,
  }))
  const parsed = parseResponse(response)
  const emailUpdate = mock.calls.find((call) => call.table === 'tester_feedback_reports' && call.action === 'update')

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(parsed.body.emailNotification.status, 'failed')
  assert.equal(mock.calls.some((call) => call.table === 'tester_feedback_reports' && call.action === 'insert'), true)
  assert.equal(emailUpdate.payload.feedback_email_status, 'failed')
})

test('submitTesterFeedbackResult keeps saved feedback when feedback recipient config is invalid', async () => {
  const mock = createMockSupabase()
  const email = createEmailSender()
  const response = await withMutedConsole(() => submitTesterFeedbackResult(createEvent(), {
    emailSender: email.emailSender,
    env: {
      FEEDBACK_NOTIFY_TO: 'not-an-email-address',
      RESEND_API_KEY: 'resend-test-key',
      RESEND_FROM_EMAIL: 'feedback@footballplayer.online',
    },
    supabaseAdmin: mock.supabaseAdmin,
  }))
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(parsed.body.emailNotification.status, 'not_configured')
  assert.equal(mock.calls.some((call) => call.table === 'tester_feedback_reports' && call.action === 'insert'), true)
  assert.equal(email.calls.length, 0)
})

test('submitTesterFeedbackResult rejects missing required title and summary before insert', async () => {
  for (const report of [
    { title: '', summary: 'Summary exists' },
    { title: 'Title exists', summary: '' },
  ]) {
    const mock = createMockSupabase()
    const response = await withMutedConsole(() => submitTesterFeedbackResult(createEvent({ report }), {
      emailSender: createEmailSender().emailSender,
      env: emailEnv,
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
    emailSender: createEmailSender().emailSender,
    env: emailEnv,
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
    emailSender: createEmailSender().emailSender,
    env: emailEnv,
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
    emailSender: createEmailSender().emailSender,
    env: emailEnv,
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
  assert.match(migrationSource, /revoke all on public\.tester_feedback_reports from anon/)
  assert.match(migrationSource, /revoke all on public\.tester_feedback_reports from public/)
  assert.match(migrationSource, /revoke all on public\.tester_feedback_reports from authenticated/)
  assert.match(migrationSource, /grant select, insert, update on public\.tester_feedback_reports to authenticated/)
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

test('tester feedback upload migration creates private bucket and metadata constraints', () => {
  assert.match(uploadEmailMigrationSource, /insert into storage\.buckets/)
  assert.match(uploadEmailMigrationSource, /'tester-feedback-attachments'/)
  assert.match(uploadEmailMigrationSource, /public,\s*[\r\n\s]*file_size_limit/i)
  assert.match(uploadEmailMigrationSource, /false,\s*[\r\n\s]*5242880/i)
  assert.match(uploadEmailMigrationSource, /allowed_mime_types/)
  assert.match(uploadEmailMigrationSource, /screenshot_storage_path/)
  assert.match(uploadEmailMigrationSource, /feedback_email_status/)
  assert.match(uploadEmailMigrationSource, /tester_feedback_reports_screenshot_metadata_check/)
  assert.doesNotMatch(uploadEmailMigrationSource, /create policy .*storage\.objects[\s\S]*using \(true\)/i)
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

test('feedback recipient setting does not change unrelated transactional email flows', () => {
  assert.match(contactRequestFunctionSource, /CONTACT_REQUEST_RECIPIENT/)
  assert.match(contactRequestFunctionSource, /support@jelumalabs\.com/)
  assert.doesNotMatch(contactRequestFunctionSource, /FEEDBACK_NOTIFY_TO/)
  assert.doesNotMatch(parentEmailFunctionSource, /FEEDBACK_NOTIFY_TO/)
  assert.doesNotMatch(parentInviteFunctionSource, /FEEDBACK_NOTIFY_TO/)
  assert.doesNotMatch(checkoutFunctionSource, /FEEDBACK_NOTIFY_TO/)
})
