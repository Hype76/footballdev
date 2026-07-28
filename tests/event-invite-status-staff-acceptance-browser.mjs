import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium } from 'playwright'

const port = Number(process.env.EVENT_INVITE_BROWSER_PORT || 5100 + Math.floor(Math.random() * 300))
const baseUrl = `http://127.0.0.1:${port}`
const fixturePassword = 'FixturePass123!'

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function dateAtOffset(offset, hour = 18) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  date.setHours(hour, 0, 0, 0)
  return date
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10)
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
  const child = spawn(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSER: 'none',
        VITE_APP_URL: baseUrl,
        VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
        VITE_PARENT_APP_URL: baseUrl,
        VITE_SUPABASE_ANON_KEY: 'fixture-anon-key',
        VITE_SUPABASE_URL: 'http://fixture.supabase.test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
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

const matchDate = dateAtOffset(2, 15)
const trainingDate = dateAtOffset(3, 18)
const matchState = {
  availability: [
    {
      id: 'availability-selected',
      match_day_id: 'match-fixture',
      player_id: 'selected-player',
      player_name: 'Selected Player',
      status: 'available',
    },
  ],
  requests: [
    {
      id: 'request-pending',
      match_day_id: 'match-fixture',
      player_id: 'pending-player',
      player_name: 'Pending Player',
      status: 'pending',
    },
  ],
}
let trainingAccepted = false

function matchRow() {
  return {
    id: 'match-fixture',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    opponent: 'FP TEST Match Invite',
    fixture_type: 'league',
    match_conclusion_rule: 'normal_time',
    current_match_phase: 'pre_match',
    match_date: dateOnly(matchDate),
    kickoff_time: '15:00',
    kickoff_time_tbc: false,
    arrival_time: '14:15',
    home_away: 'home',
    match_clock_mode: 'fixed',
    match_duration_minutes: 90,
    venue_name: 'Fixture Ground',
    venue_address: '',
    auto_select_available_players: true,
    status: 'scheduled',
    teams: { name: 'U12 Fixture Team' },
    match_day_availability_requests: matchState.requests,
    match_day_player_availability: matchState.availability,
    match_day_player_squad_decisions: [
      {
        id: 'decision-selected',
        match_day_id: 'match-fixture',
        club_id: 'club-fixture',
        team_id: 'team-u12',
        player_id: 'selected-player',
        status: 'selected',
      },
    ],
    match_day_player_availability_history: [],
    match_day_event_log: [],
    match_day_events: [],
    match_day_role_assignments: [],
    match_day_scorer_assignments: [],
    match_day_scorer_interest: [],
    match_day_shootout_kicks: [],
    match_day_final_reports: [],
  }
}

function trainingRequestRows() {
  return [
    {
      id: 'training-request-player',
      request_id: 'training-request',
      calendar_event_id: 'training-event',
      player_id: 'training-player',
      player_name: 'Training Player',
      status: trainingAccepted ? 'responded' : 'sent',
      training_availability_requests: {
        id: 'training-request',
        occurrence_date: dateOnly(trainingDate),
        occurrence_starts_at: trainingDate.toISOString(),
      },
      training_availability_responses: trainingAccepted
        ? [{
            status: 'available',
            note: '',
            responded_at: new Date().toISOString(),
            responded_by_name: 'Manager Fixture',
          }]
        : [],
    },
  ]
}

const calendarRows = [
  {
    id: 'training-event',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    event_type: 'training',
    title: 'FP TEST Training Invite',
    starts_at: trainingDate.toISOString(),
    ends_at: new Date(trainingDate.getTime() + 90 * 60 * 1000).toISOString(),
    location: 'Training Ground',
    notes: '',
    recurrence_frequency: 'none',
    parent_visible: true,
    parent_audience: 'involved_players',
  },
]

const playerRows = [
  { id: 'selected-player', club_id: 'club-fixture', team_id: 'team-u12', player_name: 'Selected Player', section: 'Squad', team: 'U12 Fixture Team', status: 'active' },
  { id: 'pending-player', club_id: 'club-fixture', team_id: 'team-u12', player_name: 'Pending Player', section: 'Squad', team: 'U12 Fixture Team', status: 'active' },
  { id: 'training-player', club_id: 'club-fixture', team_id: 'team-u12', player_name: 'Training Player', section: 'Squad', team: 'U12 Fixture Team', status: 'active' },
]

const inviteRows = [
  {
    id: 'invite-selected',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    match_day_id: 'match-fixture',
    player_id: 'selected-player',
    invite_status: 'active',
    players: playerRows[0],
  },
  {
    id: 'invite-pending',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    match_day_id: 'match-fixture',
    player_id: 'pending-player',
    invite_status: 'active',
    players: playerRows[1],
  },
  {
    id: 'invite-training',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    calendar_event_id: 'training-event',
    player_id: 'training-player',
    invite_status: 'active',
    players: playerRows[2],
  },
]

function json(route, body, status = 200) {
  return route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    headers: { 'content-range': `0-${Array.isArray(body) ? Math.max(body.length - 1, 0) : 0}/*` },
    status,
  })
}

async function preparePage(context) {
  await context.route('**/auth/v1/**', (route) => json(route, {}))
  await context.route('**/.netlify/functions/**', (route) => json(route, { success: false }, 404))
  await context.route('**/rest/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (path.endsWith('/rpc/accept_event_player_availability_on_behalf')) {
      const payload = request.postDataJSON()

      if (payload.event_type_value === 'match') {
        if (!matchState.availability.some((row) => row.player_id === payload.player_id_value)) {
          matchState.availability.push({
            id: 'availability-pending',
            match_day_id: 'match-fixture',
            player_id: payload.player_id_value,
            player_name: 'Pending Player',
            status: 'available',
          })
        }
      } else if (payload.event_type_value === 'training') {
        trainingAccepted = true
      }

      return json(route, {
        changed: true,
        eventId: payload.event_id_value,
        eventType: payload.event_type_value,
        occurrenceDate: payload.occurrence_date_value,
        playerId: payload.player_id_value,
        previousStatus: 'pending',
        respondedAt: new Date().toISOString(),
        responseStatus: 'available',
        source: 'staff_on_behalf',
      })
    }

    if (path.endsWith('/match_days')) {
      return json(route, url.searchParams.has('id') ? matchRow() : [matchRow()])
    }
    if (path.endsWith('/players')) return json(route, playerRows)
    if (path.endsWith('/teams')) return json(route, [{ id: 'team-u12', club_id: 'club-fixture', name: 'U12 Fixture Team', status: 'active' }])
    if (path.endsWith('/calendar_events')) return json(route, calendarRows)
    if (path.endsWith('/calendar_event_invites')) return json(route, inviteRows)
    if (path.endsWith('/training_availability_settings')) {
      return json(route, [{ id: 'training-setting', club_id: 'club-fixture', team_id: 'team-u12', calendar_event_id: 'training-event', enabled: true, send_days_before: 2 }])
    }
    if (path.endsWith('/training_availability_request_players')) return json(route, trainingRequestRows())

    return json(route, [])
  })

  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  return { page, pageErrors }
}

async function signIn(page) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByPlaceholder('you@club.com').fill('manager.fixture@footballplayer.test')
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL('**/coach', { timeout: 15000 })
  await page.goto(`${baseUrl}/calendar`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('heading', { name: /Calendar$/ }).waitFor({ state: 'visible', timeout: 15000 })
}

async function openEvent(page, title) {
  const eventTitle = page.getByText(title, { exact: false }).first()

  try {
    await eventTitle.waitFor({ state: 'visible', timeout: 15000 })
  } catch (error) {
    console.error(await page.locator('body').innerText())
    throw error
  }

  await eventTitle.click()
  await page.getByRole('heading', { name: 'Calendar event' }).waitFor({ state: 'visible', timeout: 15000 })
}

const server = startDevServer()
let browser

try {
  await waitForPort()
  browser = await chromium.launch({ headless: true })

  const desktopContext = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 1000 } })
  const desktop = await preparePage(desktopContext)
  await signIn(desktop.page)
  await openEvent(desktop.page, 'FP TEST Match Invite')

  await desktop.page.getByRole('button', { name: 'Edit event' }).click()
  const desktopAutoSelect = desktop.page.getByRole('checkbox', { name: 'Automatically select players who respond Available' })
  await desktopAutoSelect.waitFor({ state: 'visible' })
  assert.equal(await desktopAutoSelect.isChecked(), true)
  await desktop.page.getByText('When enabled, invited players who respond Available will be added to the match selection automatically.').waitFor({ state: 'visible' })
  const desktopAutoSelectBox = await desktopAutoSelect.locator('xpath=..').boundingBox()
  assert.ok(desktopAutoSelectBox && desktopAutoSelectBox.height >= 48)
  await desktop.page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await openEvent(desktop.page, 'FP TEST Match Invite')

  const selectedChip = desktop.page.getByRole('button', { name: 'Selected Player: Selected, Available' })
  const pendingChip = desktop.page.getByRole('button', { name: 'Pending Player: Awaiting response' })
  await selectedChip.waitFor({ state: 'visible' })
  await pendingChip.waitFor({ state: 'visible' })

  await selectedChip.focus()
  await desktop.page.keyboard.press('Enter')
  const selectedConfirm = desktop.page.getByRole('dialog').last()
  await selectedConfirm.getByText('Current availability', { exact: true }).waitFor({ state: 'visible' })
  await selectedConfirm.getByText('Available', { exact: true }).waitFor({ state: 'visible' })
  await selectedConfirm.getByText('Match selection', { exact: true }).waitFor({ state: 'visible' })
  await selectedConfirm.getByText('Selected', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await selectedConfirm.getByRole('button', { name: 'Accept on behalf of player' }).isDisabled(), true)
  await selectedConfirm.getByRole('button', { name: 'Cancel' }).click()

  await pendingChip.click()
  const pendingConfirm = desktop.page.getByRole('dialog').last()
  await pendingConfirm.getByText('Awaiting response', { exact: true }).waitFor({ state: 'visible' })
  await pendingConfirm.getByRole('button', { name: 'Accept on behalf of player' }).click()
  await desktop.page.getByRole('button', { name: 'Pending Player: Available' }).waitFor({ state: 'visible', timeout: 15000 })

  await desktop.page.getByRole('button', { name: 'Close' }).last().click()
  await openEvent(desktop.page, 'FP TEST Training Invite')
  await desktop.page.getByRole('button', { name: 'Edit event' }).click()
  assert.equal(await desktop.page.getByRole('checkbox', { name: 'Automatically select players who respond Available' }).count(), 0)
  await desktop.page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await openEvent(desktop.page, 'FP TEST Training Invite')
  const trainingChip = desktop.page.getByRole('button', { name: 'Training Player: Awaiting response' })
  await trainingChip.click()
  const trainingConfirm = desktop.page.getByRole('dialog').last()
  assert.equal(await trainingConfirm.getByText('Match selection', { exact: true }).count(), 0)
  await trainingConfirm.getByRole('button', { name: 'Accept on behalf of player' }).click()
  await desktop.page.getByRole('button', { name: 'Training Player: Available' }).waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(await desktop.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await desktop.page.goto(`${baseUrl}/match-day`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await desktop.page.getByRole('heading', { name: 'Game Day' }).waitFor({ state: 'visible', timeout: 15000 })
  await desktop.page.getByRole('button', { name: 'Create fixture' }).first().click()
  const createAutoSelect = desktop.page.getByRole('checkbox', { name: 'Automatically select players who respond Available' })
  await createAutoSelect.waitFor({ state: 'visible' })
  assert.equal(await createAutoSelect.isChecked(), true)
  await desktop.page.getByText('When enabled, invited players who respond Available will be added to the match selection automatically.').waitFor({ state: 'visible' })
  assert.equal(await desktop.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  assert.deepEqual(desktop.pageErrors, [])
  await desktopContext.close()

  const mobileContext = await browser.newContext({ colorScheme: 'light', isMobile: true, viewport: { width: 390, height: 844 } })
  const mobile = await preparePage(mobileContext)
  await signIn(mobile.page)
  await openEvent(mobile.page, 'FP TEST Match Invite')
  await mobile.page.getByRole('button', { name: 'Edit event' }).click()
  const mobileAutoSelect = mobile.page.getByRole('checkbox', { name: 'Automatically select players who respond Available' })
  await mobileAutoSelect.waitFor({ state: 'visible' })
  assert.equal(await mobileAutoSelect.isChecked(), true)
  const mobileAutoSelectBox = await mobileAutoSelect.locator('xpath=..').boundingBox()
  assert.ok(mobileAutoSelectBox && mobileAutoSelectBox.height >= 48)
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await mobile.page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await openEvent(mobile.page, 'FP TEST Match Invite')
  const mobileChip = mobile.page.getByRole('button', { name: 'Pending Player: Available' })
  await mobileChip.waitFor({ state: 'visible' })
  const chipBox = await mobileChip.boundingBox()
  assert.ok(chipBox && chipBox.height >= 48)
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await mobileChip.click()
  await mobile.page.getByRole('dialog').last().getByText('Available', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  assert.deepEqual(mobile.pageErrors, [])
  await mobileContext.close()

  console.log('Event invite status, automatic match selection, and staff acceptance browser checks passed on desktop dark mode and mobile light mode.')
} catch (error) {
  console.error(server.getOutput())
  throw error
} finally {
  if (browser) {
    await browser.close()
  }
  await stopDevServer(server)
}
