import {
  canonicalizeAnalyticsRoute,
  getAnalyticsEventDefinition,
  getMeaningfulRouteEvent,
  isClearlyExcludedAnalyticsProfile,
  mapAuditActionToAnalyticsEvent,
  normalizeAnalyticsEventInput,
} from '../../../src/lib/analytics/registry.js'
import {
  buildPlatformAnalyticsReport,
  normalizePlatformAnalyticsFilters,
} from '../../../src/lib/platform-analytics.js'
import { loadActiveAuthorityProfile } from './_authority-profile.js'

const MAX_REPORT_ROWS = 200_000
const REPORT_PAGE_SIZE = 1_000
const MAX_AUDIT_INGEST_ROWS = 20_000

function text(value) {
  return String(value ?? '').trim()
}

function getBearerToken(event = {}) {
  const header = text(event.headers?.authorization || event.headers?.Authorization)
  const [scheme, token] = header.split(' ')
  return scheme?.toLowerCase() === 'bearer' ? text(token) : ''
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  }
}

function statusError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function parseJsonBody(event = {}) {
  try {
    return JSON.parse(event.body || '{}')
  } catch {
    throw statusError('The analytics request body is invalid.', 400, 'analytics_body_invalid')
  }
}

function resolveAnalyticsEnvironment(event = {}, env = globalThis.process?.env || {}) {
  const context = text(globalThis.Netlify?.env?.get?.('CONTEXT') || env.CONTEXT).toLowerCase()
  const host = text(event.headers?.['x-forwarded-host'] || event.headers?.host).toLowerCase()

  if (context === 'production' || host === 'footballplayer.online' || host === 'www.footballplayer.online') {
    return 'production'
  }

  if (context === 'deploy-preview' || context === 'branch-deploy') {
    return 'preview'
  }

  return context || 'local'
}

function normalizeProfileRole(profile = {}) {
  return text(profile.role).toLowerCase() || 'unknown'
}

async function authenticateEvent(supabaseAdmin, event) {
  const token = getBearerToken(event)

  if (!token) {
    throw statusError('Login is required.', 401, 'unauthenticated')
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)

  if (error || !data?.user?.id) {
    throw statusError('Login is required.', 401, 'unauthenticated')
  }

  const profile = await loadActiveAuthorityProfile(supabaseAdmin, data.user)
  return { authUser: data.user, profile }
}

async function requirePlatformAdmin(supabaseAdmin, event) {
  const authenticated = await authenticateEvent(supabaseAdmin, event)

  if (normalizeProfileRole(authenticated.profile) !== 'super_admin') {
    throw statusError('Platform Admin access is required.', 403, 'forbidden')
  }

  return authenticated
}

function buildEventRow({ input, profile, environment, occurredAt = new Date().toISOString(), sourceKind = 'direct' }) {
  const definition = input.definition || getAnalyticsEventDefinition(input.eventName)

  return {
    occurred_at: occurredAt,
    event_name: input.eventName,
    user_id: profile.id,
    role: normalizeProfileRole(profile),
    club_id: profile.club_id || null,
    team_id: null,
    session_id: input.sessionId || '',
    platform: input.platform || 'web',
    canonical_route: input.canonicalRoute || '',
    feature_key: input.featureKey || definition?.featureKey || '',
    environment,
    metadata: input.metadata || {},
    client_event_id: input.clientEventId,
    source_kind: sourceKind,
    is_meaningful: Boolean(definition?.meaningful),
    is_parent_activation: Boolean(definition?.parentActivation),
    is_club_activation: Boolean(definition?.clubActivation),
    is_excluded: isClearlyExcludedAnalyticsProfile(profile, environment),
  }
}

export async function recordPlatformAnalyticsEvent({
  supabaseAdmin,
  event,
  environment = resolveAnalyticsEnvironment(event),
} = {}) {
  const { profile } = await authenticateEvent(supabaseAdmin, event)
  const input = normalizeAnalyticsEventInput(parseJsonBody(event))
  const row = buildEventRow({ input, profile, environment })
  const { error } = await supabaseAdmin
    .from('analytics_events')
    .upsert(row, {
      onConflict: 'user_id,event_name,client_event_id',
      ignoreDuplicates: true,
    })

  if (error) {
    throw error
  }

  return {
    accepted: true,
    eventName: input.eventName,
    canonicalRoute: input.canonicalRoute,
  }
}

function queryValue(event, key) {
  return event?.queryStringParameters?.[key] ?? ''
}

function reportFilterInput(event) {
  return {
    preset: queryValue(event, 'preset'),
    startDate: queryValue(event, 'startDate'),
    endDate: queryValue(event, 'endDate'),
    role: queryValue(event, 'role'),
    platform: queryValue(event, 'platform'),
    clubId: queryValue(event, 'clubId'),
    plan: queryValue(event, 'plan'),
    route: queryValue(event, 'route'),
    includeExcluded: queryValue(event, 'includeExcluded'),
  }
}

async function selectReportTable(supabaseAdmin, table, columns, startDate, endDate) {
  const rows = []

  for (let offset = 0; offset < MAX_REPORT_ROWS; offset += REPORT_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .gte('activity_date', startDate)
      .lte('activity_date', endDate)
      .range(offset, offset + REPORT_PAGE_SIZE - 1)

    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < REPORT_PAGE_SIZE) break
  }

  return rows
}

async function selectReferenceTable(supabaseAdmin, table, columns) {
  const rows = []

  for (let offset = 0; offset < MAX_REPORT_ROWS; offset += REPORT_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .range(offset, offset + REPORT_PAGE_SIZE - 1)

    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < REPORT_PAGE_SIZE) break
  }

  return rows
}

function earliestReportDate(filters) {
  const maintenanceStart = new Date(`${filters.today}T12:00:00.000Z`)
  maintenanceStart.setUTCDate(maintenanceStart.getUTCDate() - 89)
  const maintenanceDate = maintenanceStart.toISOString().slice(0, 10)
  return [filters.previousStartDate, maintenanceDate].filter(Boolean).sort()[0]
}

export async function loadPlatformAnalyticsReport({
  supabaseAdmin,
  event,
  now = new Date(),
} = {}) {
  await requirePlatformAdmin(supabaseAdmin, event)
  const filters = normalizePlatformAnalyticsFilters(reportFilterInput(event), now)

  if (queryValue(event, 'refresh') === 'true') {
    const { error: refreshError } = await supabaseAdmin.rpc('refresh_platform_analytics_aggregates', {
      start_date_value: filters.startDate,
      end_date_value: filters.endDate,
    })

    if (refreshError) {
      throw refreshError
    }
  }

  const firstDate = earliestReportDate(filters)
  const [
    dailyUsers,
    dailyPageUsers,
    hourlyUsers,
    hourlyPages,
    hourlyPlatform,
    lifetimes,
    clubs,
    users,
  ] = await Promise.all([
    selectReportTable(
      supabaseAdmin,
      'analytics_daily_user_activity',
      'activity_date,user_id,role,club_id,platform,is_excluded,login_count,page_view_count,meaningful_action_count,first_activity_at,last_activity_at',
      firstDate,
      filters.endDate,
    ),
    selectReportTable(
      supabaseAdmin,
      'analytics_daily_page_user_activity',
      'activity_date,user_id,role,club_id,platform,canonical_route,is_excluded,page_views,session_count,meaningful_follow_on_actions',
      firstDate,
      filters.endDate,
    ),
    selectReportTable(
      supabaseAdmin,
      'analytics_hourly_user_activity',
      'activity_date,day_of_week,hour_bucket,user_id,role,club_id,platform,is_excluded,login_count,page_views,meaningful_actions,parent_actions,staff_actions',
      firstDate,
      filters.endDate,
    ),
    selectReportTable(
      supabaseAdmin,
      'analytics_hourly_page_activity',
      'activity_date,day_of_week,hour_bucket,role,club_id,platform,canonical_route,is_excluded,page_views,unique_users,sessions',
      firstDate,
      filters.endDate,
    ),
    selectReportTable(
      supabaseAdmin,
      'analytics_hourly_platform_activity',
      'activity_date,day_of_week,hour_bucket,role,club_id,platform,is_excluded,unique_active_users,login_count,page_views,meaningful_actions,parent_actions,staff_actions',
      firstDate,
      filters.endDate,
    ),
    selectReferenceTable(
      supabaseAdmin,
      'analytics_user_lifetime',
      'user_id,first_login_at,first_meaningful_at,first_parent_action_at,last_login_at,last_meaningful_at',
    ),
    selectReferenceTable(supabaseAdmin, 'clubs', 'id,name,plan_key,created_at,status'),
    selectReferenceTable(supabaseAdmin, 'users', 'id,role,role_rank,club_id,created_at,status,email,username,name,display_name'),
  ])
  const environment = resolveAnalyticsEnvironment(event)
  const safeUsers = users.map((user) => ({
    id: user.id,
    role: user.role,
    role_rank: user.role_rank,
    club_id: user.club_id,
    created_at: user.created_at,
    status: user.status,
    isExcluded: isClearlyExcludedAnalyticsProfile(user, environment),
  }))

  return buildPlatformAnalyticsReport({
    dailyUsers,
    dailyPageUsers,
    hourlyUsers,
    hourlyPages,
    hourlyPlatform,
    lifetimes,
    clubs,
    users: safeUsers,
    filters,
    now,
  })
}

function auditRoute(row) {
  return canonicalizeAnalyticsRoute(row?.metadata?.path || '')
}

function auditInput({ row, eventName, route = '' }) {
  const definition = getAnalyticsEventDefinition(eventName)

  return {
    eventName,
    clientEventId: `audit:${row.id}`,
    sessionId: '',
    platform: 'web',
    canonicalRoute: route,
    featureKey: definition?.featureKey || '',
    metadata: {},
    definition,
  }
}

async function loadProfilesById(supabaseAdmin, userIds) {
  const profiles = new Map()
  const uniqueIds = [...new Set(userIds.filter(Boolean))]

  for (let index = 0; index < uniqueIds.length; index += 500) {
    const ids = uniqueIds.slice(index, index + 500)
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id,email,username,name,display_name,role,club_id,status')
      .in('id', ids)

    if (error) throw error
    for (const profile of data || []) profiles.set(profile.id, profile)
  }

  return profiles
}

export async function ingestAuditAnalyticsEvents({
  supabaseAdmin,
  startAt,
  endAt,
  environment = 'production',
} = {}) {
  const { data: auditRows, error: auditError } = await supabaseAdmin
    .from('audit_logs')
    .select('id,actor_id,club_id,action,entity_type,outcome,metadata,created_at')
    .gte('created_at', startAt)
    .lte('created_at', endAt)
    .order('created_at', { ascending: true })
    .limit(MAX_AUDIT_INGEST_ROWS)

  if (auditError) {
    throw auditError
  }

  const profiles = await loadProfilesById(supabaseAdmin, (auditRows || []).map((row) => row.actor_id))
  const eventRows = []

  for (const auditRow of auditRows || []) {
    const profile = profiles.get(auditRow.actor_id)
    const eventName = mapAuditActionToAnalyticsEvent(auditRow.action)

    if (
      !profile?.id
      || profile.status !== 'active'
      || (auditRow.outcome && auditRow.outcome !== 'success')
      || !eventName
    ) {
      continue
    }

    const canonicalRoute = eventName === 'page.viewed' ? auditRoute(auditRow) : ''

    if (eventName === 'page.viewed' && !canonicalRoute) {
      continue
    }

    eventRows.push(buildEventRow({
      input: auditInput({ row: auditRow, eventName, route: canonicalRoute }),
      profile: { ...profile, club_id: auditRow.club_id || profile.club_id },
      environment,
      occurredAt: auditRow.created_at,
      sourceKind: 'audit',
    }))

    if (eventName === 'page.viewed') {
      const meaningfulEvent = getMeaningfulRouteEvent(canonicalRoute)

      if (meaningfulEvent) {
        eventRows.push(buildEventRow({
          input: auditInput({ row: auditRow, eventName: meaningfulEvent, route: canonicalRoute }),
          profile: { ...profile, club_id: auditRow.club_id || profile.club_id },
          environment,
          occurredAt: auditRow.created_at,
          sourceKind: 'audit',
        }))
      }
    }
  }

  for (let index = 0; index < eventRows.length; index += 500) {
    const { error } = await supabaseAdmin
      .from('analytics_events')
      .upsert(eventRows.slice(index, index + 500), {
        onConflict: 'user_id,event_name,client_event_id',
        ignoreDuplicates: true,
      })

    if (error) throw error
  }

  return {
    auditRowsRead: auditRows?.length || 0,
    analyticsRowsPrepared: eventRows.length,
  }
}

export function createPlatformAnalyticsHandler({
  supabaseAdmin,
  now = () => new Date(),
} = {}) {
  return async function platformAnalyticsHandler(event) {
    if (!['GET', 'POST'].includes(event.httpMethod)) {
      return json(405, { success: false, code: 'method_not_allowed', message: 'Method not allowed.' })
    }

    try {
      if (event.httpMethod === 'POST') {
        const result = await recordPlatformAnalyticsEvent({ supabaseAdmin, event })
        return json(202, { success: true, ...result })
      }

      const report = await loadPlatformAnalyticsReport({ supabaseAdmin, event, now: now() })
      return json(200, { success: true, report })
    } catch (error) {
      console.error('platform_analytics_request_failed', {
        code: error?.code || 'unknown',
        statusCode: error?.statusCode || 500,
      })
      return json(error?.statusCode || 500, {
        success: false,
        code: error?.code || 'platform_analytics_failed',
        message: error?.statusCode && error.statusCode < 500
          ? error.message
          : 'Platform analytics are unavailable right now.',
      })
    }
  }
}
