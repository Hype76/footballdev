import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium, devices } from 'playwright'

const fixturePassword = 'FixturePass123!'
const port = Number(process.env.PARENT_DEVELOPMENT_BROWSER_PORT || 5450 + Math.floor(Math.random() * 200))
const baseUrl = `http://127.0.0.1:${port}`
const firstLinkId = 'parent-link-fixture'
const secondLinkId = 'parent-link-fixture-second'
const firstReportId = '11111111-aaaa-4aaa-8aaa-111111111111'
const scheduledReportId = '22222222-bbbb-4bbb-8bbb-222222222222'
const secondReportId = '33333333-cccc-4ccc-8ccc-333333333333'

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPort(timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const open = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      const timeoutId = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, 250)
      socket.once('connect', () => {
        clearTimeout(timeoutId)
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        clearTimeout(timeoutId)
        socket.destroy()
        resolve(false)
      })
    })

    if (open) {
      return
    }

    await wait(100)
  }

  throw new Error('Timed out waiting for the Parent Development browser server.')
}

function startServer() {
  const child = spawn(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `npm.cmd run dev -- --host 0.0.0.0 --port ${port} --strictPort`],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSER: 'none',
        VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
        VITE_APP_URL: baseUrl,
        VITE_PARENT_APP_URL: baseUrl,
        VITE_SUPABASE_URL: 'http://fixture.supabase.test',
        VITE_SUPABASE_ANON_KEY: 'fixture-anon-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { child, output: () => output }
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) {
    return
  }

  if (process.platform === 'win32') {
    spawn(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`],
      { stdio: 'ignore' },
    )
  } else {
    server.child.kill()
  }

  await Promise.race([once(server.child, 'exit'), wait(3000)])
}

function buildReport({
  author = 'Fixture Coach',
  deliveryLabel = 'Sent',
  deliveryState = 'sent',
  formName = 'First child review',
  id = firstReportId,
  playerId = 'player-fixture',
  playerName = "Fixture O'Neil-Child",
  recordDate = '2026-07-29',
  canDownloadPdf = true,
  pdfLabel = 'PDF attached',
  pdfState = 'attached',
  uniqueFeedback = 'Great first-child feedback.',
} = {}) {
  return {
    id,
    finalizedAt: `${recordDate}T10:00:00.000Z`,
    recordDate,
    club: { id: 'club-fixture', name: 'Fixture United' },
    team: { id: 'team-u12', name: 'U12 Fixture Team' },
    player: { id: playerId, name: playerName },
    author: { name: author },
    section: 'Development',
    form: {
      id: '44444444-dddd-4ddd-8ddd-444444444444',
      name: formName,
      version: 2,
      templateKey: 'fixture-review',
    },
    overallScore: 8,
    overallMaxScore: 10,
    attendanceIncluded: true,
    progressionIncluded: true,
    responseItems: [
      {
        fieldId: 'technical',
        label: 'Technical',
        type: 'score_1_10',
        displayValue: '1 / 10 - Well Below Standard',
        numericScore: 1,
        maxScore: 10,
        ratingLabel: 'Well Below Standard',
        order: 1,
      },
      {
        fieldId: 'tactical',
        label: 'Tactical',
        type: 'score_1_10',
        displayValue: '5 / 10 - Expected Level',
        numericScore: 5,
        maxScore: 10,
        ratingLabel: 'Expected Level',
        order: 2,
      },
      {
        fieldId: 'game-impact',
        label: 'Game impact',
        type: 'score_1_10',
        displayValue: '10 / 10 - Exceptional',
        numericScore: 10,
        maxScore: 10,
        ratingLabel: 'Exceptional',
        order: 3,
      },
      {
        fieldId: 'review-summary',
        label: 'Review summary',
        type: 'textarea',
        displayValue: uniqueFeedback,
        numericScore: null,
        maxScore: null,
        ratingLabel: '',
        order: 4,
      },
      {
        fieldId: 'strengths',
        label: 'Strengths',
        type: 'textarea',
        displayValue: 'Calm receiving under pressure.',
        numericScore: null,
        ratingLabel: '',
        order: 5,
      },
      {
        fieldId: 'priority',
        label: 'Development priority',
        type: 'textarea',
        displayValue: 'Scan earlier before receiving.',
        numericScore: null,
        ratingLabel: '',
        order: 6,
      },
      {
        fieldId: 'training',
        label: 'Training focus',
        type: 'textarea',
        displayValue: 'First-touch direction drills.',
        numericScore: null,
        ratingLabel: '',
        order: 7,
      },
    ],
    sections: [
      {
        key: 'attendanceSummary',
        title: 'Attendance',
        body: 'Attended 9 of 10 sessions.',
        chartPoints: [],
      },
      {
        key: 'progressionChart',
        title: 'Progression',
        body: 'Steady improvement across the review period.',
        chartPoints: [
          { label: 'June', value: 7 },
          { label: 'July', value: 8 },
        ],
      },
    ],
    deliveryState,
    deliveryLabel,
    deliveredAt: `${recordDate}T11:00:00.000Z`,
    pdfState,
    pdfLabel,
    canDownloadPdf,
  }
}

const reportsByLink = {
  [firstLinkId]: [
    buildReport(),
    buildReport({
      id: scheduledReportId,
      recordDate: '2026-06-29',
      formName: 'Scheduled first child review',
      deliveryState: 'scheduled',
      deliveryLabel: 'Scheduled',
      canDownloadPdf: false,
      pdfState: 'not_requested',
      pdfLabel: 'No PDF requested',
      uniqueFeedback: 'Scheduled first-child feedback.',
    }),
  ],
  [secondLinkId]: [
    buildReport({
      id: secondReportId,
      recordDate: '2026-07-28',
      formName: 'Second child review',
      playerId: 'player-fixture-second',
      playerName: 'Second Fixture Child',
      deliveryState: 'failed',
      deliveryLabel: 'Delivery failed',
      canDownloadPdf: false,
      pdfState: 'not_requested',
      pdfLabel: 'No PDF requested',
      uniqueFeedback: 'Second-child-only feedback.',
    }),
  ],
}

async function prepareContext(browser, { standalone = false, ...options }) {
  const context = await browser.newContext(options)
  if (standalone) {
    await context.addInitScript(() => {
      Object.defineProperty(window.navigator, 'standalone', {
        configurable: true,
        value: true,
      })
      const originalMatchMedia = window.matchMedia.bind(window)
      window.matchMedia = (query) => {
        if (query === '(display-mode: standalone)') {
          return {
            addEventListener() {},
            addListener() {},
            dispatchEvent() { return false },
            matches: true,
            media: query,
            onchange: null,
            removeEventListener() {},
            removeListener() {},
          }
        }

        return originalMatchMedia(query)
      }
    })
  }
  const consoleErrors = []
  const pageErrors = []
  const failedResources = []
  const endpointRequests = []
  let delaySecondChild = false
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, apikey, content-type, prefer, x-client-info',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  }

  await context.route('**/api/parent-development/history', async (route) => {
    const body = route.request().postDataJSON() || {}
    endpointRequests.push({
      action: body.action,
      parentLinkId: body.parentLinkId,
      reportId: body.reportId || '',
      authorization: route.request().headers().authorization || '',
    })

    if (body.action === 'download_pdf') {
      const allowedReport = (reportsByLink[body.parentLinkId] || [])
        .find((report) => report.id === body.reportId && report.canDownloadPdf)

      if (!allowedReport) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'This Development PDF is not available.',
          }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: {
          'content-disposition': "attachment; filename=\"Fixture O'Neil-Child - 29-07-26 - U12 Fixture Team.pdf\"; filename*=UTF-8''Fixture%20O%27Neil-Child%20-%2029-07-26%20-%20U12%20Fixture%20Team.pdf",
        },
        body: Buffer.from('%PDF-1.4\nfixture\n%%EOF'),
      })
      return
    }

    if (delaySecondChild && body.parentLinkId === secondLinkId) {
      await wait(750)
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        parentLinkId: body.parentLinkId,
        reports: reportsByLink[body.parentLinkId] || [],
      }),
    })
  })
  await context.route('**/.netlify/functions/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authorized: false, success: true }),
  }))
  await context.route('**/auth/v1/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: corsHeaders,
    body: '{}',
  }))
  await context.route('**/rest/v1/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: corsHeaders,
    body: '[]',
  }))

  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'failed'

    if (
      failure !== 'net::ERR_ABORTED'
      && ['document', 'script', 'stylesheet'].includes(request.resourceType())
    ) {
      failedResources.push(`${request.resourceType()}: ${request.url()} ${failure}`)
    }
  })

  return {
    consoleErrors,
    context,
    endpointRequests,
    failedResources,
    page,
    pageErrors,
    setDelaySecondChild(value) {
      delaySecondChild = value
    },
  }
}

async function signIn(page) {
  await page.goto(`${baseUrl}/sign-in?tab=parent`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await page.getByPlaceholder('you@club.com').waitFor({ state: 'visible', timeout: 30000 })
  await page.getByRole('button', { name: 'Parent' }).click()
  await page.getByPlaceholder('you@club.com').fill('parent-multiple.fixture@footballplayer.test')
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL('**/parent-portal', { timeout: 30000 })
}

async function verifyDevelopmentJourney(session, viewportName) {
  const { page } = session
  await signIn(page)
  await page.goto(
    `${baseUrl}/parent-portal?section=development&parentLinkId=${firstLinkId}`,
    { waitUntil: 'domcontentloaded', timeout: 60000 },
  )
  await page.getByRole('heading', { name: 'Shared Development history' })
    .waitFor({ state: 'visible', timeout: 30000 })
  await page.getByText('First child review', { exact: true }).waitFor({ state: 'visible' })
  await page.getByText('Scheduled first child review', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await page.getByText('Second child review', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Never expose this', { exact: true }).count(), 0)

  await page.getByRole('button', { name: 'View report' }).first().click()
  await page.waitForURL(`**reportId=${firstReportId}`)
  await page.getByText('Great first-child feedback.', { exact: true }).waitFor({ state: 'visible' })
  await page.getByText('1 / 10 - Well Below Standard', { exact: true }).waitFor({ state: 'visible' })
  await page.getByText('5 / 10 - Expected Level', { exact: true }).waitFor({ state: 'visible' })
  await page.getByText('10 / 10 - Exceptional', { exact: true }).waitFor({ state: 'visible' })
  await page.getByText('Strengths', { exact: true }).waitFor({ state: 'visible' })
  await page.getByText('Development priority', { exact: true }).waitFor({ state: 'visible' })
  await page.getByText('Training focus', { exact: true }).waitFor({ state: 'visible' })
  await page.getByText('Attended 9 of 10 sessions.', { exact: true }).waitFor({ state: 'visible' })
  await page.getByText('Steady improvement across the review period.', { exact: true }).waitFor({ state: 'visible' })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('Great first-child feedback.', { exact: true }).waitFor({ state: 'visible' })
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Shared Development history' }).waitFor({ state: 'visible' })
  await page.goForward({ waitUntil: 'domcontentloaded' })
  await page.getByText('Great first-child feedback.', { exact: true }).waitFor({ state: 'visible' })

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF' }).click()
  const download = await downloadPromise
  assert.equal(download.suggestedFilename(), "Fixture O'Neil-Child - 29-07-26 - U12 Fixture Team.pdf")

  await page.getByRole('button', { name: 'Back to Development history' }).click()
  session.setDelaySecondChild(true)
  const childSelector = viewportName === 'desktop'
    ? page.locator('#parent-portal-shell-child')
    : page.getByLabel('Choose child')
  await childSelector.selectOption(secondLinkId)
  await page.waitForURL(`**parentLinkId=${secondLinkId}`)
  await page.getByText('Loading Development history...', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await page.getByText('Great first-child feedback.', { exact: true }).count(), 0)
  assert.equal(await page.getByText('First child review', { exact: true }).count(), 0)
  await page.getByText('Second child review', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await page.getByText('Delivery failed', { exact: true }).count(), 1)
  session.setDelaySecondChild(false)

  await page.goto(
    `${baseUrl}/parent-portal?section=development&parentLinkId=${secondLinkId}&reportId=${firstReportId}`,
    { waitUntil: 'domcontentloaded' },
  )
  await page.getByText('This report is not available for the selected child.', { exact: true })
    .waitFor({ state: 'visible' })
  assert.equal(await page.getByText('Great first-child feedback.', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Second-child-only feedback.', { exact: true }).count(), 0)

  assert.equal(
    session.endpointRequests.every(
      (request) => request.authorization === 'Bearer fixture-token-parent-multiple.fixture@footballplayer.test',
    ),
    true,
  )
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  )
  if (viewportName === 'pwa') {
    assert.equal(await page.evaluate(() => (
      window.matchMedia('(display-mode: standalone)').matches
      && window.navigator.standalone === true
    )), true)
    const manifestResult = await page.evaluate(async () => {
      const manifestLink = document.querySelector('link[rel="manifest"]')?.getAttribute('href') || ''
      const response = await fetch(manifestLink)
      return {
        manifestLink,
        ok: response.ok,
        contentType: response.headers.get('content-type') || '',
      }
    })
    assert.match(manifestResult.manifestLink, /manifest\.webmanifest/)
    assert.equal(manifestResult.ok, true)
    assert.match(manifestResult.contentType, /manifest|json/i)
  }
  assert.deepEqual(session.consoleErrors, [])
  assert.deepEqual(session.pageErrors, [])
  assert.deepEqual(session.failedResources, [])
}

const server = startServer()
let browser

try {
  await waitForPort()
  browser = await chromium.launch({ headless: true })

  for (const viewport of [
    { name: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
    { name: 'iPhone', options: { ...devices['iPhone 13'] } },
    { name: 'android', options: { ...devices['Galaxy S9+'] } },
    { name: 'pwa', options: { ...devices['iPhone 13'], standalone: true } },
  ]) {
    const session = await prepareContext(browser, viewport.options)
    await verifyDevelopmentJourney(session, viewport.name)
    await session.context.close()
    process.stdout.write(`PASS ${viewport.name}: Development scores, canonical PDF filename, child isolation, direct route, refresh, history, and responsive layout\n`)
  }
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`)
  process.stderr.write(server.output())
  process.exitCode = 1
} finally {
  await browser?.close()
  await stopServer(server)
}
