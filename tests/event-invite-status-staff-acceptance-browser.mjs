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
      id: 'request-selected',
      match_day_id: 'match-fixture',
      player_id: 'selected-player',
      player_name: 'Selected Player',
      status: 'available',
      responded_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
    },
    {
      id: 'request-pending',
      match_day_id: 'match-fixture',
      player_id: 'pending-player',
      player_name: 'Pending Player',
      status: 'pending',
    },
  ],
  decisions: [
    {
      id: 'decision-selected',
      match_day_id: 'match-fixture',
      club_id: 'club-fixture',
      team_id: 'team-u12',
      player_id: 'selected-player',
      status: 'selected',
    },
  ],
}
let trainingAccepted = false
let invitationActionCount = 0
let invitationPreviewCount = 0
let calendarMutationCount = 0
let matchDayDetailReadCount = 0

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
    match_day_player_squad_decisions: matchState.decisions,
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

const bulkPlayerRows = Array.from({ length: 32 }, (_, index) => ({
  id: `bulk-player-${index + 1}`,
  club_id: 'club-fixture',
  team_id: 'team-u12',
  player_name: `Long List Player ${String(index + 1).padStart(2, '0')}`,
  section: 'Squad',
  team: 'U12 Fixture Team',
  status: 'active',
}))

const playerRows = [
  { id: 'selected-player', club_id: 'club-fixture', team_id: 'team-u12', player_name: 'Selected Player', section: 'Squad', team: 'U12 Fixture Team', status: 'active' },
  { id: 'pending-player', club_id: 'club-fixture', team_id: 'team-u12', player_name: 'Pending Player', section: 'Squad', team: 'U12 Fixture Team', status: 'active' },
  { id: 'training-player', club_id: 'club-fixture', team_id: 'team-u12', player_name: 'Training Player', section: 'Squad', team: 'U12 Fixture Team', status: 'active' },
  ...bulkPlayerRows,
]

const inviteRows = [
  {
    id: 'invite-selected',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    match_day_id: 'match-fixture',
    player_id: 'selected-player',
    invite_status: 'active',
    notify_requested: true,
    recipient_type: 'parent_guardian',
    response_requirement: 'response_required',
    players: playerRows[0],
  },
  {
    id: 'invite-pending',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    match_day_id: 'match-fixture',
    player_id: 'pending-player',
    invite_status: 'active',
    notify_requested: true,
    recipient_type: 'parent_guardian',
    response_requirement: 'response_required',
    players: playerRows[1],
  },
  {
    id: 'invite-training',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    calendar_event_id: 'training-event',
    player_id: 'training-player',
    invite_status: 'active',
    notify_requested: true,
    recipient_type: 'parent_guardian',
    response_requirement: 'response_required',
    players: playerRows[2],
  },
  ...bulkPlayerRows.map((player, index) => ({
    id: `invite-bulk-${index + 1}`,
    club_id: 'club-fixture',
    team_id: 'team-u12',
    match_day_id: 'match-fixture',
    player_id: player.id,
    invite_status: 'active',
    players: player,
  })),
]

function json(route, body, status = 200) {
  return route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    headers: { 'content-range': `0-${Array.isArray(body) ? Math.max(body.length - 1, 0) : 0}/*` },
    status,
  })
}

async function preparePage(context, { standalone = false } = {}) {
  if (standalone) {
    await context.addInitScript(() => {
      Object.defineProperty(window.navigator, 'standalone', {
        configurable: true,
        value: true,
      })
      const originalMatchMedia = window.matchMedia.bind(window)
      window.matchMedia = (query) => {
        if (query === '(display-mode: standalone)') {
          return {
            addEventListener() {},
            addListener() {},
            dispatchEvent() { return false },
            matches: true,
            media: query,
            onchange: null,
            removeEventListener() {},
            removeListener() {},
          }
        }

        return originalMatchMedia(query)
      }
    })
  }

  await context.route('**/auth/v1/**', (route) => json(route, {}))
  await context.route('**/.netlify/functions/**', (route) => json(route, { success: false }, 404))
  await context.route('**/.netlify/functions/send-event-player-invitation', (route) => {
    const payload = route.request().postDataJSON()

    if (payload.preview === true) {
      invitationPreviewCount += 1
      return json(route, {
        success: true,
        preview: true,
        playerId: payload.playerId,
        recipientCount: 1,
        recipients: [{ address: 'p***@example.test', type: 'Parent' }],
      })
    }

    invitationActionCount += 1
    return json(route, {
      success: true,
      duplicate: false,
      failedCount: 0,
      playerId: payload.playerId,
      recipientCount: 1,
    })
  })
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

    if (path.endsWith('/rpc/mark_event_player_unavailable_on_behalf')) {
      const payload = request.postDataJSON()
      const availability = matchState.availability.find((row) => row.player_id === payload.player_id_value)

      if (payload.event_type_value === 'match' && availability) {
        availability.status = 'unavailable'
      }

      return json(route, {
        changed: true,
        eventId: payload.event_id_value,
        eventType: payload.event_type_value,
        occurrenceDate: payload.occurrence_date_value,
        playerId: payload.player_id_value,
        previousStatus: 'available',
        respondedAt: new Date().toISOString(),
        responseStatus: 'unavailable',
        source: 'staff_on_behalf',
      })
    }

    if (
      path.endsWith('/rpc/set_match_day_player_squad_decision')
      || path.endsWith('/rpc/set_match_day_player_squad_decision_v2')
    ) {
      const payload = request.postDataJSON()
      const savedDecision = {
        id: 'decision-pending',
        match_day_id: payload.match_day_id_value,
        club_id: 'club-fixture',
        team_id: 'team-u12',
        player_id: payload.player_id_value,
        status: payload.decision_value,
        decided_at: new Date().toISOString(),
        decided_by_name: 'Manager Fixture',
      }
      matchState.decisions = [
        ...matchState.decisions.filter((row) => row.player_id !== payload.player_id_value),
        savedDecision,
      ]
      return json(route, [savedDecision])
    }

    if (path.endsWith('/rpc/get_staff_match_day_detail')) {
      matchDayDetailReadCount += 1
      return json(route, matchRow())
    }

    if (path.endsWith('/rpc/get_team_players')) {
      return json(route, playerRows)
    }

    if (path.endsWith('/rpc/get_player_linked_chat_context')) {
      const payload = request.postDataJSON()
      return json(route, {
        ok: true,
        playerId: payload.player_id_value,
        clubId: 'club-fixture',
        teamId: 'team-u12',
        permissions: {
          canStartParent: false,
          canStartStaff: true,
          canViewParent: true,
          canViewStaff: true,
        },
        conversations: [],
      })
    }

    if (path.endsWith('/match_days')) {
      if (url.searchParams.has('id')) {
        matchDayDetailReadCount += 1
      }
      return json(route, url.searchParams.has('id') ? matchRow() : [matchRow()])
    }
    if (path.endsWith('/players')) return json(route, playerRows)
    if (path.endsWith('/teams')) return json(route, [{ id: 'team-u12', club_id: 'club-fixture', name: 'U12 Fixture Team', status: 'active' }])
    if (path.endsWith('/calendar_events')) {
      if (request.method() !== 'GET') {
        calendarMutationCount += 1
      }
      return json(route, calendarRows)
    }
    if (path.endsWith('/calendar_event_invites')) return json(route, inviteRows)
    if (path.endsWith('/training_availability_settings')) {
      return json(route, [{ id: 'training-setting', club_id: 'club-fixture', team_id: 'team-u12', calendar_event_id: 'training-event', enabled: true, send_days_before: 2 }])
    }
    if (path.endsWith('/training_availability_request_players')) return json(route, trainingRequestRows())
    if (path.endsWith('/training_availability_responses')) {
      return json(route, trainingAccepted
        ? [{
            request_id: 'training-request',
            calendar_event_id: 'training-event',
            player_id: 'training-player',
            status: 'available',
            note: '',
            responded_at: new Date().toISOString(),
            responded_by_name: 'Manager Fixture',
            response_source: 'staff_on_behalf',
          }]
        : [])
    }

    return json(route, [])
  })

  const page = await context.newPage()
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  return { consoleErrors, page, pageErrors }
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

async function verifyMatchDayManagePlayersDeepLink(page) {
  await page.goto(`${baseUrl}/match-day`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('heading', { name: 'Game Day' }).waitFor({ state: 'visible', timeout: 15000 })
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      'view-cache:sessions:club-fixture:user-manager.fixture@footballplayer.test:50:team-u12',
      JSON.stringify({
        matchDays: [],
        players: [{ id: 'stale-player' }],
        sessions: [{ id: 'stale-session' }],
        teams: [{ id: 'team-u12', name: 'U12 Fixture Team' }],
      }),
    )
  })
  const detailReadsBeforeOpen = matchDayDetailReadCount
  const managePlayersButton = page.getByRole('button', { name: 'Manage invited players' })
  if (!await managePlayersButton.count()) {
    await page.getByRole('button', { name: /^Manage U12 Fixture Team v FP TEST Match Invite$/ }).click()
  }
  try {
    await managePlayersButton.waitFor({ state: 'visible', timeout: 15000 })
  } catch (error) {
    console.error(await page.locator('body').innerText())
    throw error
  }
  await managePlayersButton.click()
  const modal = page.getByTestId('calendar-event-modal')
  try {
    await modal.getByRole('heading', { name: 'Manage invited players' }).waitFor({ state: 'visible', timeout: 15000 })
  } catch (error) {
    console.error(await page.locator('body').innerText())
    throw error
  }
  await modal.getByText('FP TEST Match Invite', { exact: false }).first().waitFor({ state: 'visible' })
  assert.ok(matchDayDetailReadCount > detailReadsBeforeOpen)
  assert.equal(await page.getByText('The requested event could not be opened in the saved event context.').count(), 0)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.getByRole('button', { name: 'Close calendar event' }).click()
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
  await verifyMatchDayManagePlayersDeepLink(desktop.page)
  await desktop.page.goto(`${baseUrl}/calendar?action=view&eventId=training-event&source=calendar`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const managerHomeDeepLinkModal = desktop.page.getByTestId('calendar-event-modal')
  await managerHomeDeepLinkModal.getByRole('heading', { name: 'Calendar event' }).waitFor({ state: 'visible', timeout: 15000 })
  await managerHomeDeepLinkModal.getByText('FP TEST Training Invite', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(calendarMutationCount, 0)
  await managerHomeDeepLinkModal.getByRole('button', { name: 'Close calendar event' }).click()
  await desktop.page.waitForURL(`${baseUrl}/calendar`, { timeout: 15000 })
  await desktop.page.getByRole('button', { name: 'Add event', exact: true }).click()
  await desktop.page.getByRole('heading', { name: 'Add calendar event' }).waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(calendarMutationCount, 0)
  await desktop.page.getByRole('button', { name: 'Close calendar event' }).click()
  await desktop.page.waitForURL(`${baseUrl}/calendar`, { timeout: 15000 })
  await desktop.page.goto(`${baseUrl}/sessions/start?action=create-session`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await desktop.page.getByTestId('calendar-event-modal').getByRole('heading', { name: 'Create session' }).waitFor({ state: 'visible', timeout: 15000 })
  const quickTrainingAvailability = desktop.page.getByRole('checkbox', { name: /Request player availability/ })
  await quickTrainingAvailability.waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(await desktop.page.getByLabel('Send days before').count(), 0)
  await quickTrainingAvailability.check()
  await desktop.page.getByLabel('Send days before').waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(await desktop.page.getByLabel('Share with parents?').count(), 0)
  await desktop.page.getByText('Availability requests will be sent to eligible Parents or adult Players', { exact: false }).waitFor({ state: 'visible' })
  await desktop.page.getByRole('button', { name: 'Save changes', exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(calendarMutationCount, 0)
  await desktop.page.getByRole('button', { name: 'Close calendar event' }).click()
  await desktop.page.goto(`${baseUrl}/calendar`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await desktop.page.goto(`${baseUrl}/calendar?action=add-event`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  try {
    await desktop.page.getByRole('heading', { name: 'Add calendar event' }).waitFor({ state: 'visible', timeout: 15000 })
  } catch (error) {
    console.error(desktop.consoleErrors)
    console.error(desktop.pageErrors)
    console.error(await desktop.page.locator('body').innerText())
    throw error
  }
  await desktop.page.goBack({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await desktop.page.getByRole('heading', { name: /Calendar$/ }).waitFor({ state: 'visible', timeout: 15000 })
  await desktop.page.goForward({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await desktop.page.getByRole('heading', { name: 'Add calendar event' }).waitFor({ state: 'visible', timeout: 15000 })
  await desktop.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await desktop.page.getByRole('heading', { name: 'Add calendar event' }).waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(calendarMutationCount, 0)
  await desktop.page.getByRole('button', { name: 'Close calendar event' }).click()
  await desktop.page.waitForURL(`${baseUrl}/calendar`, { timeout: 15000 })
  assert.equal(calendarMutationCount, 0)
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

  const desktopSummary = desktop.page.getByTestId('event-response-summary')
  await desktopSummary.waitFor({ state: 'visible' })
  await desktopSummary.getByText('34 participants', { exact: true }).waitFor({ state: 'visible' })
  await desktopSummary.getByText('Available', { exact: true }).waitFor({ state: 'visible' })
  await desktopSummary.getByText('Awaiting response', { exact: true }).waitFor({ state: 'visible' })
  await desktopSummary.getByText('Invitation not sent', { exact: true }).waitFor({ state: 'visible' })
  await desktopSummary.getByText('Selected', { exact: true }).waitFor({ state: 'visible' })
  await desktopSummary.getByText('Not selected', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await desktop.page.getByText('Invited players', { exact: true }).count(), 0)

  const desktopViewResponses = desktopSummary.getByRole('button', { name: 'View responses' })
  await desktopViewResponses.click()
  const desktopManager = desktop.page.getByTestId('event-response-manager')
  await desktopManager.waitFor({ state: 'visible' })
  await desktopManager.getByText('34 of 34 players', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await desktopManager.locator('[role="row"][data-player-id]').count(), 34)
  assert.deepEqual(
    await desktopManager.locator('[role="rowgroup"] h3').allTextContents(),
    ['Available (1)', 'Awaiting response (1)', 'Invitation not sent (32)'],
  )

  const desktopPlayerProfileButton = desktopManager.getByRole('button', { name: 'Open Pending Player player profile' })
  await desktopPlayerProfileButton.focus()
  await desktop.page.keyboard.press('Enter')
  await desktop.page.waitForURL((url) => (
    url.pathname === '/player/Pending%20Player'
    && url.searchParams.get('playerId') === 'pending-player'
    && url.searchParams.get('teamId') === 'team-u12'
    && url.searchParams.get('clubId') === 'club-fixture'
  ), { timeout: 15000 })
  await desktop.page.goBack({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await desktop.page.getByTestId('event-response-manager').waitFor({ state: 'visible', timeout: 15000 })

  await desktopManager.getByRole('tab', { name: 'Invitation not sent (32)' }).click()
  assert.equal(await desktopManager.locator('[role="row"][data-player-id]').count(), 32)
  const desktopSearch = desktopManager.getByRole('searchbox', { name: 'Search players' })
  await desktopSearch.fill('long list player 17')
  await desktopManager.getByText('1 of 34 players', { exact: true }).waitFor({ state: 'visible' })
  await desktopManager.getByText('Long List Player 17', { exact: true }).waitFor({ state: 'visible' })
  await desktopManager.getByRole('button', { name: 'Clear search' }).click()
  await desktopManager.getByRole('tab', { name: 'Awaiting response (1)' }).click()

  const pendingRow = desktopManager.locator('[role="row"][data-player-id="pending-player"]')
  await pendingRow.getByRole('button', { name: 'Expand' }).click()
  const pendingDetailsRow = desktopManager.locator('[role="row"][data-player-id="pending-player-details"]')
  await pendingDetailsRow.getByRole('button', { name: 'Actions for Pending Player' }).click()
  await pendingDetailsRow.getByRole('menuitem', { name: 'Resend invitation' }).click()
  const resendConfirm = desktop.page.getByRole('dialog').last()
  await resendConfirm.getByText('p***@example.test', { exact: true }).waitFor({ state: 'visible' })
  await resendConfirm.getByRole('button', { name: 'Resend invitation' }).click()
  await wait(500)
  assert.equal(invitationPreviewCount, 1)
  assert.equal(invitationActionCount, 1)
  await pendingDetailsRow.getByRole('button', { name: 'Actions for Pending Player' }).click()
  await pendingDetailsRow.getByRole('menuitem', { name: 'Add to match squad' }).click()
  const selectConfirm = desktop.page.getByRole('dialog').last()
  await selectConfirm.getByText('Awaiting response', { exact: true }).waitFor({ state: 'visible' })
  await selectConfirm.getByRole('button', { name: 'Add to match squad' }).click()
  await pendingDetailsRow.getByText('Selected', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  await pendingDetailsRow.getByRole('button', { name: 'Actions for Pending Player' }).click()
  await pendingDetailsRow.getByRole('menuitem', { name: 'Mark available on behalf' }).click()
  const pendingConfirm = desktop.page.getByRole('dialog').last()
  await pendingConfirm.getByText('Awaiting response', { exact: true }).waitFor({ state: 'visible' })
  await pendingConfirm.getByRole('button', { name: 'Accept on behalf of player' }).click()
  await desktopManager.getByRole('tab', { name: 'Available (2)' }).waitFor({ state: 'visible', timeout: 15000 })
  await desktopManager.getByRole('tab', { name: 'All (34)' }).click()
  await desktopManager.locator('[role="row"][data-player-id="pending-player"]').getByText('Available', { exact: true }).nth(1).waitFor({ state: 'visible' })
  const acceptedPendingRow = desktopManager.locator('[role="row"][data-player-id="pending-player-details"]')
  await acceptedPendingRow.getByText('Selected', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  await acceptedPendingRow.getByRole('button', { name: 'Actions for Pending Player' }).click()
  await acceptedPendingRow.getByRole('menuitem', { name: 'Mark Unavailable' }).click()
  const unavailableConfirm = desktop.page.getByRole('dialog').last()
  await unavailableConfirm.getByRole('button', { name: 'Mark Unavailable' }).click()
  await desktopManager.getByRole('tab', { name: 'Unavailable (1)' }).waitFor({ state: 'visible', timeout: 15000 })
  await acceptedPendingRow.getByText('Selected', { exact: true }).waitFor({ state: 'visible' })
  await desktop.page.keyboard.press('Escape')
  await desktopManager.waitFor({ state: 'hidden' })
  await desktop.page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'View responses')
  assert.equal(await desktopViewResponses.evaluate((element) => element === document.activeElement), true)

  await desktopViewResponses.click()
  await desktop.page.getByTestId('event-response-manager').getByRole('button', { name: 'Add or remove players' }).click()
  const playerManagement = desktop.page.getByTestId('event-player-management')
  await playerManagement.waitFor({ state: 'visible', timeout: 15000 })
  await playerManagement.getByText('Review the player delta first. The safe default saves additions and removals without sending email, push, SMS, or invitation resends.', { exact: true }).waitFor({ state: 'visible' })

  await desktop.page.getByRole('button', { name: 'Close calendar event' }).click()
  await desktop.page.getByRole('button', { name: 'Agenda' }).click()
  await openEvent(desktop.page, 'FP TEST Training Invite')
  await desktop.page.getByRole('button', { name: 'Edit event' }).click()
  assert.equal(await desktop.page.getByRole('checkbox', { name: 'Automatically select players who respond Available' }).count(), 0)
  await desktop.page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await openEvent(desktop.page, 'FP TEST Training Invite')
  const trainingSummary = desktop.page.getByTestId('event-response-summary')
  await trainingSummary.getByText('Awaiting response', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await trainingSummary.getByText('Match selection', { exact: true }).count(), 0)
  await trainingSummary.getByRole('button', { name: 'View responses' }).click()
  const trainingManager = desktop.page.getByTestId('event-response-manager')
  await trainingManager.getByRole('tab', { name: 'Awaiting response (1)' }).click()
  const trainingRow = trainingManager.locator('[role="row"][data-player-id="training-player"]')
  await trainingRow.getByRole('button', { name: 'Expand' }).click()
  const trainingDetailsRow = trainingManager.locator('[role="row"][data-player-id="training-player-details"]')
  await trainingDetailsRow.getByRole('button', { name: 'Actions for Training Player' }).click()
  await trainingDetailsRow.getByRole('menuitem', { name: 'Mark attending on behalf' }).click()
  const trainingConfirm = desktop.page.getByRole('dialog').last()
  assert.equal(await trainingConfirm.getByText('Match selection', { exact: true }).count(), 0)
  await trainingConfirm.getByRole('button', { name: 'Mark attending on behalf' }).click()
  await trainingManager.getByRole('tab', { name: 'Attending (1)', exact: true }).waitFor({ state: 'visible', timeout: 15000 })
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

  matchState.availability = matchState.availability.filter((row) => row.id !== 'availability-pending')
  matchState.decisions = matchState.decisions.filter((row) => row.player_id !== 'pending-player')
  trainingAccepted = false

  const mobileContext = await browser.newContext({ colorScheme: 'light', isMobile: true, viewport: { width: 390, height: 844 } })
  const mobile = await preparePage(mobileContext)
  await signIn(mobile.page)
  await verifyMatchDayManagePlayersDeepLink(mobile.page)
  await openEvent(mobile.page, 'FP TEST Match Invite')
  const mobileModal = mobile.page.getByTestId('calendar-event-modal')
  const mobileContent = mobile.page.getByTestId('calendar-event-modal-content')
  const mobileActionBar = mobile.page.getByTestId('calendar-mobile-action-bar')
  const mobileClose = mobile.page.getByRole('button', { name: 'Close calendar event' })
  const mobileMoreActions = mobile.page.getByRole('button', { name: 'More actions' })
  const modalBox = await mobileModal.boundingBox()
  const contentBox = await mobileContent.boundingBox()
  const actionBarBox = await mobileActionBar.boundingBox()
  const closeBox = await mobileClose.boundingBox()
  assert.ok(modalBox && modalBox.height >= 800 && modalBox.height <= 844)
  assert.ok(contentBox && actionBarBox && contentBox.height > actionBarBox.height * 3)
  assert.ok(actionBarBox.height < 150)
  assert.equal(await mobileActionBar.getAttribute('data-mobile-action-dock'), 'expanded')
  const mobileCollapseActions = mobile.page.getByRole('button', { name: 'Collapse actions' })
  const mobileCollapseBox = await mobileCollapseActions.boundingBox()
  assert.ok(mobileCollapseBox && mobileCollapseBox.width >= 44 && mobileCollapseBox.height >= 44)
  await mobileCollapseActions.click()
  const mobileExpandActions = mobile.page.getByRole('button', { name: 'Expand actions' })
  await mobileExpandActions.waitFor({ state: 'visible' })
  const mobileHandleBox = await mobileExpandActions.boundingBox()
  assert.ok(mobileHandleBox && mobileHandleBox.width >= 44 && mobileHandleBox.height >= 44)
  assert.equal(await mobile.page.evaluate(() => window.localStorage.getItem('footballplayer.online:mobile-action-dock:collapsed:v1')), 'true')
  await mobileExpandActions.click()
  assert.equal(await mobile.page.evaluate(() => window.localStorage.getItem('footballplayer.online:mobile-action-dock:collapsed:v1')), 'false')
  const quickActionButton = mobile.page.getByRole('button', { name: 'Open quick actions' })
  if (await quickActionButton.count()) {
    assert.equal(await quickActionButton.locator('xpath=..').getAttribute('aria-hidden'), 'true')
  }
  assert.ok(closeBox && closeBox.width >= 44 && closeBox.height >= 44)
  assert.equal(await mobileActionBar.getByRole('button', { name: 'Close', exact: true }).count(), 0)
  assert.equal(await mobile.page.evaluate(() => document.body.style.overflow), 'hidden')
  assert.equal(await mobileContent.evaluate((element) => element.scrollHeight > element.clientHeight), true)
  await mobileMoreActions.click()
  const mobileActionSheet = mobile.page.getByTestId('calendar-mobile-actions')
  await mobileActionSheet.waitFor({ state: 'visible' })
  assert.deepEqual(
    await mobileActionSheet.getByRole('menuitem').allTextContents(),
    ['Build Formation Board with attending players', 'Manage invited players', 'Edit event', 'Move or reschedule', 'Cancel fixture'],
  )
  await mobile.page.keyboard.press('Escape')
  await mobileActionSheet.waitFor({ state: 'hidden' })
  await mobile.page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'More actions')
  assert.equal(await mobileMoreActions.evaluate((element) => element === document.activeElement), true)
  await mobileMoreActions.click()
  await mobileActionSheet.getByRole('menuitem', { name: 'Edit event' }).click()
  const mobileAutoSelect = mobile.page.getByRole('checkbox', { name: 'Automatically select players who respond Available' })
  await mobileAutoSelect.waitFor({ state: 'visible' })
  assert.equal(await mobileAutoSelect.isChecked(), true)
  const mobileAutoSelectBox = await mobileAutoSelect.locator('xpath=..').boundingBox()
  assert.ok(mobileAutoSelectBox && mobileAutoSelectBox.height >= 48)
  await mobile.page.getByLabel('Title').fill('')
  await mobile.page.locator('input[name="opponent"]').fill('')
  await mobile.page.getByRole('button', { name: 'Collapse actions' }).click()
  await mobile.page.getByRole('button', { name: /Expand actions, unsaved changes/ }).waitFor({ state: 'visible' })
  await mobileModal.locator('form').evaluate((form) => form.requestSubmit())
  await mobile.page.locator('#calendar-modal-validation-summary').getByText('Add an opponent or event title for this fixture.', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await mobileActionBar.getAttribute('data-mobile-action-dock'), 'expanded')
  const mobileOpponent = mobile.page.locator('input[name="opponent"]')
  assert.equal(await mobileOpponent.evaluate((element) => element === document.activeElement), true)
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await mobile.page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await openEvent(mobile.page, 'FP TEST Match Invite')
  const mobileSummary = mobile.page.getByTestId('event-response-summary')
  const mobileViewResponses = mobileSummary.getByRole('button', { name: 'View responses' })
  const mobileViewResponsesBox = await mobileViewResponses.boundingBox()
  assert.ok(mobileViewResponsesBox && mobileViewResponsesBox.height >= 44)
  await mobileViewResponses.click()
  const mobileManager = mobile.page.getByTestId('event-response-manager')
  const mobileManagerBox = await mobileManager.boundingBox()
  assert.ok(mobileManagerBox && mobileManagerBox.height >= 800 && mobileManagerBox.height <= 844)
  assert.equal(await mobileManager.locator('[role="row"][data-player-id]').count(), 34)
  const mobileSearch = mobileManager.getByRole('searchbox', { name: 'Search players' })
  await mobileSearch.fill('PENDING')
  await mobileManager.getByText('1 of 34 players', { exact: true }).waitFor({ state: 'visible' })
  const mobilePendingRow = mobileManager.locator('[role="row"][data-player-id="pending-player"]')
  const mobilePlayerProfileButton = mobilePendingRow.getByRole('button', { name: 'Open Pending Player player profile' })
  const mobilePlayerProfileButtonBox = await mobilePlayerProfileButton.boundingBox()
  assert.ok(mobilePlayerProfileButtonBox && mobilePlayerProfileButtonBox.height >= 44)
  await mobilePendingRow.getByRole('button', { name: 'Expand' }).click()
  const mobilePendingDetailsRow = mobileManager.locator('[role="row"][data-player-id="pending-player-details"]')
  const mobileActionButton = mobilePendingDetailsRow.getByRole('button', { name: 'Actions for Pending Player' })
  const mobileActionButtonBox = await mobileActionButton.boundingBox()
  assert.ok(mobileActionButtonBox && mobileActionButtonBox.height >= 44)
  await mobileActionButton.click()
  const mobileRowMenu = mobilePendingDetailsRow.getByRole('menu', { name: 'Actions for Pending Player' })
  const mobileRowMenuBox = await mobileRowMenu.boundingBox()
  assert.ok(mobileRowMenuBox && mobileRowMenuBox.x >= 0 && mobileRowMenuBox.x + mobileRowMenuBox.width <= 390)
  await mobileRowMenu.getByRole('menuitem', { name: 'Mark available on behalf' }).click()
  const mobileAvailabilityDialog = mobile.page.getByRole('dialog').last()
  await mobileAvailabilityDialog.getByText('Awaiting response', { exact: true }).waitFor({ state: 'visible' })
  await mobileAvailabilityDialog.getByRole('button', { name: 'Accept on behalf of player' }).click()
  await mobileManager.getByRole('tab', { name: 'Available (2)' }).waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await mobileManager.getByRole('button', { name: 'Close response manager' }).click()
  await mobile.page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'View responses')
  assert.equal(await mobileViewResponses.evaluate((element) => element === document.activeElement), true)
  await mobileClose.click()
  await mobileModal.waitFor({ state: 'hidden' })
  assert.equal(await mobile.page.evaluate(() => document.body.style.overflow), '')
  await mobile.page.goto(`${baseUrl}/sessions/start?action=create-session`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const mobileSessionModal = mobile.page.getByTestId('calendar-event-modal')
  await mobileSessionModal.getByRole('heading', { name: 'Create session' }).waitFor({ state: 'visible', timeout: 15000 })
  const mobileSessionDock = mobile.page.getByTestId('calendar-mobile-action-bar')
  assert.equal(await mobileSessionDock.getAttribute('data-mobile-action-dock'), 'expanded')
  await mobileSessionDock.getByRole('button', { name: 'Cancel', exact: true }).waitFor({ state: 'visible' })
  await mobileSessionDock.getByRole('button', { name: 'Save', exact: true }).waitFor({ state: 'visible' })
  await mobile.page.getByLabel('Title').fill('FP TEST unsaved session')
  await mobile.page.getByRole('button', { name: 'Collapse actions' }).click()
  await mobile.page.getByRole('button', { name: /Expand actions, unsaved changes/ }).waitFor({ state: 'visible' })
  await mobile.page.getByRole('button', { name: /Expand actions, unsaved changes/ }).click()
  await mobile.page.getByRole('button', { name: 'Close calendar event' }).click()
  await mobileSessionModal.waitFor({ state: 'hidden' })
  await mobile.page.setViewportSize({ width: 844, height: 390 })
  await mobile.page.goto(`${baseUrl}/calendar`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await openEvent(mobile.page, 'FP TEST Match Invite')
  assert.equal(await mobile.page.getByTestId('calendar-mobile-action-bar').isVisible(), false)
  assert.equal(await mobile.page.getByTestId('calendar-desktop-action-bar').isVisible(), true)
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await mobile.page.getByRole('button', { name: 'Close calendar event' }).click()
  assert.deepEqual(mobile.pageErrors, [])
  await mobileContext.close()

  const tabletContext = await browser.newContext({
    colorScheme: 'light',
    hasTouch: true,
    viewport: { width: 820, height: 1180 },
  })
  const tablet = await preparePage(tabletContext)
  await signIn(tablet.page)
  await openEvent(tablet.page, 'FP TEST Match Invite')
  await tablet.page.getByTestId('event-response-summary').getByRole('button', { name: 'View responses' }).click()
  const tabletManager = tablet.page.getByTestId('event-response-manager')
  const tabletManagerBox = await tabletManager.boundingBox()
  assert.ok(tabletManagerBox && tabletManagerBox.width >= 760 && tabletManagerBox.width <= 820)
  await tabletManager.getByRole('tab', { name: 'Invitation not sent (32)' }).click()
  await tabletManager.getByRole('searchbox', { name: 'Search players' }).fill('Player 08')
  await tabletManager.getByText('Long List Player 08', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await tablet.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  assert.deepEqual(tablet.pageErrors, [])
  await tabletContext.close()

  const pwaContext = await browser.newContext({
    colorScheme: 'dark',
    hasTouch: true,
    isMobile: true,
    viewport: { width: 393, height: 852 },
  })
  const pwa = await preparePage(pwaContext, { standalone: true })
  await signIn(pwa.page)
  assert.equal(await pwa.page.evaluate(() => (
    window.matchMedia('(display-mode: standalone)').matches
    && window.navigator.standalone === true
  )), true)
  await pwa.page.getByRole('button', { name: 'Agenda' }).click()
  await openEvent(pwa.page, 'FP TEST Training Invite')
  const pwaDock = pwa.page.getByTestId('calendar-mobile-action-bar')
  assert.equal(await pwaDock.getAttribute('data-mobile-action-dock'), 'expanded')
  await pwa.page.getByRole('button', { name: 'Collapse actions' }).click()
  await pwa.page.getByRole('button', { name: 'Expand actions' }).waitFor({ state: 'visible' })
  await pwa.page.getByRole('button', { name: 'Expand actions' }).click()
  await pwa.page.getByTestId('event-response-summary').getByRole('button', { name: 'View responses' }).click()
  const pwaManager = pwa.page.getByTestId('event-response-manager')
  await pwaManager.getByRole('tab', { name: 'Attending (0)', exact: true }).waitFor({ state: 'visible' })
  await pwaManager.getByRole('tab', { name: 'Awaiting response (1)' }).waitFor({ state: 'visible' })
  const pwaTrainingProfileButton = pwaManager.getByRole('button', { name: 'Open Training Player player profile' })
  await pwaTrainingProfileButton.click()
  await pwa.page.waitForURL((url) => (
    url.pathname === '/player/Training%20Player'
    && url.searchParams.get('playerId') === 'training-player'
    && url.searchParams.get('teamId') === 'team-u12'
  ), { timeout: 15000 })
  await pwa.page.goBack({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await pwa.page.getByTestId('event-response-manager').waitFor({ state: 'visible', timeout: 15000 })
  const pwaManagerBox = await pwaManager.boundingBox()
  assert.ok(pwaManagerBox && pwaManagerBox.height >= 820 && pwaManagerBox.height <= 852)
  assert.equal(await pwa.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  assert.deepEqual(pwa.pageErrors, [])
  await pwaContext.close()

  const shortAndroidContext = await browser.newContext({
    colorScheme: 'dark',
    isMobile: true,
    viewport: { width: 360, height: 480 },
  })
  const shortAndroid = await preparePage(shortAndroidContext)
  await signIn(shortAndroid.page)
  await openEvent(shortAndroid.page, 'FP TEST Match Invite')
  const shortModalBox = await shortAndroid.page.getByTestId('calendar-event-modal').boundingBox()
  const shortContentBox = await shortAndroid.page.getByTestId('calendar-event-modal-content').boundingBox()
  const shortActionBox = await shortAndroid.page.getByTestId('calendar-mobile-action-bar').boundingBox()
  assert.ok(shortModalBox && shortModalBox.height >= 450 && shortModalBox.height <= 480)
  assert.ok(shortContentBox && shortActionBox && shortContentBox.height > shortActionBox.height * 2)
  assert.equal(
    await shortAndroid.page.getByTestId('calendar-event-modal-content').evaluate((element) => element.scrollHeight > element.clientHeight),
    true,
  )
  await shortAndroid.page.getByTestId('event-response-summary').getByRole('button', { name: 'View responses' }).click()
  const shortManager = shortAndroid.page.getByTestId('event-response-manager')
  const shortManagerBox = await shortManager.boundingBox()
  assert.ok(shortManagerBox && shortManagerBox.height >= 450 && shortManagerBox.height <= 480)
  assert.equal(
    await shortManager.locator('.overflow-y-auto').evaluate((element) => element.scrollHeight > element.clientHeight),
    true,
  )
  await shortManager.getByRole('tab', { name: 'Invitation not sent (32)' }).click()
  await shortManager.getByRole('searchbox', { name: 'Search players' }).fill('Player 32')
  await shortManager.getByText('Long List Player 32', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await shortAndroid.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  assert.deepEqual(shortAndroid.pageErrors, [])
  await shortAndroidContext.close()

  console.log('Event response summary, grouped manager, search, staff acceptance, and Calendar layout checks passed on desktop, tablet, iPhone, short Android, and controlled standalone PWA sessions.')
} catch (error) {
  console.error(server.getOutput())
  throw error
} finally {
  if (browser) {
    await browser.close()
  }
  await stopDevServer(server)
}
