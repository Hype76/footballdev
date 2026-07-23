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

function createMatchFixture({ isLive = false, isScorer = false } = {}) {
  return {
    id: 'match-parity-fixture',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    team_name: 'U12 Fixture Team',
    teams: { name: 'U12 Fixture Team' },
    opponent: 'Parity United',
    fixture_type: 'league',
    match_date: '2026-07-23',
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
    status: isLive ? 'live' : 'scheduled',
    match_conclusion_rule: 'extra_time_then_penalties',
    current_match_phase: isLive ? 'first_half' : 'pre_match',
    extra_time_period_count: 2,
    extra_time_half_minutes: 15,
    home_shootout_score: 0,
    away_shootout_score: 0,
    shootout_winner: null,
    home_score: 0,
    away_score: 0,
    phase_started_at: isLive ? '2026-07-22T10:00:00Z' : null,
    timer_started_at: isLive ? '2026-07-22T10:00:00Z' : null,
    timer_paused_at: null,
    timer_elapsed_seconds: 0,
    timer_status: isLive ? 'running' : 'not_started',
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

async function prepareContext(browser, viewportOptions, {
  authRestoreDelayMs = 0,
  clockDelayMs = 0,
  clockFailureCount = 0,
  fixtureDelayMs = 0,
  fixtureFailureCount = 0,
  fixtureNullCount = 0,
  isLive = false,
  isScorer = false,
  matchOverrides = {},
  parentRouteDelayMs = 0,
  platformAdminFails = false,
} = {}) {
  const context = await browser.newContext(viewportOptions)
  const fixtureState = { match: { ...createMatchFixture({ isLive, isScorer }), ...matchOverrides } }
  const mutationRequests = []
  const consoleErrors = []
  const pageErrors = []
  const resourceFailures = []
  let remainingClockFailures = clockFailureCount
  let remainingFixtureFailures = fixtureFailureCount
  let remainingFixtureNulls = fixtureNullCount

  await context.route('**/src/lib/auth-access-browser-fixtures.js*', async (route) => {
    if (authRestoreDelayMs > 0) {
      await wait(authRestoreDelayMs)
    }

    await route.continue()
  })
  await context.route('**/src/pages/ParentPortalPage.jsx*', async (route) => {
    if (parentRouteDelayMs > 0) {
      await wait(parentRouteDelayMs)
    }

    await route.continue()
  })

  await context.route('**/.netlify/functions/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
  })
  await context.route('**/.netlify/functions/platform-admin-access**', async (route) => {
    await route.fulfill({
      status: platformAdminFails ? 503 : 200,
      contentType: 'application/json',
      body: JSON.stringify(platformAdminFails ? { error: 'Unavailable' } : { authorized: false }),
    })
  })
  await context.route('**/?match-timer-sync=*', async (route) => {
    if (clockDelayMs > 0) {
      await wait(clockDelayMs)
    }

    if (remainingClockFailures > 0) {
      remainingClockFailures -= 1
      await route.fulfill({ status: 503, contentType: 'text/plain', body: '' })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      headers: { date: 'Wed, 22 Jul 2026 10:00:30 GMT' },
      body: '',
    })
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
    if (fixtureDelayMs > 0) {
      await wait(fixtureDelayMs)
    }

    if (remainingFixtureFailures > 0) {
      remainingFixtureFailures -= 1
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Unavailable' }) })
      return
    }

    if (remainingFixtureNulls > 0) {
      remainingFixtureNulls -= 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      return
    }

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
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText || 'failed'

    if (errorText !== 'net::ERR_ABORTED' && ['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      resourceFailures.push(`${request.resourceType()}: ${request.url()} ${errorText}`)
    }
  })
  page.on('response', (response) => {
    if (response.status() >= 400 && ['document', 'script', 'stylesheet'].includes(response.request().resourceType())) {
      resourceFailures.push(`${response.request().resourceType()}: ${response.url()} ${response.status()}`)
    }
  })

  return { context, consoleErrors, fixtureState, mutationRequests, page, pageErrors, resourceFailures }
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

async function verifyWakeLockControl(page, mutationRequests) {
  const control = page.getByRole('region', { name: 'Screen awake control' })
  const checkbox = control.getByRole('checkbox')
  await checkbox.waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(await checkbox.isChecked(), false)
  const mutationCount = mutationRequests.length
  await checkbox.click()
  const settledStatus = control.getByText(/Screen awake is (active|not supported|unavailable)/)
  await settledStatus.waitFor({ state: 'visible', timeout: 15000 })
  assert.match(await settledStatus.innerText(), /Screen awake is (active|not supported|unavailable)/)
  assert.equal(mutationRequests.length, mutationCount)
  await checkbox.click()
  assert.equal(await checkbox.isChecked(), false)
  assert.equal(mutationRequests.length, mutationCount)
}

async function verifyFixtureConclusionRules(page) {
  await page.getByRole('button', { name: 'Create fixture' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Create fixture' })
  const fixtureType = dialog.getByLabel('Fixture type')
  const conclusionRule = dialog.getByLabel('How this match can finish')
  await conclusionRule.waitFor({ state: 'visible', timeout: 15000 })

  for (const fixtureTypeValue of ['friendly', 'league', 'cup', 'tournament']) {
    await fixtureType.selectOption(fixtureTypeValue)
    assert.equal(await conclusionRule.isVisible(), true)
    assert.deepEqual(await conclusionRule.locator('option').evaluateAll((options) => options.map((option) => option.value)), [
      'normal_time',
      'extra_time',
      'extra_time_then_penalties',
      'straight_to_penalties',
    ])
  }

  await conclusionRule.selectOption('extra_time_then_penalties')
  await dialog.getByLabel('Extra-time periods').waitFor({ state: 'visible' })
  await dialog.getByLabel('Extra-time period length').waitFor({ state: 'visible' })
  await dialog.getByRole('button', { name: 'Cancel' }).click()
}

async function verifyExtendedPhaseRestoration(browser, viewport) {
  const phaseContext = await prepareContext(browser, viewport.options, {
    isLive: true,
    isScorer: true,
    matchOverrides: { status: 'second_half', current_match_phase: 'second_half' },
  })
  await signIn(phaseContext.page, { parent: true })

  const openPhase = async (phase, status, actionLabel) => {
    phaseContext.fixtureState.match = {
      ...phaseContext.fixtureState.match,
      current_match_phase: phase,
      status,
    }
    await openParentMatches(phaseContext.page)
    await phaseContext.page.getByRole('button', { name: 'Open Game Mode' }).click()
    await phaseContext.page.getByText(actionLabel, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await phaseContext.page.getByText('Cumulative clock, 2 x 15 extra-time minutes.', { exact: true }).waitFor({ state: 'visible' })
  }

  await openPhase('second_half', 'second_half', 'End normal time')
  for (const [phase, status, label] of [
    ['normal_time_complete', 'half_time', 'Start extra time'],
    ['extra_time_first_half', 'extra_time', 'Extra time half time'],
    ['extra_time_half_time', 'half_time', 'Start extra time second half'],
    ['extra_time_second_half', 'extra_time', 'End extra time'],
    ['extra_time_complete', 'half_time', 'Start penalty shootout'],
  ]) {
    await openPhase(phase, status, label)
  }
  await openPhase('penalties', 'penalties', 'Finish shootout')
  await phaseContext.page.getByText('Penalty shootout', { exact: true }).first().waitFor({ state: 'visible' })
  await phaseContext.page.getByRole('button', { name: 'Our team scored' }).waitFor({ state: 'visible' })
  await phaseContext.page.getByRole('region', { name: 'Penalty shootout controls' }).getByText('0 to 0', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(phaseContext.mutationRequests.length, 0)
  assert.deepEqual(phaseContext.consoleErrors, [])
  assertNoPageFailures(phaseContext, `${viewport.name} extended phase restoration`)
  await phaseContext.context.close()
}

function assertNoPageFailures(session, label) {
  assert.deepEqual(session.pageErrors, [], `${label} must have zero page exceptions`)
  assert.deepEqual(session.resourceFailures, [], `${label} must have zero document, script, or stylesheet failures`)
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
    const setup = await prepareContext(browser, viewport.options)
    await signIn(setup.page)
    await setup.page.goto(`${mainBaseUrl}/match-day`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await verifyFixtureConclusionRules(setup.page)
    assert.equal(setup.mutationRequests.length, 0, `${viewport.name} fixture rule inspection must not mutate`)
    assertNoPageFailures(setup, `${viewport.name} fixture rules`)
    await setup.context.close()

    const staff = await prepareContext(browser, viewport.options)
    await signIn(staff.page)
    await staff.page.goto(`${mainBaseUrl}/match-day`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    const staffManageButton = staff.page.locator('button:visible').filter({ hasText: /^(Manage|Manage fixture)$/ }).first()
    await staffManageButton.waitFor({ state: 'visible', timeout: 30000 })
    await staffManageButton.click()
    const staffOpenButton = staff.page.getByRole('button', { name: /Start Game Mode|Open Game Mode/ }).first()
    await staffOpenButton.click()
    await staff.page.getByRole('region', { name: 'Game Mode cockpit' }).waitFor({ state: 'visible', timeout: 15000 })
    await verifyWakeLockControl(staff.page, staff.mutationRequests)
    assert.equal(staff.mutationRequests.length, 0, `${viewport.name} staff Game Mode open must not mutate`)
    await verifyBackgroundForeground(staff.page, staff.context)
    await staff.page.reload({ waitUntil: 'domcontentloaded' })
    await staff.page.locator('button:visible').filter({ hasText: /^(Manage|Manage fixture)$/ }).first().waitFor({ state: 'visible', timeout: 30000 })
    assert.equal(await staff.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    assert.deepEqual(staff.consoleErrors, [])
    assertNoPageFailures(staff, `${viewport.name} staff`)
    await staff.context.close()

    const scorer = await prepareContext(browser, viewport.options, { isScorer: true })
    await signIn(scorer.page, { parent: true })
    await openParentMatches(scorer.page)
    await scorer.page.getByRole('button', { name: 'Open Game Mode' }).click()
    await scorer.page.getByText('Authoritative match clock', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await scorer.page.getByText('0:00', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await verifyWakeLockControl(scorer.page, scorer.mutationRequests)
    const penaltyGoalToggle = scorer.page.getByText('Penalty goal', { exact: true }).locator('..').getByRole('checkbox')
    assert.equal(await penaltyGoalToggle.isChecked(), false)
    await penaltyGoalToggle.check()
    assert.equal(await penaltyGoalToggle.isChecked(), true)
    await penaltyGoalToggle.uncheck()
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
    assertNoPageFailures(scorer, `${viewport.name} accepted scorer`)
    await scorer.context.close()

    const ordinary = await prepareContext(browser, viewport.options, { isScorer: false })
    await signIn(ordinary.page, { parent: true })
    await openParentMatches(ordinary.page)
    assert.equal(await ordinary.page.getByRole('button', { name: 'Open Game Mode' }).count(), 0)
    assert.equal(await ordinary.page.getByText('Update score', { exact: true }).count(), 0)
    assert.equal(await ordinary.page.getByRole('region', { name: 'Screen awake control' }).count(), 0)
    assert.equal(ordinary.mutationRequests.length, 0)
    assert.equal(await ordinary.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    assert.deepEqual(ordinary.consoleErrors, [])
    assertNoPageFailures(ordinary, `${viewport.name} ordinary parent`)
    await ordinary.context.close()

    await verifyExtendedPhaseRestoration(browser, viewport)

    process.stdout.write(`PASS ${viewport.name}: staff, accepted scorer, ordinary parent, refresh, background, revocation, no console errors\n`)
  }

  const mobileOptions = { isMobile: true, viewport: { width: 390, height: 844 } }
  const stress = await prepareContext(browser, mobileOptions, {
    clockDelayMs: 1400,
    isLive: true,
  })
  await signIn(stress.page, { parent: true })
  await openParentMatches(stress.page)

  for (let cycle = 1; cycle <= 25; cycle += 1) {
    await stress.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
    await stress.page.getByRole('heading', { name: 'Match cards' }).waitFor({ state: 'visible', timeout: 30000 })
    await wait(1100)
    assertNoPageFailures(stress, `ordinary parent mobile refresh ${cycle} while clock is pending`)
    assert.equal(await stress.page.getByRole('button', { name: 'Open Game Mode' }).count(), 0)
    assert.equal(await stress.page.getByText('Update score', { exact: true }).count(), 0)
    await stress.page.getByText('1 min', { exact: true }).waitFor({ state: 'visible', timeout: 5000 })
    assert.equal(await stress.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  }

  await verifyBackgroundForeground(stress.page, stress.context)
  assert.equal(stress.mutationRequests.length, 0)
  assert.deepEqual(stress.consoleErrors, [])
  assertNoPageFailures(stress, 'ordinary parent mobile 25-refresh stress')
  await stress.context.close()
  process.stdout.write('PASS mobile stress: 25 delayed-clock hard refreshes, zero exceptions, zero mutations, no overflow\n')

  for (const scenario of [
    { label: 'fixture-first', clockDelayMs: 1400, fixtureDelayMs: 50 },
    { label: 'clock-first', clockDelayMs: 50, fixtureDelayMs: 1400 },
  ]) {
    const reordered = await prepareContext(browser, mobileOptions, { ...scenario, isLive: true })
    await signIn(reordered.page, { parent: true })
    await openParentMatches(reordered.page)
    await reordered.page.getByText('1 min', { exact: true }).waitFor({ state: 'visible', timeout: 5000 })
    assert.equal(reordered.mutationRequests.length, 0)
    assert.deepEqual(reordered.consoleErrors, [])
    assertNoPageFailures(reordered, `ordinary parent ${scenario.label}`)
    await reordered.context.close()
  }
  process.stdout.write('PASS response ordering: fixture-first and clock-first both render the authoritative minute safely\n')

  const clockRetry = await prepareContext(browser, mobileOptions, {
    clockFailureCount: 2,
    isLive: true,
    isScorer: true,
  })
  await signIn(clockRetry.page, { parent: true })
  await openParentMatches(clockRetry.page)
  await clockRetry.page.getByRole('button', { name: 'Open Game Mode' }).click()
  await clockRetry.page.getByText('Syncing clock...', { exact: true }).waitFor({ state: 'visible', timeout: 5000 })
  assert.equal(clockRetry.mutationRequests.length, 0)
  await clockRetry.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await clockRetry.page.getByRole('button', { name: 'Open Game Mode' }).waitFor({ state: 'visible', timeout: 30000 })
  await clockRetry.page.getByRole('button', { name: 'Open Game Mode' }).click()
  await clockRetry.page.getByText('0:30', { exact: true }).waitFor({ state: 'visible', timeout: 5000 })
  assert.equal(clockRetry.mutationRequests.length, 0)
  assertNoPageFailures(clockRetry, 'server-clock failure and refresh retry')
  await clockRetry.context.close()
  process.stdout.write('PASS server-clock retry: unavailable state is safe and refresh recovers to the authoritative time\n')

  for (const fixtureScenario of [
    { label: 'failed fixture response', fixtureFailureCount: 2 },
    { label: 'null fixture response', fixtureNullCount: 2 },
  ]) {
    const fixtureRetry = await prepareContext(browser, mobileOptions, fixtureScenario)
    await signIn(fixtureRetry.page, { parent: true })
    await openParentMatches(fixtureRetry.page)
    assert.equal(fixtureRetry.mutationRequests.length, 0)
    assertNoPageFailures(fixtureRetry, fixtureScenario.label)
    await fixtureRetry.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
    await fixtureRetry.page.getByRole('heading', { name: 'Match cards' }).waitFor({ state: 'visible', timeout: 30000 })
    await fixtureRetry.page.getByText('Parity United', { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 })
    assert.equal(fixtureRetry.mutationRequests.length, 0)
    assertNoPageFailures(fixtureRetry, `${fixtureScenario.label} retry`)
    await fixtureRetry.context.close()
  }
  process.stdout.write('PASS fixture retry: failed and null responses remain non-crashing and recover on refresh\n')

  const failClosed = await prepareContext(browser, mobileOptions, { platformAdminFails: true })
  await signIn(failClosed.page, { parent: true })
  await openParentMatches(failClosed.page)
  assert.equal(await failClosed.page.getByRole('button', { name: 'Open Game Mode' }).count(), 0)
  assert.equal(failClosed.mutationRequests.length, 0)
  assertNoPageFailures(failClosed, 'fail-closed platform-admin capability request')
  await failClosed.context.close()
  process.stdout.write('PASS capability failure: platform-admin request fails closed without a page exception or parent privilege\n')

  const cancelled = await prepareContext(browser, mobileOptions, {
    clockDelayMs: 1500,
    fixtureDelayMs: 1500,
    isLive: true,
  })
  await signIn(cancelled.page, { parent: true })
  await cancelled.page.goto(`${parentBaseUrl}/parent-portal?section=matches`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await cancelled.page.goto(`${parentBaseUrl}/sign-in?tab=parent`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await wait(1700)
  assert.equal(cancelled.mutationRequests.length, 0)
  assert.deepEqual(cancelled.pageErrors, [])
  await cancelled.context.close()
  process.stdout.write('PASS cancellation: route unmount before delayed clock and fixture completion causes no page exception or mutation\n')

  const restoration = await prepareContext(browser, mobileOptions, {
    authRestoreDelayMs: 900,
    clockDelayMs: 1100,
    fixtureDelayMs: 700,
    isLive: true,
    parentRouteDelayMs: 600,
  })
  await signIn(restoration.page, { parent: true })
  await openParentMatches(restoration.page)
  await restoration.page.getByText('1 min', { exact: true }).waitFor({ state: 'visible', timeout: 5000 })
  assert.equal(restoration.mutationRequests.length, 0)
  assert.deepEqual(restoration.consoleErrors, [])
  assertNoPageFailures(restoration, 'delayed auth, parent-link, route, fixture, and clock restoration')
  await restoration.context.close()
  process.stdout.write('PASS restoration ordering: delayed auth module, parent route, selected link, fixture, and clock recover safely\n')

  const rapid = await prepareContext(browser, mobileOptions, {
    clockDelayMs: 800,
    fixtureDelayMs: 800,
    isLive: true,
  })
  await signIn(rapid.page, { parent: true })
  await openParentMatches(rapid.page)
  for (let cycle = 0; cycle < 5; cycle += 1) {
    await rapid.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  }
  await rapid.page.getByRole('heading', { name: 'Match cards' }).waitFor({ state: 'visible', timeout: 30000 })
  await rapid.page.getByText('1 min', { exact: true }).waitFor({ state: 'visible', timeout: 5000 })
  assert.equal(rapid.mutationRequests.length, 0)
  assert.deepEqual(rapid.pageErrors, [])
  await rapid.context.close()
  process.stdout.write('PASS rapid refresh: five repeated refreshes during delayed restoration recover without exception or mutation\n')
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`)
  process.stderr.write(server.getOutput())
  process.exitCode = 1
} finally {
  await browser?.close()
  await stopDevServer(server)
}
