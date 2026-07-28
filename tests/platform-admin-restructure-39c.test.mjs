import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { getPlatformDashboardStats } from '../src/lib/platform-admin-stats.js'

const readSource = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('Platform Admin overview cards are useful, separate parents, and link to focused routes', () => {
  const cards = getPlatformDashboardStats({
    totals: {
      clubs: 3,
      teams: 7,
      players: 82,
      archivedPlayers: 4,
      staffAccounts: 11,
      parentAccounts: 29,
      clubUsers: 9,
      evaluations: 48,
      recentEvaluations: 5,
      recentAdminActions: 6,
      auditEvents: 1000,
      communications: 22,
    },
    clubs: [{ planKey: 'small_club' }, { planKey: 'small_club' }, { planKey: 'professional' }],
  }, { openIssueCount: 2 })

  assert.deepEqual(cards.map((card) => card.label), [
    'Clubs',
    'Teams',
    'Active players',
    'Staff accounts',
    'Parent accounts',
    'Development records',
    'Recent admin activity',
    'Open platform issues',
  ])
  assert.equal(cards.find((card) => card.label === 'Staff accounts')?.value, 11)
  assert.equal(cards.find((card) => card.label === 'Parent accounts')?.value, 29)
  assert.equal(cards.find((card) => card.label === 'Recent admin activity')?.value, 6)
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

test('staff and parent totals are derived separately with a role breakdown', async () => {
  const [actionsSource, normalizerSource] = await Promise.all([
    readSource('src/lib/domain/platform-admin-actions.js'),
    readSource('src/lib/domain/platform-normalizers.js'),
  ])

  assert.match(actionsSource, /const parentAccounts = users\.filter/)
  assert.match(actionsSource, /const staffAccounts = users\.filter/)
  assert.match(actionsSource, /staffRoleBreakdown/)
  assert.match(actionsSource, /recentAdminActions: auditLogs\.filter\(isRecent\)\.length/)
  assert.match(normalizerSource, /parentAccounts: normalizeNumber/)
  assert.match(normalizerSource, /staffAccounts: normalizeNumber/)
  assert.match(normalizerSource, /staffRoleBreakdown: normalizeArray/)
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
  assert.match(billingSource, /hasStripeDataError=\{Boolean\(errorMessage\)\}/)
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
