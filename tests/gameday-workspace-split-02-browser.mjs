import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import { chromium } from 'playwright'

const port = Number(process.env.GAMEDAY_WORKSPACE_SPLIT_BROWSER_PORT || 5650 + Math.floor(Math.random() * 250))
const baseUrl = `http://127.0.0.1:${port}`
const artifactDir = 'docs/audits/FP-V1-GAMEDAY-WORKSPACE-SPLIT-02-screenshots'
const liveMatchId = '22222222-2222-4222-8222-222222222222'
const upcomingMatchId = '33333333-3333-4333-8333-333333333333'
const previousMatchId = '44444444-4444-4444-8444-444444444444'

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPort(timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      const timeout = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, 250)

      socket.once('connect', () => {
        clearTimeout(timeout)
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        clearTimeout(timeout)
        resolve(false)
      })
    })

    if (connected) return
    await wait(150)
  }

  throw new Error(`Timed out waiting for ${baseUrl}`)
}

function startServer() {
  const child = spawn(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSER: 'none',
        VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
        VITE_APP_URL: baseUrl,
        VITE_PARENT_APP_URL: baseUrl,
        VITE_SUPABASE_URL: 'http://fixture.supabase.test',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { child, getOutput: () => output }
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return

  if (process.platform === 'win32') {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`], { stdio: 'ignore' })
  } else {
    server.child.kill()
  }

  await Promise.race([once(server.child, 'exit'), wait(3000)])
}

function baseMatch({ id, opponent, matchDate, status, score = [0, 0] }) {
  return {
    id,
    club_id: 'club-fixture',
    team_id: 'team-u12',
    opponent,
    fixture_type: 'league',
    match_conclusion_rule: 'extra_time_and_penalties',
    current_match_phase: status === 'live' ? 'first_half' : status === 'full_time' ? 'full_time' : 'pre_match',
    extra_time_half_minutes: 10,
    extra_time_period_count: 2,
    match_date: matchDate,
    kickoff_time: '15:00:00',
    kickoff_time_tbc: false,
    arrival_time: '14:15:00',
    home_away: 'home',
    match_clock_mode: 'fixed',
    match_duration_minutes: 70,
    venue_name: 'Jeluma Academy Ground',
    venue_address: '1 Football Way',
    notes: 'Confirm warm-up area and bring the match balls.',
    scorer_request_message: 'Can anyone help as live scorer for this match?',
    request_scorer: true,
    request_linesman: true,
    request_referee: true,
    auto_select_available_players: true,
    parent_visible: true,
    parent_audience: 'team',
    status,
    home_score: score[0],
    away_score: score[1],
    normal_time_home_score: score[0],
    normal_time_away_score: score[1],
    extra_time_home_score: 0,
    extra_time_away_score: 0,
    home_shootout_score: 0,
    away_shootout_score: 0,
    timer_started_at: status === 'live' ? '2026-08-01T14:00:00Z' : null,
    timer_elapsed_seconds: status === 'live' ? 1100 : 0,
    timer_status: status,
    created_at: '2026-07-20T10:00:00Z',
    updated_at: '2026-08-01T14:18:00Z',
    teams: { name: 'U16 Lions' },
  }
}

function detailedMatch(summary) {
  const playerNames = ['Alex Morgan', 'Jamie Smith', 'Taylor Jones', 'Riley Brown']

  return {
    ...summary,
    match_day_scorer_interest: [],
    match_day_scorer_assignments: [{ id: 'scorer-assignment', parent_name: 'Sam Morgan', status: 'accepted' }],
    match_day_role_assignments: [
      { id: 'role-scorer', role: 'scorer', parent_name: 'Sam Morgan', response: 'yes' },
      { id: 'role-referee', role: 'referee', parent_name: 'Chris Smith', response: 'yes' },
    ],
    match_day_player_availability: playerNames.map((playerName, index) => ({
      id: `availability-${index}`,
      match_day_id: summary.id,
      player_id: `player-${index}`,
      player_name: playerName,
      status: index === 3 ? 'unavailable' : index === 2 ? 'maybe' : 'available',
      transport_status: index === 1 ? 'lift_needed' : index === 2 ? 'lift_offered' : 'not_required',
    })),
    match_day_player_squad_decisions: playerNames.slice(0, 2).map((playerName, index) => ({
      id: `decision-${index}`,
      match_day_id: summary.id,
      club_id: 'club-fixture',
      team_id: 'team-u12',
      player_id: `player-${index}`,
      player_name: playerName,
      status: index === 0 ? 'selected' : 'standby',
    })),
    match_day_player_availability_history: [],
    match_day_availability_requests: playerNames.map((playerName, index) => ({
      id: `request-${index}`,
      match_day_id: summary.id,
      player_id: `player-${index}`,
      player_name: playerName,
      status: index === 3 ? 'pending' : 'responded',
    })),
    match_day_event_log: [
      { id: 'log-1', event_type: 'match_day_created', label: 'Fixture created', created_at: '2026-07-20T10:00:00Z', created_by_name: 'Coach Fixture' },
      { id: 'log-2', event_type: 'scorer_updated', label: 'Scorer selected', created_at: '2026-07-28T18:00:00Z', created_by_name: 'Coach Fixture' },
    ],
    match_day_events: [
      { id: 'event-1', event_type: 'goal', event_status: 'active', team_side: 'club', minute: 12, scorer_name: 'Alex Morgan', home_score: 1, away_score: 0, created_at: '2026-08-01T14:12:00Z' },
      { id: 'event-2', event_type: 'yellow_card', event_status: 'active', team_side: 'opponent', minute: 16, scorer_name: 'Opponent 4', home_score: 1, away_score: 0, created_at: '2026-08-01T14:16:00Z' },
    ],
    match_day_shootout_kicks: [],
    match_day_final_reports: [],
  }
}

const matchSummaries = [
  baseMatch({ id: liveMatchId, opponent: 'Academy United', matchDate: '2026-08-01', status: 'live', score: [1, 0] }),
  baseMatch({ id: upcomingMatchId, opponent: 'City Juniors', matchDate: '2026-08-08', status: 'scheduled' }),
  baseMatch({ id: previousMatchId, opponent: 'Rovers FC', matchDate: '2026-07-25', status: 'full_time', score: [2, 1] }),
]

async function fulfillJson(route, payload, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    },
    body: status === 204 ? '' : JSON.stringify(payload),
  })
}

async function preparePage(browser, viewport) {
  const context = await browser.newContext({ viewport })
  const unexpectedMutations = []
  const communicationRequests = []
  const consoleErrors = []
  const pageErrors = []
  const resourceFailures = []

  await context.route('http://fixture.supabase.test/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (request.method() === 'OPTIONS') {
      await fulfillJson(route, {}, 204)
      return
    }

    if (url.pathname.endsWith('/match_days')) {
      const requestedId = url.searchParams.get('id')?.replace(/^eq\./, '')
      if (requestedId) {
        const match = matchSummaries.find((candidate) => candidate.id === requestedId)
        await fulfillJson(route, match ? detailedMatch(match) : null)
      } else {
        await fulfillJson(route, matchSummaries)
      }
      return
    }

    if (url.pathname.endsWith('/teams')) {
      await fulfillJson(route, [{ id: 'team-u12', club_id: 'club-fixture', name: 'U16 Lions' }])
      return
    }

    if (url.pathname.endsWith('/players')) {
      await fulfillJson(route, ['Alex Morgan', 'Jamie Smith', 'Taylor Jones', 'Riley Brown'].map((playerName, index) => ({
        id: `player-${index}`,
        club_id: 'club-fixture',
        team_id: 'team-u12',
        player_name: playerName,
        status: 'active',
      })))
      return
    }

    if (url.pathname.includes('/rpc/get_match_day_presentation_states')) {
      await fulfillJson(route, [])
      return
    }

    if (!['GET', 'HEAD'].includes(request.method()) && !url.pathname.endsWith('/rpc/record_security_audit_event')) {
      unexpectedMutations.push(`${request.method()} ${url.pathname}`)
    }
    await fulfillJson(route, [])
  })

  await context.route('**/.netlify/functions/**', async (route) => {
    const url = route.request().url()
    if (/email|invite|push|sms/i.test(url)) communicationRequests.push(url)
    await fulfillJson(route, { success: true })
  })

  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    if (['document', 'script', 'stylesheet'].includes(request.resourceType()) && request.failure()?.errorText !== 'net::ERR_ABORTED') {
      resourceFailures.push(`${request.resourceType()}: ${request.url()} ${request.failure()?.errorText || 'failed'}`)
    }
  })

  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('button', { name: 'Club' }).click()
  await page.getByPlaceholder('you@club.com').fill('coach.fixture@footballplayer.test')
  await page.getByPlaceholder('Enter password').fill('FixturePass123!')
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL('**/coach', { timeout: 15000 })
  await page.goto(`${baseUrl}/match-day`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByTestId('game-day-fixture-summary').first().waitFor({ state: 'visible', timeout: 30000 })

  return { communicationRequests, consoleErrors, context, page, pageErrors, resourceFailures, unexpectedMutations }
}

async function measurePage(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main')
    const header = document.querySelector('header')
    const mainHeight = Math.round(main?.getBoundingClientRect().height || 0)
    const headerHeight = Math.round(header?.getBoundingClientRect().height || 0)
    const usableViewportHeight = Math.max(1, window.innerHeight - headerHeight)

    return {
      documentHeight: document.documentElement.scrollHeight,
      effectiveRatio: Number((mainHeight / usableViewportHeight).toFixed(2)),
      headerHeight,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      mainHeight,
      usableViewportHeight,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    }
  })
}

async function openSelectedFixture(page) {
  await page.getByTestId('game-day-fixture-summary').first().getByRole('button', { name: /Manage/ }).click()
  await page.getByTestId('game-day-selected-workspace').waitFor({ state: 'visible', timeout: 30000 })
  await page.getByRole('tab', { name: 'Overview' }).waitFor({ state: 'visible' })
}

function assertCleanRun(run) {
  const unexpectedConsoleErrors = run.consoleErrors.filter((message) => !/domain\/audit\.js:121/.test(message))
  assert.deepEqual(run.unexpectedMutations, [])
  assert.deepEqual(run.communicationRequests, [])
  assert.deepEqual(run.pageErrors, [])
  assert.deepEqual(run.resourceFailures, [])
  assert.deepEqual(unexpectedConsoleErrors, [])
}

async function runMobile(browser) {
  const run = await preparePage(browser, { width: 375, height: 812 })
  const { page } = run

  try {
    const list = await measurePage(page)
    assert.equal(list.horizontalOverflow, false)
    assert.ok(list.effectiveRatio <= 2, `Mobile fixture list ratio ${list.effectiveRatio} exceeds 2.00`)
    await page.screenshot({ path: `${artifactDir}/mobile-fixture-list-initial.png` })

    await page.getByRole('button', { name: /Previous games/ }).click()
    await page.getByTestId('game-day-previous-fixtures').waitFor({ state: 'visible' })
    await page.getByTestId('game-day-previous-fixtures').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${artifactDir}/mobile-fixture-list-lower.png` })
    await page.getByRole('button', { name: 'Hide previous games' }).click()

    await openSelectedFixture(page)
    await page.goBack()
    await page.getByTestId('game-day-fixture-summary').first().waitFor({ state: 'visible' })
    assert.doesNotMatch(page.url(), /fixture=/)
    await openSelectedFixture(page)
    const overview = await measurePage(page)
    assert.equal(overview.horizontalOverflow, false)
    assert.equal(await page.getByRole('button', { name: 'Back to fixtures' }).isVisible(), true)
    assert.equal(await page.getByTestId('game-day-fixture-summary').first().isVisible(), false)
    await page.screenshot({ path: `${artifactDir}/mobile-selected-overview.png`, fullPage: true })
    assert.ok(overview.effectiveRatio <= 2.5, `Mobile selected Overview ratio ${overview.effectiveRatio} exceeds 2.50`)

    const homeScore = page.getByLabel(/^Home \(/)
    await homeScore.fill('3')

    await page.getByRole('tab', { name: 'Squad and availability' }).click()
    assert.match(page.url(), /section=squad/)
    assert.equal((await measurePage(page)).horizontalOverflow, false)
    await page.screenshot({ path: `${artifactDir}/mobile-squad-availability.png`, fullPage: true })

    await page.getByRole('tab', { name: 'Roles and transport' }).click()
    assert.match(page.url(), /section=roles/)
    assert.equal((await measurePage(page)).horizontalOverflow, false)
    await page.screenshot({ path: `${artifactDir}/mobile-roles-transport.png`, fullPage: true })

    await page.getByRole('tab', { name: 'Timeline and notes' }).click()
    assert.match(page.url(), /section=timeline/)
    assert.equal((await measurePage(page)).horizontalOverflow, false)
    await page.screenshot({ path: `${artifactDir}/mobile-timeline-notes.png`, fullPage: true })

    await page.getByRole('tab', { name: 'Overview' }).click()
    assert.equal(await homeScore.inputValue(), '3')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByTestId('game-day-selected-workspace').waitFor({ state: 'visible', timeout: 30000 })
    assert.match(page.url(), new RegExp(`fixture=${liveMatchId}`))
    assert.equal(await page.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected'), 'true')

    await page.getByRole('button', { name: 'Back to fixtures' }).click()
    await page.getByTestId('game-day-fixture-summary').first().waitFor({ state: 'visible' })
    assert.doesNotMatch(page.url(), /fixture=/)
    assertCleanRun(run)
    return { list, overview }
  } finally {
    await run.context.close()
  }
}

async function runDesktop(browser) {
  const run = await preparePage(browser, { width: 1440, height: 900 })
  const { page } = run

  try {
    await page.getByRole('button', { name: 'List all' }).click()
    assert.equal(await page.getByTestId('game-day-fixture-summary').count(), 2)
    await openSelectedFixture(page)
    const overview = await measurePage(page)
    assert.equal(overview.horizontalOverflow, false)
    assert.ok(overview.effectiveRatio <= 2, `Desktop selected Overview ratio ${overview.effectiveRatio} exceeds 2.00`)
    assert.equal(await page.getByTestId('game-day-fixture-summary').first().isVisible(), true)
    assert.equal(await page.getByRole('button', { name: 'Back to fixtures' }).isVisible(), false)
    await page.screenshot({ path: `${artifactDir}/desktop-navigation-selected-workspace.png` })
    await page.screenshot({ path: `${artifactDir}/desktop-selected-overview.png`, fullPage: true })

    await page.getByRole('button', { name: 'Open Game Mode' }).click()
    await page.getByRole('region', { name: 'Game Mode cockpit' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Manage fixture' }).click()
    await page.getByRole('tab', { name: 'Overview' }).waitFor({ state: 'visible' })

    await page.getByLabel(/^Home \(/).fill('3')
    await page.getByTestId('game-day-fixture-summary').nth(1).getByRole('button', { name: /Manage/ }).click()
    await page.waitForURL(`**/match-day?fixture=${upcomingMatchId}&section=overview`)
    assert.equal(await page.getByLabel(/^Home \(/).inputValue(), '0')
    await page.getByTestId('game-day-fixture-summary').first().getByRole('button', { name: /Manage/ }).click()
    await page.waitForURL(`**/match-day?fixture=${liveMatchId}&section=overview`)
    assert.equal(await page.getByLabel(/^Home \(/).inputValue(), '3')

    await page.getByRole('tab', { name: 'Roles and transport' }).click()
    await page.evaluate(() => window.localStorage.setItem('app-theme-mode', 'dark'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: 'Roles and transport' }).waitFor({ state: 'visible', timeout: 30000 })
    assert.equal(await page.getByRole('tab', { name: 'Roles and transport' }).getAttribute('aria-selected'), 'true')
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theme-dark') || document.body.classList.contains('theme-dark')), true)
    await page.screenshot({ path: `${artifactDir}/desktop-roles-transport-dark.png`, fullPage: true })
    assertCleanRun(run)
    return { overview }
  } finally {
    await run.context.close()
  }
}

async function runTablet(browser) {
  const run = await preparePage(browser, { width: 768, height: 1024 })
  const { page } = run

  try {
    const list = await measurePage(page)
    await openSelectedFixture(page)
    const overview = await measurePage(page)
    assert.equal(list.horizontalOverflow, false)
    assert.equal(overview.horizontalOverflow, false)
    assert.ok(list.effectiveRatio < 4 && overview.effectiveRatio < 4)
    assertCleanRun(run)
    return { list, overview }
  } finally {
    await run.context.close()
  }
}

await mkdir(artifactDir, { recursive: true })
const server = startServer()
let browser

try {
  await waitForPort()
  browser = await chromium.launch({ headless: true })
  const mobile = await runMobile(browser)
  const desktop = await runDesktop(browser)
  const tablet = await runTablet(browser)
  console.log(JSON.stringify({ desktop, mobile, tablet }, null, 2))
  console.log('PASS Game Day workspace split browser: responsive layout, URL state, actions, dark mode, screenshots, and zero communication or data mutation')
} catch (error) {
  console.error(server.getOutput())
  throw error
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}
