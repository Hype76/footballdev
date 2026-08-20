import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium } from 'playwright'

const port = 5350 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const fixtureEmail = 'platform.billing.fixture@footballplayer.test'
const fixturePassword = 'FixturePass123!'
const fixtureUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForPort(timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const isOpen = await new Promise((resolve) => {
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

    if (isOpen) {
      return
    }

    await wait(100)
  }

  throw new Error(`Timed out waiting for 127.0.0.1:${port}`)
}

function startServer() {
  const isWindows = process.platform === 'win32'
  const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm'
  const args = isWindows
    ? ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`]
    : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
  const child = spawn(
    command,
    args,
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSER: 'none',
        VITE_APP_URL: baseUrl,
        VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable-key',
        VITE_SUPABASE_URL: 'http://fixture.supabase.test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
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

  await Promise.race([
    once(server.child, 'exit'),
    wait(3000),
  ])
}

async function fulfillJson(route, status, payload) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-allow-origin': '*',
    },
    body: status === 204 ? '' : JSON.stringify(payload),
  })
}

function fixtureUser() {
  return {
    id: fixtureUserId,
    aud: 'authenticated',
    role: 'authenticated',
    email: fixtureEmail,
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-07-28T10:00:00.000Z',
    updated_at: '2026-07-28T10:00:00.000Z',
  }
}

function fixtureProfile() {
  return {
    id: fixtureUserId,
    email: fixtureEmail,
    username: 'Platform Billing Fixture',
    name: 'Platform Billing Fixture',
    display_name: 'Platform Billing Fixture',
    role: 'super_admin',
    role_label: 'Super Admin',
    role_rank: 100,
    club_id: null,
    status: 'active',
    suspended_at: null,
  }
}

async function prepareContext(browser, { couponFailure = false, viewport }) {
  const context = await browser.newContext({ viewport })
  const requestCounts = {
    coupons: 0,
    testerCodes: 0,
    unexpectedFunctions: [],
  }
  const consoleErrors = []
  const pageErrors = []

  await context.route('**/.netlify/functions/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname

    if (pathname.endsWith('/platform-admin-access')) {
      await fulfillJson(route, 200, {
        success: true,
        hasPlatformAdminAccess: true,
        platformAdmin: {
          id: fixtureUserId,
          email: fixtureEmail,
          name: 'Platform Billing Fixture',
        },
        user: {
          ...fixtureProfile(),
          displayName: 'Platform Billing Fixture',
          accountStatus: 'active',
          clubId: '',
          clubName: 'Platform',
          clubOptions: [],
          parentPortalLinks: [],
        },
      })
      return
    }

    if (pathname.endsWith('/manage-stripe-coupons')) {
      requestCounts.coupons += 1

      if (couponFailure) {
        await fulfillJson(route, 503, {
          success: false,
          message: 'Stripe coupon data is temporarily unavailable.',
        })
        return
      }

      await fulfillJson(route, 200, {
        success: true,
        coupons: [{
          id: 'coupon_fixture',
          name: 'Fixture launch offer',
          percentOff: 20,
          amountOff: null,
          currency: null,
          duration: 'once',
          durationInMonths: null,
          redeemBy: null,
          valid: true,
          code: 'FIXTURE20',
          promotionCodeId: 'promo_fixture',
          expiresAt: null,
          firstTimeOnly: true,
          liveOnWebsite: false,
          active: true,
          createdAt: '2026-07-28T10:00:00.000Z',
        }],
      })
      return
    }

    if (pathname.endsWith('/manage-tester-access-codes')) {
      requestCounts.testerCodes += 1
      await fulfillJson(route, 200, {
        success: true,
        codes: [{
          id: 'tester_fixture',
          code: 'BILLING-FIXTURE',
          label: 'Billing fixture tester',
          planKey: 'small_club',
          assignedEmail: fixtureEmail,
          redeemedCount: 0,
          maxUses: 2,
          expiresAt: '2026-08-28T10:00:00.000Z',
          isActive: true,
          createdAt: '2026-07-28T10:00:00.000Z',
        }],
      })
      return
    }

    if (pathname.endsWith('/platform-analytics') && request.method() === 'POST') {
      await fulfillJson(route, 202, {
        success: true,
        accepted: true,
      })
      return
    }

    requestCounts.unexpectedFunctions.push(`${request.method()} ${pathname}`)
    await fulfillJson(route, 404, {
      success: false,
      message: 'Unexpected fixture function call.',
    })
  })

  await context.route('**/auth/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, 204, {})
      return
    }

    await fulfillJson(route, 200, {
      access_token: `fixture-token-${fixtureEmail}`,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'fixture-refresh-token',
      user: fixtureUser(),
    })
  })

  await context.route('**/rest/v1/**', async (route) => {
    const request = route.request()

    if (request.method() === 'OPTIONS') {
      await fulfillJson(route, 204, {})
      return
    }

    const url = new URL(request.url())
    const tableName = url.pathname.split('/rest/v1/')[1]?.split('/')[0] || ''

    if (tableName === 'users' && url.searchParams.get('id')?.startsWith('eq.')) {
      await fulfillJson(route, 200, fixtureProfile())
      return
    }

    await fulfillJson(route, 200, [])
  })

  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
  })

  return {
    consoleErrors,
    context,
    page,
    pageErrors,
    requestCounts,
  }
}

async function signInAndOpenBilling(page) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill(fixtureEmail)
  await page.getByLabel('Password').fill(fixturePassword)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL('**/platform-admin', { timeout: 15000 })
  await page.goto(`${baseUrl}/platform-billing-options`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Billing options', exact: true }).waitFor({
    state: 'visible',
    timeout: 15000,
  })
}

async function runLoadedScenario(browser, label, viewport) {
  const testContext = await prepareContext(browser, { viewport })

  try {
    await signInAndOpenBilling(testContext.page)
    await testContext.page.getByText('Fixture launch offer', { exact: true }).waitFor({ state: 'visible' })
    await testContext.page.getByText('Billing fixture tester', { exact: true }).waitFor({ state: 'visible' })
    await testContext.page.getByText('Billing data loaded', { exact: true }).waitFor({ state: 'visible' })
    assert.equal(testContext.requestCounts.coupons, 1, `${label} makes one coupon request`)
    assert.equal(testContext.requestCounts.testerCodes, 1, `${label} makes one tester-code request`)
    assert.equal(
      await testContext.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      `${label} has no page overflow`,
    )
    assert.deepEqual(testContext.pageErrors, [])
    assert.deepEqual(testContext.consoleErrors, [], JSON.stringify(testContext.requestCounts.unexpectedFunctions))
  } finally {
    await testContext.context.close()
  }
}

const server = startServer()
let browser

try {
  await waitForPort()
  browser = await chromium.launch()

  await runLoadedScenario(browser, 'desktop', { width: 1440, height: 900 })
  console.log('ok desktop Billing Options loads Stripe and tester data once')

  await runLoadedScenario(browser, 'mobile', { width: 390, height: 844 })
  console.log('ok mobile Billing Options loads without overflow')

  const partialContext = await prepareContext(browser, {
    couponFailure: true,
    viewport: { width: 1440, height: 900 },
  })

  try {
    await signInAndOpenBilling(partialContext.page)
    await partialContext.page.getByText('Billing fixture tester', { exact: true }).waitFor({ state: 'visible' })
    await partialContext.page.getByText('Platform access data loaded', { exact: true }).waitFor({ state: 'visible' })
    await partialContext.page.getByText(
      'Stripe coupon data is unavailable. Platform Admin access remains available.',
      { exact: true },
    ).waitFor({ state: 'visible' })
    await partialContext.page.getByText('Stripe coupon data unavailable', { exact: true }).waitFor({
      state: 'visible',
    })
    assert.equal(partialContext.requestCounts.coupons, 1)
    assert.equal(partialContext.requestCounts.testerCodes, 1)
    assert.deepEqual(partialContext.pageErrors, [])
  } finally {
    await partialContext.context.close()
  }

  console.log('ok Stripe failure keeps tester and Platform Admin partial state truthful')
} catch (error) {
  console.error(server.getOutput())
  throw error
} finally {
  if (browser) {
    await browser.close()
  }
  await stopServer(server)
}
