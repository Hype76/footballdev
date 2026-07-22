import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium } from 'playwright'

const fixturePassword = 'FixturePass123!'
const port = Number(process.env.MATCHDAY_SCORER_BROWSER_PORT || 4800 + Math.floor(Math.random() * 300))
const mainBaseUrl = `http://127.0.0.1:${port}`
const parentBaseUrl = mainBaseUrl

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPort(host, portValue, timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port: portValue })
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

  throw new Error(`Timed out waiting for ${host}:${portValue}`)
}

function startDevServer() {
  const env = {
    ...process.env,
    BROWSER: 'none',
    VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
    VITE_APP_URL: mainBaseUrl,
    VITE_PARENT_APP_URL: parentBaseUrl,
    VITE_SUPABASE_URL: 'http://fixture.supabase.test',
    VITE_SUPABASE_ANON_KEY: 'fixture-anon-key',
  }
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run dev -- --host 0.0.0.0 --port ${port} --strictPort`], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { child, getOutput: () => output }
}

async function stopDevServer(server) {
  if (!server?.child || server.child.exitCode !== null) {
    return
  }

  if (process.platform === 'win32') {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`], { stdio: 'ignore' })
  } else {
    server.child.kill()
  }

  await Promise.race([once(server.child, 'exit'), wait(3000)])
}

function createMatchFixture({ isScorer = false } = {}) {
  return {
    id: 'match-parity-fixture',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    team_name: 'U12 Fixture Team',
    teams: { name: 'U12 Fixture Team' },
    opponent: 'Parity United',
    fixture_type: 'league',
    match_date: '2026-07-22',
    kickoff_time: '18:00:00',
    kickoff_time_tbc: false,
    arrival_time: '17:30:00',
    home_away: 'home',
    venue_name: 'Fixture Ground',
    venue_address: '1 Fixture Way',
    notes: '',
    scorer_request_message: 'Scorer requested',
    request_scorer: true,
    request_linesman: false,
    request_referee: false,
    parent_visible: true,
    parent_audience: 'involved_players',
    status: 'scheduled',
    home_score: 0,
    away_score: 0,
    phase_started_at: null,
    timer_started_at: null,
    timer_paused_at: null,
    timer_elapsed_seconds: 0,
    timer_status: 'not_started',
    full_time_resume_status: null,
    concluded_at: null,
    concluded_by: null,
    created_at: '2026-07-22T08:00:00Z',
    updated_at: '2026-07-22T08:00:00Z',
    availability_status: 'available',
    squad_decision_state: 'selected',
    volunteer_scorer_response: 'yes',
    volunteer_linesman_response: 'no_response',
    volunteer_referee_response: 'no_response',
    has_interest: true,
    is_scorer: isScorer,
    role_assignments: isScorer
      ? [{ role: 'scorer', parentLinkId: 'parent-link-fixture', isCurrentParent: true }]
      : [],
    events: [],
    match_day_scorer_interest: [],
    match_day_scorer_assignments: [],
    match_day_role_assignments: [],
    match_day_player_availability: [],
    match_day_player_squad_decisions: [],
    match_day_player_availability_history: [],
    match_day_availability_requests: [],
    match_day_event_log: [],
    match_day_events: [],
    match_day_final_reports: [],
  }
}

async function prepareContext(browser, viewportOptions, { isScorer = false } = {}) {
  const context = await browser.newContext(viewportOptions)
  const fixtureState = { match: createMatchFixture({ isScorer }) }
  const mutationRequests = []
  const consoleErrors = []

  await context.route('**/.netlify/functions/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
  })
  await context.route('**/auth/v1/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await context.route('**/rest/v1/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await context.route('**/rest/v1/match_days?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/1' },
      body: JSON.stringify([fixtureState.match]),
    })
  })
  await context.route('**/rest/v1/rpc/get_parent_portal_match_days', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([fixtureState.match]) })
  })
  await context.route('**/rest/v1/rpc/get_parent_portal_match_day_players', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'player-fixture', player_name: 'Fixture Child', shirt_number: '9', status: 'active' }]),
    })
  })
  await context.route('**/rest/v1/rpc/set_match_day_timer_state', async (route) => {
    const payload = route.request().postDataJSON()
    mutationRequests.push({ rpc: 'set_match_day_timer_state', payload })

    if (payload.action_value === 'start') {
      fixtureState.match = {
        ...fixtureState.match,
        status: 'live',
        timer_status: 'running',
        timer_started_at: '2026-07-22T10:00:00Z',
        phase_started_at: '2026-07-22T10:00:00Z',
      }
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        matchDayId: fixtureState.match.id,
        status: fixtureState.match.status,
        timerStatus: fixtureState.match.timer_status,
        timerStartedAt: fixtureState.match.timer_started_at,
        timerElapsedSeconds: fixtureState.match.timer_elapsed_seconds,
      }),
    })
  })
  await context.route('**/rest/v1/rpc/update_match_day_score_as_scorer', async (route) => {
    mutationRequests.push({ rpc: 'update_match_day_score_as_scorer', payload: route.request().postDataJSON() })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify('score-event-fixture') })
  })
  await context.route('**/rest/v1/rpc/add_match_day_goal_as_scorer', async (route) => {
    mutationRequests.push({ rpc: 'add_match_day_goal_as_scorer', payload: route.request().postDataJSON() })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify('goal-event-fixture') })
  })

  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  return { context, consoleErrors, fixtureState, mutationRequests, page }
}

async function signIn(page, { parent = false } = {}) {
  const baseUrl = parent ? parentBaseUrl : mainBaseUrl
  await page.goto(`${baseUrl}/sign-in${parent ? '?tab=parent' : ''}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByPlaceholder('you@club.com').waitFor({ state: 'visible', timeout: 30000 })
  await page.getByRole('button', { name: parent ? 'Parent' : 'Club' }).click()
  await page.getByPlaceholder('you@club.com').fill(parent ? 'parent.fixture@footballplayer.test' : 'coach.fixture@footballplayer.test')
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL(parent ? '**/parent-portal' : '**/coach', { timeout: 30000 })
}

async function openParentMatches(page) {
  await page.goto(`${parentBaseUrl}/parent-portal?section=matches`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('heading', { name: 'Match cards' }).waitFor({ state: 'visible', timeout: 30000 })
}

async function verifyBackgroundForeground(page, context) {
  const backgroundPage = await context.newPage()
  await backgroundPage.goto('about:blank')
  await backgroundPage.bringToFront()
  await page.bringToFront()
  await backgroundPage.close()
}

const viewports = [
  { name: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
  { name: 'mobile', options: { isMobile: true, viewport: { width: 390, height: 844 } } },
]

const server = startDevServer()
let browser

try {
  await waitForPort('127.0.0.1', port)
  browser = await chromium.launch({ headless: true })

  for (const viewport of viewports) {
    const staff = await prepareContext(browser, viewport.options)
    await signIn(staff.page)
    await staff.page.goto(`${mainBaseUrl}/match-day`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    const staffManageButton = staff.page.locator('button:visible').filter({ hasText: /^(Manage|Manage fixture)$/ }).first()
    await staffManageButton.waitFor({ state: 'visible', timeout: 30000 })
    await staffManageButton.click()
    const staffOpenButton = staff.page.getByRole('button', { name: /Start Game Mode|Open Game Mode/ }).first()
    await staffOpenButton.click()
    await staff.page.getByRole('region', { name: 'Game Mode cockpit' }).waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(staff.mutationRequests.length, 0, `${viewport.name} staff Game Mode open must not mutate`)
    await verifyBackgroundForeground(staff.page, staff.context)
    await staff.page.reload({ waitUntil: 'domcontentloaded' })
    await staff.page.locator('button:visible').filter({ hasText: /^(Manage|Manage fixture)$/ }).first().waitFor({ state: 'visible', timeout: 30000 })
    assert.equal(await staff.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    assert.deepEqual(staff.consoleErrors, [])
    await staff.context.close()

    const scorer = await prepareContext(browser, viewport.options, { isScorer: true })
    await signIn(scorer.page, { parent: true })
    await openParentMatches(scorer.page)
    await scorer.page.getByRole('button', { name: 'Open Game Mode' }).click()
    await scorer.page.getByText('Authoritative match clock', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await scorer.page.getByText('0:00', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(scorer.mutationRequests.length, 0, `${viewport.name} parent scorer Game Mode open must not mutate`)

    await scorer.page.getByRole('button', { name: 'Start match' }).click()
    await scorer.page.getByRole('dialog').getByRole('button', { name: 'Start match' }).click()
    await scorer.page.getByRole('button', { name: 'Pause' }).waitFor({ state: 'visible', timeout: 15000 })
    assert.deepEqual(scorer.mutationRequests, [{
      rpc: 'set_match_day_timer_state',
      payload: { match_day_id_value: 'match-parity-fixture', action_value: 'start' },
    }])

    await verifyBackgroundForeground(scorer.page, scorer.context)
    await scorer.page.reload({ waitUntil: 'domcontentloaded' })
    await scorer.page.getByRole('button', { name: 'Open Game Mode' }).waitFor({ state: 'visible', timeout: 30000 })
    await scorer.page.getByRole('button', { name: 'Open Game Mode' }).click()
    await scorer.page.getByRole('button', { name: 'Pause' }).waitFor({ state: 'visible', timeout: 15000 })

    scorer.fixtureState.match = { ...scorer.fixtureState.match, is_scorer: false, role_assignments: [] }
    await scorer.page.reload({ waitUntil: 'domcontentloaded' })
    await scorer.page.getByRole('heading', { name: 'Match cards' }).waitFor({ state: 'visible', timeout: 30000 })
    assert.equal(await scorer.page.getByRole('button', { name: 'Open Game Mode' }).count(), 0)
    assert.equal(await scorer.page.getByText('Update score', { exact: true }).count(), 0)
    assert.equal(await scorer.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    assert.deepEqual(scorer.consoleErrors, [])
    await scorer.context.close()

    const ordinary = await prepareContext(browser, viewport.options, { isScorer: false })
    await signIn(ordinary.page, { parent: true })
    await openParentMatches(ordinary.page)
    assert.equal(await ordinary.page.getByRole('button', { name: 'Open Game Mode' }).count(), 0)
    assert.equal(await ordinary.page.getByText('Update score', { exact: true }).count(), 0)
    assert.equal(ordinary.mutationRequests.length, 0)
    assert.equal(await ordinary.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    assert.deepEqual(ordinary.consoleErrors, [])
    await ordinary.context.close()

    process.stdout.write(`PASS ${viewport.name}: staff, accepted scorer, ordinary parent, refresh, background, revocation, no console errors\n`)
  }
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`)
  process.stderr.write(server.getOutput())
  process.exitCode = 1
} finally {
  await browser?.close()
  await stopDevServer(server)
}
