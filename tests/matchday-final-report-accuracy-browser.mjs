import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import { chromium } from 'playwright'

const fixturePassword = 'FixturePass123!'
const port = Number(process.env.MATCHDAY_FINAL_REPORT_ACCURACY_BROWSER_PORT || 5650 + Math.floor(Math.random() * 300))
const baseUrl = `http://127.0.0.1:${port}`
const artifactDir = 'output/playwright/fp-v1-gameday-final-report-accuracy-10'
const fixtureMatchId = '11111111-1111-4111-8111-111111111111'

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPort(timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const ready = await new Promise((resolve) => {
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

    if (ready) return
    await wait(100)
  }

  throw new Error(`Timed out waiting for ${baseUrl}`)
}

function startServer() {
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BROWSER: 'none',
      VITE_APP_URL: baseUrl,
      VITE_PARENT_APP_URL: baseUrl,
      VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
      VITE_SUPABASE_URL: 'http://fixture.supabase.test',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
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
  if (server.child.exitCode === null) server.child.kill('SIGKILL')
}

async function fulfillJson(route, status, payload) {
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

function rawEvent(id, eventType, teamSide, minute, scorerName, overrides = {}) {
  return {
    id,
    match_day_id: fixtureMatchId,
    event_type: eventType,
    event_status: 'active',
    team_side: teamSide,
    minute,
    scorer_name: scorerName,
    scorer_initials: scorerName ? scorerName.slice(0, 1) : '',
    home_score: 2,
    away_score: 1,
    created_at: `2026-07-08T19:${String(Number(minute) % 60).padStart(2, '0')}:00Z`,
    ...overrides,
  }
}

function fixtureMatch({ isScorer = false } = {}) {
  const events = [
    rawEvent('goal-home-12', 'goal', 'club', 12, 'Dani Olmo', { home_score: 1, away_score: 0 }),
    rawEvent('card-away-35', 'yellow_card', 'opponent', 35, 'Enzo Fernández'),
    rawEvent('card-away-52', 'yellow_card', 'opponent', 52, 'Nicolás Otamendi'),
    rawEvent('water-home-60', 'water_break', 'club', 60, ''),
    rawEvent('sub-away-67-a', 'substitution', 'opponent', 67, 'Ángel Di María', {
      assist_name: 'Julián Álvarez',
      event_sequence: 1,
      created_at: '2026-07-08T19:17:00Z',
    }),
    rawEvent('sub-away-67-b', 'substitution', 'opponent', 67, 'Julián Álvarez', {
      assist_name: 'Lautaro Martínez',
      event_sequence: 2,
      created_at: '2026-07-08T19:17:01Z',
    }),
    rawEvent('card-away-80', 'yellow_card', 'opponent', 80, "Rodrigo De Paul-O'Connor"),
    rawEvent('card-away-90', 'yellow_card', 'opponent', 90, 'Alexis Mac Allister'),
    rawEvent('card-away-116', 'red_card', 'opponent', 116, 'Leandro Paredes'),
    rawEvent('card-away-128', 'yellow_card', 'opponent', 128, 'María del Carmen Ruiz', { notes: 'Staff tactical note must stay private' }),
  ]

  return {
    id: fixtureMatchId,
    club_id: 'club-fixture',
    team_id: 'team-spain',
    teams: { name: 'Spain' },
    opponent: 'Argentina',
    match_date: '2026-07-08',
    kickoff_time: '18:30:00',
    arrival_time: '18:00:00',
    home_away: 'home',
    match_duration_minutes: 130,
    venue_name: 'Final Report Test Ground',
    venue_address: '1 Test Way',
    notes: 'Parent-visible fixture note',
    parent_visible: true,
    parent_audience: 'involved_players',
    status: 'full_time',
    home_score: 2,
    away_score: 1,
    timer_status: 'full_time',
    timer_elapsed_seconds: 7800,
    is_scorer: isScorer,
    role_assignments: isScorer
      ? [{ role: 'scorer', parentLinkId: 'parent-link-fixture', isCurrentParent: true }]
      : [],
    created_at: '2026-07-08T16:00:00Z',
    updated_at: '2026-07-08T20:40:00Z',
    match_day_scorer_interest: [],
    match_day_scorer_assignments: [],
    match_day_role_assignments: [],
    match_day_player_availability: [],
    match_day_player_squad_decisions: [],
    match_day_player_availability_history: [],
    match_day_availability_requests: [],
    match_day_event_log: [],
    match_day_final_reports: [{
      match_day_id: fixtureMatchId,
      staff_notes: 'Private staff final report note',
      created_by_name: 'Coach Fixture',
      created_at: '2026-07-08T20:45:00Z',
      updated_by_name: 'Coach Fixture',
      updated_at: '2026-07-08T20:45:00Z',
    }],
    match_day_events: events,
  }
}

async function prepareContext(browser, viewport, { isScorer = false } = {}) {
  const context = await browser.newContext({ viewport })
  const match = fixtureMatch({ isScorer })
  const saveRequests = []

  await context.route('**/.netlify/functions/**', async (route) => {
    await fulfillJson(route, 200, { authorized: false, success: true })
  })
  await context.route('http://fixture.supabase.test/rest/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (request.method() === 'OPTIONS') {
      await fulfillJson(route, 204, {})
      return
    }

    if (url.pathname.endsWith('/rpc/save_match_day_final_report')) {
      saveRequests.push(request.postDataJSON())
      await fulfillJson(route, 200, match.match_day_final_reports[0])
      return
    }

    if (url.pathname.endsWith('/rpc/get_parent_portal_match_days')) {
      await fulfillJson(route, 200, [match])
      return
    }

    if (url.pathname.endsWith('/rpc/get_parent_portal_match_day_players')) {
      await fulfillJson(route, 200, [{ id: 'player-fixture', player_name: 'Fixture Child', shirt_number: '9', status: 'active' }])
      return
    }

    if (url.pathname.endsWith('/match_days')) {
      await fulfillJson(route, 200, [match])
      return
    }

    if (url.pathname.endsWith('/teams')) {
      await fulfillJson(route, 200, [{ id: 'team-spain', club_id: 'club-fixture', name: 'Spain' }])
      return
    }

    await fulfillJson(route, 200, [])
  })

  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  const criticalResourceFailures = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText || 'failed'

    if (errorText !== 'net::ERR_ABORTED' && ['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      criticalResourceFailures.push(`${request.resourceType()}: ${request.url()} ${errorText}`)
    }
  })
  page.on('response', (response) => {
    if (response.status() >= 400 && ['document', 'script', 'stylesheet'].includes(response.request().resourceType())) {
      criticalResourceFailures.push(`${response.request().resourceType()}: ${response.url()} ${response.status()}`)
    }
  })

  return { consoleErrors, context, criticalResourceFailures, page, pageErrors, saveRequests }
}

async function signIn(page, { parent = false } = {}) {
  await page.goto(`${baseUrl}/sign-in${parent ? '?tab=parent' : ''}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByPlaceholder('you@club.com').waitFor({ state: 'visible', timeout: 30000 })
  await page.getByRole('button', { name: parent ? 'Parent' : 'Club' }).click()
  await page.getByPlaceholder('you@club.com').fill(parent ? 'parent.fixture@footballplayer.test' : 'coach.fixture@footballplayer.test')
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL(parent ? '**/parent-portal' : '**/coach', { timeout: 30000 })
}

async function openStaffReport(page) {
  await page.goto(`${baseUrl}/match-day`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('heading', { name: 'Previous games' }).waitFor({ state: 'visible', timeout: 30000 })
  await page.getByRole('button', { name: 'Show previous games' }).click()
  await page.getByText('Spain v Argentina', { exact: true }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Final Match Report' }).click()
  return page.getByRole('region', { name: 'Final Match Report' })
}

async function openParentReport(page) {
  await page.goto(`${baseUrl}/parent-portal?section=results`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('heading', { name: 'Shared results' }).waitFor({ state: 'visible', timeout: 30000 })
  await page.getByRole('button', { name: /Spain v Argentina/ }).click()
  return page.getByRole('dialog', { name: 'Previous game details' })
}

async function assertCompletedReport(report, { parent = false } = {}) {
  await report.getByRole('heading', { name: 'Cards summary' }).waitFor({ state: 'visible' })
  await report.getByText('Enzo Fernández', { exact: true }).first().waitFor({ state: 'visible' })
  await report.getByText("Rodrigo De Paul-O'Connor", { exact: true }).first().waitFor({ state: 'visible' })
  await report.getByText('María del Carmen Ruiz', { exact: true }).first().waitFor({ state: 'visible' })

  const cardSection = report.getByRole('heading', { name: 'Card events' }).locator('xpath=ancestor::section[1]')
  const cardRows = await cardSection.locator('li').allTextContents()
  assert.equal(cardRows.length, 6)
  assert.deepEqual(cardRows.map((row) => Number(row.match(/(\d+)'/)?.[1])), [128, 116, 90, 80, 52, 35])
  assert.ok(cardRows.every((row) => row.includes('Argentina')))

  const substitutionSection = report.getByRole('heading', { name: 'Substitutions summary' }).locator('xpath=ancestor::section[1]')
  const substitutionRows = await substitutionSection.locator('li').allTextContents()
  assert.match(substitutionRows[0], /Julián Álvarez off, Lautaro Martínez on/)
  assert.match(substitutionRows[1], /Ángel Di María off, Julián Álvarez on/)

  const timelineSection = report.getByRole('heading', { name: 'Full event timeline' }).locator('xpath=ancestor::section[1]')
  const timelineRows = await timelineSection.locator('li').allTextContents()
  const timelineMinuteLabels = await timelineSection.locator('li > div > span').allTextContents()
  assert.deepEqual(timelineMinuteLabels.map((label) => Number(label.match(/(\d+)'/)?.[1])), [12, 35, 52, 60, 67, 67, 80, 90, 116, 128])
  assert.match(timelineRows[4], /Ángel Di María off, Julián Álvarez on/)
  assert.match(timelineRows[5], /Julián Álvarez off, Lautaro Martínez on/)

  if (parent) {
    assert.equal(await report.getByText('Private staff final report note', { exact: true }).count(), 0)
    assert.equal(await report.getByText('Staff tactical note must stay private', { exact: true }).count(), 0)
    assert.equal(await report.getByLabel('Staff notes').count(), 0)
  } else {
    await report.getByLabel('Staff notes').waitFor({ state: 'visible' })
    await report.getByText('Staff tactical note must stay private', { exact: false }).first().waitFor({ state: 'visible' })
  }
}

function assertNoPageFailures(session, label) {
  assert.deepEqual(session.pageErrors, [], `${label} page errors`)
  assert.deepEqual(session.criticalResourceFailures, [], `${label} critical resource failures`)
  assert.deepEqual(session.consoleErrors, [], `${label} console errors`)
}

async function run() {
  await mkdir(artifactDir, { recursive: true })
  const server = startServer()
  let browser

  try {
    await waitForPort()
    browser = await chromium.launch({ headless: true })
    const viewports = [
      { name: 'desktop', size: { width: 1280, height: 900 } },
      { name: 'mobile', size: { width: 390, height: 844 } },
    ]

    for (const viewport of viewports) {
      const staff = await prepareContext(browser, viewport.size)
      await signIn(staff.page)
      const staffReport = await openStaffReport(staff.page)
      await assertCompletedReport(staffReport)
      assert.equal(await staff.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      assertNoPageFailures(staff, `staff ${viewport.name}`)
      await staff.page.screenshot({ path: `${artifactDir}/staff-${viewport.name}.png`, fullPage: true })
      await staff.context.close()

      const scorer = await prepareContext(browser, viewport.size, { isScorer: true })
      await signIn(scorer.page, { parent: true })
      const scorerReport = await openParentReport(scorer.page)
      await assertCompletedReport(scorerReport, { parent: true })
      assert.equal(scorer.saveRequests.length, 0)
      assert.equal(await scorer.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      assertNoPageFailures(scorer, `accepted scorer ${viewport.name}`)
      await scorer.page.screenshot({ path: `${artifactDir}/accepted-scorer-${viewport.name}.png`, fullPage: true })
      await scorer.context.close()

      const ordinary = await prepareContext(browser, viewport.size)
      await signIn(ordinary.page, { parent: true })
      const ordinaryReport = await openParentReport(ordinary.page)
      await assertCompletedReport(ordinaryReport, { parent: true })
      assert.equal(ordinary.saveRequests.length, 0)
      assert.equal(await ordinary.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      assertNoPageFailures(ordinary, `ordinary parent ${viewport.name}`)
      await ordinary.page.screenshot({ path: `${artifactDir}/ordinary-parent-${viewport.name}.png`, fullPage: true })
      await ordinary.context.close()

      process.stdout.write(`PASS ${viewport.name}: staff, accepted scorer, ordinary parent, Spain versus Argentina ordering, privacy, overflow, and page safety\n`)
    }
  } catch (error) {
    console.error(server.getOutput())
    throw error
  } finally {
    if (browser) await browser.close()
    await stopServer(server)
  }
}

await run()
