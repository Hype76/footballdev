import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium } from 'playwright'

const fixturePassword = 'FixturePass123!'
const port = Number(process.env.PARENT_RESULTS_BROWSER_PORT || 5100 + Math.floor(Math.random() * 300))
const mainBaseUrl = `http://127.0.0.1:${port}`
const parentBaseUrl = `http://parent.footballplayer.online:${port}`

const matchRows = [
  {
    id: 'oldest-result',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    team_name: 'U12 Fixture Team',
    opponent: 'Oldest Opponent',
    match_date: '2026-05-10',
    kickoff_time: '11:00',
    home_away: 'home',
    home_score: 1,
    away_score: 0,
    parent_visible: true,
    parent_audience: 'all_team_parents',
    status: 'full_time',
    created_at: '2026-07-20T12:00:00Z',
  },
  {
    id: 'same-day-morning',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    team_name: 'U12 Fixture Team',
    opponent: 'Morning Opponent',
    match_date: '2026-07-10',
    kickoff_time: '09:00',
    home_away: 'home',
    home_score: 2,
    away_score: 1,
    parent_visible: true,
    parent_audience: 'all_team_parents',
    status: 'full_time',
    created_at: '2026-07-20T12:00:00Z',
  },
  {
    id: 'undated-result',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    team_name: 'U12 Fixture Team',
    opponent: 'Undated Opponent',
    match_date: null,
    kickoff_time: null,
    home_away: 'home',
    home_score: 0,
    away_score: 0,
    parent_visible: true,
    parent_audience: 'all_team_parents',
    status: 'full_time',
    concluded_at: '2026-07-12T12:00:00Z',
    created_at: '2026-07-12T12:00:00Z',
  },
  {
    id: 'same-day-evening',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    team_name: 'U12 Fixture Team',
    opponent: 'Newest Opponent',
    match_date: '2026-07-10',
    kickoff_time: '18:00',
    home_away: 'home',
    home_score: 4,
    away_score: 2,
    parent_visible: true,
    parent_audience: 'all_team_parents',
    status: 'full_time',
    created_at: '2026-06-01T12:00:00Z',
  },
  {
    id: 'invalid-date-result',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    team_name: 'U12 Fixture Team',
    opponent: 'Invalid Date Opponent',
    match_date: 'invalid-date',
    kickoff_time: null,
    home_away: 'home',
    home_score: 3,
    away_score: 3,
    parent_visible: true,
    parent_audience: 'all_team_parents',
    status: 'full_time',
    concluded_at: '2026-07-13T12:00:00Z',
    created_at: '2026-07-13T12:00:00Z',
  },
]

const expectedOrder = [
  'U12 Fixture Team v Newest Opponent',
  'U12 Fixture Team v Morning Opponent',
  'U12 Fixture Team v Oldest Opponent',
  'U12 Fixture Team v Invalid Date Opponent',
  'U12 Fixture Team v Undated Opponent',
]

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPort(timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const connected = await new Promise((resolve) => {
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

    if (connected) {
      return
    }

    await wait(200)
  }

  throw new Error(`Timed out waiting for local Vite port ${port}`)
}

function startDevServer() {
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run dev -- --host 0.0.0.0 --port ${port} --strictPort`], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BROWSER: 'none',
      VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
      VITE_APP_URL: mainBaseUrl,
      VITE_PARENT_APP_URL: parentBaseUrl,
      VITE_SUPABASE_URL: 'http://fixture.supabase.test',
      VITE_SUPABASE_ANON_KEY: 'fixture-anon-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })

  return { child, getOutput: () => output }
}

async function stopDevServer(server) {
  if (server.child.exitCode !== null) {
    return
  }

  if (process.platform === 'win32') {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`], { stdio: 'ignore' })
  } else {
    server.child.kill()
  }

  await Promise.race([once(server.child, 'exit'), wait(3000)])
}

async function preparePage(context) {
  await context.route('**/rest/v1/**', (route) => {
    const requestUrl = route.request().url()
    const data = requestUrl.includes('/rpc/get_parent_portal_match_days') ? matchRows : []
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    })
  })
  await context.route('**/auth/v1/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }))
  await context.route('**/.netlify/functions/**', (route) => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ success: false, message: 'Fixture function stub.' }),
  }))

  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  return { page, consoleErrors, pageErrors }
}

async function signInAndOpenResults(page, baseUrl) {
  await page.goto(`${baseUrl}/sign-in?tab=parent`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByPlaceholder('you@club.com').fill('parent.fixture@footballplayer.test')
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL('**/parent-portal', { timeout: 15000 })
  await page.goto(`${baseUrl}/parent-portal?section=results`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('heading', { name: 'Shared results' }).waitFor({ state: 'visible', timeout: 15000 })
  await page.getByRole('heading', { name: expectedOrder[0] }).waitFor({ state: 'visible', timeout: 15000 })
}

async function getResultOrder(page) {
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Shared results' }) })
  return panel.locator('button h4').allTextContents()
}

async function verifyResults(page, baseUrl) {
  assert.deepEqual(await getResultOrder(page), expectedOrder)
  assert.equal(await page.getByText('Invalid Date', { exact: true }).count(), 0)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)

  await page.getByRole('heading', { name: expectedOrder[0] }).click()
  const dialog = page.getByRole('dialog', { name: 'Previous game details' })
  await dialog.waitFor({ state: 'visible' })
  await dialog.getByText('4 - 2', { exact: true }).first().waitFor({ state: 'visible' })
  await dialog.getByRole('button', { name: 'Close' }).click()

  await page.goto(`${baseUrl}/parent-portal?section=calendar`, { waitUntil: 'domcontentloaded' })
  await page.goto(`${baseUrl}/parent-portal?section=results`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: expectedOrder[0] }).waitFor({ state: 'visible' })
  assert.deepEqual(await getResultOrder(page), expectedOrder)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: expectedOrder[0] }).waitFor({ state: 'visible' })
  assert.deepEqual(await getResultOrder(page), expectedOrder)
}

const server = startDevServer()
let browser

try {
  await waitForPort()
  browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP parent.footballplayer.online 127.0.0.1'],
  })

  const scenarios = [
    { label: 'main desktop', baseUrl: mainBaseUrl, contextOptions: { viewport: { width: 1440, height: 1000 } } },
    { label: 'parent desktop', baseUrl: parentBaseUrl, contextOptions: { viewport: { width: 1440, height: 1000 } } },
    { label: 'main mobile', baseUrl: mainBaseUrl, contextOptions: { isMobile: true, viewport: { width: 390, height: 844 } } },
    { label: 'parent mobile', baseUrl: parentBaseUrl, contextOptions: { isMobile: true, viewport: { width: 390, height: 844 } } },
  ]

  for (const scenario of scenarios) {
    const context = await browser.newContext(scenario.contextOptions)
    const fixture = await preparePage(context)
    await signInAndOpenResults(fixture.page, scenario.baseUrl)
    await verifyResults(fixture.page, scenario.baseUrl)
    assert.deepEqual(fixture.pageErrors, [], `${scenario.label} page errors`)
    assert.deepEqual(fixture.consoleErrors, [], `${scenario.label} console errors`)
    await context.close()
  }

  console.log('Parent Results browser checks passed on main and parent hosts at desktop and mobile viewports.')
} catch (error) {
  console.error(server.getOutput())
  throw error
} finally {
  if (browser) {
    await browser.close()
  }
  await stopDevServer(server)
}
