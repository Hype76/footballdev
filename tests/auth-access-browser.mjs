import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import { chromium } from 'playwright'

const fixturePassword = 'FixturePass123!'
const platformAnalyticsOnly = process.env.AUTH_BROWSER_PLATFORM_ANALYTICS_ONLY === 'true'
const scenarioFilter = String(process.env.AUTH_BROWSER_SCENARIO_FILTER || '').trim().toLowerCase()
const port = Number(process.env.AUTH_BROWSER_PORT || 4300 + Math.floor(Math.random() * 500))
const mainBaseUrl = `http://127.0.0.1:${port}`
const parentBaseUrl = `http://parent.footballplayer.online:${port}`
const parentThemeScreenshotDirectory = 'outputs/fp-v1-parent-portal-themes-release-04e'
await mkdir(parentThemeScreenshotDirectory, { recursive: true })
const managerHomeScreenshotDirectory = 'outputs/fp-v1-manager-home-darkmode-39e'
await mkdir(managerHomeScreenshotDirectory, { recursive: true })
const parentThemeMatrix = [
  { accent: 'green', label: 'light-default', mode: 'light' },
  { accent: 'green', label: 'dark-default', mode: 'dark' },
  { accent: 'purple', label: 'light-custom', mode: 'light' },
  { accent: 'purple', label: 'dark-custom', mode: 'dark' },
]
const parentThemeRoutes = [
  { label: 'overview', path: '/parent-portal?section=overview', scopeTestId: 'parent-portal-page' },
  { label: 'calendar', path: '/parent-portal?section=calendar', scopeTestId: 'parent-portal-page' },
  { label: 'invites', path: '/parent-portal?section=invites', scopeTestId: 'parent-portal-page' },
  { label: 'matches', path: '/parent-portal?section=matches', scopeTestId: 'parent-portal-page' },
  { label: 'results', path: '/parent-portal?section=results', scopeTestId: 'parent-portal-page' },
  { label: 'resources', path: '/parent-portal?section=resources', scopeTestId: 'parent-portal-page' },
  { label: 'settings', path: '/parent-portal?section=settings', scopeTestId: 'parent-portal-page' },
  { label: 'chat', path: '/parent-chat', scopeTestId: 'parent-portal-route-shell' },
  { label: 'polls', path: '/parent-polls', scopeTestId: 'parent-portal-route-shell' },
  { label: 'friends-family', path: '/friends-family', scopeTestId: 'parent-portal-route-shell' },
]

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForPort(host, port, timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const result = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port })
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

    if (result) {
      return
    }
  }

  throw new Error(`Timed out waiting for ${host}:${port}`)
}

async function waitForHttpOk(url, timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)

      if (response.ok) {
        return
      }
    } catch {
      // Vite can accept the port before the SPA route is ready.
    }

    await wait(250)
  }

  throw new Error(`Timed out waiting for ${url} to return HTTP 200`)
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

async function stopDevServer(server) {
  if (!server?.child || server.child.exitCode !== null) {
    return
  }

  if (process.platform === 'win32') {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`], {
      stdio: 'ignore',
    })
  } else {
    server.child.kill()
  }

  await Promise.race([
    once(server.child, 'exit'),
    wait(3000),
  ])

  if (server.child.exitCode === null) {
    server.child.kill('SIGKILL')
  }
}

async function preparePage(context, {
  activityStore = new Map(),
  multiRoleChat = false,
} = {}) {
  let platformProbeCount = 0
  let failActivityMark = false
  const activityRequests = []
  const chatRequests = []
  const activityCategories = ['calendar', 'invites', 'matches', 'results', 'resources', 'chat', 'polls']

  await context.route('**/api/parent-development/history', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reports: [] }),
    })
  })

  function getActivityState(parentLinkId) {
    if (!activityStore.has(parentLinkId)) {
      activityStore.set(parentLinkId, new Map(
        activityCategories.map((categoryKey) => [categoryKey, categoryKey === 'resources']),
      ))
    }

    return activityStore.get(parentLinkId)
  }

  function buildActivityRows(parentLinkId) {
    const state = getActivityState(parentLinkId)

    return activityCategories.map((categoryKey) => {
      const isNew = Boolean(state.get(categoryKey))
      return {
        category_key: categoryKey,
        scope_type: 'child',
        parent_link_id: parentLinkId,
        player_id: `player-for-${parentLinkId}`,
        latest_activity_at: '2026-07-27T16:30:00.000Z',
        last_viewed_at: isNew ? '2026-07-27T16:00:00.000Z' : '2026-07-27T16:30:00.000Z',
        is_new: isNew,
      }
    })
  }

  await context.route('**/.netlify/functions/platform-admin-access**', async (route) => {
    platformProbeCount += 1
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'Fixture tests must not call platform admin access.' }),
    })
  })
  await context.route('**/.netlify/functions/**', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'Fixture function stub.' }),
    })
  })
  await context.route('**/.netlify/functions/platform-analytics**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, accepted: true }),
      })
      return
    }

    const hours = Array.from({ length: 24 }, (_, hour) => hour)
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const emptyHourDayGrid = () => hours.map(() => days.map(() => 0))
    const activeGrid = emptyHourDayGrid()
    activeGrid[9][1] = 4
    const report = {
      generatedAt: '2026-07-27T12:00:00.000Z',
      timezone: 'Europe/London',
      filters: {
        preset: '30_days',
        startDate: '2026-06-28',
        endDate: '2026-07-27',
      },
      exclusionsActive: true,
      dataState: 'available',
      accountEstate: {
        clubs: 2,
        teams: 3,
        activePlayers: 24,
        authenticatedStaffAccounts: 8,
        authenticatedParentAccounts: 10,
        parentContacts: 12,
        activeParentChildLinks: 11,
        parentOnlyAccounts: 6,
        staffWithParentAccess: 4,
        developmentRecords: 32,
        drilldown: {},
      },
      authentication: {
        successfulLoginsToday: 6,
        successfulLoginsSelected: 24,
        distinctUsersLoggingIn: 12,
        failedLogins: 0,
        failedLoginsAvailable: true,
        drilldown: [],
      },
      productActivity: {
        activeUsersToday: 4,
        activeUsers7Days: 8,
        activeUsers30Days: 12,
        activeParents: 4,
        activeStaff: 8,
        activeClubs: 2,
        pageViews: 42,
        meaningfulActions: 42,
        newActiveUsers: 3,
        returningActiveUsers: 9,
        drilldown: [],
        pageDrilldown: [],
      },
      definitions: {
        activeUser: 'A distinct authenticated user with at least one approved meaningful action.',
        successfulLogin: 'A completed authentication event, reported separately from meaningful activity.',
      },
      overview: {
        activeUsersToday: 4,
        activeUsers7Days: 8,
        activeUsers30Days: 12,
        selectedActiveUsers: { current: 12, previous: 10, changePercent: 20, comparisonAvailable: true },
        successfulLoginsToday: 6,
        selectedSuccessfulLogins: { current: 24, previous: 20, changePercent: 20, comparisonAvailable: true },
        newUsers: 3,
        returningUsers: 9,
        activeParents: 4,
        activeStaff: 8,
        activeClubs: 2,
        pageViews: { current: 42, previous: 40, changePercent: 5, comparisonAvailable: true },
      },
      roleActivity: [
        { role: 'coach', activeUsers: 8, meaningfulActions: 30 },
        { role: 'parent_portal', activeUsers: 4, meaningfulActions: 12 },
      ],
      topPages: [
        {
          route: '/players',
          pageViews: 30,
          uniqueUsers: 10,
          percentage: 71.4,
          comparison: { current: 30, previous: 25, changePercent: 20, comparisonAvailable: true },
        },
        {
          route: '/calendar',
          pageViews: 12,
          uniqueUsers: 6,
          percentage: 28.6,
          comparison: { current: 12, previous: 15, changePercent: -20, comparisonAvailable: true },
        },
      ],
      pageHeatmap: {
        hours,
        days,
        rows: [
          { route: '/players', byHour: hours.map((hour) => hour === 9 ? 30 : 0), byDay: days.map((_, day) => day === 1 ? 30 : 0) },
          { route: '/calendar', byHour: hours.map((hour) => hour === 10 ? 12 : 0), byDay: days.map((_, day) => day === 2 ? 12 : 0) },
        ],
      },
      overallHeatmap: {
        hours,
        days,
        cells: hours.map((hour) => days.map((day, dayIndex) => ({ day, dayIndex, hour, pageViews: activeGrid[hour][dayIndex], meaningfulActions: activeGrid[hour][dayIndex], successfulLogins: activeGrid[hour][dayIndex], distinctUsers: activeGrid[hour][dayIndex], distinctClubs: activeGrid[hour][dayIndex] ? 1 : 0, internalEvents: 0, fpTestEvents: 0 }))),
        totals: { pageViews: 4, meaningfulActions: 4, successfulLogins: 4 },
        metrics: {
          activeUsers: activeGrid,
          meaningfulActions: activeGrid,
          successfulLogins: activeGrid,
          pageViews: activeGrid,
          parentActivity: activeGrid,
          staffActivity: activeGrid,
        },
      },
      maintenanceWindow: {
        available: true,
        day: 'Tuesday',
        startHour: 1,
        endHour: 3,
        averageActiveUsers: 0.5,
        maximumActiveUsers: 1,
        averageMeaningfulActions: 0.8,
        weeksAnalyzed: 8,
        confidence: 'High',
        message: 'This is a conservative low-usage recommendation, not a guarantee of zero users.',
      },
      parentAdoption: {
        stages: [
          { key: 'registered', label: 'Registered parent accounts', count: 10, available: true },
          { key: 'invited', label: 'Invitations sent', count: null, available: false },
          { key: 'activated', label: 'First meaningful parent action recorded', count: 6, available: true },
        ],
      },
      clubActivity: {
        active: 2,
        engaged: 1,
        oneAdministrator: 1,
        neverActivated: 0,
      },
      staffAccounts: { authenticatedStaffAccounts: 8, assignmentCount: 9, multiTeamAccounts: 1, activeStaffAccounts: 8 },
      dataQuality: { unattributedUsers: 0, unattributedRoles: 0, unattributedClubs: 0, unknownEventNames: 0, quarantinedEvents: 0, unprocessedEvents: 0, internalEvents: 0, fpTestEvents: 0 },
      processor: { processingLagSeconds: 0 },
      options: {
        roles: ['coach', 'parent_portal'],
        platforms: ['web', 'parent_app'],
        clubs: [{ id: 'fixture-club', name: 'Fixture Club', plan: 'small_club' }],
        plans: ['small_club'],
        routes: ['/players', '/calendar'],
        activityTypes: ['authentication', 'navigation', 'meaningful_action'],
        environments: ['production', 'preview', 'test', 'local'],
        pageFamilies: [{ value: 'player_profile', label: 'Player Profile' }],
      },
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, report }),
    })
  })
  await context.route('**/rest/v1/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    })
  })
  await context.route('**/rest/v1/rpc/get_parent_portal_activity_state', async (route) => {
    const payload = route.request().postDataJSON()
    const parentLinkId = String(payload?.parent_link_id_value ?? '')
    activityRequests.push({ operation: 'get', parentLinkId })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildActivityRows(parentLinkId)),
    })
  })
  await context.route('**/rest/v1/rpc/mark_parent_portal_category_viewed', async (route) => {
    const payload = route.request().postDataJSON()
    const parentLinkId = String(payload?.parent_link_id_value ?? '')
    const categoryKey = String(payload?.category_key_value ?? '')
    activityRequests.push({ categoryKey, operation: 'mark', parentLinkId })

    if (failActivityMark) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Fixture viewed-state write failed.' }),
      })
      return
    }

    getActivityState(parentLinkId).set(categoryKey, false)
    const savedRow = buildActivityRows(parentLinkId).find((row) => row.category_key === categoryKey)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([savedRow]),
    })
  })
  await context.route('**/rest/v1/rpc/get_parent_portal_chat_context', async (route) => {
    const payload = route.request().postDataJSON()
    const parentLinkId = String(payload?.parent_link_id_value ?? '')
    chatRequests.push({ operation: 'context', parentLinkId })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        parent_link_id: parentLinkId,
        player_id: `player-for-${parentLinkId}`,
        child_filter_available: multiRoleChat,
      }]),
    })
  })
  await context.route('**/rest/v1/rpc/get_parent_portal_chat_rooms', async (route) => {
    const payload = route.request().postDataJSON()
    const parentLinkId = String(payload?.parent_link_id_value ?? '')
    const childOnly = Boolean(payload?.child_only_value)
    const selectedSecondChild = parentLinkId === 'parent-link-fixture-second'
    const selectedChildName = selectedSecondChild ? 'Second Fixture Child' : 'Fixture Child'
    const allRooms = [
      {
        id: 'chat-direct-first',
        room_type: 'parent_staff',
        status: 'active',
        title: 'Chat with Staff',
        club_id: 'club-fixture',
        club_name: 'Fixture United',
        team_id: 'team-u12',
        team_name: 'U12 Fixture Team',
        player_id: 'player-fixture',
        player_name: 'Fixture Child',
        match_day_id: null,
        opponent: '',
        match_date: null,
        kickoff_time: null,
        kickoff_time_tbc: false,
        meet_time: null,
        venue_name: '',
        fixture_status: '',
        child_names: ['Fixture Child'],
        latest_message: 'First child preview',
        latest_message_at: '2026-07-27T17:00:00.000Z',
        unread_count: 1,
        can_post: true,
      },
      {
        id: 'chat-direct-second',
        room_type: 'parent_staff',
        status: 'active',
        title: 'Chat with Staff',
        club_id: 'club-fixture',
        club_name: 'Fixture United',
        team_id: 'team-u12',
        team_name: 'U12 Fixture Team',
        player_id: 'player-fixture-second',
        player_name: 'Second Fixture Child',
        match_day_id: null,
        opponent: '',
        match_date: null,
        kickoff_time: null,
        kickoff_time_tbc: false,
        meet_time: null,
        venue_name: '',
        fixture_status: '',
        child_names: ['Second Fixture Child'],
        latest_message: 'Second child preview',
        latest_message_at: '2026-07-27T16:55:00.000Z',
        unread_count: 2,
        can_post: true,
      },
      {
        id: 'chat-team',
        room_type: 'team',
        status: 'active',
        title: 'U12 Fixture Team Chat',
        club_id: 'club-fixture',
        club_name: 'Fixture United',
        team_id: 'team-u12',
        team_name: 'U12 Fixture Team',
        player_id: null,
        player_name: '',
        match_day_id: null,
        opponent: '',
        match_date: null,
        kickoff_time: null,
        kickoff_time_tbc: false,
        meet_time: null,
        venue_name: '',
        fixture_status: '',
        child_names: childOnly
          ? [selectedChildName]
          : ['Fixture Child', 'Second Fixture Child'],
        latest_message: 'Team preview',
        latest_message_at: '2026-07-27T16:50:00.000Z',
        unread_count: 0,
        can_post: true,
      },
    ]
    const rooms = childOnly
      ? allRooms.filter((room) => (
          room.room_type === 'team'
          || room.player_id === (selectedSecondChild ? 'player-fixture-second' : 'player-fixture')
        ))
      : allRooms
    chatRequests.push({
      childOnly,
      operation: 'rooms',
      parentLinkId,
      returnedRoomIds: rooms.map((room) => room.id),
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rooms),
    })
  })
  await context.route('**/rest/v1/rpc/get_parent_portal_chat_messages', async (route) => {
    const payload = route.request().postDataJSON()
    const roomId = String(payload?.target_room_id ?? '')
    chatRequests.push({
      childOnly: Boolean(payload?.child_only_value),
      operation: 'messages',
      parentLinkId: String(payload?.parent_link_id_value ?? ''),
      roomId,
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        id: `message-${roomId}`,
        room_id: roomId,
        sender_id: 'fixture-staff',
        sender_kind: 'staff',
        sender_name: 'Fixture Coach',
        sender_role: 'Coach',
        body: `Safe fixture message for ${roomId}`,
        deleted_at: null,
        created_at: '2026-07-27T17:00:00.000Z',
        updated_at: '2026-07-27T17:00:00.000Z',
        can_delete: false,
      }]),
    })
  })
  await context.route('**/rest/v1/rpc/mark_parent_portal_chat_room_read', async (route) => {
    const payload = route.request().postDataJSON()
    chatRequests.push({
      childOnly: Boolean(payload?.child_only_value),
      operation: 'read',
      parentLinkId: String(payload?.parent_link_id_value ?? ''),
      roomId: String(payload?.target_room_id ?? ''),
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify('2026-07-27T17:00:00.000Z'),
    })
  })
  await context.route('**/rest/v1/rpc/mark_parent_portal_chat_viewed', async (route) => {
    const payload = route.request().postDataJSON()
    const parentLinkId = String(payload?.parent_link_id_value ?? '')
    chatRequests.push({
      operation: 'viewed',
      parentLinkId,
      roomId: String(payload?.target_room_id ?? ''),
    })
    getActivityState(parentLinkId).set('chat', false)
    const savedRow = buildActivityRows(parentLinkId).find((row) => row.category_key === 'chat')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([savedRow]),
    })
  })
  await context.route('**/rest/v1/rpc/send_parent_portal_chat_message', async (route) => {
    const payload = route.request().postDataJSON()
    chatRequests.push({
      body: String(payload?.body_value ?? ''),
      childOnly: Boolean(payload?.child_only_value),
      operation: 'send',
      parentLinkId: String(payload?.parent_link_id_value ?? ''),
      roomId: String(payload?.target_room_id ?? ''),
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify('80000000-0000-4000-8000-000000000001'),
    })
  })
  await context.route('**/auth/v1/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    })
  })

  const page = await context.newPage()

  page.on('pageerror', (error) => {
    throw error
  })

  return {
    page,
    getActivityRequests: () => activityRequests,
    getChatRequests: () => chatRequests,
    getPlatformProbeCount: () => platformProbeCount,
    setActivityNew: (parentLinkId, categoryKey, isNew) => {
      getActivityState(parentLinkId).set(categoryKey, Boolean(isNew))
    },
    setActivityMarkFailure: (value) => {
      failActivityMark = Boolean(value)
    },
  }
}

async function prepareClubDisplayPage(context, { failPatch = false } = {}) {
  const prepared = await preparePage(context)
  const requests = []
  let themeAccent = 'green'
  let themeButtonStyle = 'solid'

  await context.route('**/rest/v1/clubs**', async (route) => {
    const request = route.request()

    if (request.method() === 'PATCH') {
      const payload = request.postDataJSON()
      requests.push({
        method: request.method(),
        payload,
        url: request.url(),
      })

      if (failPatch) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Fixture display save failed.' }),
        })
        return
      }

      themeAccent = String(payload?.theme_accent ?? themeAccent)
      themeButtonStyle = String(payload?.theme_button_style ?? themeButtonStyle)
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'club-fixture',
        name: 'Fixture United',
        logo_url: '',
        contact_email: 'club.fixture@footballplayer.test',
        contact_phone: '',
        require_approval: true,
        theme_accent: themeAccent,
        theme_button_style: themeButtonStyle,
        status: 'active',
        suspended_at: null,
        plan_key: 'small_club',
        plan_status: 'active',
        is_plan_comped: true,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        stripe_price_id: null,
        current_period_end: null,
        plan_updated_at: null,
        tester_access_code_id: null,
        tester_access_code: null,
        tester_access_email: null,
        tester_access_redeemed_at: null,
        tester_access_expires_at: null,
        onboarding_enabled: true,
        onboarding_completed_steps: [],
        onboarding_dismissed_at: null,
        onboarding_reset_at: null,
      }),
    })
  })

  return {
    ...prepared,
    getDisplayRequests: () => requests,
    getThemeAccent: () => themeAccent,
    getThemeButtonStyle: () => themeButtonStyle,
  }
}

async function prepareParentInvitePage(context) {
  const prepared = await preparePage(context)
  let acceptanceCallCount = 0

  await context.route('**/.netlify/functions/get-parent-invite**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        invite: {
          email: 'parent.fixture@footballplayer.test',
          playerName: 'Fixture Child',
          teamName: 'U12 Fixture Team',
          clubName: 'Fixture United',
        },
      }),
    })
  })
  await context.route('**/rest/v1/rpc/accept_parent_player_link', async (route) => {
    acceptanceCallCount += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'parent-link-fixture' }]),
    })
  })
  await context.route('**/rest/v1/parent_player_links**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'parent-link-fixture',
        club_id: 'club-fixture',
        team_id: 'team-u12',
        player_id: 'player-fixture',
        link_type: 'parent',
        email: 'parent.fixture@footballplayer.test',
        status: 'active',
        players: {
          player_name: 'Fixture Child',
          section: 'Squad',
          team: 'U12 Fixture Team',
        },
        teams: {
          name: 'U12 Fixture Team',
          theme_mode: 'system',
          theme_accent: 'green',
          theme_button_style: 'solid',
        },
        clubs: {
          name: 'Fixture United',
        },
      }),
    })
  })

  return {
    ...prepared,
    getAcceptanceCallCount: () => acceptanceCallCount,
  }
}

async function prepareParentInviteStatePage(context, {
  invite = null,
  message = '',
  status = 200,
} = {}) {
  const prepared = await preparePage(context)

  await context.route('**/.netlify/functions/get-parent-invite**', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(invite
        ? { success: true, invite }
        : { success: false, message }),
    })
  })

  return prepared
}

async function prepareDemoPage(context, response = { status: 200, body: { success: true } }) {
  const prepared = await preparePage(context)
  const resetRequests = []

  await context.route('**/.netlify/functions/reset-demo-account', async (route) => {
    const request = route.request()
    resetRequests.push({
      method: request.method(),
      headers: request.headers(),
      body: request.postDataJSON(),
    })
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })

  return {
    ...prepared,
    getResetRequests: () => resetRequests,
  }
}

async function signIn(page, email, baseUrl = mainBaseUrl, access = 'club') {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByPlaceholder('you@club.com').waitFor({ state: 'visible', timeout: 60000 })
  if (access === 'parent') {
    await page.getByRole('button', { name: 'Parent' }).click()
  } else {
    await page.getByRole('button', { name: 'Coach' }).click()
  }
  await page.getByPlaceholder('you@club.com').fill(email)
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.locator('form').evaluate((form) => form.requestSubmit())
}

async function parentSignIn(page, email, baseUrl = parentBaseUrl) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByPlaceholder('you@club.com').waitFor({ state: 'visible', timeout: 60000 })
  await page.getByRole('button', { name: 'Parent' }).click()
  await page.getByRole('heading', { name: 'Sign in to parent access' }).waitFor({ state: 'visible', timeout: 60000 })
  await page.getByPlaceholder('you@club.com').fill(email)
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.waitForFunction(
    ({ expectedEmail, expectedPassword }) => {
      const emailInput = document.querySelector('input[placeholder="you@club.com"]')
      const passwordInput = document.querySelector('input[placeholder="Enter password"]')
      return emailInput?.value === expectedEmail && passwordInput?.value === expectedPassword
    },
    { expectedEmail: email, expectedPassword: fixturePassword },
    { timeout: 15000 },
  )
  await page.locator('form').evaluate((form) => form.requestSubmit())
}

async function assertVisibleText(page, text, timeout = 15000) {
  await page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout })
}

async function assertVisibleTextContaining(page, text) {
  await page.getByText(text).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 15000 })
}

async function assertNoCustomerBillingNotice(page) {
  assert.equal(await page.locator('[aria-label="Billing access notice"]').count(), 0)
  assert.equal(await page.getByText('Payment required', { exact: true }).count(), 0)
  assert.equal(await page.evaluate(() => window.__billingNoticeFlashDetected), false)
}

async function setFixtureBillingState(page, email, patch) {
  await page.goto(`${mainBaseUrl}/sign-in`, { waitUntil: 'commit', timeout: 60000 })
  await page.evaluate(({ fixtureEmail, fixturePatch }) => {
    window.localStorage.setItem(
      `auth-access-browser-fixture-profile-patch:${fixtureEmail}`,
      JSON.stringify(fixturePatch),
    )
  }, { fixtureEmail: email.toLowerCase(), fixturePatch: patch })
}

async function assertLoginAccessStateCleared(page) {
  const accessState = await page.evaluate(() => ({
    selectedAccessMode: window.sessionStorage.getItem('selected-access-mode'),
    selectedAccessModeExplicit: window.sessionStorage.getItem('selected-access-mode-explicit'),
    selectedTeamId: window.sessionStorage.getItem('selected-team-id'),
    loginAccessIntent: window.sessionStorage.getItem('login-access-intent'),
  }))

  assert.deepEqual(accessState, {
    selectedAccessMode: null,
    selectedAccessModeExplicit: null,
    selectedTeamId: null,
    loginAccessIntent: null,
  })
}

async function assertSidebarFooterContract(page, { reportIssueExpected = true } = {}) {
  const sidebar = page.locator('aside')

  await assertNoSetupGuideTrigger(page)
  await sidebar.getByRole('link', { name: 'Settings' }).waitFor({ state: 'visible', timeout: 15000 })
  await sidebar.getByRole('button', { name: 'Sign out' }).waitFor({ state: 'visible', timeout: 15000 })

  if (reportIssueExpected) {
    await sidebar.getByText('Report issue', { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 })
  }
}

async function assertHeaderContextPanelRemoved(page) {
  const header = page.locator('header')

  await header.waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(await header.getByText('View', { exact: true }).count(), 0)
  assert.equal(await header.getByText('Focus', { exact: true }).count(), 0)
  assert.equal(await header.getByText('Team tools', { exact: true }).count(), 0)
  assert.equal(await header.getByLabel('Access view').count(), 0)
  assert.equal(await header.getByRole('link', { name: 'Settings' }).count(), 0)
  assert.equal(await header.getByRole('button', { name: /Sign out/ }).count(), 0)
}

async function assertSidebarWorkspaceControls(page, { accessViewExpected = true } = {}) {
  const sidebar = page.locator('aside')

  if (accessViewExpected) {
    await sidebar.getByLabel('Access view').waitFor({ state: 'visible', timeout: 15000 })
  }

  await sidebar.getByRole('link', { name: 'Settings' }).waitFor({ state: 'visible', timeout: 15000 })
  await sidebar.getByRole('button', { name: 'Sign out' }).waitFor({ state: 'visible', timeout: 15000 })
}

async function assertNoSetupGuideTrigger(page) {
  assert.equal(await page.getByText('Open setup guide', { exact: true }).count(), 0)
}

async function closeOnboardingDialog(page) {
  const onboardingDialog = page.getByRole('dialog', { name: /Club setup|Setup/i })

  if (await onboardingDialog.count() > 0) {
    await onboardingDialog.getByRole('button', { name: 'Close' }).click()
    await onboardingDialog.waitFor({ state: 'detached', timeout: 15000 })
  }
}

async function openMobileNavigation(page) {
  await closeOnboardingDialog(page)
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: 'Close navigation' }).waitFor({ state: 'visible', timeout: 15000 })
}

async function assertSelectedOption(page, label, expectedText) {
  const value = await page.getByRole('combobox', { name: label, exact: true }).evaluate((select) => {
    const option = select.options[select.selectedIndex]
    return option ? option.textContent.trim() : ''
  })

  assert.equal(value, expectedText)
}

async function waitForPathname(page, pathname) {
  await page.waitForFunction((expectedPathname) => window.location.pathname === expectedPathname, pathname, {
    timeout: 15000,
  })
}

async function seedSelectedAccessMode(page, mode) {
  await page.goto(`${mainBaseUrl}/sign-in`, { waitUntil: 'commit', timeout: 60000 })
  await page.evaluate((nextMode) => {
    window.sessionStorage.setItem('selected-access-mode', nextMode)
  }, mode)
}

async function applyTheme(page, { accent, mode }) {
  await page.evaluate(({ nextAccent, nextMode }) => {
    const modeClasses = ['theme-light', 'theme-dark']
    const accentClasses = ['accent-yellow', 'accent-blue', 'accent-green', 'accent-red', 'accent-purple']
    const buttonClasses = ['button-style-solid', 'button-style-gradient']
    const elements = [document.documentElement, document.body]

    window.localStorage.setItem('app-theme-mode', nextMode)
    window.localStorage.setItem('app-theme-accent', nextAccent)
    window.localStorage.setItem('app-theme-button-style', 'solid')
    for (const element of elements) {
      element.classList.remove(...modeClasses, ...accentClasses, ...buttonClasses)
      element.classList.add(`theme-${nextMode}`, `accent-${nextAccent}`, 'button-style-solid')
    }
    document.documentElement.dataset.themeAccent = nextAccent
    document.documentElement.dataset.buttonStyle = 'solid'
    window.dispatchEvent(new CustomEvent('app-theme-changed', {
      detail: {
        accent: nextAccent,
        buttonStyle: 'solid',
        mode: nextMode,
      },
    }))
  }, { nextAccent: accent, nextMode: mode })
  await page.waitForFunction(({ nextAccent, nextMode }) => (
    document.documentElement.classList.contains(`theme-${nextMode}`)
    && document.documentElement.classList.contains(`accent-${nextAccent}`)
    && document.body.classList.contains(`theme-${nextMode}`)
    && document.body.classList.contains(`accent-${nextAccent}`)
    && document.documentElement.dataset.themeAccent === nextAccent
  ), { nextAccent: accent, nextMode: mode })
  await page.waitForTimeout(350)
  await page.waitForFunction(({ nextAccent, nextMode }) => (
    document.documentElement.classList.contains(`theme-${nextMode}`)
    && document.documentElement.classList.contains(`accent-${nextAccent}`)
    && document.documentElement.dataset.themeAccent === nextAccent
  ), { nextAccent: accent, nextMode: mode })
}

async function auditParentTheme(page, { accent, label, mode, scopeTestId }) {
  const audit = await page.evaluate(({ expectedScopeTestId }) => {
    function parseRgb(value) {
      const channels = String(value || '').match(/[\d.]+/g)?.slice(0, 3).map(Number)
      return channels?.length === 3 ? channels : null
    }

    function luminance(rgb) {
      const channels = rgb.map((value) => {
        const normalized = value / 255
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
    }

    function contrastRatio(foreground, background) {
      const foregroundRgb = parseRgb(foreground)
      const backgroundRgb = parseRgb(background)
      if (!foregroundRgb || !backgroundRgb) return 0
      const foregroundLuminance = luminance(foregroundRgb)
      const backgroundLuminance = luminance(backgroundRgb)
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    }

    function inheritedBackground(element) {
      let current = element
      while (current) {
        const background = getComputedStyle(current).backgroundColor
        if (background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)') {
          return background
        }
        current = current.parentElement
      }
      return getComputedStyle(document.body).backgroundColor
    }

    function resolveColor(value) {
      const probe = document.createElement('span')
      probe.style.color = value
      probe.style.position = 'fixed'
      probe.style.visibility = 'hidden'
      document.body.append(probe)
      const resolved = getComputedStyle(probe).color
      probe.remove()
      return resolved
    }

    function sample(selector) {
      const element = document.querySelector(selector)
      if (!element) return null
      const style = getComputedStyle(element)
      const background = inheritedBackground(element)
      return {
        background,
        foreground: style.color,
        ratio: contrastRatio(style.color, background),
      }
    }

    function mappedColor(scope, selector, property) {
      const element = scope.querySelector(selector)
      return element ? getComputedStyle(element)[property] : null
    }

    const scope = document.querySelector(`[data-testid="${expectedScopeTestId}"]`)
    const root = getComputedStyle(document.documentElement)
    if (!scope) {
      return { scopePresent: false }
    }

    const tokens = {
      accent: resolveColor(root.getPropertyValue('--accent').trim()),
      accentSoft: resolveColor(root.getPropertyValue('--accent-soft').trim()),
      buttonPrimary: resolveColor(root.getPropertyValue('--button-primary').trim()),
      buttonPrimaryText: resolveColor(root.getPropertyValue('--button-primary-text').trim()),
      panelAlt: resolveColor(root.getPropertyValue('--panel-alt').trim()),
      panelBackground: resolveColor(root.getPropertyValue('--panel-bg').trim()),
      textMuted: resolveColor(root.getPropertyValue('--text-muted').trim()),
      textPrimary: resolveColor(root.getPropertyValue('--text-primary').trim()),
      textSecondary: resolveColor(root.getPropertyValue('--text-secondary').trim()),
    }

    return {
      accent: document.documentElement.dataset.themeAccent,
      documentOverflows: document.documentElement.scrollWidth > window.innerWidth,
      mapped: {
        accentBackground: mappedColor(
          scope,
          '[class~="bg-[#ecfdf5]"]:not([class~="bg-white"]):not([class~="bg-[#f7faf8]"]), [class~="bg-[#bbf7d0]"]:not([class~="bg-white"]):not([class~="bg-[#f7faf8]"])',
          'backgroundColor',
        ),
        accentButton: mappedColor(
          scope,
          'button:not(:disabled)[class~="bg-[#047857]"], [class~="bg-[#047857]"]:not(button)',
          'backgroundColor',
        ),
        accentButtonText: mappedColor(
          scope,
          'button:not(:disabled)[class~="bg-[#047857]"], [class~="bg-[#047857]"]:not(button)',
          'color',
        ),
        accentText: mappedColor(scope, '[class~="text-[#047857]"]', 'color'),
        mutedText: mappedColor(scope, '[class~="text-[#4b5f55]"]', 'color'),
        panelAlt: mappedColor(
          scope,
          '[class~="bg-[#f7faf8]"]:not([class~="bg-white"]):not([class~="bg-[#ecfdf5]"])',
          'backgroundColor',
        ),
        panelBackground: mappedColor(
          scope,
          '[class~="bg-white"]:not([class~="bg-[#f7faf8]"]):not([class~="bg-[#ecfdf5]"])',
          'backgroundColor',
        ),
        primaryText: mappedColor(scope, '[class~="text-[#101828]"]', 'color'),
      },
      samples: {
        accent: sample(`[data-testid="${expectedScopeTestId}"] [class~="text-[#047857]"]`),
        button: sample(`[data-testid="${expectedScopeTestId}"] [class~="bg-[#047857]"]`),
        heading: sample(`[data-testid="${expectedScopeTestId}"] h1, [data-testid="${expectedScopeTestId}"] h2`),
        muted: sample(`[data-testid="${expectedScopeTestId}"] [class~="text-[#4b5f55]"]`),
      },
      scopePresent: true,
      tokens,
    }
  }, { expectedScopeTestId: scopeTestId })

  assert.equal(audit.scopePresent, true, `${label} has the Parent theme scope`)
  assert.equal(audit.accent, accent, `${label} applies ${accent}`)
  assert.equal(audit.documentOverflows, false, `${label} stays within the viewport`)

  const mappingPairs = [
    ['accentBackground', 'accentSoft'],
    ['accentButton', 'buttonPrimary'],
    ['accentButtonText', 'buttonPrimaryText'],
    ['accentText', 'textSecondary'],
    ['mutedText', 'textMuted'],
    ['panelAlt', 'panelAlt'],
    ['panelBackground', 'panelBackground'],
    ['primaryText', 'textPrimary'],
  ]
  for (const [mappedName, tokenName] of mappingPairs) {
    if (audit.mapped[mappedName]) {
      assert.equal(audit.mapped[mappedName], audit.tokens[tokenName], `${label} maps ${mappedName}`)
    }
  }

  for (const [sampleName, sample] of Object.entries(audit.samples)) {
    if (sample) {
      assert.ok(sample.ratio >= 4.5, `${label} ${sampleName} contrast ${sample.ratio.toFixed(2)} is at least 4.5`)
    }
  }

  return audit
}

async function auditStandaloneTheme(page, { label }) {
  const audit = await page.evaluate(() => {
    function parseRgb(value) {
      const channels = String(value || '').match(/[\d.]+/g)?.slice(0, 3).map(Number)
      return channels?.length === 3 ? channels : null
    }

    function luminance(rgb) {
      const channels = rgb.map((value) => {
        const normalized = value / 255
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
    }

    function contrastRatio(foreground, background) {
      const foregroundRgb = parseRgb(foreground)
      const backgroundRgb = parseRgb(background)
      if (!foregroundRgb || !backgroundRgb) return 0
      const foregroundLuminance = luminance(foregroundRgb)
      const backgroundLuminance = luminance(backgroundRgb)
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    }

    const heading = document.querySelector('main h1, main h2')
    const panel = heading?.closest('section, div')
    const button = document.querySelector('main button:not([disabled])')
    return {
      buttonRatio: button
        ? contrastRatio(getComputedStyle(button).color, getComputedStyle(button).backgroundColor)
        : null,
      documentOverflows: document.documentElement.scrollWidth > window.innerWidth,
      headingRatio: heading && panel
        ? contrastRatio(getComputedStyle(heading).color, getComputedStyle(panel).backgroundColor)
        : null,
    }
  })

  assert.equal(audit.documentOverflows, false, `${label} stays within the viewport`)
  if (audit.headingRatio) {
    assert.ok(audit.headingRatio >= 4.5, `${label} heading contrast is at least 4.5`)
  }
  if (audit.buttonRatio) {
    assert.ok(audit.buttonRatio >= 4.5, `${label} button contrast is at least 4.5`)
  }
}

async function auditManagerHome(page, { label, mode }) {
  const audit = await page.evaluate(({ expectedMode }) => {
    function parseRgb(value) {
      const channels = String(value || '').match(/[\d.]+/g)?.slice(0, 3).map(Number)
      return channels?.length === 3 ? channels : null
    }

    function luminance(rgb) {
      const channels = rgb.map((value) => {
        const normalized = value / 255
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
    }

    function contrastRatio(foreground, background) {
      const foregroundRgb = parseRgb(foreground)
      const backgroundRgb = parseRgb(background)
      if (!foregroundRgb || !backgroundRgb) return 0
      const foregroundLuminance = luminance(foregroundRgb)
      const backgroundLuminance = luminance(backgroundRgb)
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    }

    function inheritedBackground(element) {
      let current = element
      while (current) {
        const background = getComputedStyle(current).backgroundColor
        if (background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)') {
          return background
        }
        current = current.parentElement
      }
      return getComputedStyle(document.body).backgroundColor
    }

    const scope = document.querySelector('[data-testid="manager-home"]')
    const rootStyle = getComputedStyle(document.documentElement)
    const token = (name) => {
      const probe = document.createElement('span')
      probe.style.color = rootStyle.getPropertyValue(name).trim()
      probe.style.position = 'fixed'
      probe.style.visibility = 'hidden'
      document.body.append(probe)
      const resolved = getComputedStyle(probe).color
      probe.remove()
      return resolved
    }
    const sections = [
      'manager-home-header',
      'manager-home-next-session',
      'manager-home-quick-actions',
      'manager-home-metrics',
      'manager-home-latest-notes',
    ].map((testId) => {
      const element = document.querySelector(`[data-testid="${testId}"]`)
      return {
        background: element ? getComputedStyle(element).backgroundColor : null,
        present: Boolean(element),
        testId,
      }
    })
    const textSamples = scope
      ? [...scope.querySelectorAll('h1, h2, a')]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => {
          const style = getComputedStyle(element)
          const background = inheritedBackground(element)
          return {
            background,
            foreground: style.color,
            ratio: contrastRatio(style.color, background),
            text: element.textContent.trim().slice(0, 60),
          }
        })
      : []

    return {
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      bodyLuminance: luminance(parseRgb(getComputedStyle(document.body).backgroundColor) || [255, 255, 255]),
      documentOverflows: document.documentElement.scrollWidth > window.innerWidth,
      expectedModeApplied: document.documentElement.classList.contains(`theme-${expectedMode}`),
      panelBackground: token('--panel-bg'),
      primaryBackground: token('--button-primary'),
      scopePresent: Boolean(scope),
      sections,
      shellBackground: token('--shell-card'),
      textSamples,
    }
  }, { expectedMode: mode })

  assert.equal(audit.scopePresent, true, `${label} renders Manager Home`)
  assert.equal(audit.expectedModeApplied, true, `${label} applies ${mode} mode`)
  assert.equal(audit.documentOverflows, false, `${label} has no horizontal overflow`)
  assert.equal(audit.sections.every((section) => section.present), true, `${label} renders all Manager Home sections`)
  assert.equal(audit.sections[0].background, audit.shellBackground, `${label} uses the shell token for the header`)
  for (const section of audit.sections.slice(1)) {
    assert.equal(section.background, audit.panelBackground, `${label} uses the quiet panel token for ${section.testId}`)
    assert.notEqual(section.background, audit.primaryBackground, `${label} does not fill ${section.testId} with the action colour`)
  }
  for (const sample of audit.textSamples) {
    assert.ok(sample.ratio >= 4.5, `${label} "${sample.text}" contrast ${sample.ratio.toFixed(2)} is at least 4.5`)
  }
  if (mode === 'dark') {
    assert.ok(audit.bodyLuminance < 0.08, `${label} uses a near-black charcoal page background`)
  }

  return audit
}

async function runScenario(name, callback) {
  if (scenarioFilter && !name.toLowerCase().includes(scenarioFilter)) {
    return
  }

  await callback()
  console.log(`ok ${name}`)
}

const server = startDevServer()
let browser

try {
  await waitForPort('127.0.0.1', port)
  await waitForHttpOk(`${mainBaseUrl}/sign-in`)

  browser = await chromium.launch({
    args: [
      '--host-resolver-rules=MAP parent.footballplayer.online 127.0.0.1',
    ],
  })

  await runScenario('platform admin login opens platform admin view', async () => {
    const context = await browser.newContext()
    await context.addInitScript(() => {
      window.__quickActionFlashDetected = false
      window.__billingNoticeFlashDetected = false
      const detectRestrictedShellContent = () => {
        if (document.querySelector('[aria-label="Open quick actions"], [aria-label="Close quick actions"]')) {
          window.__quickActionFlashDetected = true
        }
        if (document.querySelector('[aria-label="Billing access notice"]')) {
          window.__billingNoticeFlashDetected = true
        }
      }
      const startObserver = () => {
        detectRestrictedShellContent()
        new MutationObserver(detectRestrictedShellContent).observe(document.documentElement, { childList: true, subtree: true })
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver, { once: true })
      } else {
        startObserver()
      }
    })
    const { page } = await preparePage(context)
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await signIn(page, 'platform.fixture@footballplayer.test')
    await page.waitForURL('**/platform-admin', { timeout: 15000 })
    await page.goto(`${mainBaseUrl}/platform-admin`)
    await page.getByText('Platform control', { exact: true }).waitFor({ state: 'visible' })
    assert.equal(await page.evaluate(() => window.__quickActionFlashDetected), false)
    await assertNoCustomerBillingNotice(page)
    await assertVisibleText(page, 'Platform control')
    await assertVisibleText(page, 'Platform tools')
    assert.equal(await page.locator('a[href="/platform-analytics"]').count() > 0, true)
    await assertVisibleText(page, 'Operational summary')
    await page.goto(`${mainBaseUrl}/platform-analytics`)
    await page.waitForURL('**/platform-analytics', { timeout: 15000 })
    await page.getByRole('heading', { name: 'Platform Analytics', exact: true }).waitFor({ state: 'visible' })
    await assertVisibleText(page, 'Account estate')
    await assertVisibleText(page, 'Authentication')
    await assertVisibleText(page, 'Product activity')
    for (const title of [
      'Page and role activity',
      'Activity heatmap',
      'Club adoption and dormancy',
    ]) {
      const section = page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::section[1]')
      await section.getByRole('button', { name: 'Expand', exact: true }).click()
    }
    await assertVisibleText(page, 'Top pages')
    await assertVisibleText(page, 'Account estate')
    await assertVisibleText(page, 'Activity heatmap')
    await assertVisibleText(page, 'Quiet-window guidance')
    assert.equal(await page.getByRole('table').count() >= 2, true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await assertSelectedOption(page, 'Access view', 'Platform admin')
    await assertHeaderContextPanelRemoved(page)
    await assertSidebarWorkspaceControls(page)
    await assertSidebarFooterContract(page)
    assert.deepEqual(pageErrors, [])
    assert.equal(await page.evaluate(() => window.__quickActionFlashDetected), false)
    await assertNoCustomerBillingNotice(page)

    for (const route of [
      { path: '/platform-clubs', heading: 'Club and Team Management' },
      { path: '/platform-staff', heading: 'Platform Admins' },
      { path: '/platform-data-hygiene', heading: 'Data Hygiene' },
      { path: '/platform-billing-options', heading: 'Billing Options' },
      { path: '/platform-banners', heading: 'Platform Banners' },
      { path: '/platform-feedback', heading: 'Turn tester feedback into a clear product queue.' },
      { path: '/data-transfer', heading: 'Data Transfer' },
    ]) {
      await page.goto(`${mainBaseUrl}${route.path}`)
      await page.waitForURL(`**${route.path}`, { timeout: 15000 })
      await page.getByRole('heading', { name: route.heading, exact: true }).first().waitFor({ state: 'visible', timeout: 15000 })
      await assertNoCustomerBillingNotice(page)
      assert.deepEqual(pageErrors, [], route.path)
    }
    await context.close()
  })

  await runScenario('mobile platform analytics stays usable without page overflow', async () => {
    const context = await browser.newContext({ isMobile: true, viewport: { width: 390, height: 844 } })
    const { page } = await preparePage(context)
    await signIn(page, 'platform.fixture@footballplayer.test')
    await page.waitForURL('**/platform-admin', { timeout: 15000 })
    await page.goto(`${mainBaseUrl}/platform-analytics`)
    await page.waitForURL('**/platform-analytics', { timeout: 15000 })
    await page.getByRole('heading', { name: 'Platform Analytics', exact: true }).waitFor({ state: 'visible' })
    await assertVisibleText(page, 'Account estate')
    await assertVisibleText(page, 'Activity heatmap')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await context.close()
  })

  if (!platformAnalyticsOnly) {
  await runScenario('billing restriction remains visible and correctly owned for customer staff', async () => {
    const cases = [
      { email: 'team-admin.fixture@footballplayer.test', planKey: 'single_team', roleRank: 70, stripeExpected: true },
      { email: 'club.fixture@footballplayer.test', planKey: 'small_club', roleRank: 90, stripeExpected: true },
      { email: 'coach.fixture@footballplayer.test', planKey: 'single_team', roleRank: 30, stripeExpected: false },
    ]

    for (const entry of cases) {
      const context = await browser.newContext()
      const { page } = await preparePage(context)
      await setFixtureBillingState(page, entry.email, {
        billingArrangement: 'immediate',
        isPlanComped: false,
        planKey: entry.planKey,
        planStatus: 'past_due',
        roleRank: entry.roleRank,
      })
      await signIn(page, entry.email)
      if (entry.stripeExpected) {
        try {
          await page.locator('[aria-label="Billing access notice"]').waitFor({ state: 'visible', timeout: 15000 })
        } catch (error) {
          throw new Error(`${entry.email} did not show the customer billing notice at ${page.url()}`, { cause: error })
        }
        await assertVisibleText(page, 'Payment required')
        await assertVisibleText(page, 'Export data')
      } else {
        await page.getByRole('heading', { name: 'Plan access needs attention', exact: true }).waitFor({ state: 'visible', timeout: 15000 })
      }
      assert.notEqual(new URL(page.url()).pathname, '/sign-in', `${entry.email} remains logged in`)
      assert.equal(await page.getByRole('link', { name: 'Continue with Stripe', exact: true }).count() > 0, entry.stripeExpected, entry.email)
      await context.close()
    }
  })

  await runScenario('billing restriction and financial actions stay absent from Parent routes', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    const email = 'parent.fixture@footballplayer.test'
    await setFixtureBillingState(page, email, {
      billingArrangement: 'immediate',
      isPlanComped: false,
      planKey: 'small_club',
      planStatus: 'past_due',
    })
    await parentSignIn(page, email, mainBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await assertVisibleTextContaining(page, 'Fixture Child')
    assert.equal(await page.locator('[aria-label="Billing access notice"]').count(), 0)
    assert.equal(await page.getByText('Payment required', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('link', { name: 'Continue with Stripe', exact: true }).count(), 0)
    assert.equal(await page.getByRole('link', { name: 'Export data', exact: true }).count(), 0)
    await context.close()
  })

  await runScenario('club admin login opens club-wide view', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'club.fixture@footballplayer.test')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'Club-wide view')
    await assertVisibleText(page, 'Club tools')
    await assertSelectedOption(page, 'Access view', 'Club admin view')
    assert.equal(await page.getByRole('option', { name: 'Platform admin' }).count(), 0)
    await assertHeaderContextPanelRemoved(page)
    await assertSidebarWorkspaceControls(page)
    await assertSidebarFooterContract(page)
    await context.close()
  })

  for (const viewport of [
    { name: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', options: { isMobile: true, viewport: { width: 390, height: 844 } } },
  ]) {
    await runScenario(`${viewport.name} club display previews, saves, reloads, survives sign-in, and does not leak`, async () => {
      const context = await browser.newContext(viewport.options)
      const {
        getDisplayRequests,
        getThemeAccent,
        getThemeButtonStyle,
        page,
      } = await prepareClubDisplayPage(context)
      await signIn(page, 'club.fixture@footballplayer.test')
      await page.waitForURL('**/coach', { timeout: 15000 })
      await page.goto(`${mainBaseUrl}/user-settings?area=display`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await closeOnboardingDialog(page)
      await page.getByRole('combobox', { name: 'Accent colour', exact: true }).waitFor({ state: 'visible', timeout: 15000 })
      assert.equal(await page.getByRole('option', { name: 'Legacy solid' }).count(), 0)
      assert.equal(await page.getByRole('option', { name: 'Solid colour' }).count(), 0)
      await page.getByRole('combobox', { name: 'Accent colour', exact: true }).selectOption('custom')
      await page.getByLabel('Custom accent hexadecimal value').fill('#abc')
      assert.equal(await page.getByRole('button', { name: 'Save club display' }).isDisabled(), true)
      assert.equal(getDisplayRequests().length, 0)
      await page.getByLabel('Custom accent hexadecimal value').fill('#2b6cb0')
      await page.getByLabel('Button style').selectOption('gradient')
      await assertVisibleText(page, 'Preview only until saved.')

      assert.equal(getDisplayRequests().length, 0)
      assert.equal(
        await page.locator('.club-display-preview').evaluate((element) =>
          element.style.getPropertyValue('--button-primary').trim()),
        '#2b6cb0',
      )
      assert.notEqual(
        await page.locator('.club-display-preview-primary').first().evaluate((element) =>
          getComputedStyle(element).backgroundImage),
        'none',
      )

      await closeOnboardingDialog(page)
      await page.getByRole('button', { name: 'Save club display' }).click()
      await assertVisibleText(page, 'Club display settings saved.')

      assert.equal(getThemeAccent(), '#2b6cb0')
      assert.equal(getThemeButtonStyle(), 'gradient')
      assert.equal(getDisplayRequests().length, 1)
      assert.deepEqual(getDisplayRequests()[0].payload, {
        theme_accent: '#2b6cb0',
        theme_button_style: 'gradient',
      })
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('accent-custom')), true)
      assert.equal(await page.evaluate(() => document.documentElement.dataset.buttonStyle), 'gradient')
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--button-primary').trim()),
        '#2b6cb0',
      )

      await page.getByLabel('Theme').selectOption('dark')
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theme-dark')), true)
      await page.getByLabel('Theme').selectOption('light')
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theme-light')), true)
      await page.getByLabel('Theme').selectOption('system')
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.waitForFunction(() => document.documentElement.classList.contains('theme-dark'), null, {
        timeout: 15000,
      })
      await page.emulateMedia({ colorScheme: 'light' })
      await page.waitForFunction(() => document.documentElement.classList.contains('theme-light'), null, {
        timeout: 15000,
      })

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.getByRole('combobox', { name: 'Accent colour', exact: true }).waitFor({ state: 'visible', timeout: 15000 })
      await assertSelectedOption(page, 'Accent colour', 'Custom')
      await assertSelectedOption(page, 'Button style', 'Gradient')
      assert.equal(await page.getByLabel('Custom accent hexadecimal value').inputValue(), '#2b6cb0')
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('accent-custom')), true)
      assert.equal(await page.evaluate(() => document.documentElement.dataset.buttonStyle), 'gradient')

      await page.getByLabel('Access view').selectOption({ label: 'Team: U12 Fixture Team' })
      await assertSelectedOption(page, 'Access view', 'Team: U12 Fixture Team')
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('accent-custom')), true)
      assert.equal(await page.evaluate(() => document.documentElement.dataset.buttonStyle), 'gradient')

      await closeOnboardingDialog(page)
      if (viewport.name === 'mobile') {
        await openMobileNavigation(page)
      }
      await page.locator('aside').getByRole('button', { name: 'Sign out' }).click()
      await waitForPathname(page, '/sign-in')
      await signIn(page, 'club.fixture@footballplayer.test')
      await page.waitForURL('**/coach', { timeout: 15000 })
      await page.waitForFunction(() => document.documentElement.classList.contains('accent-custom'), null, {
        timeout: 15000,
      })
      assert.equal(await page.evaluate(() => document.documentElement.dataset.buttonStyle), 'gradient')

      await closeOnboardingDialog(page)
      if (viewport.name === 'mobile') {
        await openMobileNavigation(page)
      }
      await page.locator('aside').getByRole('button', { name: 'Sign out' }).click()
      await waitForPathname(page, '/sign-in')
      await signIn(page, 'other-club.fixture@footballplayer.test')
      await page.waitForURL('**/coach', { timeout: 15000 })
      await page.waitForFunction(() => document.documentElement.classList.contains('accent-blue'), null, {
        timeout: 15000,
      })
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('accent-blue')), true)
      assert.equal(await page.evaluate(() => document.documentElement.dataset.buttonStyle), 'solid')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      await context.close()
    })
  }

  await runScenario('failed club display save stays preview-only and preserves the active club display', async () => {
    const context = await browser.newContext()
    const { getDisplayRequests, page } = await prepareClubDisplayPage(context, { failPatch: true })
    await signIn(page, 'club.fixture@footballplayer.test')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await page.goto(`${mainBaseUrl}/user-settings?area=display`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await closeOnboardingDialog(page)
    await page.getByRole('combobox', { name: 'Accent colour', exact: true }).selectOption('red')
    await page.getByLabel('Button style').selectOption('gradient')
    await closeOnboardingDialog(page)
    await page.getByRole('button', { name: 'Save club display' }).click()
    await assertVisibleText(page, 'Fixture display save failed.')

    assert.equal(getDisplayRequests().length, 1)
    assert.equal(await page.getByText('Club display settings saved.', { exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('accent-green')), true)
    assert.equal(await page.evaluate(() => document.documentElement.dataset.buttonStyle), 'solid')
    assert.deepEqual(
      await page.evaluate(() => ({
        accent: window.localStorage.getItem('app-theme-accent'),
        buttonStyle: window.localStorage.getItem('app-theme-button-style'),
      })),
      { accent: 'green', buttonStyle: 'solid' },
    )
    await context.close()
  })

  await runScenario('coach login opens team view', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'coach.fixture@footballplayer.test')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'U12 Fixture Team')
    await assertVisibleText(page, 'Team tools')
    assert.equal(await page.getByRole('option', { name: 'Platform admin' }).count(), 0)
    await assertHeaderContextPanelRemoved(page)
    await assertSidebarWorkspaceControls(page, { accessViewExpected: false })
    await assertSidebarFooterContract(page, { reportIssueExpected: false })
    await context.close()
  })

  for (const viewport of [
    { name: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', options: { isMobile: true, viewport: { width: 390, height: 844 } } },
  ]) {
    for (const mode of ['light', 'dark']) {
      await runScenario(`${viewport.name} Manager Home ${mode} mode preserves hierarchy, actions and accessibility`, async () => {
        const context = await browser.newContext(viewport.options)
        const { page } = await preparePage(context)
        await signIn(page, 'manager.fixture@footballplayer.test')
        await page.waitForURL('**/coach', { timeout: 15000 })
        await closeOnboardingDialog(page)
        await page.getByTestId('manager-home').waitFor({ state: 'visible', timeout: 15000 })
        await applyTheme(page, { accent: 'green', mode })

        await page.getByRole('heading', { name: 'No upcoming event scheduled', exact: true }).waitFor({ state: 'visible', timeout: 15000 })
        assert.equal(await page.getByTestId('manager-home-next-session').getByRole('link', { name: 'Add event' }).getAttribute('href'), '/calendar?action=add-event')

        const expectedActions = [
          ['View squad', '/players/current'],
          ['Add player note', '/assess-player/new?choosePlayer=1'],
          ['Add assessment', '/assess-player/new?choosePlayer=1'],
          ['Open calendar', '/calendar'],
        ]
        for (const [name, href] of expectedActions) {
          const link = page.getByTestId('manager-home-quick-actions').getByRole('link', { name: new RegExp(`^${name}`) })
          await link.waitFor({ state: 'visible', timeout: 15000 })
          assert.equal(await link.getAttribute('href'), href)
          await link.focus()
          const focusStyle = await link.evaluate((element) => ({
            boxShadow: getComputedStyle(element).boxShadow,
            outlineStyle: getComputedStyle(element).outlineStyle,
          }))
          assert.equal(
            focusStyle.boxShadow !== 'none' || focusStyle.outlineStyle !== 'none',
            true,
            `${viewport.name} ${mode} ${name} has a visible focus indicator`,
          )
        }

        const coachMode = page.getByRole('button', { name: 'Coach Mode', exact: true })
        const fullMode = page.getByRole('button', { name: 'Full Mode', exact: true })
        assert.equal(await fullMode.getAttribute('aria-pressed'), 'true')
        await coachMode.click()
        assert.equal(await coachMode.getAttribute('aria-pressed'), 'true')
        await page.getByTestId('manager-home-next-session').waitFor({ state: 'visible' })
        assert.equal(await page.getByTestId('manager-home-quick-actions').count(), 0)
        assert.equal(await page.getByTestId('manager-home-metrics').count(), 0)
        assert.equal(await page.getByTestId('manager-home-latest-notes').count(), 0)
        await fullMode.click()
        await page.getByTestId('manager-home-quick-actions').waitFor({ state: 'visible' })
        assert.equal(await fullMode.getAttribute('aria-pressed'), 'true')

        await page.getByTestId('manager-home-metrics').getByText('Players', { exact: true }).waitFor({ state: 'visible' })
        await page.getByTestId('manager-home-latest-notes').getByText(
          'Coach notes and assessments will appear here after the first session.',
          { exact: true },
        ).waitFor({ state: 'visible' })

        await auditManagerHome(page, {
          label: `${viewport.name} Manager Home ${mode}`,
          mode,
        })

        if (viewport.name === 'mobile') {
          await openMobileNavigation(page)
          const sidebar = page.locator('aside')
          await sidebar.getByText('Club tools', { exact: true }).waitFor({ state: 'visible' })
          await sidebar.getByText('Match Operations', { exact: true }).waitFor({ state: 'visible' })
          await sidebar.getByText('Team Comms', { exact: true }).waitFor({ state: 'visible' })
          await sidebar.getByText('Squad tools', { exact: true }).waitFor({ state: 'visible' })
          assert.equal(await sidebar.locator('a[aria-current="page"]').getAttribute('href'), '/coach')
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
        }

        await page.screenshot({
          fullPage: true,
          path: `${managerHomeScreenshotDirectory}/${viewport.name}-${mode}.png`,
        })
        await context.close()
      })
    }
  }

  for (const viewport of [
    { name: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', options: { isMobile: true, viewport: { width: 390, height: 844 } } },
  ]) {
    await runScenario(`${viewport.name} demo login authenticates without a browser reset request`, async () => {
      const context = await browser.newContext(viewport.options)
      const { getResetRequests, page } = await prepareDemoPage(context)
      await page.goto(`${mainBaseUrl}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      const demoButton = page.getByRole('button', { name: /^Open demo account$/i })
      await demoButton.waitFor({ state: 'visible', timeout: 15000 })
      await demoButton.click()
      await page.waitForURL('**/coach', { timeout: 15000 })
      await assertVisibleText(page, 'Club-wide view')

      const resetRequests = getResetRequests()
      assert.equal(resetRequests.length, 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      await context.close()
    })
  }

  await runScenario('stale parent mode staff session at root opens team view', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await page.goto(`${mainBaseUrl}/sign-in`, { waitUntil: 'commit', timeout: 60000 })
    await page.evaluate(() => {
      window.sessionStorage.setItem('auth-access-browser-fixture-email', 'coach.fixture@footballplayer.test')
      window.sessionStorage.setItem('selected-access-mode', 'parent')
      window.sessionStorage.removeItem('login-access-intent')
    })
    await page.goto(`${mainBaseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'U12 Fixture Team')
    await assertVisibleText(page, 'Team tools')
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Parent portal', { exact: true }).count(), 0)
    await context.close()
  })

  await runScenario('parent portal login opens family view', async () => {
    const context = await browser.newContext()
    const { getActivityRequests, page } = await preparePage(context)
    await parentSignIn(page, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await assertVisibleText(page, 'Family Portal')
    await assertVisibleTextContaining(page, 'Fixture Child')
    await assertNoSetupGuideTrigger(page)
    assert.equal(
      getActivityRequests().filter((request) => (
        request.operation === 'get'
        && request.parentLinkId === 'parent-link-fixture'
      )).length,
      1,
      'initial Parent Portal loading must issue one activity snapshot request',
    )
    await context.close()
  })

  await runScenario('Parent New indicator clears after success, preserves layout, and isolates children', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const {
      getActivityRequests,
      page,
      setActivityNew,
    } = await preparePage(context)
    setActivityNew('parent-link-fixture-second', 'resources', false)

    await parentSignIn(page, 'parent-multiple.fixture@footballplayer.test', mainBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })

    const resourceNewLink = page.locator('a[aria-label="Resources, New activity"]:visible').first()
    await resourceNewLink.waitFor({ state: 'visible', timeout: 15000 })
    const beforeClearBox = await resourceNewLink.boundingBox()
    assert.ok(beforeClearBox)

    await resourceNewLink.click()
    await page.waitForURL('**/parent-portal?section=resources*', { timeout: 15000 })
    await page.waitForFunction(() => (
      document.querySelectorAll('a[aria-label="Resources, New activity"]:not([hidden])').length === 0
    ))

    const clearedResourceLink = page.locator('a[aria-label="Resources"]:visible').first()
    const afterClearBox = await clearedResourceLink.boundingBox()
    assert.ok(afterClearBox)
    assert.ok(Math.abs(beforeClearBox.width - afterClearBox.width) < 0.5)
    assert.ok(Math.abs(beforeClearBox.height - afterClearBox.height) < 0.5)
    assert.ok(getActivityRequests().some((request) => (
      request.operation === 'mark'
      && request.categoryKey === 'resources'
      && request.parentLinkId === 'parent-link-fixture'
    )))

    await page.locator('a[aria-label="Overview"]:visible').first().click()
    await page.waitForURL('**/parent-portal?section=overview*', { timeout: 15000 })
    setActivityNew('parent-link-fixture', 'resources', true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('a[aria-label="Resources, New activity"]:visible').first()
      .waitFor({ state: 'visible', timeout: 15000 })

    await page.locator('#parent-portal-shell-child').selectOption('parent-link-fixture-second')
    await page.waitForFunction(() => (
      document.querySelectorAll('a[aria-label="Resources, New activity"]:not([hidden])').length === 0
    ))

    await page.locator('#parent-portal-shell-child').selectOption('parent-link-fixture')
    await page.locator('a[aria-label="Resources, New activity"]:visible').first()
      .waitFor({ state: 'visible', timeout: 15000 })

    await context.close()
  })

  await runScenario('multi-role Parent Chat filters rooms by selected child and clears only loaded child New', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const {
      getChatRequests,
      page,
      setActivityNew,
    } = await preparePage(context, { multiRoleChat: true })
    setActivityNew('parent-link-fixture', 'chat', true)
    setActivityNew('parent-link-fixture-second', 'chat', true)

    await parentSignIn(page, 'parent-multiple.fixture@footballplayer.test', mainBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await page.goto(`${mainBaseUrl}/parent-chat?parentLinkId=parent-link-fixture`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })

    const childOnlySwitch = page.getByRole('switch', { name: 'Your child only' })
    await childOnlySwitch.waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await childOnlySwitch.getAttribute('aria-checked'), 'false')
    await page.getByText('First child preview', { exact: true }).waitFor({ state: 'visible' })
    await page.getByText('Second child preview', { exact: true }).waitFor({ state: 'visible' })

    await childOnlySwitch.click()
    await page.getByText('First child preview', { exact: true }).waitFor({ state: 'visible' })
    await page.getByText('Second child preview', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(
      getChatRequests().filter((request) => request.operation === 'viewed').length,
      0,
    )

    await page.getByRole('button').filter({ hasText: 'First child preview' }).click()
    await page.getByText('Safe fixture message for chat-direct-first', { exact: true })
      .waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.querySelector('textarea') !== null)
    await page.waitForTimeout(100)
    assert.ok(getChatRequests().some((request) => (
      request.operation === 'viewed'
      && request.parentLinkId === 'parent-link-fixture'
      && request.roomId === 'chat-direct-first'
    )))
    assert.equal(
      getChatRequests().some((request) => (
        request.operation === 'viewed'
        && request.parentLinkId === 'parent-link-fixture-second'
      )),
      false,
    )

    await page.locator('#parent-portal-shell-child').selectOption('parent-link-fixture-second')
    await page.getByText('Second child preview', { exact: true }).waitFor({ state: 'visible' })
    await page.getByText('First child preview', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(
      getChatRequests().some((request) => (
        request.operation === 'viewed'
        && request.parentLinkId === 'parent-link-fixture-second'
      )),
      false,
    )

    await page.getByRole('button').filter({ hasText: 'Second child preview' }).click()
    await page.getByText('Safe fixture message for chat-direct-second', { exact: true })
      .waitFor({ state: 'visible' })
    await page.getByLabel('Message').fill('Safe browser fixture message')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('textarea')?.value === '')
    assert.equal(
      getChatRequests().filter((request) => request.operation === 'send').length,
      1,
    )
    assert.ok(getChatRequests().some((request) => (
      request.operation === 'send'
      && request.childOnly
      && request.parentLinkId === 'parent-link-fixture-second'
      && request.roomId === 'chat-direct-second'
    )))

    await page.setViewportSize({ width: 390, height: 844 })
    await childOnlySwitch.waitFor({ state: 'visible' })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    )
    await context.close()
  })

  await runScenario('Parent-only and staff Parent Chat surfaces never show the child filter switch', async () => {
    const parentContext = await browser.newContext()
    const { page: parentPage } = await preparePage(parentContext)
    await parentSignIn(parentPage, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await parentPage.goto(`${mainBaseUrl}/parent-chat`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await parentPage.getByRole('heading', { name: 'Chat', exact: true }).waitFor({ state: 'visible' })
    assert.equal(await parentPage.getByRole('switch', { name: 'Your child only' }).count(), 0)
    await parentContext.close()

    const staffContext = await browser.newContext()
    const { page: staffPage } = await preparePage(staffContext)
    await signIn(staffPage, 'multi.fixture@footballplayer.test', mainBaseUrl, 'club')
    await staffPage.goto(`${mainBaseUrl}/parent-chat-staff`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await staffPage.getByRole('heading', { name: 'Parent Chat', exact: true })
      .waitFor({ state: 'visible' })
    assert.equal(await staffPage.getByRole('switch', { name: 'Your child only' }).count(), 0)
    await staffContext.close()
  })

  await runScenario('Parent New indicator remains when viewed-state persistence fails', async () => {
    const context = await browser.newContext({ viewport: { width: 820, height: 1180 } })
    const {
      getActivityRequests,
      page,
      setActivityMarkFailure,
    } = await preparePage(context)
    setActivityMarkFailure(true)

    await parentSignIn(page, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    const failedMarkResponse = page.waitForResponse((response) => (
      response.url().includes('/rest/v1/rpc/mark_parent_portal_category_viewed')
      && response.status() === 500
    ))
    await page.locator('a[aria-label="Resources, New activity"]:visible').first().click()
    await page.waitForURL('**/parent-portal?section=resources*', { timeout: 15000 })
    await failedMarkResponse
    await page.waitForFunction(() => (
      document.querySelector('a[aria-label="Resources, New activity"]') !== null
    ))

    assert.ok(getActivityRequests().some((request) => (
      request.operation === 'mark' && request.categoryKey === 'resources'
    )))
    await page.locator('a[aria-label="Resources, New activity"]:visible').first()
      .waitFor({ state: 'visible', timeout: 15000 })
    await context.close()
  })

  await runScenario('Parent New clear is shared across simultaneous browser sessions', async () => {
    const sharedActivityStore = new Map()
    const firstContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const secondContext = await browser.newContext({ isMobile: true, viewport: { width: 390, height: 844 } })
    const { page: firstPage } = await preparePage(firstContext, { activityStore: sharedActivityStore })
    const { page: secondPage } = await preparePage(secondContext, { activityStore: sharedActivityStore })

    await parentSignIn(firstPage, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await parentSignIn(secondPage, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await firstPage.locator('a[aria-label="Resources, New activity"]:visible').first()
      .waitFor({ state: 'visible', timeout: 15000 })
    await secondPage.locator('a[aria-label="Resources, New activity"]:visible').first()
      .waitFor({ state: 'visible', timeout: 15000 })

    await firstPage.locator('a[aria-label="Resources, New activity"]:visible').first().click()
    await firstPage.waitForURL('**/parent-portal?section=resources*', { timeout: 15000 })
    await firstPage.waitForFunction(() => (
      document.querySelectorAll('a[aria-label="Resources, New activity"]:not([hidden])').length === 0
    ))

    await secondPage.reload({ waitUntil: 'domcontentloaded' })
    await secondPage.waitForFunction(() => (
      document.querySelectorAll('a[aria-label="Resources, New activity"]:not([hidden])').length === 0
    ))

    await firstContext.close()
    await secondContext.close()
  })

  for (const viewport of [
    {
      evidenceTheme: 'dark-custom',
      name: 'desktop',
      options: { viewport: { width: 1440, height: 900 } },
    },
    {
      evidenceTheme: 'light-custom',
      name: 'tablet',
      options: { viewport: { width: 820, height: 1180 } },
    },
    {
      evidenceTheme: 'dark-default',
      name: 'mobile',
      options: { isMobile: true, viewport: { width: 390, height: 844 } },
    },
  ]) {
    await runScenario(`${viewport.name} Parent route and theme audit matrix`, async () => {
      const context = await browser.newContext(viewport.options)
      const { page } = await preparePage(context)
      const consoleErrors = []
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })

      await parentSignIn(page, 'parent-multiple.fixture@footballplayer.test', mainBaseUrl)
      await page.waitForURL('**/parent-portal', { timeout: 15000 })
      await assertVisibleTextContaining(page, 'Fixture Child')
      await page.getByRole('option', { name: /Second Fixture Child/ }).waitFor({ state: 'attached', timeout: 15000 })
      assert.equal(await page.getByRole('option', { name: /Second Fixture Child/ }).count(), 1)

      for (const route of parentThemeRoutes) {
        await page.goto(`${mainBaseUrl}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await page.getByTestId(route.scopeTestId).waitFor({ state: 'visible', timeout: 15000 })
        await page.waitForTimeout(150)

        for (const theme of parentThemeMatrix) {
          await applyTheme(page, theme)
          await auditParentTheme(page, {
            ...theme,
            label: `${viewport.name} ${route.label} ${theme.label}`,
            scopeTestId: route.scopeTestId,
          })

          if (route.label === 'overview') {
            const newIndicator = page.locator('[aria-label="Resources has new activity"]:visible').first()
            await newIndicator.waitFor({ state: 'visible', timeout: 15000 })
            assert.equal((await newIndicator.textContent())?.trim(), 'New')
            assert.equal(
              await page.locator('nav[aria-label="Parent portal sections"]:visible')
                .locator('span')
                .filter({ hasText: /^\d+$/ })
                .count(),
              0,
            )
          }

          const shouldCapture = theme.label === viewport.evidenceTheme
            || (route.label === 'overview' && ['light-default', 'dark-custom'].includes(theme.label))
          if (shouldCapture) {
            await page.screenshot({
              path: `${parentThemeScreenshotDirectory}/parent-${viewport.name}-${route.label}-${theme.label}.png`,
              fullPage: true,
            })
          }
        }
      }

      assert.deepEqual(consoleErrors, [])
      await context.close()
    })
  }

  for (const viewport of [
    { evidenceTheme: 'dark-custom', name: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
    { evidenceTheme: 'light-custom', name: 'tablet', options: { viewport: { width: 820, height: 1180 } } },
    { evidenceTheme: 'dark-default', name: 'mobile', options: { isMobile: true, viewport: { width: 390, height: 844 } } },
  ]) {
    for (const inviteState of [
      {
        invite: {
          email: 'parent.fixture@footballplayer.test',
          playerName: 'Fixture Child',
          teamName: 'U12 Fixture Team',
          clubName: 'Fixture United',
        },
        label: 'valid',
        message: '',
        status: 200,
        visibleText: 'Create your family portal login',
      },
      {
        invite: null,
        label: 'expired',
        message: 'This parent invite has expired. Please ask the club to send a new invite.',
        status: 410,
        visibleText: 'This parent invite has expired.',
      },
      {
        invite: null,
        label: 'invalid',
        message: 'This access link is not available. Please ask the club to send a new invite.',
        status: 404,
        visibleText: 'This access link is not available.',
      },
    ]) {
      await runScenario(`${viewport.name} ${inviteState.label} Parent invite theme matrix`, async () => {
        const context = await browser.newContext(viewport.options)
        const { page } = await prepareParentInviteStatePage(context, inviteState)
        await page.goto(`${mainBaseUrl}/parent-invite/theme-audit-token`, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        })
        await page.getByTestId('parent-invite-shell').waitFor({ state: 'visible', timeout: 15000 })
        await assertVisibleTextContaining(page, inviteState.visibleText)

        for (const theme of parentThemeMatrix) {
          await applyTheme(page, theme)
          await auditParentTheme(page, {
            ...theme,
            label: `${viewport.name} ${inviteState.label} invite ${theme.label}`,
            scopeTestId: 'parent-invite-shell',
          })
          if (theme.label === viewport.evidenceTheme) {
            await page.screenshot({
              path: `${parentThemeScreenshotDirectory}/parent-invite-${viewport.name}-${inviteState.label}-${theme.label}.png`,
              fullPage: true,
            })
          }
        }

        await context.close()
      })
    }
  }

  for (const viewport of [
    { name: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', options: { viewport: { width: 820, height: 1180 } } },
    { name: 'mobile', options: { isMobile: true, viewport: { width: 390, height: 844 } } },
  ]) {
    await runScenario(`${viewport.name} Parent sign-in continuation remains readable in every theme`, async () => {
      const context = await browser.newContext(viewport.options)
      const { page } = await preparePage(context)
      await page.goto(`${mainBaseUrl}/sign-in?tab=parent&parentInvite=theme-audit-token`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      await page.getByRole('heading', { name: 'Sign in to parent access' }).waitFor({ state: 'visible', timeout: 15000 })
      assert.equal(new URL(page.url()).searchParams.get('parentInvite'), 'theme-audit-token')

      for (const theme of parentThemeMatrix) {
        await applyTheme(page, theme)
        await auditStandaloneTheme(page, { label: `${viewport.name} Parent sign-in ${theme.label}` })
        if (['light-default', 'dark-custom'].includes(theme.label)) {
          await page.screenshot({
            path: `${parentThemeScreenshotDirectory}/parent-sign-in-${viewport.name}-${theme.label}.png`,
            fullPage: true,
          })
        }
      }

      await context.close()
    })
  }

  await runScenario('main parent tab resolves dual-access user to parent portal only', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'multi.fixture@footballplayer.test', mainBaseUrl, 'parent')
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await assertVisibleText(page, 'Family Portal')
    await assertVisibleTextContaining(page, 'Fixture Child')
    assert.equal(await page.getByText(/sign-in is for club staff/i).count(), 0)
    await assertNoSetupGuideTrigger(page)
    await context.close()
  })

  await runScenario('club tab resolves dual-access user to team workspace only', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'multi.fixture@footballplayer.test', mainBaseUrl, 'club')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'Club-wide view')
    await assertVisibleText(page, 'Club tools')
    await assertSelectedOption(page, 'Access view', 'Team access')
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Team workspace unavailable', { exact: true }).count(), 0)
    await assertSidebarFooterContract(page)
    await context.close()
  })

  await runScenario('parent-only account using club login returns safely to club sign-in', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'parent.fixture@footballplayer.test', mainBaseUrl, 'club')
    await waitForPathname(page, '/sign-in')
    assert.equal(new URL(page.url()).searchParams.get('tab'), null)
    await page.getByRole('button', { name: 'Coach' }).waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Choose where to continue', { exact: true }).count(), 0)
    await context.close()
  })

  await runScenario('staff-only account using parent login returns safely to parent sign-in', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await parentSignIn(page, 'coach.fixture@footballplayer.test', mainBaseUrl)
    await waitForPathname(page, '/sign-in')
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'parent')
    await page.getByRole('button', { name: 'Parent' }).waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Team workspace unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Choose where to continue', { exact: true }).count(), 0)
    await context.close()
  })

  await runScenario('stale parent mode does not override club login intent', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await seedSelectedAccessMode(page, 'parent')
    await signIn(page, 'coach.fixture@footballplayer.test', mainBaseUrl, 'club')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'Team tools')
    await assertSelectedOption(page, 'Access view', 'Team: U12 Fixture Team')
    await context.close()
  })

  await runScenario('stale team mode does not override parent login intent', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await seedSelectedAccessMode(page, 'team')
    await parentSignIn(page, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await assertVisibleText(page, 'Family Portal')
    await assertVisibleTextContaining(page, 'Fixture Child')
    await context.close()
  })

  await runScenario('failed club login clears stale parent access intent', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await seedSelectedAccessMode(page, 'parent')
    await page.goto(`${mainBaseUrl}/sign-in`, { waitUntil: 'commit', timeout: 60000 })
    await page.getByRole('button', { name: 'Coach' }).click()
    await page.getByPlaceholder('you@club.com').fill('coach.fixture@footballplayer.test')
    await page.getByPlaceholder('Enter password').fill('WrongFixturePass123!')
    await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
    await assertVisibleText(page, 'Fixture login failed.')
    await waitForPathname(page, '/sign-in')
    assert.equal(await page.getByText('Login again before creating your club').count(), 0)
    await assertLoginAccessStateCleared(page)
    await context.close()
  })

  await runScenario('failed parent login clears stale team access intent', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await seedSelectedAccessMode(page, 'team')
    await page.goto(`${mainBaseUrl}/sign-in?tab=parent`, { waitUntil: 'commit', timeout: 60000 })
    await page.getByRole('button', { name: 'Parent' }).click()
    await page.getByPlaceholder('you@club.com').fill('parent.fixture@footballplayer.test')
    await page.getByPlaceholder('Enter password').fill('WrongFixturePass123!')
    await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
    await assertVisibleText(page, 'Fixture login failed.')
    await waitForPathname(page, '/sign-in')
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'parent')
    assert.equal(await page.getByText('Login again before creating your club').count(), 0)
    await assertLoginAccessStateCleared(page)
    await context.close()
  })

  await runScenario('legacy parent login routes redirect to unified parent sign-in', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await page.goto(`${mainBaseUrl}/parent-login?parentInvite=fixture-token&confirmed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await waitForPathname(page, '/sign-in')
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'parent')
    assert.equal(new URL(page.url()).searchParams.get('parentInvite'), 'fixture-token')
    await page.getByRole('button', { name: 'Parent' }).waitFor({ state: 'visible', timeout: 15000 })
    await context.close()
  })

  await runScenario('signed-out existing parent login accepts the invite once before opening the portal', async () => {
    const context = await browser.newContext()
    const { getAcceptanceCallCount, page } = await prepareParentInvitePage(context)
    await page.goto(`${mainBaseUrl}/sign-in?tab=parent&parentInvite=fixture-parent-invite`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.getByPlaceholder('you@club.com').fill('parent.fixture@footballplayer.test')
    await page.getByPlaceholder('Enter password').fill(fixturePassword)
    await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
    await page.waitForURL('**/parent-portal?*', { timeout: 15000 })
    const finalUrl = new URL(page.url())

    assert.equal(finalUrl.origin, mainBaseUrl)
    assert.equal(finalUrl.searchParams.get('linked'), '1')
    assert.equal(finalUrl.searchParams.get('parentLinkId'), 'parent-link-fixture')
    assert.equal(getAcceptanceCallCount(), 1)
    await assertVisibleText(page, 'Child linked')
    await assertVisibleTextContaining(page, 'Fixture Child is now available')
    await context.close()
  })

  await runScenario('authenticated parent invite stays higher priority on mobile and accepts once', async () => {
    const context = await browser.newContext({
      isMobile: true,
      viewport: { width: 390, height: 844 },
    })
    const { getAcceptanceCallCount, page } = await prepareParentInvitePage(context)
    await parentSignIn(page, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await page.goto(`${mainBaseUrl}/parent-invite/fixture-parent-invite`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForURL('**/parent-portal?*', { timeout: 15000 })
    const finalUrl = new URL(page.url())

    assert.equal(finalUrl.origin, mainBaseUrl)
    assert.equal(finalUrl.searchParams.get('linked'), '1')
    assert.equal(finalUrl.searchParams.get('parentLinkId'), 'parent-link-fixture')
    assert.equal(getAcceptanceCallCount(), 1)
    await assertVisibleText(page, 'Child linked')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await context.close()
  })

  await runScenario('stale parent mode preserves the session and recovers to team workspace', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await page.goto(`${mainBaseUrl}/sign-in`, { waitUntil: 'commit', timeout: 60000 })
    await page.evaluate(() => {
      window.sessionStorage.setItem('auth-access-browser-fixture-email', 'fallback-dual.fixture@footballplayer.test')
      window.sessionStorage.setItem('selected-access-mode', 'parent')
      window.sessionStorage.removeItem('login-access-intent')
    })
    await page.goto(`${mainBaseUrl}/parent-portal`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await assertVisibleText(page, 'Choose an available workspace')
    await assertVisibleText(page, 'Your session is still active')
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Fixture Child').count(), 0)
    await page.getByRole('button', { name: 'Open Team / Coach' }).click()
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'Club-wide view')
    await context.close()
  })

  await runScenario('stale parent recovery does not show a stale family label', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await page.goto(`${mainBaseUrl}/sign-in`, { waitUntil: 'commit', timeout: 60000 })
    await page.evaluate(() => {
      window.sessionStorage.setItem('auth-access-browser-fixture-email', 'stale-label-dual.fixture@footballplayer.test')
      window.sessionStorage.setItem('selected-access-mode', 'parent')
      window.sessionStorage.removeItem('login-access-intent')
    })
    await page.goto(`${mainBaseUrl}/parent-portal`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await assertVisibleText(page, 'Choose an available workspace')
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('U17 Green').count(), 0)
    assert.equal(await page.getByLabel('Access view').count(), 0)
    await page.getByRole('button', { name: 'Open Team / Coach' }).click()
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'U17 Green')
    await assertVisibleText(page, 'Team tools')
    await context.close()
  })

  await runScenario('parent-link lookup failure is not treated as confirmed no-link', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await parentSignIn(page, 'lookup-failed-dual.fixture@footballplayer.test', mainBaseUrl)
    await assertVisibleText(page, 'Parent access could not be confirmed', 60000)
    await assertVisibleText(page, 'A temporary Parent-link lookup problem is not treated as proof that the link is missing.')
    assert.equal(await page.getByText(/sign-in is for parent access/i).count(), 0)
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Open Team / Coach' }).click()
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'Club-wide view')
    await context.close()
  })

  await runScenario('confirmed no-link parent intent stays strict and returns to Parent sign-in', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await parentSignIn(page, 'fallback-dual.fixture@footballplayer.test', mainBaseUrl)
    await waitForPathname(page, '/sign-in')
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'parent')
    await page.getByRole('button', { name: 'Parent' }).waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await page.getByText('Choose an available workspace', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Open Team / Coach' }).count(), 0)
    await context.close()
  })

  await runScenario('parent-only unavailable fallback redirects to unified parent sign-in without exposing data', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await parentSignIn(page, 'parent-unlinked.fixture@footballplayer.test', mainBaseUrl)
    await waitForPathname(page, '/sign-in')
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'parent')
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('What this means', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Next step', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Return to Coach platform' }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Retry' }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Sign in again' }).count(), 0)
    assert.equal(await page.getByText('Fixture Child').count(), 0)
    await assertNoSetupGuideTrigger(page)
    await context.close()
  })

  await runScenario('Family Portal shell restores club branding and safe child context on desktop and mobile', async () => {
    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const { page: desktopPage } = await preparePage(desktopContext)
    await parentSignIn(desktopPage, 'parent-multiple.fixture@footballplayer.test', mainBaseUrl)
    await desktopPage.waitForURL('**/parent-portal', { timeout: 15000 })

    const desktopContextPanel = desktopPage.getByTestId('parent-portal-context-desktop')
    await desktopContextPanel.waitFor({ state: 'visible' })
    await desktopContextPanel.getByRole('img', { name: 'Fixture United logo' }).waitFor({ state: 'visible' })
    await desktopContextPanel.getByText('Fixture United', { exact: true }).waitFor({ state: 'visible' })
    const desktopChildSelector = desktopContextPanel.locator('#parent-portal-shell-child')
    assert.equal(await desktopChildSelector.locator('option').count(), 2)
    await desktopChildSelector.selectOption('parent-link-fixture-second')
    await desktopContextPanel.getByRole('paragraph').filter({ hasText: 'Second Fixture Child' }).waitFor({ state: 'visible' })
    await desktopPage.getByText('Private family view. You only see information the club has shared for this child.', { exact: true }).waitFor({ state: 'visible' })
    assert.equal(await desktopPage.getByText('Child being viewed', { exact: true }).count(), 0)
    assert.equal(await desktopPage.getByRole('button', { name: 'Return to Coach platform' }).count(), 0)
    const desktopShellAudit = await desktopPage.evaluate(() => {
      const shell = document.querySelector('[data-testid="parent-portal-route-shell"]')
      const sidebar = document.querySelector('[data-testid="parent-portal-context-desktop"]')?.parentElement
      const main = shell?.querySelector('main')
      const accountActions = sidebar?.querySelector('[aria-label="Parent account actions"]')
      const shellBox = shell?.getBoundingClientRect()
      const sidebarBox = sidebar?.getBoundingClientRect()
      const actionsBox = accountActions?.getBoundingClientRect()

      return {
        actionsInsideSidebar: Boolean(actionsBox && sidebarBox && actionsBox.bottom <= sidebarBox.bottom + 1),
        documentHasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        documentHasVerticalOverflow: document.documentElement.scrollHeight > window.innerHeight + 1,
        mainOverflowY: main ? getComputedStyle(main).overflowY : '',
        shellInsideViewport: Boolean(shellBox && shellBox.top >= -1 && shellBox.bottom <= window.innerHeight + 1),
        sidebarOverflow: sidebar ? getComputedStyle(sidebar).overflow : '',
      }
    })
    assert.deepEqual(desktopShellAudit, {
      actionsInsideSidebar: true,
      documentHasHorizontalOverflow: false,
      documentHasVerticalOverflow: false,
      mainOverflowY: 'auto',
      shellInsideViewport: true,
      sidebarOverflow: 'hidden',
    })
    await desktopContext.close()

    const mobileContext = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    })
    const { page: mobilePage } = await preparePage(mobileContext)
    await parentSignIn(mobilePage, 'parent-multiple.fixture@footballplayer.test', mainBaseUrl)
    await mobilePage.waitForURL('**/parent-portal', { timeout: 15000 })

    const mobileContextPanel = mobilePage.getByTestId('parent-portal-context-mobile')
    await mobileContextPanel.waitFor({ state: 'visible' })
    await mobileContextPanel.getByText('Fixture United', { exact: true }).waitFor({ state: 'visible' })
    const mobileChildSelector = mobileContextPanel.locator('#parent-portal-shell-child-mobile')
    await mobileChildSelector.selectOption('parent-link-fixture-second')
    await mobileContextPanel.getByRole('paragraph').filter({ hasText: 'Second Fixture Child' }).waitFor({ state: 'visible' })
    const mobileNavState = await mobileContextPanel.locator('xpath=..').evaluate((element) => {
      const styles = getComputedStyle(element)
      const signOut = element.querySelector('[aria-label="Sign out of the parent portal"]')
      return {
        bottom: element.getBoundingClientRect().bottom,
        position: styles.position,
        signOutHeight: signOut?.getBoundingClientRect().height ?? 0,
        viewportHeight: window.innerHeight,
      }
    })
    assert.equal(mobileNavState.position, 'fixed')
    assert.ok(mobileNavState.bottom <= mobileNavState.viewportHeight + 1)
    assert.ok(mobileNavState.signOutHeight >= 44)
    assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await mobileContext.close()
  })

  await runScenario('Family Portal shell stays usable at short desktop, zoom-equivalent, tablet and mobile viewports', async () => {
    const matrix = [
      { height: 560, label: 'short desktop', usesDesktopShell: true, width: 1280 },
      { height: 700, label: '80 percent zoom equivalent', usesDesktopShell: true, width: 1600 },
      { height: 560, label: '125 percent zoom equivalent', usesDesktopShell: true, width: 1024 },
      { height: 480, label: '150 percent zoom equivalent', usesDesktopShell: false, width: 854 },
      { height: 1024, label: 'tablet', usesDesktopShell: false, width: 768 },
      { height: 800, label: 'Android phone', usesDesktopShell: false, width: 360 },
    ]

    for (const viewport of matrix) {
      const context = await browser.newContext({
        hasTouch: !viewport.usesDesktopShell,
        isMobile: viewport.width < 600,
        viewport: { width: viewport.width, height: viewport.height },
      })
      const { page } = await preparePage(context)
      await parentSignIn(page, 'parent-multiple.fixture@footballplayer.test', mainBaseUrl)
      await page.waitForURL('**/parent-portal', { timeout: 15000 })
      await page.getByTestId('parent-portal-route-shell').waitFor({ state: 'visible', timeout: 15000 })

      const audit = await page.evaluate(({ usesDesktopShell }) => {
        const routeShell = document.querySelector('[data-testid="parent-portal-route-shell"]')
        const desktopContext = document.querySelector('[data-testid="parent-portal-context-desktop"]')
        const mobileContext = document.querySelector('[data-testid="parent-portal-context-mobile"]')
        const desktopSidebar = desktopContext?.parentElement
        const accountActions = (usesDesktopShell ? desktopSidebar : mobileContext?.parentElement)
          ?.querySelector('[aria-label="Parent account actions"]')
        const actionsBox = accountActions?.getBoundingClientRect()

        return {
          actionsReachable: Boolean(actionsBox && actionsBox.top < window.innerHeight && actionsBox.bottom > 0),
          desktopContextVisible: Boolean(desktopContext && getComputedStyle(desktopContext).display !== 'none' && desktopContext.getBoundingClientRect().width > 0),
          documentHasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          documentHasVerticalOverflow: document.documentElement.scrollHeight > window.innerHeight + 1,
          mainOverflowY: routeShell?.querySelector('main') ? getComputedStyle(routeShell.querySelector('main')).overflowY : '',
          mobileContextVisible: Boolean(mobileContext && getComputedStyle(mobileContext).display !== 'none' && mobileContext.getBoundingClientRect().width > 0),
        }
      }, viewport)

      assert.equal(audit.documentHasHorizontalOverflow, false, `${viewport.label} has no horizontal overflow`)
      assert.equal(audit.actionsReachable, true, `${viewport.label} keeps account actions reachable`)

      if (viewport.usesDesktopShell) {
        assert.equal(audit.desktopContextVisible, true, `${viewport.label} uses the desktop sidebar`)
        assert.equal(audit.mobileContextVisible, false, `${viewport.label} hides the mobile action bar`)
        assert.equal(audit.documentHasVerticalOverflow, false, `${viewport.label} keeps document scrolling bounded`)
        assert.equal(audit.mainOverflowY, 'auto', `${viewport.label} gives content one scroll region`)
      } else {
        assert.equal(audit.desktopContextVisible, false, `${viewport.label} hides the desktop sidebar`)
        assert.equal(audit.mobileContextVisible, true, `${viewport.label} uses the safe mobile action bar`)
      }

      await context.close()
    }
  })

  await runScenario('parent portal sign out is visible and clears the fixture session', async () => {
    const desktopContext = await browser.newContext()
    const { page: desktopPage } = await preparePage(desktopContext)
    await parentSignIn(desktopPage, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await desktopPage.waitForURL('**/parent-portal', { timeout: 15000 })
    const mainAccountActions = desktopPage
      .getByTestId('parent-portal-context-desktop')
      .locator('xpath=..')
      .getByLabel('Parent account actions')
    await mainAccountActions.getByRole('button', { name: /Sign out/ }).waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await mainAccountActions.getByRole('button', { name: /Sign out/ }).count(), 1)
    assert.equal(await desktopPage.getByRole('button', { name: 'Return to Coach platform' }).count(), 0)
    await desktopPage.goto(`${mainBaseUrl}/parent-portal?section=settings`, { waitUntil: 'domcontentloaded' })
    await assertVisibleText(desktopPage, 'Parent settings')
    await desktopPage.getByRole('button', { name: /Sign out/ }).first().waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await desktopPage.getByRole('button', { name: 'Return to Coach platform' }).count(), 0)
    await desktopPage.getByRole('button', { name: /Sign out/ }).first().click()
    await waitForPathname(desktopPage, '/sign-in')
    assert.equal(new URL(desktopPage.url()).searchParams.get('tab'), 'parent')
    assert.equal(await desktopPage.evaluate(() => window.sessionStorage.getItem('auth-access-browser-fixture-email')), null)
    await desktopContext.close()

    const mobileContext = await browser.newContext({
      isMobile: true,
      viewport: { width: 390, height: 844 },
    })
    const { page: mobilePage } = await preparePage(mobileContext)
    await parentSignIn(mobilePage, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await mobilePage.waitForURL('**/parent-portal', { timeout: 15000 })
    const mobileAccountActions = mobilePage
      .getByTestId('parent-portal-context-mobile')
      .locator('xpath=..')
      .getByLabel('Parent account actions')
    await mobileAccountActions.getByRole('button', { name: /Sign out/ }).waitFor({ state: 'visible', timeout: 15000 })
    await mobilePage.goto(`${mainBaseUrl}/parent-portal?section=settings`, { waitUntil: 'domcontentloaded' })
    await assertVisibleText(mobilePage, 'Parent settings')
    await mobileAccountActions.getByRole('button', { name: /Sign out/ }).waitFor({ state: 'visible', timeout: 15000 })
    await mobileContext.close()
  })

  await runScenario('dual-access parent can switch to staff without a new login', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'multi.fixture@footballplayer.test', mainBaseUrl, 'parent')
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await page.getByRole('button', { name: 'Return to Coach platform' }).first().click()
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertSelectedOption(page, 'Access view', 'Team access')
    await assertVisibleText(page, 'Club-wide view')
    assert.equal(
      await page.evaluate(() => window.sessionStorage.getItem('auth-access-browser-fixture-email')),
      'multi.fixture@footballplayer.test',
    )
    await context.close()
  })

  await runScenario('dual-access switch restores the last valid staff team', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'multi.fixture@footballplayer.test')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await page.getByLabel('Access view').selectOption({ label: 'Team: U12 Fixture Team' })
    await assertSelectedOption(page, 'Access view', 'Team: U12 Fixture Team')
    await page.getByLabel('Access view').selectOption({ label: 'Family portal' })
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await page.getByRole('button', { name: 'Return to Coach platform' }).first().click()
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertSelectedOption(page, 'Access view', 'Team: U12 Fixture Team')
    await assertVisibleText(page, 'Team tools')
    await context.close()
  })

  await runScenario('dual-access switch with no saved team opens safe club-wide staff access', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'multi.fixture@footballplayer.test')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertSelectedOption(page, 'Access view', 'Team access')
    await page.getByLabel('Access view').selectOption({ label: 'Family portal' })
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await page.getByRole('button', { name: 'Return to Coach platform' }).first().click()
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertSelectedOption(page, 'Access view', 'Team access')
    await assertVisibleText(page, 'Club-wide view')
    await context.close()
  })

  await runScenario('dual-access switch is visible in the mobile parent shell', async () => {
    const context = await browser.newContext({
      isMobile: true,
      viewport: { width: 390, height: 844 },
    })
    const { page } = await preparePage(context)
    await signIn(page, 'multi.fixture@footballplayer.test', mainBaseUrl, 'parent')
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    const accountActions = page
      .getByTestId('parent-portal-context-mobile')
      .locator('xpath=..')
      .getByLabel('Parent account actions')
    const switchButton = accountActions.getByRole('button', { name: 'Return to Coach platform' })
    const signOutButton = accountActions.getByRole('button', { name: /Sign out/ })
    await switchButton.waitFor({ state: 'visible', timeout: 15000 })
    await signOutButton.waitFor({ state: 'visible', timeout: 15000 })
    const [switchBox, signOutBox] = await Promise.all([switchButton.boundingBox(), signOutButton.boundingBox()])
    assert.ok(switchBox && signOutBox)
    assert.ok(Math.abs(switchBox.y - signOutBox.y) <= 2)
    assert.ok(switchBox.height >= 44)
    assert.ok(signOutBox.height >= 44)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await context.close()
  })

  await runScenario('parent host transfers the same session to the staff platform securely', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await parentSignIn(page, 'multi.fixture@footballplayer.test', parentBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await page.getByRole('button', { name: 'Return to Coach platform' }).first().click()
    await page.waitForURL(`${mainBaseUrl}/coach`, { timeout: 15000 })
    await assertVisibleText(page, 'Club-wide view')
    assert.equal(
      await page.evaluate(() => window.sessionStorage.getItem('auth-access-browser-fixture-email')),
      'multi.fixture@footballplayer.test',
    )
    await context.close()
  })

  await runScenario('multi-context user can switch between platform team and parent', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'multi.fixture@footballplayer.test')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertSelectedOption(page, 'Access view', 'Team access')
    await assertVisibleText(page, 'Club-wide view')

    await page.getByLabel('Access view').selectOption({ label: 'Team: U12 Fixture Team' })
    await assertSelectedOption(page, 'Access view', 'Team: U12 Fixture Team')
    await assertVisibleText(page, 'Team tools')

    await page.getByLabel('Access view').selectOption({ label: 'Family portal' })
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await assertVisibleText(page, 'Family Portal')
    await page.getByLabel('Access view').waitFor({ state: 'detached', timeout: 15000 })
    assert.equal(await page.getByLabel('Access view').count(), 0)
    await assertVisibleTextContaining(page, 'Fixture Child')
    await assertNoSetupGuideTrigger(page)
    await context.close()
  })

  await runScenario('team context with no active team shows Team access', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'teamless.fixture@footballplayer.test')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertSelectedOption(page, 'Access view', 'Team access')
    await assertVisibleText(page, 'Club-wide view')
    await assertSidebarFooterContract(page)
    await context.close()
  })

  await runScenario('parent host isolation prevents platform exposure and probing', async () => {
    const context = await browser.newContext()
    const { page, getPlatformProbeCount } = await preparePage(context)
    await parentSignIn(page, 'multi.fixture@footballplayer.test', parentBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await assertVisibleTextContaining(page, 'Fixture Child')
    assert.equal(await page.getByText('Platform admin', { exact: true }).count(), 0)
    assert.equal(getPlatformProbeCount(), 0)
    await assertNoSetupGuideTrigger(page)
    await context.close()
  })

  await runScenario('mobile drawer omits setup guide and keeps footer actions', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const { page } = await preparePage(context)
    await signIn(page, 'platform.fixture@footballplayer.test')
    await page.waitForURL('**/platform-admin', { timeout: 15000 })
    await assertVisibleText(page, 'Operational summary')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await assertHeaderContextPanelRemoved(page)
    await openMobileNavigation(page)
    await assertSidebarWorkspaceControls(page)
    await assertSidebarFooterContract(page)
    await context.close()
  })
  }
} catch (error) {
  console.error(server.getOutput())
  throw error
} finally {
  if (browser) {
    await browser.close()
  }
  await stopDevServer(server)
}
