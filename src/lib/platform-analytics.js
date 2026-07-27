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
const DAY_NAMES = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])

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
  return {
    ...range,
    role: String(input.role ?? 'all').trim() || 'all',
    platform: String(input.platform ?? 'all').trim() || 'all',
    clubId: String(input.clubId ?? 'all').trim() || 'all',
    plan: String(input.plan ?? 'all').trim() || 'all',
    route: String(input.route ?? 'all').trim() || 'all',
    includeExcluded: input.includeExcluded === true || input.includeExcluded === 'true',
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

function isParentRole(role) {
  return String(role ?? '').toLowerCase() === 'parent_portal'
}

function isPlatformRole(role) {
  return String(role ?? '').toLowerCase() === 'super_admin'
}

function isStaffRole(role) {
  return Boolean(role) && !isParentRole(role) && !isPlatformRole(role)
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
    const day = date.getUTCDay()
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
    const day = numberValue(row.day_of_week ?? row.dayOfWeek)
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
        const rowDay = numberValue(row.day_of_week ?? row.dayOfWeek)
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

function cleanUserRows(users) {
  return users.filter((user) => String(user.status ?? 'active') === 'active')
}

function buildParentAdoption(users, lifetimes, selectedRows, filters) {
  const parentUsers = cleanUserRows(users).filter((user) => isParentRole(user.role) && (filters.includeExcluded || !user.isExcluded))
  const parentIds = new Set(parentUsers.map((user) => String(user.id ?? '')).filter(Boolean))
  const lifetimeById = new Map(lifetimes.map((row) => [String(row.user_id ?? row.userId ?? ''), row]))
  const loggedIn = [...parentIds].filter((id) => lifetimeById.get(id)?.first_login_at ?? lifetimeById.get(id)?.firstLoginAt).length
  const activated = [...parentIds].filter((id) => {
    const lifetime = lifetimeById.get(id)
    return Boolean(
      (lifetime?.first_login_at ?? lifetime?.firstLoginAt)
      && (lifetime?.first_parent_action_at ?? lifetime?.firstParentActionAt),
    )
  }).length
  const active = uniqueCount(
    activeRows(selectedRows).filter((row) => isParentRole(row.role) && parentIds.has(String(row.user_id ?? row.userId ?? ''))),
    (row) => String(row.user_id ?? row.userId ?? ''),
  )

  return {
    stages: [
      { key: 'registered', label: 'Registered parent accounts', count: parentIds.size, available: true },
      { key: 'invited', label: 'Invitations sent', count: null, available: false },
      { key: 'first_login', label: 'First successful login recorded', count: loggedIn, available: true },
      { key: 'activated', label: 'First meaningful parent action recorded', count: activated, available: true },
      { key: 'active', label: 'Active in the selected period', count: active, available: true },
    ],
    registered: parentIds.size,
    activated,
    active,
    dormant: Math.max(0, activated - active),
  }
}

function buildClubActivity(clubs, users, dailyRows, filters) {
  const clubPlanById = new Map(clubs.map((club) => [String(club.id ?? ''), String(club.plan_key ?? club.planKey ?? '')]))
  const eligibleRows = dailyRows.filter((row) => (
    !isPlatformRole(row.role)
    && filterRow(row, { ...filters, startDate: '1900-01-01', endDate: '9999-12-31' }, clubPlanById)
  ))
  const activeDailyRows = activeRows(eligibleRows.filter((row) => filterRow(row, filters, clubPlanById)))
  const byClub = new Map()
  const historyByClub = new Map()

  for (const row of activeRows(eligibleRows)) {
    const clubId = String(row.club_id ?? row.clubId ?? '')
    if (!clubId) continue
    const activityDate = String(row.activity_date ?? row.activityDate ?? '')
    if (activityDate > (historyByClub.get(clubId) ?? '')) historyByClub.set(clubId, activityDate)
  }

  for (const row of activeDailyRows) {
    const clubId = String(row.club_id ?? row.clubId ?? '')
    if (!clubId) continue
    const current = byClub.get(clubId) || { users: new Set(), days: new Set() }
    current.users.add(String(row.user_id ?? row.userId ?? ''))
    current.days.add(String(row.activity_date ?? row.activityDate ?? ''))
    byClub.set(clubId, current)
  }

  const selectedClubs = clubs.filter((club) => {
    if (filters.clubId !== 'all' && String(club.id) !== filters.clubId) return false
    if (filters.plan !== 'all' && String(club.plan_key ?? club.planKey ?? '') !== filters.plan) return false
    return true
  })
  const adminCounts = new Map()

  for (const user of cleanUserRows(users)) {
    if (!filters.includeExcluded && user.isExcluded) continue
    if (isParentRole(user.role) || isPlatformRole(user.role) || numberValue(user.role_rank ?? user.roleRank) < 70) continue
    const clubId = String(user.club_id ?? user.clubId ?? '')
    if (clubId) adminCounts.set(clubId, (adminCounts.get(clubId) ?? 0) + 1)
  }

  const dormantThresholds = [14, 30, 60, 90]
  const dormancy = Object.fromEntries(dormantThresholds.map((days) => [
    `${days}Days`,
    selectedClubs.filter((club) => {
      const latest = historyByClub.get(String(club.id))
      return !latest || latest < addUtcDays(filters.today, -days)
    }).length,
  ]))

  return {
    active: selectedClubs.filter((club) => byClub.has(String(club.id))).length,
    engaged: selectedClubs.filter((club) => {
      const activity = byClub.get(String(club.id))
      return activity && activity.users.size >= 2 && activity.days.size >= 2
    }).length,
    oneAdministrator: selectedClubs.filter((club) => adminCounts.get(String(club.id)) === 1).length,
    neverActivated: selectedClubs.filter((club) => !byClub.has(String(club.id))).length,
    dormancy,
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
  users = [],
  filters: filterInput = {},
  now = new Date(),
} = {}) {
  const filters = normalizePlatformAnalyticsFilters(filterInput, now)
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
  const selectedActiveStaff = selectedActiveRows.filter((row) => isStaffRole(row.role))
  const selectedActiveParents = selectedActiveRows.filter((row) => isParentRole(row.role))
  const selectedActiveClubs = new Set(
    selectedActiveRows
      .filter((row) => !isPlatformRole(row.role))
      .map((row) => String(row.club_id ?? row.clubId ?? ''))
      .filter(Boolean),
  )

  return {
    generatedAt: now.toISOString(),
    timezone: UK_TIME_ZONE,
    filters,
    exclusionsActive: !filters.includeExcluded,
    definitions: {
      activeUser: 'A distinct authenticated user with at least one approved meaningful action.',
      successfulLogin: 'A completed authentication event, reported separately from meaningful activity.',
      activatedParent: 'A registered parent with a successful login and at least one meaningful parent action.',
      activeClub: 'A club with at least one non-Platform-Admin meaningful action in the selected period.',
      engagedClub: 'A club with at least two active users across at least two separate days.',
    },
    overview: {
      activeUsersToday: uniqueCount(activeRows(todayRows), (row) => String(row.user_id ?? row.userId ?? '')),
      activeUsers7Days: uniqueCount(activeRows(sevenDayRows), (row) => String(row.user_id ?? row.userId ?? '')),
      activeUsers30Days: uniqueCount(activeRows(thirtyDayRows), (row) => String(row.user_id ?? row.userId ?? '')),
      selectedActiveUsers: compareMetric(
        selectedActiveUserIds.size,
        uniqueCount(previousActiveRows, (row) => String(row.user_id ?? row.userId ?? '')),
      ),
      successfulLoginsToday: sum(todayRows, 'login_count'),
      selectedSuccessfulLogins: compareMetric(sum(selectedRows, 'login_count'), sum(previousRows, 'login_count')),
      newUsers,
      returningUsers,
      activeParents: uniqueCount(selectedActiveParents, (row) => String(row.user_id ?? row.userId ?? '')),
      activeStaff: uniqueCount(selectedActiveStaff, (row) => String(row.user_id ?? row.userId ?? '')),
      activeClubs: selectedActiveClubs.size,
      pageViews: compareMetric(pageViews, previousPageViews),
    },
    roleActivity: Object.values(
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
    topPages,
    pageHeatmap: buildPageHeatmap(hourlyPages, dailyPageUsers, topPages, filters, clubPlanById),
    overallHeatmap: buildOverallHeatmap(hourlyUsers.length ? hourlyUsers : hourlyPlatform, filters, clubPlanById),
    maintenanceWindow: recommendMaintenanceWindow(hourlyUsers.length ? hourlyUsers : hourlyPlatform, {
      ...filters,
      startDate: addUtcDays(filters.today, -89),
      endDate: filters.today,
    }, clubPlanById),
    parentAdoption: buildParentAdoption(users, lifetimes, selectedRows, filters),
    clubActivity: buildClubActivity(clubs, users, dailyUsers, filters),
    options: {
      roles: [...new Set(dailyUsers.map((row) => String(row.role ?? '')).filter(Boolean))].sort(),
      platforms: [...new Set(dailyUsers.map((row) => String(row.platform ?? '')).filter(Boolean))].sort(),
      clubs: clubs
        .map((club) => ({ id: String(club.id ?? ''), name: String(club.name ?? 'Unnamed club'), plan: String(club.plan_key ?? club.planKey ?? '') }))
        .filter((club) => club.id)
        .sort((left, right) => left.name.localeCompare(right.name)),
      plans: [...new Set(clubs.map((club) => String(club.plan_key ?? club.planKey ?? '')).filter(Boolean))].sort(),
      routes: topPages.map((page) => page.route),
    },
    dataState: dailyUsers.length
      ? (selectedRows.length || topPages.length ? 'available' : 'empty')
      : 'insufficient',
  }
}
