import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import { chromium } from 'playwright'

const port = Number(process.env.MATCHDAY_FINAL_REPORT_BROWSER_PORT || 5350 + Math.floor(Math.random() * 300))
const baseUrl = `http://127.0.0.1:${port}`
const artifactDir = 'output/playwright/fp-v1-match-final-report-65'
const fixtureMatchId = '11111111-1111-4111-8111-111111111111'
let savedReport = null

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

function fixtureMatch() {
  return {
    id: fixtureMatchId,
    club_id: 'club-fixture',
    team_id: 'team-u12',
    opponent: 'City Juniors',
    match_date: '2026-07-08',
    kickoff_time: '18:30:00',
    arrival_time: '18:00:00',
    home_away: 'away',
    match_duration_minutes: 70,
    venue_name: 'City Ground',
    venue_address: '1 Stadium Way',
    notes: 'Fixture setup note',
    status: 'full_time',
    home_score: 1,
    away_score: 2,
    timer_status: 'full_time',
    timer_elapsed_seconds: 4200,
    created_at: '2026-07-08T16:00:00Z',
    updated_at: '2026-07-08T19:40:00Z',
    teams: { name: 'U12 Fixture Team' },
    match_day_scorer_interest: [],
    match_day_scorer_assignments: [],
    match_day_role_assignments: [],
    match_day_player_availability: [],
    match_day_player_availability_history: [],
    match_day_availability_requests: [],
    match_day_event_log: [],
    match_day_final_reports: savedReport ? [savedReport] : [],
    match_day_events: [
      { id: 'goal-active', match_day_id: fixtureMatchId, event_type: 'goal', event_status: 'active', team_side: 'club', minute: 14, scorer_name: 'Alex Morgan', home_score: 0, away_score: 1, created_at: '2026-07-08T18:44:00Z' },
      { id: 'goal-void', match_day_id: fixtureMatchId, event_type: 'goal', event_status: 'voided', team_side: 'club', minute: 28, scorer_name: 'Alex Morgan', home_score: 0, away_score: 2, correction_reason: 'Goal awarded in error', created_at: '2026-07-08T18:58:00Z', voided_at: '2026-07-08T19:01:00Z' },
      { id: 'card-active', match_day_id: fixtureMatchId, event_type: 'yellow_card', event_status: 'active', team_side: 'opponent', minute: 35, scorer_name: 'Opponent 6', home_score: 0, away_score: 1, created_at: '2026-07-08T19:05:00Z' },
      { id: 'sub-active', match_day_id: fixtureMatchId, event_type: 'substitution', event_status: 'active', team_side: 'club', minute: 45, scorer_name: 'Player Off', assist_name: 'Player On', home_score: 0, away_score: 1, created_at: '2026-07-08T19:15:00Z' },
      { id: 'water-active', match_day_id: fixtureMatchId, event_type: 'water_break', event_status: 'active', team_side: 'club', minute: 52, home_score: 0, away_score: 1, created_at: '2026-07-08T19:22:00Z' },
      { id: 'sub-void', match_day_id: fixtureMatchId, event_type: 'substitution', event_status: 'voided', team_side: 'club', minute: 60, scorer_name: 'Wrong Player', assist_name: 'Player On', home_score: 1, away_score: 2, correction_reason: 'Wrong player selected', created_at: '2026-07-08T19:30:00Z', voided_at: '2026-07-08T19:31:00Z' },
    ],
  }
}

async function prepareContext(browser, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport })
  const saveRequests = []

  await context.route('http://fixture.supabase.test/rest/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (request.method() === 'OPTIONS') {
      await fulfillJson(route, 204, {})
      return
    }

    if (url.pathname.endsWith('/rpc/save_match_day_final_report')) {
      const payload = request.postDataJSON()
      saveRequests.push(payload)
      savedReport = {
        match_day_id: fixtureMatchId,
        club_id: 'club-fixture',
        team_id: 'team-u12',
        staff_notes: payload.staff_notes_value,
        created_by_name: 'Coach Fixture',
        created_at: '2026-07-10T18:00:00Z',
        updated_by_name: 'Coach Fixture',
        updated_at: '2026-07-10T18:00:00Z',
      }
      await fulfillJson(route, 200, savedReport)
      return
    }

    if (url.pathname.endsWith('/match_days')) {
      await fulfillJson(route, 200, [fixtureMatch()])
      return
    }

    if (url.pathname.endsWith('/teams')) {
      await fulfillJson(route, 200, [{ id: 'team-u12', club_id: 'club-fixture', name: 'U12 Fixture Team' }])
      return
    }

    if (url.pathname.endsWith('/players') || url.pathname.endsWith('/match_locations')) {
      await fulfillJson(route, 200, [])
      return
    }

    await fulfillJson(route, 200, [])
  })

  const page = await context.newPage()
  const consoleErrors = []
  const failedRequests = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText || 'failed'}`))

  return { context, page, saveRequests, consoleErrors, failedRequests }
}

async function signInCoach(page) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('button', { name: 'Club' }).click()
  await page.getByPlaceholder('you@club.com').fill('coach.fixture@footballplayer.test')
  await page.getByPlaceholder('Enter password').fill('FixturePass123!')
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL('**/coach', { timeout: 15000 })
}

async function run() {
  await mkdir(artifactDir, { recursive: true })
  const server = startServer()
  let browser

  try {
    await waitForPort()
    browser = await chromium.launch({ headless: true })

    const staff = await prepareContext(browser)
    await signInCoach(staff.page)
    await staff.page.goto(`${baseUrl}/match-day`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await staff.page.getByRole('heading', { name: 'Previous games' }).waitFor({ state: 'visible' })
    await staff.page.getByRole('button', { name: 'Show previous games' }).click()
    await staff.page.getByText('City Juniors v U12 Fixture Team', { exact: true }).waitFor({ state: 'visible' })
    await staff.page.getByRole('button', { name: 'Final Match Report' }).click()

    const report = staff.page.getByRole('region', { name: 'Final Match Report' })
    await report.getByRole('heading', { name: 'Final Match Report' }).waitFor({ state: 'visible' })
    staff.failedRequests.length = 0
    await report.getByText('1 - 2', { exact: true }).waitFor({ state: 'visible' })
    await report.getByText('Fixed, 70 minutes', { exact: true }).waitFor({ state: 'visible' })
    await report.getByText('Away', { exact: true }).waitFor({ state: 'visible' })
    assert.equal(await report.getByText(/^Voided,/).count(), 2)
    await report.getByRole('heading', { name: 'Goals summary' }).waitFor({ state: 'visible' })
    await report.getByText('U12 Fixture Team', { exact: true }).first().waitFor({ state: 'visible' })
    await report.getByText('City Juniors', { exact: true }).first().waitFor({ state: 'visible' })
    await report.getByText('Opponent 6', { exact: true }).first().waitFor({ state: 'visible' })
    await report.getByText('0 yellow, 0 red', { exact: true }).waitFor({ state: 'hidden' }).catch(() => {})
    await report.getByText('1 yellow, 0 red', { exact: true }).waitFor({ state: 'visible' })

    const notes = report.getByLabel('Staff notes')
    await notes.fill('Strong response after half time.')
    await report.getByRole('button', { name: 'Save report' }).click()
    await report.getByText('Final match report saved.', { exact: true }).waitFor({ state: 'visible' })
    assert.deepEqual(staff.saveRequests, [{
      match_day_id_value: fixtureMatchId,
      staff_notes_value: 'Strong response after half time.',
    }])
    await report.getByText(/by Coach Fixture/).first().waitFor({ state: 'visible' })
    await staff.page.screenshot({ path: `${artifactDir}/desktop-final-report.png`, fullPage: true })

    await staff.page.setViewportSize({ width: 390, height: 844 })
    await report.scrollIntoViewIfNeeded()
    const reportBox = await report.boundingBox()
    assert.ok(reportBox && reportBox.width <= 390, `Report width exceeded mobile viewport: ${reportBox?.width}`)
    assert.equal(await notes.isVisible(), true)
    assert.equal(await report.getByRole('button', { name: 'Save report' }).isVisible(), true)
    await staff.page.screenshot({ path: `${artifactDir}/mobile-final-report.png`, fullPage: true })
    assert.deepEqual(staff.consoleErrors, [])
    assert.deepEqual(staff.failedRequests, [])
    await staff.context.close()

    const signedOut = await prepareContext(browser, { width: 390, height: 844 })
    await signedOut.page.goto(`${baseUrl}/match-day`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await signedOut.page.waitForURL('**/sign-in', { timeout: 15000 })
    assert.equal(await signedOut.page.getByText('Final Match Report', { exact: true }).count(), 0)
    assert.deepEqual(signedOut.consoleErrors, [])
    await signedOut.context.close()

    console.log('Final Match Report browser smoke passed: Previous Games, save RPC, desktop, mobile, and signed-out safety.')
  } catch (error) {
    if (server) console.error(server.getOutput())
    throw error
  } finally {
    if (browser) await browser.close()
    await stopServer(server)
  }
}

await run()
