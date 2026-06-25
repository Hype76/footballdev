import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium } from 'playwright'

const configuredBaseUrl = String(process.env.PLATFORM_FEEDBACK_BROWSER_BASE_URL || '').replace(/\/$/, '')
const port = Number(process.env.PLATFORM_FEEDBACK_BROWSER_PORT || 4900 + Math.floor(Math.random() * 400))
const baseUrl = configuredBaseUrl || `http://127.0.0.1:${port}`
const fixtureUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const fixtureEmail = 'platform.fixture@footballplayer.test'
const fixtureReportId = '06d29475-ded1-4b7c-b893-28e3237072e9'

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForPort(host, nextPort, timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const isReady = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port: nextPort })
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

    if (isReady) {
      return
    }

    await wait(100)
  }

  throw new Error(`Timed out waiting for ${host}:${nextPort}`)
}

function startDevServer() {
  if (configuredBaseUrl) {
    return null
  }

  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BROWSER: 'none',
      VITE_SUPABASE_URL: 'http://fixture.supabase.test',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  return {
    child,
    getOutput: () => output,
  }
}

async function stopDevServer(server) {
  if (!server?.child || server.child.exitCode !== null) {
    return
  }

  if (process.platform === 'win32') {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`], {
      stdio: 'ignore',
    })
  } else {
    server.child.kill()
  }

  await Promise.race([
    once(server.child, 'exit'),
    wait(3000),
  ])

  if (server.child.exitCode === null) {
    server.child.kill('SIGKILL')
  }
}

async function fulfillJson(route, status, payload) {
  await route.fulfill({
    status,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    },
    contentType: 'application/json',
    body: status === 204 ? '' : JSON.stringify(payload),
  })
}

function fixtureAuthUser() {
  return {
    id: fixtureUserId,
    aud: 'authenticated',
    role: 'authenticated',
    email: fixtureEmail,
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-06-25T09:00:00.000Z',
    updated_at: '2026-06-25T09:00:00.000Z',
  }
}

function fixtureProfile(role = 'super_admin') {
  return {
    id: fixtureUserId,
    email: fixtureEmail,
    username: 'Platform Fixture',
    name: 'Platform Fixture',
    display_name: 'Platform Fixture',
    role,
    role_label: role === 'super_admin' ? 'Super Admin' : 'Coach',
    role_rank: role === 'super_admin' ? 100 : 20,
    club_id: null,
    status: 'active',
    suspended_at: null,
  }
}

function fixtureIssueReport(status = 'new') {
  return {
    id: fixtureReportId,
    createdAt: '2026-06-25T08:49:38.769Z',
    submittedByUserId: fixtureUserId,
    submittedByEmail: fixtureEmail,
    submittedByName: 'Stephen King',
    role: 'super_admin',
    clubId: '',
    clubName: '',
    teamId: '',
    teamName: '',
    module: 'Shell/auth/workspace',
    phase: 'production',
    route: '/platform-feedback',
    pageTitle: 'Platform Feedback',
    feedbackType: 'confusion',
    severity: 'medium',
    status,
    resolutionState: status === 'fixed' ? 'closed' : '',
    title: 'Fixture issue report',
    summary: 'Fixture issue summary',
    reproductionSteps: '',
    expectedResult: '',
    actualResult: '',
    browserDevice: 'Fixture browser',
    logReference: '',
    adminNotes: '',
  }
}

async function prepareContext(browser, { role = 'super_admin' } = {}) {
  const context = await browser.newContext()
  const requests = {
    reports: [],
    updates: [],
  }
  let currentReport = fixtureIssueReport()

  await context.route('http://fixture.supabase.test/auth/v1/token**', async (route) => {
    await fulfillJson(route, 200, {
      access_token: 'fixture-access-token',
      refresh_token: 'fixture-refresh-token',
      expires_in: 3600,
      token_type: 'bearer',
      user: fixtureAuthUser(),
    })
  })

  await context.route('http://fixture.supabase.test/auth/v1/user**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, 204, {})
      return
    }

    await fulfillJson(route, 200, fixtureAuthUser())
  })

  await context.route('http://fixture.supabase.test/rest/v1/users**', async (route) => {
    await fulfillJson(route, 200, [fixtureProfile(role)])
  })

  await context.route('http://fixture.supabase.test/rest/v1/platform_feedback**', async (route) => {
    await fulfillJson(route, 200, [])
  })

  await context.route('http://fixture.supabase.test/rest/v1/platform_feedback_votes**', async (route) => {
    await fulfillJson(route, 200, [])
  })

  await context.route(`${baseUrl}/.netlify/functions/platform-admin-access`, async (route) => {
    await fulfillJson(route, 200, {
      success: role === 'super_admin',
      hasPlatformAdminAccess: role === 'super_admin',
      user: {
        ...fixtureProfile(role),
        displayName: 'Platform Fixture',
        clubId: '',
        clubName: 'Platform',
        clubOptions: [],
      },
    })
  })

  await context.route(`${baseUrl}/.netlify/functions/platform-feedback-reports`, async (route) => {
    requests.reports.push({ method: route.request().method(), headers: route.request().headers() })
    await fulfillJson(route, role === 'super_admin' ? 200 : 403, role === 'super_admin'
      ? { success: true, reports: [currentReport], stats: { total: 1, open: 1, production: 1, highSeverity: 0 } }
      : { success: false, code: 'forbidden', message: 'Only platform admins can load feedback reports.' })
  })

  await context.route(`${baseUrl}/.netlify/functions/platform-feedback-report-update`, async (route) => {
    const body = route.request().postDataJSON()
    requests.updates.push({ method: route.request().method(), headers: route.request().headers(), body })

    if (role !== 'super_admin') {
      await fulfillJson(route, 403, { success: false, code: 'forbidden', message: 'Only platform admins can update issue reports.' })
      return
    }

    currentReport = fixtureIssueReport(body.action === 'closed' ? 'fixed' : 'triaged')
    await fulfillJson(route, 200, { success: true, report: currentReport })
  })

  const page = await context.newPage()

  return { context, page, requests }
}

async function signIn(page) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/email/i).fill(fixtureEmail)
  await page.getByLabel(/password/i).fill('FixturePass123!')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/$/, { timeout: 15000 })
}

let server
let browser

try {
  server = startDevServer()

  if (server) {
    await waitForPort('127.0.0.1', port)
  }

  browser = await chromium.launch()

  {
    const { context, page, requests } = await prepareContext(browser)
    await signIn(page)
    await page.goto(`${baseUrl}/platform-feedback`, { waitUntil: 'domcontentloaded' })

    await assert.doesNotReject(() => page.getByText('Production Report Issue submissions').waitFor({ timeout: 15000 }))
    await assert.doesNotReject(() => page.getByText(fixtureReportId).waitFor({ timeout: 15000 }))
    assert.equal(await page.getByText('No feedback has been submitted yet.').count(), 0)
    assert.equal(await page.getByText('No product ideas have been submitted yet.').count() > 0, true)
    assert.equal(requests.reports.length, 1)

    const issuePanelBackground = await page.locator('section[aria-labelledby="issue-reports-heading"]').evaluate((element) => getComputedStyle(element).backgroundColor)
    assert.notEqual(issuePanelBackground, 'rgb(255, 255, 255)')

    await page.getByRole('button', { name: /mark reviewed/i }).click()
    await assert.doesNotReject(() => page.getByText('Reviewed').waitFor({ timeout: 15000 }))
    assert.equal(requests.updates[0].body.action, 'reviewed')

    await context.close()
  }

  {
    const { context, page, requests } = await prepareContext(browser, { role: 'coach' })
    await signIn(page)
    await page.goto(`${baseUrl}/platform-feedback`, { waitUntil: 'domcontentloaded' })

    assert.equal(await page.getByText('Production Report Issue submissions').count(), 0)
    assert.equal(requests.updates.length, 0)

    await context.close()
  }
} finally {
  if (browser) {
    await browser.close()
  }

  await stopDevServer(server)
}
