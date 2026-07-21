import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assertPdfScope, loadCommunicationPdfDocument } from '../netlify/functions/lib/_pdf-report.js'
import {
  PDF_DOCUMENT_LIMITS,
  PDF_DOCUMENT_VERSION,
  PDF_REPORT_TYPES,
  buildAssessmentPdfDocument,
  buildParentMessagePdfDocument,
  renderPdfDocumentHtml,
  validatePdfDocument,
} from '../src/lib/pdf-document.js'
import {
  PDF_RENDER_LIMITS,
  buildPdfBuffer,
  getActivePdfRenderCount,
  isNetworkRequestAllowed,
} from '../src/lib/pdf-builder.js'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { createRenderPdfHandler } = await import('../netlify/functions/render-pdf.js')

function validParentDocument(overrides = {}) {
  return buildParentMessagePdfDocument({
    clubName: 'Example Club',
    playerName: 'Example Player',
    teamName: 'Under 12',
    subject: 'Development update',
    body: 'A short progress update.',
    assessmentFields: [{ label: 'Technical', value: '7' }],
    ...overrides,
  })
}

function validPdfBuffer(pageCount = 1) {
  return Buffer.from(`%PDF-1.7\n${'/Type /Page\n'.repeat(pageCount)}%%EOF`, 'latin1')
}

function createMockBrowser({
  pdfBuffer = validPdfBuffer(),
  scrollHeight = 900,
  screenshotBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  onSetContent = () => {},
} = {}) {
  const calls = []
  const handlers = new Map()
  const page = {
    close: async () => calls.push('page.close'),
    evaluate: async () => scrollHeight,
    on: (name, handler) => handlers.set(name, handler),
    pdf: async () => pdfBuffer,
    screenshot: async () => screenshotBuffer,
    setBypassCSP: async (value) => calls.push(`csp:${value}`),
    setContent: async (html) => {
      calls.push('content')
      onSetContent(html)
    },
    setDefaultNavigationTimeout: (value) => calls.push(`navigation:${value}`),
    setDefaultTimeout: (value) => calls.push(`timeout:${value}`),
    setJavaScriptEnabled: async (value) => calls.push(`javascript:${value}`),
    setRequestInterception: async (value) => calls.push(`interception:${value}`),
    setViewport: async () => calls.push('viewport'),
  }
  const context = {
    close: async () => calls.push('context.close'),
    newPage: async () => page,
  }
  const browser = {
    close: async () => calls.push('browser.close'),
    createBrowserContext: async () => context,
  }

  return { browser, calls, handlers, page }
}

function activePlanProfile(overrides = {}) {
  return {
    id: 'actor-1',
    authUserId: 'actor-1',
    email: 'actor@example.test',
    authEmail: 'actor@example.test',
    name: 'Actor',
    role: 'admin',
    roleLabel: 'Admin',
    roleRank: 100,
    clubId: 'club-a',
    accountStatus: 'active',
    clubStatus: 'active',
    planKey: 'single_team',
    planStatus: 'active',
    isPlanComped: true,
    testerAccessExpired: false,
    ...overrides,
  }
}

function reportRequest(body, headers = {}) {
  return new Request('https://example.test/.netlify/functions/render-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer opaque-token', ...headers },
    body: JSON.stringify(body),
  })
}

function createTableMock(rows) {
  const calls = []
  const database = {
    from(table) {
      const filters = []
      const builder = {
        eq(column, value) {
          filters.push([column, value])
          return builder
        },
        maybeSingle: async () => {
          calls.push({ table, filters: [...filters] })
          return { data: rows[table] ?? null, error: null }
        },
        select() {
          return builder
        },
      }
      return builder
    },
  }

  return { calls, database }
}

test('PDF document schema rejects executable, remote-resource, and caller-controlled output fields', () => {
  const forbiddenFields = ['html', 'css', 'url', 'image', 'filename', 'template', 'script']

  for (const field of forbiddenFields) {
    assert.throws(() => validatePdfDocument({ ...validParentDocument(), [field]: 'not accepted' }), {
      code: 'PDF_INVALID_REQUEST',
    })
  }

  assert.throws(() => validatePdfDocument({
    version: PDF_DOCUMENT_VERSION,
    reportType: 'unsupported',
  }))
  assert.throws(() => validParentDocument({ body: 'x'.repeat(PDF_DOCUMENT_LIMITS.maxTextLength + 1) }), {
    code: 'PDF_LIMIT_EXCEEDED',
  })
  assert.throws(() => validParentDocument({
    assessmentFields: Array.from({ length: PDF_DOCUMENT_LIMITS.maxResponseItems + 1 }, (_, index) => ({
      label: `Field ${index}`,
      value: 'Value',
    })),
  }), { code: 'PDF_LIMIT_EXCEEDED' })
  assert.throws(() => buildAssessmentPdfDocument({
    clubName: 'Example Club',
    playerName: 'Example Player',
    emailSections: Array.from({ length: PDF_DOCUMENT_LIMITS.maxEmailSections + 1 }, (_, index) => ({
      title: `Section ${index}`,
      body: 'Bounded content',
    })),
  }), { code: 'PDF_LIMIT_EXCEEDED' })
  assert.throws(() => buildAssessmentPdfDocument({
    clubName: 'Example Club',
    playerName: 'Example Player',
    emailSections: [{
      title: 'Chart',
      body: 'Bounded chart',
      chartPoints: Array.from({ length: PDF_DOCUMENT_LIMITS.maxChartPoints + 1 }, (_, index) => ({
        label: `Point ${index}`,
        value: 5,
      })),
    }],
  }), { code: 'PDF_LIMIT_EXCEEDED' })
})

test('server-owned HTML keeps hostile text inert and blocks active content and resources', () => {
  const hostileText = '<script>run()</script><img src="http://127.0.0.1/private" onerror="run()"><iframe src="file:///secret"></iframe>&entity;'
  const html = renderPdfDocumentHtml(validParentDocument({
    subject: hostileText,
    body: hostileText,
    assessmentFields: [{ label: hostileText, value: hostileText }],
  }))

  assert.doesNotMatch(html, /<script>run\(\)<\/script>/)
  assert.doesNotMatch(html, /<img src="http:\/\/127\.0\.0\.1/)
  assert.doesNotMatch(html, /<iframe src="file:/)
  assert.doesNotMatch(html, /onerror="run\(\)"/)
  assert.match(html, /&lt;script&gt;run\(\)&lt;\/script&gt;/)
  assert.match(html, /default-src 'none'/)
  assert.match(html, /script-src 'none'/)
  assert.match(html, /img-src 'none'/)
  assert.match(html, /connect-src 'none'/)
  assert.doesNotMatch(html, /process\.env|SUPABASE_SERVICE_ROLE_KEY/)
})

test('network isolation denies every request class without resolving or fetching it', () => {
  const destinations = [
    'https://public.example/resource',
    'http://localhost/private',
    'http://127.0.0.1/private',
    'http://[::1]/private',
    'http://169.254.169.254/metadata',
    'http://10.0.0.1/private',
    'file:///etc/passwd',
    'ftp://example.test/file',
    'ws://example.test/socket',
    'data:text/html,content',
  ]

  for (const destination of destinations) {
    assert.equal(isNetworkRequestAllowed(destination), false)
  }
})

test('isolated renderer disables JavaScript, aborts requests, validates output, and always cleans up', async () => {
  let renderedHtml = ''
  const mock = createMockBrowser({ onSetContent: (html) => { renderedHtml = html } })
  const output = await buildPdfBuffer(validParentDocument(), {
    launchBrowser: async () => mock.browser,
  })

  assert.deepEqual(output, validPdfBuffer())
  assert.ok(mock.calls.includes('javascript:false'))
  assert.ok(mock.calls.includes('csp:false'))
  assert.ok(mock.calls.includes('interception:true'))
  assert.ok(mock.calls.includes('page.close'))
  assert.ok(mock.calls.includes('context.close'))
  assert.ok(mock.calls.includes('browser.close'))
  assert.match(renderedHtml, /Content-Security-Policy/)

  let aborted = false
  mock.handlers.get('request')?.({
    abort: async () => { aborted = true },
    isInterceptResolutionHandled: () => false,
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(aborted, true)
  assert.equal(getActivePdfRenderCount(), 0)
})

test('isolated renderer fails closed for invalid, oversized, excessive-page, timeout, and concurrency outcomes', async () => {
  const invalid = createMockBrowser({ pdfBuffer: Buffer.from('not-a-pdf') })
  await assert.rejects(buildPdfBuffer(validParentDocument(), { launchBrowser: async () => invalid.browser }), {
    code: 'PDF_OUTPUT_INVALID',
  })
  assert.ok(invalid.calls.includes('browser.close'))

  const oversized = createMockBrowser({
    pdfBuffer: Buffer.concat([validPdfBuffer(), Buffer.alloc(PDF_RENDER_LIMITS.maxPdfBytes)]),
  })
  await assert.rejects(buildPdfBuffer(validParentDocument(), { launchBrowser: async () => oversized.browser }), {
    code: 'PDF_OUTPUT_TOO_LARGE',
  })

  const tooManyPages = createMockBrowser({ pdfBuffer: validPdfBuffer(PDF_RENDER_LIMITS.maxPages + 1) })
  await assert.rejects(buildPdfBuffer(validParentDocument(), { launchBrowser: async () => tooManyPages.browser }), {
    code: 'PDF_PAGE_LIMIT_EXCEEDED',
  })

  await assert.rejects(buildPdfBuffer(validParentDocument(), {
    launchBrowser: () => new Promise(() => {}),
    timeoutMs: 10,
  }), { code: 'PDF_RENDER_TIMEOUT' })
  assert.equal(getActivePdfRenderCount(), 0)

  const stalledPdf = createMockBrowser()
  stalledPdf.page.pdf = () => new Promise(() => {})
  await assert.rejects(buildPdfBuffer(validParentDocument(), {
    launchBrowser: async () => stalledPdf.browser,
    timeoutMs: 20,
  }), { code: 'PDF_RENDER_TIMEOUT' })
  assert.ok(stalledPdf.calls.includes('page.close'))
  assert.ok(stalledPdf.calls.includes('browser.close'))
  assert.equal(getActivePdfRenderCount(), 0)

  let releaseLaunch
  const launchGate = new Promise((resolve) => { releaseLaunch = resolve })
  const first = buildPdfBuffer(validParentDocument(), { launchBrowser: () => launchGate })
  const second = buildPdfBuffer(validParentDocument(), { launchBrowser: () => launchGate })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(getActivePdfRenderCount(), PDF_RENDER_LIMITS.maxConcurrentRenders)
  await assert.rejects(buildPdfBuffer(validParentDocument(), { launchBrowser: () => launchGate }), {
    code: 'PDF_BUSY',
  })
  releaseLaunch(createMockBrowser().browser)
  await Promise.all([first, second])
  assert.equal(getActivePdfRenderCount(), 0)
})

test('PDF authority fails closed across authentication, club, team, and assignment boundaries', () => {
  assert.throws(() => assertPdfScope({ targetClubId: 'club-a' }), { code: 'PDF_SCOPE_DENIED' })
  assert.throws(() => assertPdfScope({ profile: activePlanProfile(), targetClubId: 'club-b' }), {
    code: 'PDF_CROSS_CLUB_DENIED',
  })
  assert.throws(() => assertPdfScope({
    profile: activePlanProfile({ role: 'coach', roleRank: 20 }),
    targetClubId: 'club-a',
    targetTeamId: 'team-b',
    teamExists: true,
    teamAssigned: false,
  }), { code: 'PDF_CROSS_TEAM_DENIED' })
  assert.equal(assertPdfScope({
    profile: activePlanProfile({ role: 'coach', roleRank: 20 }),
    targetClubId: 'club-a',
    targetTeamId: 'team-a',
    teamExists: true,
    teamAssigned: true,
  }), true)
  assert.equal(assertPdfScope({
    profile: activePlanProfile({ clubId: '', role: 'super_admin', roleRank: 100 }),
    targetClubId: 'club-b',
    targetTeamId: 'team-b',
    teamExists: true,
  }), true)
})

test('historical activity PDFs are rebuilt from scoped records and ignore stored markup', async () => {
  const legacyMarker = 'legacy-markup-must-not-be-used'
  const mock = createTableMock({
    communication_logs: {
      id: 'log-a',
      club_id: 'club-a',
      player_id: 'player-a',
      evaluation_id: 'evaluation-a',
      channel: 'email',
      action: 'parent_email_sent',
      metadata: {
        hasAttachment: true,
        subject: 'Development update',
        body: 'Structured message body.',
        assessmentFields: [{ label: 'Technical', value: '7' }],
        pdfHtml: `<script>${legacyMarker}</script>`,
      },
    },
    evaluations: {
      id: 'evaluation-a',
      club_id: 'club-a',
      team_id: 'team-a',
      player_id: 'player-a',
      player_name: 'Trusted Player',
      team: 'Trusted Team',
      section: 'Squad',
      session: '2026-07-20',
    },
    players: {
      id: 'player-a',
      club_id: 'club-a',
      team_id: 'team-a',
      player_name: 'Trusted Player',
      team: 'Trusted Team',
    },
    clubs: { id: 'club-a', name: 'Trusted Club' },
    teams: { id: 'team-a', club_id: 'club-a', name: 'Trusted Team' },
    team_staff: { team_id: 'team-a' },
  })
  const document = await loadCommunicationPdfDocument({
    supabaseAdmin: mock.database,
    profile: activePlanProfile({ role: 'coach', roleRank: 20 }),
    clubId: 'club-a',
    communicationLogId: 'log-a',
  })

  assert.equal(document.context.clubName, 'Trusted Club')
  assert.equal(document.context.playerName, 'Trusted Player')
  assert.equal(document.context.teamName, 'Trusted Team')
  assert.doesNotMatch(JSON.stringify(document), new RegExp(legacyMarker))
  assert.ok(mock.calls.find((call) => call.table === 'communication_logs')?.filters.some(
    ([column, value]) => column === 'club_id' && value === 'club-a',
  ))
  assert.ok(mock.calls.find((call) => call.table === 'team_staff')?.filters.some(
    ([column, value]) => column === 'user_id' && value === 'actor-1',
  ))
})

test('public PDF endpoint accepts only an authenticated resource identifier and returns fixed safe headers', async () => {
  const logs = []
  const handler = createRenderPdfHandler({
    authenticate: async () => activePlanProfile(),
    loadReport: async () => validParentDocument(),
    render: async () => validPdfBuffer(),
    logger: {
      error: (...values) => logs.push(values),
      info: (...values) => logs.push(values),
    },
  })
  const response = await handler(reportRequest({
    reportType: PDF_REPORT_TYPES.parentMessage,
    clubId: 'club-a',
    communicationLogId: 'log-a',
  }), { requestId: 'request-a' })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="football-player-report.pdf"')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(Buffer.from(await response.arrayBuffer()).equals(validPdfBuffer()), true)
  assert.doesNotMatch(JSON.stringify(logs), /club-a|log-a|opaque-token/)
})

test('public PDF endpoint rejects anonymous, unsupported, oversized, and caller-markup requests before rendering', async () => {
  let renderCount = 0
  let authenticateCount = 0
  const handler = createRenderPdfHandler({
    authenticate: async () => {
      authenticateCount += 1
      throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
    },
    render: async () => {
      renderCount += 1
      return validPdfBuffer()
    },
    logger: { error() {}, info() {} },
  })
  const anonymous = await handler(reportRequest({
    reportType: PDF_REPORT_TYPES.parentMessage,
    clubId: 'club-a',
    communicationLogId: 'log-a',
  }))
  assert.equal(anonymous.status, 401)

  const callerMarkup = await handler(reportRequest({
    reportType: PDF_REPORT_TYPES.parentMessage,
    clubId: 'club-a',
    communicationLogId: 'log-a',
    html: '<p>not accepted</p>',
  }))
  assert.equal(callerMarkup.status, 400)

  const spoofedAuthority = await handler(reportRequest({
    reportType: PDF_REPORT_TYPES.parentMessage,
    clubId: 'club-a',
    communicationLogId: 'log-a',
    role: 'super_admin',
    rank: 100,
    teamId: 'team-b',
  }))
  assert.equal(spoofedAuthority.status, 400)
  assert.equal(authenticateCount, 1)

  const wrongMethod = await handler(new Request('https://example.test', { method: 'GET' }))
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get('allow'), 'POST')

  const wrongContentType = await handler(new Request('https://example.test', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{}',
  }))
  assert.equal(wrongContentType.status, 415)

  const oversized = await handler(new Request('https://example.test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': '20000' },
    body: '{}',
  }))
  assert.equal(oversized.status, 413)
  assert.equal(renderCount, 0)
})

test('public PDF endpoint keeps disabled, removed, and suspended authority failures generic', async () => {
  for (const authorityState of ['disabled', 'removed', 'suspended']) {
    let renderCount = 0
    const handler = createRenderPdfHandler({
      authenticate: async () => {
        throw Object.assign(new Error(`Internal authority state: ${authorityState}`), { statusCode: 403 })
      },
      render: async () => {
        renderCount += 1
        return validPdfBuffer()
      },
      logger: { error() {}, info() {} },
    })
    const response = await handler(reportRequest({
      reportType: PDF_REPORT_TYPES.parentMessage,
      clubId: 'club-a',
      communicationLogId: 'log-a',
    }))
    const result = await response.json()

    assert.equal(response.status, 403)
    assert.equal(result.error, 'This PDF report is not available.')
    assert.doesNotMatch(JSON.stringify(result), new RegExp(authorityState))
    assert.equal(renderCount, 0)
  }
})

test('assessment documents remain bounded and support server-rendered charts only', () => {
  const document = buildAssessmentPdfDocument({
    clubName: 'Example Club',
    playerName: 'Example Player',
    teamName: 'Under 12',
    responseItems: [{ label: 'Technical', value: 8 }],
    emailSections: [{
      title: 'Progression',
      body: 'Scores over time.',
      chartPoints: [{ label: 'First', value: 6 }, { label: 'Second', value: 8 }],
    }],
  })
  const html = renderPdfDocumentHtml(document)

  assert.equal(document.reportType, PDF_REPORT_TYPES.assessment)
  assert.match(html, /<svg/)
  assert.match(html, /8 \/ 10/)
  assert.throws(() => validatePdfDocument({
    ...document,
    emailSections: [{
      title: 'Remote chart',
      body: 'Denied',
      chartPoints: [{ label: 'First', value: 6, url: 'https://example.test' }, { label: 'Second', value: 8 }],
    }],
  }), { code: 'PDF_INVALID_REQUEST' })
})
