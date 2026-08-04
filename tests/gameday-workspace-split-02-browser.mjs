import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import { chromium } from 'playwright'

const port = Number(process.env.GAMEDAY_WORKSPACE_SPLIT_BROWSER_PORT || 5650 + Math.floor(Math.random() * 250))
const baseUrl = `http://127.0.0.1:${port}`
const artifactDir = 'docs/audits/FP-V1-GAMEDAY-MOBILE-COMPACTION-29C-screenshots'
const capabilityArtifactDir = 'docs/audits/FP-V1-GAMEDAY-CAPABILITY-RESTORATION-31A-screenshots'
const layoutArtifactDir = 'docs/audits/FP-V1-GAMEDAY-RESPONSIVE-LAYOUT-INTEGRITY-31B-screenshots'
const liveMatchId = '22222222-2222-4222-8222-222222222222'
const upcomingMatchId = '33333333-3333-4333-8333-333333333333'
const previousMatchId = '44444444-4444-4444-8444-444444444444'
const longContentMatchId = '55555555-5555-4555-8555-555555555555'

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

function baseMatch({ id, opponent, matchDate, status, score = [0, 0], teamName = 'U16 Lions', venueName = 'Jeluma Academy Ground' }) {
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
    venue_name: venueName,
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
    teams: { name: teamName },
  }
}

function detailedMatch(summary) {
  const playerNames = ['Alex Morgan', 'Jamie Smith', 'Taylor Jones', 'Riley Brown']

  return {
    ...summary,
    match_day_scorer_interest: [],
    match_day_scorer_assignments: [{ id: 'scorer-assignment', parent_name: 'Sam Morgan', status: 'accepted' }],
    match_day_role_assignments: [
      { id: 'role-scorer', role: 'scorer', parent_link_id: 'parent-link-0', auth_user_id: 'parent-user-0', parent_email: 'alex@fixture.test', player_name: 'Alex Morgan' },
      { id: 'role-referee', role: 'referee', parent_link_id: 'parent-link-2', auth_user_id: 'parent-user-2', parent_email: 'taylor@fixture.test', player_name: 'Taylor Jones' },
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
      status: 'selected',
    })),
    match_day_player_availability_history: [],
    match_day_availability_requests: playerNames.map((playerName, index) => ({
      id: `request-${index}`,
      match_day_id: summary.id,
      player_id: `player-${index}`,
      player_name: playerName,
      parent_link_id: `parent-link-${index}`,
      auth_user_id: `parent-user-${index}`,
      recipient_name: `${playerName.split(' ')[0]} Parent`,
      recipient_email: `${playerName.split(' ')[0].toLowerCase()}@fixture.test`,
      scorer_eligible: index < 2,
      scorer_eligibility_reason: index < 2 ? '' : 'No current accepted Player link.',
      status: index === 3 ? 'pending' : 'responded',
      responded_at: index === 3 ? null : '2026-07-31T17:45:00Z',
      volunteer_scorer_response: index < 2 ? 'yes' : 'no_response',
      volunteer_referee_response: index === 2 ? 'yes' : 'no_response',
      volunteer_linesman_response: index === 3 ? 'no' : 'no_response',
      volunteer_responded_at: '2026-07-31T17:50:00Z',
      transport_needs_lift: index === 1,
      transport_can_offer_lift: index === 2,
      transport_seats_offered: index === 2 ? 3 : 0,
      transport_responded_at: index === 1 || index === 2 ? '2026-07-31T18:00:00Z' : null,
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

function relativeMatchDate(dayOffset) {
  const date = new Date()
  date.setDate(date.getDate() + dayOffset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const matchSummaries = [
  baseMatch({ id: liveMatchId, opponent: 'Academy United', matchDate: relativeMatchDate(0), status: 'live', score: [1, 0] }),
  baseMatch({ id: upcomingMatchId, opponent: 'City Juniors', matchDate: relativeMatchDate(5), status: 'scheduled' }),
  baseMatch({
    id: longContentMatchId,
    opponent: 'Northumberland International Football Development Academy Wanderers',
    matchDate: relativeMatchDate(6),
    status: 'scheduled',
    teamName: 'Football Player Under Seventeen Development and Performance Squad',
    venueName: 'The Extremely Long Community Sports and High Performance Development Centre',
  }),
  baseMatch({ id: previousMatchId, opponent: 'Rovers FC', matchDate: relativeMatchDate(-9), status: 'full_time', score: [2, 1] }),
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

async function preparePage(browser, viewport, contextOptions = {}, fixtureSummaries = matchSummaries) {
  const context = await browser.newContext({ viewport, ...contextOptions })
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
        const match = fixtureSummaries.find((candidate) => candidate.id === requestedId)
        await fulfillJson(route, match ? detailedMatch(match) : null)
      } else {
        await fulfillJson(route, fixtureSummaries)
      }
      return
    }

    if (url.pathname.endsWith('/teams')) {
      await fulfillJson(route, [{ id: 'team-u12', club_id: 'club-fixture', name: 'U16 Lions' }])
      return
    }

    if (url.pathname.includes('/rpc/get_team_players') || url.pathname.endsWith('/players')) {
      await fulfillJson(route, ['Alex Morgan', 'Jamie Smith', 'Taylor Jones', 'Riley Brown'].map((playerName, index) => ({
        id: `player-${index}`,
        club_id: 'club-fixture',
        team_id: 'team-u12',
        section: 'Squad',
        player_name: playerName,
        shirt_number: String(index + 7),
        status: 'active',
      })))
      return
    }

    if (url.pathname.includes('/rpc/get_match_day_presentation_states')) {
      await fulfillJson(route, [])
      return
    }

    if (!['GET', 'HEAD'].includes(request.method())
      && !url.pathname.includes('/rpc/get_')
      && !url.pathname.endsWith('/rpc/record_security_audit_event')) {
      unexpectedMutations.push(`${request.method()} ${url.pathname}`)
    }
    await fulfillJson(route, [])
  })

  await context.route('**/.netlify/functions/**', async (route) => {
    const url = route.request().url()
    if (/email|invite|push|sms/i.test(url)) communicationRequests.push(url)
    if (url.includes('/select-match-day-volunteer') && route.request().method() === 'GET') {
      await fulfillJson(route, {
        success: true,
        eligibility: [0, 1, 2, 3].map((index) => ({
          request_id: `request-${index}`,
          eligible: index < 2,
          reason: index < 2 ? '' : 'No current accepted Player link.',
          parent_link_id: `parent-link-${index}`,
          auth_user_id: `parent-user-${index}`,
        })),
      })
      return
    }
    await fulfillJson(route, { success: true })
  })

  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location()
      consoleErrors.push(`${message.text()} @ ${location.url || 'unknown'}:${location.lineNumber ?? 0}`)
    }
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
  if (fixtureSummaries.some((match) => match.status !== 'full_time')) {
    await page.getByTestId('game-day-fixture-summary').first().waitFor({ state: 'visible', timeout: 30000 })
  } else {
    await page.getByTestId('game-day-empty-fixtures').waitFor({ state: 'visible', timeout: 30000 })
  }

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

async function measureFixtureListFlow(page) {
  return page.evaluate(() => {
    const headingElement = [...document.querySelectorAll('h2')].find((element) => element.textContent?.trim() === 'Active fixtures')
    const sectionElement = headingElement?.closest('section')
    const controlsElement = sectionElement?.querySelector('[role="group"][aria-label="Fixture list view"]')
    const createElement = [...(sectionElement?.querySelectorAll('button') || [])].find((element) => element.textContent?.trim() === 'Create fixture')
    const fixtureElement = sectionElement?.querySelector('[data-testid="game-day-fixture-summary"], [data-testid="game-day-empty-fixtures"]')
    const previousElement = [...(sectionElement?.querySelectorAll('button') || [])].find((element) => /^Previous games/.test(element.textContent?.trim() || ''))
    const headerElement = headingElement?.parentElement?.parentElement
    const bodyElement = fixtureElement?.parentElement?.parentElement
    const rect = (element) => {
      const box = element?.getBoundingClientRect()
      return box ? { bottom: box.bottom, height: box.height, left: box.left, right: box.right, top: box.top, width: box.width } : null
    }
    const overlaps = (first, second) => Boolean(
      first && second
      && first.left < second.right - 1
      && first.right > second.left + 1
      && first.top < second.bottom - 1
      && first.bottom > second.top + 1
    )
    const headingRect = rect(headingElement)
    const controlsRect = rect(controlsElement)
    const createRect = rect(createElement)
    const fixtureRect = rect(fixtureElement)
    const previousRect = rect(previousElement)
    const headerRect = rect(headerElement)

    return {
      bodyHasViewportHeightLimit: Boolean(bodyElement && getComputedStyle(bodyElement).maxHeight !== 'none'),
      bodyIsNestedScroller: Boolean(bodyElement && ['auto', 'scroll'].includes(getComputedStyle(bodyElement).overflowY)),
      cardAfterHeader: Boolean(fixtureRect && headerRect && fixtureRect.top >= headerRect.bottom - 1),
      controlsCreateOverlap: overlaps(controlsRect, createRect),
      createCardOverlap: overlaps(createRect, fixtureRect),
      headingControlsOverlap: overlaps(headingRect, controlsRect),
      headingCreateOverlap: overlaps(headingRect, createRect),
      previousAfterCard: Boolean(previousRect && fixtureRect && previousRect.top >= fixtureRect.bottom - 1),
      sectionHorizontalOverflow: Boolean(sectionElement && sectionElement.scrollWidth > sectionElement.clientWidth + 1),
    }
  })
}

function assertFixtureListFlow(flow, name) {
  assert.equal(flow.headingControlsOverlap, false, `${name} overlaps the Active fixtures heading and view controls`)
  assert.equal(flow.headingCreateOverlap, false, `${name} overlaps the Active fixtures heading and Create fixture`)
  assert.equal(flow.controlsCreateOverlap, false, `${name} overlaps view controls and Create fixture`)
  assert.equal(flow.createCardOverlap, false, `${name} overlaps Create fixture and the first fixture card`)
  assert.equal(flow.cardAfterHeader, true, `${name} starts the first fixture card before the header ends`)
  assert.equal(flow.previousAfterCard, true, `${name} places Previous games before the first fixture card ends`)
  assert.equal(flow.sectionHorizontalOverflow, false, `${name} fixture list overflows horizontally`)
  assert.equal(flow.bodyHasViewportHeightLimit, false, `${name} fixture list assumes a fixed viewport height`)
  assert.equal(flow.bodyIsNestedScroller, false, `${name} fixture list creates a nested vertical scroller`)
}

async function openSelectedFixture(page, opponent = 'Academy United') {
  await page.getByTestId('game-day-fixture-summary').filter({ hasText: opponent }).getByRole('button', { name: /Manage/ }).click()
  await page.getByTestId('game-day-selected-workspace').waitFor({ state: 'visible', timeout: 30000 })
  await page.getByRole('tab', { name: 'Scorer and roles' }).waitFor({ state: 'visible' })
}

function assertCleanRun(run) {
  const unexpectedConsoleErrors = run.consoleErrors.filter((message) => !/domain\/audit\.js:121/.test(message))
  assert.deepEqual(run.unexpectedMutations, [])
  assert.deepEqual(run.communicationRequests, [])
  assert.deepEqual(run.pageErrors, [])
  assert.deepEqual(run.resourceFailures, [])
  assert.deepEqual(unexpectedConsoleErrors, [])
}

async function assertRestoredLiveActions(page, viewportName) {
  await page.getByRole('button', { name: 'Open Game Mode' }).click()
  const cockpit = page.getByRole('region', { name: 'Game Mode cockpit' })
  await cockpit.waitFor({ state: 'visible' })

  const actionKeys = await page
    .getByTestId('game-day-live-actions')
    .locator('[data-match-day-action]')
    .evaluateAll((actions) => actions.map((action) => action.getAttribute('data-match-day-action')))
  assert.deepEqual(actionKeys, ['goal', 'yellow_card', 'red_card', 'substitution'])

  for (const actionKey of actionKeys) {
    assert.equal(await page.locator(`[data-match-day-action="${actionKey}"]`).isEnabled(), true)
  }

  await cockpit.screenshot({ path: `${capabilityArtifactDir}/${viewportName}-direct-live-actions.png` })

  for (const [actionKey, eventType] of [
    ['yellow_card', 'yellow_card'],
    ['red_card', 'red_card'],
    ['substitution', 'substitution'],
  ]) {
    await page.locator(`[data-match-day-action="${actionKey}"]`).click()
    const dialog = page.getByRole('dialog', { name: 'Add match event' })
    await dialog.waitFor({ state: 'visible' })
    assert.equal(await dialog.getByRole('combobox', { name: 'Event type' }).inputValue(), eventType)

    if (actionKey === 'yellow_card' || actionKey === 'red_card') {
      const playerOptions = await dialog.getByRole('combobox', { name: 'Player' }).locator('option').allTextContents()
      assert.deepEqual(playerOptions.map((option) => option.trim()), ['Choose player', 'Alex Morgan #7', 'Jamie Smith #8'])
      assert.equal(await dialog.getByRole('button', { name: 'Save event' }).isDisabled(), true)
    }

    if (actionKey === 'substitution') {
      assert.equal(await dialog.getByRole('combobox', { name: 'Player Off' }).count(), 1)
      assert.equal(await dialog.getByRole('combobox', { name: 'Player On' }).count(), 1)
      assert.equal(await dialog.getByRole('button', { name: 'Save event' }).isDisabled(), true)
    }

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor({ state: 'hidden' })
  }

  await page.locator('[data-match-day-action="goal"]').click()
  const goalDialog = page.getByRole('dialog', { name: 'Add goal' })
  await goalDialog.waitFor({ state: 'visible' })
  await goalDialog.getByRole('button', { name: 'Cancel' }).click()
  await goalDialog.waitFor({ state: 'hidden' })

  return cockpit
}

async function runMobile(browser) {
  const run = await preparePage(browser, { width: 375, height: 812 })
  const { page } = run

  try {
    const list = await measurePage(page)
    assert.equal(list.horizontalOverflow, false)
    assert.ok(list.effectiveRatio <= 3.2, `Mobile fixture list ratio ${list.effectiveRatio} exceeds 3.20`)
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
    const roles = await measurePage(page)
    assert.equal(roles.horizontalOverflow, false)
    assert.equal(await page.getByRole('button', { name: 'Back to fixtures' }).isVisible(), true)
    assert.equal(await page.getByTestId('game-day-fixture-summary').first().isVisible(), false)
    assert.equal(await page.getByRole('tab', { name: 'Scorer and roles' }).getAttribute('aria-selected'), 'true')
    assert.match(page.url(), /section=roles/)
    const tabLabels = await page.getByRole('tab').allTextContents()
    assert.deepEqual(tabLabels.map((label) => label.trim()), [
      'Scorer and roles',
      'Players and availability',
      'Match details',
      'Timeline and notes',
      'Transport',
    ])
    const scorerReach = await page.evaluate(() => {
      const main = document.querySelector('main')?.getBoundingClientRect()
      const header = document.querySelector('header')?.getBoundingClientRect()
      const scorer = document.querySelector('[data-testid="game-day-role-scorer"]')?.getBoundingClientRect()
      const controls = document.querySelector('[data-testid="game-day-match-controls"]')?.getBoundingClientRect()
      const usableViewportHeight = Math.max(1, window.innerHeight - (header?.height || 0))
      return {
        controlsBeforeScorer: Boolean(controls && scorer && controls.top < scorer.top),
        distanceFromMain: scorer && main ? Math.round(scorer.top - main.top) : Number.POSITIVE_INFINITY,
        usableViewportHeight,
      }
    })
    assert.equal(scorerReach.controlsBeforeScorer, true)
    assert.ok(scorerReach.distanceFromMain <= scorerReach.usableViewportHeight * 2, `Scorer is ${scorerReach.distanceFromMain}px from the workspace start, beyond two usable viewports`)
    assert.ok(roles.effectiveRatio <= 3, `Mobile selected scorer and roles ratio ${roles.effectiveRatio} exceeds 3.00`)
    const roleCardLabels = await page.locator('[data-testid^="game-day-role-"] > div:first-child > p:first-child').allTextContents()
    assert.deepEqual(roleCardLabels, ['Scorer', 'Referee', 'Linesman'])
    assert.match(await page.getByTestId('game-day-role-scorer').innerText(), /Selected:/)
    assert.equal(await page.getByTestId('game-day-role-scorer').getByRole('button', { name: /Deselect|Replace selected volunteer|^Select$/ }).first().isVisible(), true)
    await page.screenshot({ path: `${artifactDir}/mobile-selected-scorer-roles.png`, fullPage: true })

    const mobileCockpit = await assertRestoredLiveActions(page, 'mobile-375x812')
    assert.equal(await mobileCockpit.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true)
    await page.getByRole('button', { name: 'Manage fixture' }).click()
    await page.getByRole('tab', { name: 'Scorer and roles' }).waitFor({ state: 'visible' })

    await page.getByRole('tab', { name: 'Match details' }).click()
    assert.match(page.url(), /section=overview/)
    const homeScore = page.getByLabel(/^Home \(/)
    await homeScore.fill('3')
    const details = await measurePage(page)
    assert.equal(details.horizontalOverflow, false)
    await page.screenshot({ path: `${artifactDir}/mobile-match-details.png`, fullPage: true })

    await page.getByRole('tab', { name: 'Players and availability' }).click()
    assert.match(page.url(), /section=squad/)
    const squad = await measurePage(page)
    assert.equal(squad.horizontalOverflow, false)
    assert.ok(squad.effectiveRatio <= 2.35, `Mobile collapsed Players and availability ratio ${squad.effectiveRatio} exceeds 2.35`)
    const groupButtons = page.getByTestId('game-day-availability-section').locator('button[aria-expanded]')
    assert.equal(await groupButtons.count(), 5)
    assert.deepEqual(await groupButtons.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-expanded'))), ['false', 'false', 'false', 'false', 'false'])
    const emptyGroupButton = page.getByTestId('game-day-availability-no_response').getByRole('button').first()
    assert.equal(await emptyGroupButton.isDisabled(), true)
    assert.match(await emptyGroupButton.innerText(), /None/)
    const availableGroupButton = page.getByTestId('game-day-availability-available').getByRole('button').first()
    await availableGroupButton.focus()
    await page.keyboard.press('Enter')
    assert.equal(await availableGroupButton.getAttribute('aria-expanded'), 'true')
    assert.equal(await page.getByRole('group', { name: 'Squad decision for Alex Morgan' }).isVisible(), true)
    const maybeGroupButton = page.getByTestId('game-day-availability-maybe').getByRole('button').first()
    await maybeGroupButton.click()
    assert.equal(await maybeGroupButton.getAttribute('aria-expanded'), 'true')
    assert.equal(await availableGroupButton.getAttribute('aria-expanded'), 'true')
    assert.match(await page.getByTestId('game-day-availability-unavailable').innerText(), /Unavailable[\s\S]*1 Player/)
    await maybeGroupButton.click()
    assert.equal(await maybeGroupButton.getAttribute('aria-expanded'), 'false')
    await page.getByRole('tab', { name: 'Match details' }).click()
    await page.getByRole('tab', { name: 'Players and availability' }).click()
    assert.equal(await availableGroupButton.getAttribute('aria-expanded'), 'true')
    await availableGroupButton.focus()
    await page.keyboard.press('Enter')
    assert.equal(await availableGroupButton.getAttribute('aria-expanded'), 'false')
    const liftSnapshot = page.getByRole('region', { name: 'Lift coordination snapshot' })
    assert.equal(await liftSnapshot.isVisible(), true)
    assert.match(await liftSnapshot.innerText(), /1\s*NEEDS LIFT/i)
    assert.match(await liftSnapshot.innerText(), /3\s*CAN OFFER SEATS/i)
    await page.screenshot({ path: `${artifactDir}/mobile-squad-availability.png`, fullPage: true })

    await page.getByRole('tab', { name: 'Timeline and notes' }).click()
    assert.match(page.url(), /section=timeline/)
    const timeline = await measurePage(page)
    assert.equal(timeline.horizontalOverflow, false)
    await page.screenshot({ path: `${artifactDir}/mobile-timeline-notes.png`, fullPage: true })

    await page.getByRole('tab', { name: 'Transport' }).click()
    assert.match(page.url(), /section=transport/)
    const transport = await measurePage(page)
    assert.equal(transport.horizontalOverflow, false)
    assert.equal(await page.getByTestId('game-day-transport-section').getByRole('heading', { name: 'Transport risk' }).isVisible(), true)
    assert.equal(await page.getByTestId('game-day-transport-section').getByRole('heading', { name: 'Transport coordination' }).isVisible(), true)
    await page.screenshot({ path: `${artifactDir}/mobile-transport-last.png`, fullPage: true })

    await page.getByRole('tab', { name: 'Match details' }).click()
    assert.equal(await homeScore.inputValue(), '3')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByTestId('game-day-selected-workspace').waitFor({ state: 'visible', timeout: 30000 })
    assert.match(page.url(), new RegExp(`fixture=${liveMatchId}`))
    assert.equal(await page.getByRole('tab', { name: 'Match details' }).getAttribute('aria-selected'), 'true')

    await page.getByRole('button', { name: 'Back to fixtures' }).click()
    await page.getByTestId('game-day-fixture-summary').first().waitFor({ state: 'visible' })
    assert.doesNotMatch(page.url(), /fixture=/)
    assertCleanRun(run)
    return { details, list, roles, scorerReach, squad, timeline, transport }
  } finally {
    await run.context.close()
  }
}

async function runDesktop(browser) {
  const run = await preparePage(browser, { width: 1440, height: 900 })
  const { page } = run

  try {
    await page.getByRole('button', { name: 'Create fixture' }).last().click()
    const fixtureDialog = page.getByRole('dialog', { name: 'Create fixture' })
    await fixtureDialog.waitFor({ state: 'visible' })
    await fixtureDialog.getByRole('button', { name: 'Close' }).click()
    await fixtureDialog.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'List all' }).click()
    assert.equal(await page.getByTestId('game-day-fixture-summary').count(), 3)
    await openSelectedFixture(page)
    const fixtureListFlow = await measureFixtureListFlow(page)
    assertFixtureListFlow(fixtureListFlow, 'desktop-1440x900')
    const roles = await measurePage(page)
    assert.equal(roles.horizontalOverflow, false)
    assert.ok(roles.effectiveRatio <= 2.25, `Desktop selected scorer and roles ratio ${roles.effectiveRatio} exceeds 2.25`)
    assert.equal(await page.getByTestId('game-day-fixture-summary').first().isVisible(), true)
    assert.equal(await page.getByRole('button', { name: 'Back to fixtures' }).isVisible(), false)
    await page.screenshot({ path: `${artifactDir}/desktop-navigation-selected-workspace.png` })
    await page.screenshot({ path: `${artifactDir}/desktop-selected-scorer-roles.png`, fullPage: true })

    await assertRestoredLiveActions(page, 'desktop-1440x900')
    await page.getByRole('button', { name: 'Manage fixture' }).click()
    await page.getByRole('tab', { name: 'Scorer and roles' }).waitFor({ state: 'visible' })

    await page.getByRole('tab', { name: 'Match details' }).click()
    await page.getByLabel(/^Home \(/).fill('3')
    await page.getByTestId('game-day-fixture-summary').filter({ hasText: 'City Juniors' }).getByRole('button', { name: /Manage/ }).click()
    await page.waitForURL(`**/match-day?fixture=${upcomingMatchId}&section=roles`)
    await page.getByRole('tab', { name: 'Match details' }).click()
    assert.equal(await page.getByLabel(/^Home \(/).inputValue(), '0')
    await page.getByTestId('game-day-fixture-summary').filter({ hasText: 'Academy United' }).getByRole('button', { name: /Manage/ }).click()
    await page.waitForURL(`**/match-day?fixture=${liveMatchId}&section=roles`)
    await page.getByRole('tab', { name: 'Match details' }).click()
    assert.equal(await page.getByLabel(/^Home \(/).inputValue(), '3')

    await page.getByRole('tab', { name: 'Scorer and roles' }).click()
    await page.evaluate(() => window.localStorage.setItem('app-theme-mode', 'dark'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: 'Scorer and roles' }).waitFor({ state: 'visible', timeout: 30000 })
    assert.equal(await page.getByRole('tab', { name: 'Scorer and roles' }).getAttribute('aria-selected'), 'true')
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theme-dark') || document.body.classList.contains('theme-dark')), true)
    await page.screenshot({ path: `${artifactDir}/desktop-roles-transport-dark.png`, fullPage: true })
    assertCleanRun(run)
    return { fixtureListFlow, roles }
  } finally {
    await run.context.close()
  }
}

async function runEmptyFixtureList(browser) {
  const run = await preparePage(browser, { width: 1440, height: 900 }, {}, [])
  const { page } = run

  try {
    assert.equal(await page.getByText('No live or upcoming matches yet.').isVisible(), true)
    const fixtureListFlow = await measureFixtureListFlow(page)
    assertFixtureListFlow(fixtureListFlow, 'desktop-empty-fixture-list')
    await page.screenshot({ path: `${layoutArtifactDir}/desktop-empty-fixture-list.png`, fullPage: true })
    assertCleanRun(run)
    return fixtureListFlow
  } finally {
    await run.context.close()
  }
}

async function runTablet(browser) {
  const run = await preparePage(browser, { width: 768, height: 1024 })
  const { page } = run

  try {
    const list = await measurePage(page)
    await page.getByRole('button', { name: 'Open navigation' }).click()
    assert.equal(await page.getByRole('button', { name: 'Close navigation' }).isVisible(), true)
    assert.equal((await measurePage(page)).horizontalOverflow, false)
    await page.getByRole('button', { name: 'Close navigation' }).click()
    await openSelectedFixture(page)
    const roles = await measurePage(page)
    assert.equal(list.horizontalOverflow, false)
    assert.equal(roles.horizontalOverflow, false)
    assert.ok(list.effectiveRatio < 4 && roles.effectiveRatio < 4)
    assertCleanRun(run)
    return { list, roles }
  } finally {
    await run.context.close()
  }
}

async function runResponsiveVariant(browser, { contextOptions, name, rootFontScale = 1, viewport }) {
  const run = await preparePage(browser, viewport, contextOptions)
  const { page } = run

  try {
    if (rootFontScale !== 1) {
      await page.addStyleTag({ content: `html { font-size: ${rootFontScale * 100}% !important; }` })
    }
    await page.getByRole('button', { name: 'List all' }).click()
    const initialFixtureListFlow = await measureFixtureListFlow(page)
    assertFixtureListFlow(initialFixtureListFlow, `${name}-fixture-list`)
    await page.screenshot({ path: `${layoutArtifactDir}/${name}-fixture-list.png`, fullPage: true })
    await openSelectedFixture(page)
    const measurement = await measurePage(page)
    const selectedFixtureListFlow = viewport.width >= 1280 ? await measureFixtureListFlow(page) : null
    const structure = await page.evaluate(() => {
      const controls = document.querySelector('[data-testid="game-day-match-controls"]')
      const scorer = document.querySelector('[data-testid="game-day-role-scorer"]')
      const workspace = document.querySelector('[data-testid="game-day-selected-workspace"]')
      const nestedVerticalScrollers = workspace
        ? [...workspace.querySelectorAll('*')].filter((element) => {
          const style = window.getComputedStyle(element)
          return ['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1
        }).length
        : -1

      return {
        controlsBeforeScorer: Boolean(controls && scorer && controls.compareDocumentPosition(scorer) & Node.DOCUMENT_POSITION_FOLLOWING),
        nestedVerticalScrollers,
      }
    })
    assert.equal(measurement.horizontalOverflow, false, `${name} has horizontal overflow`)
    assert.equal(structure.controlsBeforeScorer, true, `${name} does not place controls before scorer`)
    assert.equal(structure.nestedVerticalScrollers, 0, `${name} has a nested vertical scroll trap in the selected workspace`)
    if (selectedFixtureListFlow) assertFixtureListFlow(selectedFixtureListFlow, `${name}-selected-fixture`)
    assert.equal(await page.getByRole('tab', { name: 'Transport' }).last().getAttribute('aria-selected'), 'false')
    await page.screenshot({ path: `${layoutArtifactDir}/${name}.png`, fullPage: true })
    assertCleanRun(run)
    return { initialFixtureListFlow, measurement, selectedFixtureListFlow, structure }
  } finally {
    await run.context.close()
  }
}

await mkdir(artifactDir, { recursive: true })
await mkdir(capabilityArtifactDir, { recursive: true })
await mkdir(layoutArtifactDir, { recursive: true })
const server = startServer()
let browser

try {
  await waitForPort()
  browser = await chromium.launch({ headless: true })
  const mobile = await runMobile(browser)
  const desktop = await runDesktop(browser)
  const emptyFixtureList = await runEmptyFixtureList(browser)
  const tablet = await runTablet(browser)
  const variants = {}
  for (const variant of [
    { name: 'wide-desktop-2560', viewport: { width: 2560, height: 1080 } },
    { name: 'wide-desktop-1920', viewport: { width: 1920, height: 1080 } },
    { name: 'wide-desktop-1600', viewport: { width: 1600, height: 900 } },
    { name: 'standard-desktop', viewport: { width: 1280, height: 800 } },
    { name: 'desktop-1366', viewport: { width: 1366, height: 768 } },
    { name: 'short-desktop', viewport: { width: 1366, height: 600 } },
    { name: 'desktop-text-125', viewport: { width: 1440, height: 900 }, rootFontScale: 1.25 },
    { name: 'desktop-text-150', viewport: { width: 1440, height: 900 }, rootFontScale: 1.5 },
    { name: 'desktop-text-200', viewport: { width: 1440, height: 900 }, rootFontScale: 2 },
    { name: 'tablet-landscape-1024', viewport: { width: 1024, height: 768 }, contextOptions: { hasTouch: true } },
    { name: 'iphone-landscape', viewport: { width: 812, height: 375 }, contextOptions: { hasTouch: true, isMobile: true } },
    { name: 'android-portrait', viewport: { width: 412, height: 915 }, contextOptions: { hasTouch: true, isMobile: true } },
    { name: 'android-landscape', viewport: { width: 915, height: 412 }, contextOptions: { hasTouch: true, isMobile: true } },
    { name: 'pwa-touch', viewport: { width: 390, height: 844 }, contextOptions: { hasTouch: true, isMobile: true } },
    { name: 'high-zoom-equivalent', viewport: { width: 720, height: 450 } },
  ]) {
    variants[variant.name] = await runResponsiveVariant(browser, variant)
  }
  console.log(JSON.stringify({ desktop, emptyFixtureList, mobile, tablet, variants }, null, 2))
  console.log('PASS Game Day workspace split browser: operational order, progressive disclosure, responsive matrix, URL state, keyboard state, dark mode, screenshots, and zero communication or data mutation')
} catch (error) {
  console.error(server.getOutput())
  throw error
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}
