import { platformAnalyticsMetricDefinitions } from './analytics/metric-definitions.js'

export const PLATFORM_ANALYTICS_PRESETS = Object.freeze({
  today: 1,
  '7_days': 7,
  '30_days': 30,
  '90_days': 90,
})

export const PLATFORM_ANALYTICS_METRICS = Object.freeze([
  'meaningfulActions',
  'activeUsers',
  'successfulLogins',
  'pageViews',
  'parentActivity',
  'staffActivity',
])

const UK_TIME_ZONE = 'Europe/London'
const DAY_NAMES = Object.freeze(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])

const ANALYTICS_ACTIVITY_TYPES = new Set(['all', 'authentication', 'navigation', 'meaningful_action'])
const ANALYTICS_ENVIRONMENTS = new Set(['all', 'production', 'preview', 'test', 'local'])

function safeFilterValue(value, fallback = 'all') {
  const normalized = String(value ?? fallback).trim()
  return /^[a-zA-Z0-9_:/.-]{1,120}$/.test(normalized) ? normalized : fallback
}

function safeUuidFilter(value) {
  const normalized = String(value ?? 'all').trim()
  return normalized === 'all' || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : 'all'
}

function numberValue(value) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function dateKey(value) {
  const text = String(value ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function toUtcDate(value) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

function addUtcDays(value, days) {
  const date = toUtcDate(`${value}T12:00:00.000Z`)

  if (!date) {
    return ''
  }

  date.setUTCDate(date.getUTCDate() + days)
  return isoDate(date)
}

function daysBetween(startDate, endDate) {
  const start = toUtcDate(`${startDate}T12:00:00.000Z`)
  const end = toUtcDate(`${endDate}T12:00:00.000Z`)

  if (!start || !end) {
    return 0
  }

  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
}

function ukToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: UK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${map.year}-${map.month}-${map.day}`
}

export function resolvePlatformAnalyticsRange(input = {}, now = new Date()) {
  const preset = input.preset === 'custom' || Object.hasOwn(PLATFORM_ANALYTICS_PRESETS, input.preset)
    ? input.preset
    : '30_days'
  const today = ukToday(now)
  let endDate = dateKey(input.endDate) || today
  let startDate = dateKey(input.startDate)

  if (preset !== 'custom') {
    startDate = addUtcDays(endDate, -(PLATFORM_ANALYTICS_PRESETS[preset] - 1))
  }

  if (!startDate || startDate > endDate) {
    startDate = addUtcDays(endDate, -29)
    endDate = today
  }

  if (daysBetween(startDate, endDate) > 90) {
    startDate = addUtcDays(endDate, -89)
  }

  return {
    preset,
    startDate,
    endDate,
    previousStartDate: addUtcDays(startDate, -daysBetween(startDate, endDate)),
    previousEndDate: addUtcDays(startDate, -1),
    today,
  }
}

export function normalizePlatformAnalyticsFilters(input = {}, now = new Date()) {
  const range = resolvePlatformAnalyticsRange(input, now)
  const legacyExcluded = input.includeExcluded === true || input.includeExcluded === 'true'
  const activityType = safeFilterValue(input.activityType)
  const environment = safeFilterValue(input.environment, 'production')
  return {
    ...range,
    role: safeFilterValue(input.role),
    platform: safeFilterValue(input.platform),
    clubId: safeUuidFilter(input.clubId),
    plan: safeFilterValue(input.plan),
    route: safeFilterValue(input.route),
    activityType: ANALYTICS_ACTIVITY_TYPES.has(activityType) ? activityType : 'all',
    environment: ANALYTICS_ENVIRONMENTS.has(environment) ? environment : 'production',
    pageFamily: safeFilterValue(input.pageFamily),
    includeInternal: legacyExcluded || input.includeInternal === true || input.includeInternal === 'true',
    includeFpTest: legacyExcluded || input.includeFpTest === true || input.includeFpTest === 'true',
    includeExcluded: legacyExcluded,
  }
}

function filterRow(row, filters, clubPlanById, { includeRoute = false } = {}) {
  const activityDate = dateKey(row.activity_date ?? row.activityDate)

  if (!activityDate || activityDate < filters.startDate || activityDate > filters.endDate) return false
  if (!filters.includeExcluded && Boolean(row.is_excluded ?? row.isExcluded)) return false
  if (filters.role !== 'all' && String(row.role ?? '') !== filters.role) return false
  if (filters.platform !== 'all' && String(row.platform ?? '') !== filters.platform) return false

  const clubId = String(row.club_id ?? row.clubId ?? '')
  if (filters.clubId !== 'all' && clubId !== filters.clubId) return false
  if (filters.plan !== 'all' && clubPlanById.get(clubId) !== filters.plan) return false

  if (includeRoute && filters.route !== 'all') {
    const canonicalRoute = String(row.canonical_route ?? row.canonicalRoute ?? '')
    if (canonicalRoute !== filters.route) return false
  }

  return true
}

function filterPeriodRow(row, startDate, endDate, filters, clubPlanById, options = {}) {
  return filterRow(row, { ...filters, startDate, endDate }, clubPlanById, options)
}

function uniqueCount(rows, keySelector) {
  return new Set(rows.map(keySelector).filter(Boolean)).size
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + numberValue(row[key] ?? row[toCamelCase(key)]), 0)
}

function toCamelCase(value) {
  return String(value).replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

function compareMetric(current, previous) {
  if (!previous) {
    return { current, previous, changePercent: null, comparisonAvailable: false }
  }

  return {
    current,
    previous,
    changePercent: Math.round(((current - previous) / previous) * 1000) / 10,
    comparisonAvailable: true,
  }
}

function activeRows(rows) {
  return rows.filter((row) => numberValue(row.meaningful_action_count ?? row.meaningfulActionCount) > 0)
}

function selectedDailyRows(rows, filters, clubPlanById) {
  return rows.filter((row) => filterRow(row, filters, clubPlanById))
}

function activityWithin(rows, filters, clubPlanById, startDate, endDate) {
  return rows.filter((row) => filterPeriodRow(row, startDate, endDate, filters, clubPlanById))
}

function buildTopPages(pageRows, filters, clubPlanById, previous = false) {
  const startDate = previous ? filters.previousStartDate : filters.startDate
  const endDate = previous ? filters.previousEndDate : filters.endDate
  const rows = pageRows.filter((row) =>
    filterPeriodRow(row, startDate, endDate, filters, clubPlanById, { includeRoute: true }),
  )
  const routeMap = new Map()

  for (const row of rows) {
    const route = String(row.canonical_route ?? row.canonicalRoute ?? '/other')
    const current = routeMap.get(route) || { route, pageViews: 0, userIds: new Set(), sessions: 0 }
    current.pageViews += numberValue(row.page_views ?? row.pageViews)
    const userId = String(row.user_id ?? row.userId ?? '')
    if (userId) current.userIds.add(userId)
    current.sessions += numberValue(row.session_count ?? row.sessionCount)
    routeMap.set(route, current)
  }

  return [...routeMap.values()].map((row) => ({
    route: row.route,
    pageViews: row.pageViews,
    uniqueUsers: row.userIds.size,
    sessions: row.sessions,
  }))
}

function withPageComparisons(currentPages, previousPages) {
  const totalViews = currentPages.reduce((total, page) => total + page.pageViews, 0)
  const previousByRoute = new Map(previousPages.map((page) => [page.route, page]))

  return currentPages
    .map((page) => ({
      ...page,
      percentage: totalViews ? Math.round((page.pageViews / totalViews) * 1000) / 10 : 0,
      comparison: compareMetric(page.pageViews, previousByRoute.get(page.route)?.pageViews ?? 0),
    }))
    .sort((left, right) => right.pageViews - left.pageViews || right.uniqueUsers - left.uniqueUsers || left.route.localeCompare(right.route))
}

function buildPageHeatmap(hourlyPageRows, dailyPageRows, topRoutes, filters, clubPlanById) {
  const routeSet = new Set(topRoutes.slice(0, 8).map((page) => page.route))
  const byHour = new Map()
  const byDay = new Map()

  for (const row of hourlyPageRows) {
    if (!filterRow(row, filters, clubPlanById, { includeRoute: true })) continue
    const route = String(row.canonical_route ?? row.canonicalRoute ?? '')
    if (!routeSet.has(route)) continue
    const hour = numberValue(row.hour_bucket ?? row.hourBucket)
    byHour.set(`${route}:${hour}`, (byHour.get(`${route}:${hour}`) ?? 0) + numberValue(row.page_views ?? row.pageViews))
  }

  for (const row of dailyPageRows) {
    if (!filterRow(row, filters, clubPlanById, { includeRoute: true })) continue
    const route = String(row.canonical_route ?? row.canonicalRoute ?? '')
    if (!routeSet.has(route)) continue
    const date = toUtcDate(`${row.activity_date ?? row.activityDate}T12:00:00.000Z`)
    if (!date) continue
    const day = (date.getUTCDay() + 6) % 7
    byDay.set(`${route}:${day}`, (byDay.get(`${route}:${day}`) ?? 0) + numberValue(row.page_views ?? row.pageViews))
  }

  return {
    hours: Array.from({ length: 24 }, (_, hour) => hour),
    days: DAY_NAMES,
    rows: [...routeSet].map((route) => ({
      route,
      byHour: Array.from({ length: 24 }, (_, hour) => byHour.get(`${route}:${hour}`) ?? 0),
      byDay: Array.from({ length: 7 }, (_, day) => byDay.get(`${route}:${day}`) ?? 0),
    })),
  }
}

function overallMetricValue(row, metric) {
  if (metric === 'activeUsers') return numberValue(row.unique_active_users ?? row.uniqueActiveUsers)
  if (metric === 'successfulLogins') return numberValue(row.login_count ?? row.loginCount)
  if (metric === 'pageViews') return numberValue(row.page_views ?? row.pageViews)
  if (metric === 'parentActivity') return numberValue(row.parent_actions ?? row.parentActions)
  if (metric === 'staffActivity') return numberValue(row.staff_actions ?? row.staffActions)
  return numberValue(row.meaningful_actions ?? row.meaningfulActions)
}

function buildOverallHeatmap(hourlyRows, filters, clubPlanById) {
  const filtered = hourlyRows.filter((row) => filterRow(row, filters, clubPlanById))
  const metricMaps = Object.fromEntries(PLATFORM_ANALYTICS_METRICS.map((metric) => [metric, new Map()]))
  const activeUserMaps = new Map()

  for (const row of filtered) {
    const day = (numberValue(row.day_of_week ?? row.dayOfWeek) + 6) % 7
    const hour = numberValue(row.hour_bucket ?? row.hourBucket)
    const key = `${day}:${hour}`

    for (const metric of PLATFORM_ANALYTICS_METRICS) {
      const map = metricMaps[metric]
      if (metric === 'activeUsers' && (row.user_id ?? row.userId)) {
        const users = activeUserMaps.get(key) || new Set()
        if (numberValue(row.meaningful_actions ?? row.meaningfulActions) > 0) {
          users.add(String(row.user_id ?? row.userId))
        }
        activeUserMaps.set(key, users)
        map.set(key, users.size)
      } else {
        map.set(key, (map.get(key) ?? 0) + overallMetricValue(row, metric))
      }
    }
  }

  return {
    days: DAY_NAMES,
    hours: Array.from({ length: 24 }, (_, hour) => hour),
    metrics: Object.fromEntries(
      PLATFORM_ANALYTICS_METRICS.map((metric) => [
        metric,
        Array.from({ length: 24 }, (_, hour) =>
          Array.from({ length: 7 }, (_, day) => metricMaps[metric].get(`${day}:${hour}`) ?? 0),
        ),
      ]),
    ),
  }
}

function mondayKey(dateValue) {
  const date = toUtcDate(`${dateValue}T12:00:00.000Z`)
  if (!date) return ''
  const day = date.getUTCDay()
  date.setUTCDate(date.getUTCDate() - ((day + 6) % 7))
  return isoDate(date)
}

export function recommendMaintenanceWindow(hourlyRows, filters, clubPlanById) {
  const filtered = hourlyRows.filter((row) => filterRow(row, filters, clubPlanById))
  const weeks = new Set(filtered.map((row) => mondayKey(row.activity_date ?? row.activityDate)).filter(Boolean))

  if (weeks.size < 4) {
    return {
      available: false,
      confidence: 'Insufficient data',
      weeksAnalyzed: weeks.size,
      message: 'At least four weeks of activity are needed before recommending a low-usage period.',
    }
  }

  const candidates = []

  for (let day = 0; day < 7; day += 1) {
    for (let hour = 0; hour < 23; hour += 1) {
      const matchingRows = filtered.filter((row) => {
        const rowDay = (numberValue(row.day_of_week ?? row.dayOfWeek) + 6) % 7
        const rowHour = numberValue(row.hour_bucket ?? row.hourBucket)
        return rowDay === day && (rowHour === hour || rowHour === hour + 1)
      })
      const dates = new Set(matchingRows.map((row) => row.activity_date ?? row.activityDate))
      const divisor = Math.max(1, dates.size)
      const hasUserRows = matchingRows.some((row) => row.user_id ?? row.userId)
      const activeUsers = hasUserRows
        ? new Set(
          matchingRows
            .filter((row) => numberValue(row.meaningful_actions ?? row.meaningfulActions) > 0)
            .map((row) => `${row.activity_date ?? row.activityDate}:${row.user_id ?? row.userId}`),
        ).size
        : sum(matchingRows, 'unique_active_users')
      const meaningfulActions = sum(matchingRows, 'meaningful_actions')
      const peakUsers = hasUserRows
        ? Math.max(0, ...[...dates].map((date) => new Set(
          matchingRows
            .filter((row) => (row.activity_date ?? row.activityDate) === date)
            .filter((row) => numberValue(row.meaningful_actions ?? row.meaningfulActions) > 0)
            .map((row) => String(row.user_id ?? row.userId)),
        ).size))
        : matchingRows.reduce(
          (maximum, row) => Math.max(maximum, numberValue(row.unique_active_users ?? row.uniqueActiveUsers)),
          0,
        )

      candidates.push({
        day,
        hour,
        averageActiveUsers: Math.round((activeUsers / divisor) * 10) / 10,
        averageMeaningfulActions: Math.round((meaningfulActions / divisor) * 10) / 10,
        peakUsers,
        score: activeUsers * 5 + meaningfulActions * 2 + peakUsers * 8,
      })
    }
  }

  candidates.sort((left, right) => left.score - right.score || left.peakUsers - right.peakUsers || left.day - right.day || left.hour - right.hour)
  const best = candidates[0]
  const confidence = weeks.size >= 8 && best.peakUsers <= 2 ? 'High' : 'Moderate'

  return {
    available: true,
    day: DAY_NAMES[best.day],
    startHour: best.hour,
    endHour: best.hour + 2,
    averageActiveUsers: best.averageActiveUsers,
    maximumActiveUsers: best.peakUsers,
    averageMeaningfulActions: best.averageMeaningfulActions,
    weeksAnalyzed: weeks.size,
    confidence,
    message: 'This is a conservative low-usage recommendation, not a guarantee of zero users.',
  }
}

function canonicalIdentityMetrics(identityAdoption = {}) {
  const parent = identityAdoption.parentAdoption || {}
  const staff = identityAdoption.staff || {}
  const activity = identityAdoption.activity || {}
  const activation = identityAdoption.clubActivation || {}
  const dormancy = identityAdoption.dormancy || {}

  return {
    available: numberValue(identityAdoption.definitionVersion) >= 2,
    parent,
    staff,
    activity,
    activation,
    dormancy,
    reconciliation: identityAdoption.reconciliation || {},
    captureStartDate: identityAdoption.captureStartDate || null,
  }
}

const FRIENDLY_PAGE_NAMES = Object.freeze({
  parent_overview: 'Parent Overview',
  parent_calendar: 'Parent Calendar',
  parent_chat: 'Parent Chat',
  parent_polls: 'Parent Polls',
  friends_family: 'Friends and Family',
  staff_calendar: 'Coach Calendar',
  player_profile: 'Player Profile',
  development: 'Development',
  game_day: 'Game Day',
  staff_access: 'Coach Access',
  platform_analytics: 'Platform Analytics',
  no_page: 'No page',
})

function friendlyPageName(pageFamily, canonicalRoute) {
  if (FRIENDLY_PAGE_NAMES[pageFamily]) return FRIENDLY_PAGE_NAMES[pageFamily]
  const route = String(canonicalRoute || pageFamily || '/other')
  return route
    .replace(/^\//, '')
    .replace(/\//g, ' ')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Other'
}

function buildCanonicalHeatmap(evidence = {}) {
  const cells = Array.isArray(evidence.cells) ? evidence.cells : []
  const cellMap = new Map(cells.map((cell) => [`${numberValue(cell.hour)}:${numberValue(cell.dayIndex)}`, cell]))
  const metrics = ['meaningfulActions', 'successfulLogins', 'pageViews']

  return {
    days: Array.isArray(evidence.days) && evidence.days.length === 7 ? evidence.days : DAY_NAMES,
    hours: Array.from({ length: 24 }, (_, hour) => hour),
    metrics: Object.fromEntries(metrics.map((metric) => [
      metric,
      Array.from({ length: 24 }, (_, hour) =>
        Array.from({ length: 7 }, (_, day) => numberValue(cellMap.get(`${hour}:${day}`)?.[metric])),
      ),
    ])),
    cells: Array.from({ length: 24 }, (_, hour) =>
      Array.from({ length: 7 }, (_, day) => {
        const cell = cellMap.get(`${hour}:${day}`) || {}
        return {
          dayIndex: day,
          day: (evidence.days || DAY_NAMES)[day] || DAY_NAMES[day],
          hour,
          pageViews: numberValue(cell.pageViews),
          meaningfulActions: numberValue(cell.meaningfulActions),
          successfulLogins: numberValue(cell.successfulLogins),
          distinctUsers: numberValue(cell.distinctUsers),
          distinctClubs: numberValue(cell.distinctClubs),
          internalEvents: numberValue(cell.internalEvents),
          fpTestEvents: numberValue(cell.fpTestEvents),
        }
      }),
    ),
    totals: {
      pageViews: numberValue(evidence.totals?.pageViews),
      meaningfulActions: numberValue(evidence.totals?.meaningfulActions),
      successfulLogins: numberValue(evidence.totals?.successfulLogins),
    },
    timezone: 'Europe/London',
    dayOrder: 'Monday to Sunday',
  }
}

function canonicalDashboardSections(dashboardEvidence = {}, identity = {}) {
  if (numberValue(dashboardEvidence.definitionVersion) < 4) return null
  const product = dashboardEvidence.productActivity || {}
  const authentication = dashboardEvidence.authentication || {}
  const rawPages = Array.isArray(dashboardEvidence.topPages) ? dashboardEvidence.topPages : []
  const pageViewsTotal = rawPages.reduce((total, page) => total + numberValue(page.pageViews), 0)
  const topPages = rawPages.map((page) => ({
    route: page.canonicalRoute || '/other',
    pageFamily: page.pageFamily || 'other',
    label: friendlyPageName(page.pageFamily, page.canonicalRoute),
    pageViews: numberValue(page.pageViews),
    uniqueUsers: numberValue(page.distinctUsers),
    sessions: numberValue(page.sessions),
    percentage: pageViewsTotal ? Math.round((numberValue(page.pageViews) / pageViewsTotal) * 1000) / 10 : 0,
    comparison: { comparisonAvailable: false, current: numberValue(page.pageViews), previous: 0, changePercent: null },
  }))

  return {
    generatedAt: dashboardEvidence.generatedAt || null,
    accountEstate: dashboardEvidence.accountEstate || {},
    authentication,
    productActivity: {
      ...product,
      activeParents: product.activeParents === undefined ? numberValue(identity.activity?.activeParents) : numberValue(product.activeParents),
      activeStaff: product.activeStaff === undefined ? numberValue(identity.activity?.activeStaff) : numberValue(product.activeStaff),
      activeClubs: product.activeClubs === undefined ? numberValue(identity.activity?.activeClubs) : numberValue(product.activeClubs),
      pageDrilldown: topPages.map((page) => ({ id: page.pageFamily, eventCount: page.pageViews })),
    },
    topPages,
    roleActivity: Array.isArray(dashboardEvidence.roleActivity) ? dashboardEvidence.roleActivity : [],
    overallHeatmap: buildCanonicalHeatmap(dashboardEvidence.heatmap),
    dataQuality: dashboardEvidence.quality || {},
    processor: dashboardEvidence.processor || {},
    reconciliation: dashboardEvidence.reconciliation || {},
    trend: Array.isArray(dashboardEvidence.trend) ? dashboardEvidence.trend : [],
    staffRoleAdoption: Array.isArray(dashboardEvidence.staffRoleAdoption) ? dashboardEvidence.staffRoleAdoption : [],
    workspaceActivity: dashboardEvidence.workspaceActivity || {},
  }
}

export function buildPlatformAnalyticsReport({
  dailyUsers = [],
  dailyPageUsers = [],
  hourlyPages = [],
  hourlyPlatform = [],
  hourlyUsers = [],
  lifetimes = [],
  clubs = [],
  identityAdoption = {},
  dashboardEvidence = {},
  filters: filterInput = {},
  now = new Date(),
} = {}) {
  const filters = normalizePlatformAnalyticsFilters(filterInput, now)
  const identity = canonicalIdentityMetrics(identityAdoption)
  const canonicalDashboard = canonicalDashboardSections(dashboardEvidence, identity)
  const clubPlanById = new Map(clubs.map((club) => [String(club.id ?? ''), String(club.plan_key ?? club.planKey ?? '')]))
  const selectedRows = selectedDailyRows(dailyUsers, filters, clubPlanById)
  const previousRows = activityWithin(dailyUsers, filters, clubPlanById, filters.previousStartDate, filters.previousEndDate)
  const selectedActiveRows = activeRows(selectedRows)
  const previousActiveRows = activeRows(previousRows)
  const todayRows = activityWithin(dailyUsers, filters, clubPlanById, filters.today, filters.today)
  const sevenDayRows = activityWithin(dailyUsers, filters, clubPlanById, addUtcDays(filters.today, -6), filters.today)
  const thirtyDayRows = activityWithin(dailyUsers, filters, clubPlanById, addUtcDays(filters.today, -29), filters.today)
  const lifetimesByUser = new Map(lifetimes.map((row) => [String(row.user_id ?? row.userId ?? ''), row]))
  const selectedActiveUserIds = new Set(selectedActiveRows.map((row) => String(row.user_id ?? row.userId ?? '')).filter(Boolean))
  const newUsers = [...selectedActiveUserIds].filter((userId) => {
    const lifetime = lifetimesByUser.get(userId)
    const firstActivity = String(lifetime?.first_meaningful_at ?? lifetime?.firstMeaningfulAt ?? lifetime?.first_login_at ?? lifetime?.firstLoginAt ?? '')
    return firstActivity && firstActivity.slice(0, 10) >= filters.startDate && firstActivity.slice(0, 10) <= filters.endDate
  }).length
  const returningUsers = Math.max(0, selectedActiveUserIds.size - newUsers)
  const currentPages = buildTopPages(dailyPageUsers, filters, clubPlanById)
  const previousPages = buildTopPages(dailyPageUsers, filters, clubPlanById, true)
  const topPages = withPageComparisons(currentPages, previousPages)
  const pageViews = topPages.reduce((total, page) => total + page.pageViews, 0)
  const previousPageViews = previousPages.reduce((total, page) => total + page.pageViews, 0)
  return {
    generatedAt: canonicalDashboard?.generatedAt || now.toISOString(),
    timezone: UK_TIME_ZONE,
    filters,
    exclusionsActive: !filters.includeExcluded,
    definitions: {
      activeUser: 'A distinct authenticated user with at least one approved meaningful action.',
      successfulLogin: 'A completed authentication event, reported separately from meaningful activity.',
      activatedParent: 'A registered parent with a successful login and at least one meaningful parent action.',
      activeClub: 'A club with at least one non-Platform-Admin meaningful action in the selected period.',
      engagedClub: 'A club with at least two active users across at least two separate days.',
      registry: platformAnalyticsMetricDefinitions(),
    },
    accountEstate: canonicalDashboard?.accountEstate || {},
    authentication: canonicalDashboard?.authentication || {},
    productActivity: canonicalDashboard?.productActivity || {},
    overview: {
      activeUsersToday: canonicalDashboard ? numberValue(canonicalDashboard.productActivity.activeUsersToday) : uniqueCount(activeRows(todayRows), (row) => String(row.user_id ?? row.userId ?? '')),
      activeUsers7Days: canonicalDashboard ? numberValue(canonicalDashboard.productActivity.activeUsers7Days) : uniqueCount(activeRows(sevenDayRows), (row) => String(row.user_id ?? row.userId ?? '')),
      activeUsers30Days: canonicalDashboard ? numberValue(canonicalDashboard.productActivity.activeUsers30Days) : uniqueCount(activeRows(thirtyDayRows), (row) => String(row.user_id ?? row.userId ?? '')),
      selectedActiveUsers: compareMetric(
        canonicalDashboard ? numberValue(canonicalDashboard.productActivity.selectedActiveUsers) : selectedActiveUserIds.size,
        uniqueCount(previousActiveRows, (row) => String(row.user_id ?? row.userId ?? '')),
      ),
      successfulLoginsToday: canonicalDashboard ? numberValue(canonicalDashboard.authentication.successfulLoginsToday) : sum(todayRows, 'login_count'),
      selectedSuccessfulLogins: compareMetric(canonicalDashboard ? numberValue(canonicalDashboard.authentication.successfulLoginsSelected) : sum(selectedRows, 'login_count'), sum(previousRows, 'login_count')),
      distinctUsersLoggingIn: canonicalDashboard ? numberValue(canonicalDashboard.authentication.distinctUsersLoggingIn) : 0,
      failedLogins: canonicalDashboard?.authentication.failedLoginsAvailable ? numberValue(canonicalDashboard.authentication.failedLogins) : null,
      newUsers: canonicalDashboard ? numberValue(canonicalDashboard.productActivity.newActiveUsers) : newUsers,
      returningUsers: canonicalDashboard ? numberValue(canonicalDashboard.productActivity.returningActiveUsers) : returningUsers,
      activeParents: canonicalDashboard ? numberValue(canonicalDashboard.productActivity.activeParents) : (identity.available ? numberValue(identity.activity.activeParents) : 0),
      activeStaff: canonicalDashboard ? numberValue(canonicalDashboard.productActivity.activeStaff) : (identity.available ? numberValue(identity.activity.activeStaff) : 0),
      activeClubs: canonicalDashboard ? numberValue(canonicalDashboard.productActivity.activeClubs) : (identity.available ? numberValue(identity.activity.activeClubs) : 0),
      pageViews: compareMetric(canonicalDashboard ? numberValue(canonicalDashboard.productActivity.pageViews) : pageViews, previousPageViews),
      meaningfulActions: canonicalDashboard ? numberValue(canonicalDashboard.productActivity.meaningfulActions) : sum(selectedRows, 'meaningful_action_count'),
    },
    roleActivity: canonicalDashboard?.roleActivity || Object.values(
      selectedActiveRows.reduce((map, row) => {
        const role = String(row.role ?? 'unknown')
        const current = map[role] || { role, userIds: new Set(), meaningfulActions: 0 }
        current.userIds.add(String(row.user_id ?? row.userId ?? ''))
        current.meaningfulActions += numberValue(row.meaningful_action_count ?? row.meaningfulActionCount)
        map[role] = current
        return map
      }, {}),
    )
      .map((row) => ({ role: row.role, activeUsers: row.userIds.size, meaningfulActions: row.meaningfulActions }))
      .sort((left, right) => right.activeUsers - left.activeUsers || left.role.localeCompare(right.role)),
    topPages: canonicalDashboard?.topPages || topPages,
    pageHeatmap: buildPageHeatmap(hourlyPages, dailyPageUsers, topPages, filters, clubPlanById),
    overallHeatmap: canonicalDashboard?.overallHeatmap || buildOverallHeatmap(hourlyUsers.length ? hourlyUsers : hourlyPlatform, filters, clubPlanById),
    dataQuality: canonicalDashboard?.dataQuality || {},
    processor: canonicalDashboard?.processor || {},
    reconciliation: canonicalDashboard?.reconciliation || {},
    maintenanceWindow: filters.includeInternal || filters.includeFpTest || filters.environment !== 'production' || filters.activityType !== 'all' || filters.pageFamily !== 'all'
      ? {
        available: false,
        confidence: 'Filtered view',
        weeksAnalyzed: 0,
        message: 'Quiet-window guidance is shown only for the default production customer-activity scope.',
      }
      : recommendMaintenanceWindow(hourlyUsers.length ? hourlyUsers : hourlyPlatform, {
        ...filters,
        startDate: addUtcDays(filters.today, -89),
        endDate: filters.today,
      }, clubPlanById),
    parentAdoption: {
      ...identity.parent,
      stages: (identity.parent.stages || []).map((stage) => stage.key === 'active' && canonicalDashboard
        ? { ...stage, count: numberValue(canonicalDashboard.productActivity.activeParents) }
        : stage),
      registered: numberValue(identity.parent.authenticatedParentAccounts),
      activated: numberValue(identity.parent.parentsWithFirstMeaningfulAction),
      active: canonicalDashboard ? numberValue(canonicalDashboard.productActivity.activeParents) : numberValue(identity.parent.activeParents),
      dormant: numberValue(identity.parent.dormantActivatedParents),
      available: identity.available,
    },
    staffAccounts: {
      ...identity.staff,
      activeStaffAccounts: canonicalDashboard ? numberValue(canonicalDashboard.productActivity.activeStaff) : numberValue(identity.staff.activeStaffAccounts),
      available: identity.available,
    },
    clubActivity: {
      active: canonicalDashboard ? numberValue(canonicalDashboard.productActivity.activeClubs) : numberValue(identity.activity.activeClubs),
      engaged: null,
      oneAdministrator: null,
      neverActivated: numberValue(identity.activation.noStaffLoginObserved),
      insufficientActivationHistory: numberValue(identity.activation.insufficientStaffLoginHistory),
      dormancy: {
        '14Days': numberValue(identity.dormancy.dormant14Days),
        '30Days': numberValue(identity.dormancy.dormant30Days),
        '60Days': numberValue(identity.dormancy.dormant60Days),
        '90Days': numberValue(identity.dormancy.dormant90Days),
        noQualifyingActivity: numberValue(identity.dormancy.noQualifyingActivity),
        insufficientHistory: numberValue(identity.dormancy.insufficientHistory),
      },
      activationStages: identity.activation.stages || [],
      available: identity.available,
    },
    identityReconciliation: identity.reconciliation,
    identityCaptureStartDate: identity.captureStartDate,
    trend: canonicalDashboard?.trend || [],
    staffRoleAdoption: canonicalDashboard?.staffRoleAdoption || [],
    workspaceActivity: canonicalDashboard?.workspaceActivity || {},
    options: {
      roles: [...new Set(dailyUsers.map((row) => String(row.role ?? '')).filter(Boolean))].sort(),
      platforms: [...new Set(dailyUsers.map((row) => String(row.platform ?? '')).filter(Boolean))].sort(),
      clubs: clubs
        .map((club) => ({ id: String(club.id ?? ''), name: String(club.name ?? 'Unnamed club'), plan: String(club.plan_key ?? club.planKey ?? '') }))
        .filter((club) => club.id)
        .sort((left, right) => left.name.localeCompare(right.name)),
      plans: [...new Set(clubs.map((club) => String(club.plan_key ?? club.planKey ?? '')).filter(Boolean))].sort(),
      routes: topPages.map((page) => page.route),
      activityTypes: ['authentication', 'navigation', 'meaningful_action'],
      environments: ['production', 'preview', 'test', 'local'],
      pageFamilies: canonicalDashboard?.topPages.map((page) => ({ value: page.pageFamily, label: page.label })) || [],
    },
    dataState: dailyUsers.length
      ? (selectedRows.length || topPages.length ? 'available' : 'empty')
      : 'insufficient',
  }
}
