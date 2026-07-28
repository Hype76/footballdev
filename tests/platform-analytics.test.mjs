import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  canonicalizeAnalyticsRoute,
  getMeaningfulRouteEvent,
  isClearlyExcludedAnalyticsProfile,
  mapAuditActionToAnalyticsEvent,
  normalizeAnalyticsEventInput,
} from '../src/lib/analytics/registry.js'
import {
  buildPlatformAnalyticsReport,
  normalizePlatformAnalyticsFilters,
  recommendMaintenanceWindow,
} from '../src/lib/platform-analytics.js'
import { recordSuccessfulLoginAnalytics } from '../src/lib/domain/platform-analytics.js'
import { createPlatformAnalyticsHandler } from '../netlify/functions/lib/_platform-analytics.js'

const now = new Date('2026-07-27T12:00:00.000Z')
const clubId = '11111111-1111-4111-8111-111111111111'
const staffId = '22222222-2222-4222-8222-222222222222'
const parentId = '33333333-3333-4333-8333-333333333333'

function dailyRow(overrides = {}) {
  return {
    activity_date: '2026-07-27',
    user_id: staffId,
    role: 'coach',
    club_id: clubId,
    platform: 'web',
    is_excluded: false,
    login_count: 0,
    page_view_count: 0,
    meaningful_action_count: 1,
    parent_action_count: 0,
    staff_action_count: 1,
    ...overrides,
  }
}

function reportFixture(overrides = {}) {
  const input = {
    now,
    filters: { preset: '30_days' },
    clubs: [{ id: clubId, name: 'Safe club', plan_key: 'small_club' }],
    users: [
      { id: staffId, role: 'coach', club_id: clubId, status: 'active' },
      { id: parentId, role: 'parent_portal', club_id: clubId, status: 'active' },
    ],
    lifetimes: [
      { user_id: staffId, first_login_at: '2026-06-01T09:00:00Z', first_meaningful_at: '2026-06-01T09:05:00Z' },
      { user_id: parentId, first_login_at: '2026-07-27T09:00:00Z', first_meaningful_at: '2026-07-27T09:05:00Z', first_parent_action_at: '2026-07-27T09:05:00Z' },
    ],
    dailyUsers: [
      dailyRow({ login_count: 2, page_view_count: 5, meaningful_action_count: 2 }),
      dailyRow({
        user_id: parentId,
        role: 'parent_portal',
        platform: 'parent_app',
        login_count: 1,
        page_view_count: 3,
        meaningful_action_count: 1,
        parent_action_count: 1,
        staff_action_count: 0,
      }),
      dailyRow({ activity_date: '2026-07-24', meaningful_action_count: 2 }),
      dailyRow({ activity_date: '2026-07-01', meaningful_action_count: 1 }),
      dailyRow({ activity_date: '2026-06-20', meaningful_action_count: 5 }),
    ],
    dailyPageUsers: [
      { activity_date: '2026-07-27', user_id: staffId, role: 'coach', club_id: clubId, platform: 'web', canonical_route: '/players', is_excluded: false, page_views: 6, session_count: 2 },
      { activity_date: '2026-07-27', user_id: parentId, role: 'parent_portal', club_id: clubId, platform: 'parent_app', canonical_route: '/players', is_excluded: false, page_views: 2, session_count: 1 },
      { activity_date: '2026-07-27', user_id: staffId, role: 'coach', club_id: clubId, platform: 'web', canonical_route: '/calendar', is_excluded: false, page_views: 4, session_count: 1 },
    ],
    hourlyPages: [
      { activity_date: '2026-07-27', day_of_week: 1, hour_bucket: 9, role: 'coach', club_id: clubId, platform: 'web', canonical_route: '/players', is_excluded: false, page_views: 6 },
      { activity_date: '2026-07-27', day_of_week: 1, hour_bucket: 10, role: 'parent_portal', club_id: clubId, platform: 'parent_app', canonical_route: '/players', is_excluded: false, page_views: 2 },
    ],
    hourlyPlatform: [
      { activity_date: '2026-07-27', day_of_week: 1, hour_bucket: 9, role: 'coach', club_id: clubId, platform: 'web', is_excluded: false, unique_active_users: 1, login_count: 2, page_views: 6, meaningful_actions: 2, parent_actions: 0, staff_actions: 2 },
    ],
    hourlyUsers: [
      { activity_date: '2026-07-27', day_of_week: 1, hour_bucket: 9, user_id: staffId, role: 'coach', club_id: clubId, platform: 'web', is_excluded: false, login_count: 2, page_views: 6, meaningful_actions: 2, parent_actions: 0, staff_actions: 2 },
    ],
    ...overrides,
  }
  return buildPlatformAnalyticsReport(input)
}

function authorityClient(role) {
  const profile = { id: staffId, role, role_rank: role === 'super_admin' ? 100 : 60, club_id: clubId, status: 'active' }
  const tables = {
    users: profile,
    platform_admins: role === 'super_admin' ? { id: staffId } : null,
    user_club_memberships: { auth_user_id: staffId },
    clubs: { id: clubId, status: 'active' },
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: staffId } }, error: null }) },
    from(table) {
      const query = {
        select() { return query },
        eq() { return query },
        maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
      }
      return query
    },
  }
  return client
}

test('successful login analytics sends no password or refresh token and fails safely', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return { ok: true, status: 202, json: async () => ({ success: true, accepted: true }) }
  }

  try {
    const result = await recordSuccessfulLoginAnalytics({
      session: { access_token: 'short-lived-access-token', refresh_token: 'must-not-send' },
      user: { id: staffId },
    })
    assert.equal(result.accepted, true)
    assert.equal(request.url, '/.netlify/functions/platform-analytics')
    assert.deepEqual(JSON.parse(request.options.body).metadata, {})
    assert.doesNotMatch(request.options.body, /password|refresh_token|must-not-send/i)
    assert.equal(JSON.parse(request.options.body).eventName, 'auth.login_succeeded')

    globalThis.fetch = async () => { throw new Error('offline') }
    const failed = await recordSuccessfulLoginAnalytics({ session: { access_token: 'token' } })
    assert.equal(failed.accepted, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('login count is separate from meaningful activity and active users are deduplicated', () => {
  const report = reportFixture()
  assert.equal(report.overview.selectedSuccessfulLogins.current, 3)
  assert.equal(report.overview.selectedActiveUsers.current, 2)
  assert.equal(report.overview.activeUsersToday, 2)
  assert.equal(report.overview.activeUsers7Days, 2)
  assert.equal(report.overview.activeUsers30Days, 2)
})

test('parent, staff, and active-club classifications use meaningful actions', () => {
  const report = reportFixture()
  assert.equal(report.overview.activeParents, 1)
  assert.equal(report.overview.activeStaff, 1)
  assert.equal(report.overview.activeClubs, 1)
  assert.equal(report.parentAdoption.activated, 1)
})

test('canonical routes group dynamic paths and remove query strings and fragments', () => {
  assert.equal(canonicalizeAnalyticsRoute('https://footballplayer.online/player/abc-123?tab=notes#latest'), '/player/:playerId')
  assert.equal(canonicalizeAnalyticsRoute('/platform-clubs?status=active'), '/platform-admin/clubs')
  assert.equal(getMeaningfulRouteEvent('/player/abc-123'), 'player.viewed')
})

test('static assets, functions, and API requests are excluded', () => {
  assert.equal(canonicalizeAnalyticsRoute('/assets/app.js'), '')
  assert.equal(canonicalizeAnalyticsRoute('/.netlify/functions/platform-analytics'), '')
  assert.equal(canonicalizeAnalyticsRoute('/api/private'), '')
})

test('top pages rank views while reporting views and unique users separately', () => {
  const report = reportFixture()
  assert.equal(report.topPages[0].route, '/players')
  assert.equal(report.topPages[0].pageViews, 8)
  assert.equal(report.topPages[0].uniqueUsers, 2)
  assert.equal(report.topPages[1].route, '/calendar')
})

test('page and overall heatmaps aggregate exact hour and day values', () => {
  const report = reportFixture()
  const players = report.pageHeatmap.rows.find((row) => row.route === '/players')
  assert.equal(players.byHour[9], 6)
  assert.equal(players.byHour[10], 2)
  assert.equal(players.byDay[1], 8)
  assert.equal(report.overallHeatmap.metrics.meaningfulActions[9][1], 2)
  assert.equal(report.overallHeatmap.metrics.activeUsers[9][1], 1)
})

test('overall heatmap deduplicates an active user across platforms in the same hour', () => {
  const report = reportFixture({
    hourlyUsers: [
      { activity_date: '2026-07-27', day_of_week: 1, hour_bucket: 9, user_id: staffId, role: 'coach', club_id: clubId, platform: 'web', is_excluded: false, meaningful_actions: 1 },
      { activity_date: '2026-07-27', day_of_week: 1, hour_bucket: 9, user_id: staffId, role: 'coach', club_id: clubId, platform: 'coach_app', is_excluded: false, meaningful_actions: 1 },
    ],
  })
  assert.equal(report.overallHeatmap.metrics.activeUsers[9][1], 1)
  assert.equal(report.overallHeatmap.metrics.meaningfulActions[9][1], 2)
})

test('test, demo, Platform Admin, and non-production profiles are identified', () => {
  assert.equal(isClearlyExcludedAnalyticsProfile({ role: 'super_admin' }, 'production'), true)
  assert.equal(isClearlyExcludedAnalyticsProfile({ role: 'coach', email: 'alex+test@club.test' }, 'production'), true)
  assert.equal(isClearlyExcludedAnalyticsProfile({ role: 'coach', name: 'Demo Coach' }, 'production'), true)
  assert.equal(isClearlyExcludedAnalyticsProfile({ role: 'coach' }, 'preview'), true)
  assert.equal(isClearlyExcludedAnalyticsProfile({ role: 'coach', email: 'coach@club.co.uk' }, 'production'), false)
})

test('platform, role, and custom date filters apply independently', () => {
  const parentReport = reportFixture({ filters: { preset: '30_days', role: 'parent_portal' } })
  assert.equal(parentReport.overview.selectedActiveUsers.current, 1)
  assert.equal(parentReport.overview.activeParents, 1)
  assert.equal(parentReport.overview.activeStaff, 0)

  const webReport = reportFixture({ filters: { preset: '30_days', platform: 'web' } })
  assert.equal(webReport.overview.selectedActiveUsers.current, 1)
  assert.equal(webReport.overview.activeParents, 0)

  const filters = normalizePlatformAnalyticsFilters({
    preset: 'custom',
    startDate: '2026-07-24',
    endDate: '2026-07-24',
  }, now)
  assert.equal(filters.startDate, '2026-07-24')
  assert.equal(filters.endDate, '2026-07-24')
})

test('maintenance recommendation reports sufficient and insufficient data honestly', () => {
  const filters = normalizePlatformAnalyticsFilters({ preset: '90_days' }, now)
  const clubPlans = new Map([[clubId, 'small_club']])
  assert.equal(recommendMaintenanceWindow([], filters, clubPlans).available, false)

  const rows = Array.from({ length: 35 }, (_, index) => {
    const date = new Date('2026-06-23T12:00:00Z')
    date.setUTCDate(date.getUTCDate() + index)
    return {
      activity_date: date.toISOString().slice(0, 10),
      day_of_week: date.getUTCDay(),
      hour_bucket: 12,
      role: 'coach',
      club_id: clubId,
      platform: 'web',
      is_excluded: false,
      unique_active_users: 1,
      meaningful_actions: 1,
    }
  })
  const recommendation = recommendMaintenanceWindow(rows, filters, clubPlans)
  assert.equal(recommendation.available, true)
  assert.ok(recommendation.weeksAnalyzed >= 4)
  assert.match(recommendation.message, /not a guarantee/i)
})

test('event input accepts allowlisted events, rejects aggregate-only events, and drops free text', () => {
  const normalized = normalizeAnalyticsEventInput({
    eventName: 'page.viewed',
    clientEventId: 'event:1',
    route: '/players?search=child-name',
    metadata: {
      childName: 'Private Child',
      feedbackText: 'Private feedback',
      message: 'Private message',
      notes: 'Private notes',
    },
  })
  assert.equal(normalized.canonicalRoute, '/players')
  assert.deepEqual(normalized.metadata, {})
  assert.throws(
    () => normalizeAnalyticsEventInput({ eventName: 'auth.login_failed', clientEventId: 'event:2' }),
    /not accepted/i,
  )
  assert.equal(mapAuditActionToAnalyticsEvent('ui_clicked'), '')
  assert.equal(mapAuditActionToAnalyticsEvent('staff_invite_failed'), '')
  assert.equal(mapAuditActionToAnalyticsEvent('data_transfer_request_denied'), '')
  assert.equal(mapAuditActionToAnalyticsEvent('list'), '')
  assert.equal(mapAuditActionToAnalyticsEvent('player_updated'), 'platform.action_completed')
})

test('Platform Admin authority is required and normal users are denied', async () => {
  const normalHandler = createPlatformAnalyticsHandler({ supabaseAdmin: authorityClient('coach'), now: () => now })
  const normalResponse = await normalHandler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer token' },
    queryStringParameters: {},
  })
  assert.equal(normalResponse.statusCode, 403)
  assert.equal(JSON.parse(normalResponse.body).code, 'forbidden')

  const adminClient = authorityClient('super_admin')
  adminClient.from = (table) => {
    if (table === 'users' || table === 'platform_admins') {
      const data = table === 'users'
        ? { id: staffId, role: 'super_admin', role_rank: 100, club_id: null, status: 'active' }
        : { id: staffId }
      const query = {
        select() { return query },
        eq() { return query },
        maybeSingle: async () => ({ data, error: null }),
        range: async () => ({ data: [], error: null }),
      }
      return query
    }
    const query = {
      select() { return query },
      gte() { return query },
      lte() { return query },
      range: async () => ({ data: [], error: null }),
    }
    return query
  }
  const adminHandler = createPlatformAnalyticsHandler({ supabaseAdmin: adminClient, now: () => now })
  const adminResponse = await adminHandler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer token' },
    queryStringParameters: {},
  })
  assert.equal(adminResponse.statusCode, 200)
})

test('privacy, accessible fallback, mobile layout, and existing controls remain present', async () => {
  const [migration, component, page, auth] = await Promise.all([
    readFile(new URL('../supabase/migrations/20260728050210_platform_analytics_foundation.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/platform/PlatformAnalyticsSection.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/PlatformAdminPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/auth.js', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(migration, /child_name|feedback_text|message_text|private_note|password|access_token|refresh_token/i)
  assert.match(migration, /metadata jsonb not null default '\{\}'::jsonb/)
  assert.match(migration, /check \(metadata = '\{\}'::jsonb\)/)
  assert.match(component, /<table/)
  assert.match(component, /title=\{`\$\{Number\(value/)
  assert.match(component, /sm:grid-cols-2 xl:grid-cols-4/)
  assert.match(component, /overflow-x-auto/)
  assert.match(page, /PlatformBannerManagementSection/)
  assert.match(page, /PlatformAdminStaffSection/)
  assert.match(page, /PlatformPlanMixSection/)
  assert.match(auth, /void recordSuccessfulLoginAnalytics\(data\)/)
})

test('UK date boundaries remain stable across daylight-saving dates', () => {
  const spring = normalizePlatformAnalyticsFilters({ preset: 'today' }, new Date('2026-03-29T00:30:00.000Z'))
  const autumn = normalizePlatformAnalyticsFilters({ preset: 'today' }, new Date('2026-10-25T01:30:00.000Z'))
  assert.equal(spring.today, '2026-03-29')
  assert.equal(autumn.today, '2026-10-25')
})
