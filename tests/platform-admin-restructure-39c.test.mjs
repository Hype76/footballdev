import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { getPlatformDashboardStats } from '../src/lib/platform-admin-stats.js'

const readSource = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('Platform Admin overview cards are useful, separate parents, and link to focused routes', () => {
  const cards = getPlatformDashboardStats({
    accountEstate: {
      customerClubs: 7,
      customerWorkspaces: 11,
      workspaceScopeBreakdown: { club: 7, team: 4, individual: 0 },
      teams: 28,
      activePlayers: 89,
      staffAccounts: 37,
      staffAssignments: 33,
      usersWithParentAccess: 5,
      staffWithParentAccess: 4,
      developmentRecords: 85,
    },
    productActivity: { activeUsers7Days: 8 },
  }, { openIssueCount: 2 })

  assert.deepEqual(cards.map((card) => card.label), [
    'Customer clubs',
    'Teams',
    'Active players',
    'Staff accounts',
    'Users with Parent access',
    'Development records',
    'Active this week',
    'Open platform issues',
  ])
  assert.equal(cards.find((card) => card.label === 'Customer clubs')?.value, 7)
  assert.equal(cards.find((card) => card.label === 'Staff accounts')?.value, 37)
  assert.equal(cards.find((card) => card.label === 'Users with Parent access')?.value, 5)
  assert.equal(cards.find((card) => card.label === 'Active this week')?.value, 8)
  assert.equal(cards.find((card) => card.label === 'Open platform issues')?.value, 2)
  assert.ok(cards.every((card) => card.path && card.actionLabel))
  assert.ok(!cards.some((card) => ['Adult users', 'Shared exports', 'Audit events', 'Platform admins'].includes(card.label)))
})

test('focused routes sit behind the existing Platform Admin route guard', async () => {
  const [routerSource, sidebarSource] = await Promise.all([
    readSource('src/app/router.jsx'),
    readSource('src/components/layout/Sidebar.jsx'),
  ])
  const guardedStart = routerSource.indexOf('element: <RequirePlatformAdminAccess />')
  const guardedEnd = routerSource.indexOf('element: <RequirePlatformFeedbackAccess />', guardedStart)
  const guardedRoutes = routerSource.slice(guardedStart, guardedEnd)

  for (const path of [
    'platform-analytics',
    'platform-banners',
    'platform-staff',
    'platform-data-hygiene',
    'platform-billing-options',
  ]) {
    assert.match(guardedRoutes, new RegExp(`path: '${path}'`))
    assert.match(sidebarSource, new RegExp(`path: '/${path}'`))
  }
  assert.match(sidebarSource, /path: '\/platform-feedback'/)
})

test('overview no longer stacks full management systems and feedback remains authoritative elsewhere', async () => {
  const pageSource = await readSource('src/pages/PlatformAdminPage.jsx')
  const dashboardStart = pageSource.indexOf('{showDashboard ? (')
  const dashboardEnd = pageSource.indexOf('{showAnalytics ? (', dashboardStart)
  const dashboardMarkup = pageSource.slice(dashboardStart, dashboardEnd)

  assert.match(dashboardMarkup, /<PlatformStatGrid items=\{dashboardStats\}/)
  assert.match(dashboardMarkup, /<PlatformPlanMixSection/)
  assert.match(dashboardMarkup, /<PlatformOperationalSummarySection/)
  assert.doesNotMatch(dashboardMarkup, /<PlatformAnalyticsSection/)
  assert.doesNotMatch(dashboardMarkup, /<PlatformBannerManagementSection/)
  assert.doesNotMatch(dashboardMarkup, /<PlatformAdminStaffSection/)
  assert.doesNotMatch(dashboardMarkup, /<PlatformFeedbackSection/)
  assert.match(pageSource, /const showLegacyFeedback = section === 'feedback-legacy'/)
})

test('overview uses the canonical analytics report while operational management keeps its existing model', async () => {
  const [pageSource, serviceSource] = await Promise.all([
    readSource('src/pages/PlatformAdminPage.jsx'),
    readSource('netlify/functions/lib/_platform-analytics.js'),
  ])

  assert.match(pageSource, /getPlatformDashboardStats\(analyticsReport/)
  assert.doesNotMatch(pageSource, /getPlatformDashboardStats\(stats/)
  assert.match(serviceSource, /get_platform_analytics_canonical_v4/)
  assert.doesNotMatch(serviceSource, /supabaseAdmin\.rpc\('get_platform_analytics_dashboard_14c'/)
  assert.doesNotMatch(serviceSource, /supabaseAdmin\.rpc\('get_platform_analytics_identity_adoption'/)
})

test('theme and collapse state use shared tokens and current-session storage', async () => {
  const [heroSource, sectionSource, cssSource, billingSource] = await Promise.all([
    readSource('src/components/platform/PlatformHeroSection.jsx'),
    readSource('src/components/ui/SectionCard.jsx'),
    readSource('src/index.css'),
    readSource('src/pages/PlatformBillingOptionsPage.jsx'),
  ])

  assert.match(heroSource, /<Link/)
  assert.match(heroSource, /focus-visible:ring-\[var\(--focus-ring\)\]/)
  assert.match(sectionSource, /window\.sessionStorage\.getItem/)
  assert.match(sectionSource, /window\.sessionStorage\.setItem/)
  assert.doesNotMatch(sectionSource, /window\.localStorage/)
  assert.match(cssSource, /\.platform-admin-theme/)
  assert.match(cssSource, /var\(--panel-bg\)/)
  assert.match(cssSource, /var\(--text-primary\)/)
  assert.match(billingSource, /title="Stripe coupon data unavailable"/)
  assert.match(billingSource, /hasStripeDataError=\{Boolean\(couponErrorMessage\)\}/)
})

test('Data Hygiene exposes reporting only and adds no destructive cleanup control', async () => {
  const [pageSource, cardsSource] = await Promise.all([
    readSource('src/pages/PlatformAdminPage.jsx'),
    readSource('src/components/platform/PlatformDashboardCards.jsx'),
  ])
  const hygieneStart = pageSource.indexOf('{showDataHygiene ? (')
  const hygieneEnd = pageSource.indexOf('{showClubManagement ? (', hygieneStart)
  const hygieneMarkup = pageSource.slice(hygieneStart, hygieneEnd)

  assert.match(hygieneMarkup, /<PlatformDataHygieneSection/)
  assert.doesNotMatch(hygieneMarkup, /onDelete|onCleanup|onPurge/)
  assert.doesNotMatch(cardsSource, /Delete archived|Purge|Clean up now/)
})
