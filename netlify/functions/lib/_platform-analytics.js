import {
  analyticsRoleFamily,
  canonicalizeAnalyticsRoute,
  getAnalyticsEventDefinition,
  getMeaningfulRouteEvent,
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

function safeRequestId(event = {}) {
  const value = text(event.headers?.['x-nf-request-id'] || event.headers?.['x-request-id'])
  return /^[a-zA-Z0-9:_-]{1,96}$/.test(value) ? value : ''
}

async function maybeSingle(query) {
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data || null
}

async function resolveAuthoritativeEventContext({ supabaseAdmin, authUser, profile, input }) {
  const allowedRoles = new Set([normalizeProfileRole(profile)])
  let team = null

  if (input.reportedTeamId) {
    team = await maybeSingle(
      supabaseAdmin.from('teams').select('id,club_id,name').eq('id', input.reportedTeamId),
    )
    if (!team) throw statusError('The reported analytics team is not available.', 403, 'analytics_team_spoof_denied')

    const isPlatformAdmin = normalizeProfileRole(profile) === 'super_admin'
    const isClubAdmin = ['admin', 'club_admin'].includes(normalizeProfileRole(profile))
      && profile.club_id === team.club_id
    const staff = await maybeSingle(
      supabaseAdmin
        .from('team_staff')
        .select('role_key')
        .eq('team_id', team.id)
        .eq('user_id', profile.id),
    )
    const parent = await maybeSingle(
      supabaseAdmin
        .from('parent_player_links')
        .select('id')
        .eq('team_id', team.id)
        .eq('auth_user_id', authUser.id)
        .eq('status', 'active'),
    )

    if (!isPlatformAdmin && !isClubAdmin && !staff && !parent) {
      throw statusError('The reported analytics team is not authorized.', 403, 'analytics_team_spoof_denied')
    }
    if (staff?.role_key) allowedRoles.add(text(staff.role_key).toLowerCase())
    if (parent) allowedRoles.add('parent_portal')
  }

  if (input.reportedRole === 'parent_portal' && !allowedRoles.has('parent_portal')) {
    const parent = await maybeSingle(
      supabaseAdmin
        .from('parent_player_links')
        .select('id')
        .eq('auth_user_id', authUser.id)
        .eq('status', 'active')
        .limit(1),
    )
    if (parent) allowedRoles.add('parent_portal')
  }

  const requestedRole = input.reportedRole
  if (requestedRole && !allowedRoles.has(requestedRole)) {
    throw statusError('The reported analytics role is not authorized.', 403, 'analytics_role_spoof_denied')
  }
  const role = requestedRole || normalizeProfileRole(profile)
  const clubId = team?.club_id || profile.club_id || null
  const club = clubId
    ? await maybeSingle(supabaseAdmin.from('clubs').select('id,name').eq('id', clubId))
    : null
  const scopeIdentity = [club?.name, team?.name].map((value) => text(value).toLowerCase()).join(' ')

  return {
    role,
    clubId,
    teamId: team?.id || null,
    internalState: role === 'super_admin',
    fpTestState: scopeIdentity.includes('fp test') || scopeIdentity.includes('fp-test'),
  }
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

function buildEventRow({
  input,
  profile,
  environment,
  context = {},
  occurredAt = new Date().toISOString(),
  receivedAt = new Date().toISOString(),
  sourceKind = 'direct',
  requestId = '',
  processorRunId = null,
}) {
  const definition = input.definition || getAnalyticsEventDefinition(input.eventName)
  const role = context.role || normalizeProfileRole(profile)
  const internalState = context.internalState ?? role === 'super_admin'
  const fpTestState = Boolean(context.fpTestState)
  const excluded = environment !== 'production' || internalState || fpTestState

  return {
    occurred_at: occurredAt,
    received_at: receivedAt,
    event_name: input.eventName,
    user_id: profile.id,
    role,
    club_id: context.clubId ?? profile.club_id ?? null,
    team_id: context.teamId || null,
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
    is_excluded: excluded,
    event_category: definition?.activityClass === 'authentication'
      ? 'authentication'
      : (definition?.meaningful ? 'meaningful_action' : 'navigation'),
    action_family: definition?.featureKey || 'unknown',
    route_key: input.canonicalRoute || '',
    source: sourceKind === 'audit' ? 'server_audit' : 'web',
    production_state: environment,
    actor_auth_user_id: profile.id,
    actor_profile_id: profile.id,
    actor_role_at_event: role,
    actor_role_family: analyticsRoleFamily(role),
    request_id: requestId,
    internal_state: internalState,
    fp_test_state: fpTestState,
    page_view: ['page.view', 'page.viewed'].includes(input.eventName),
    idempotency_key: input.clientEventId,
    schema_version: 2,
    processor_run_id: processorRunId,
  }
}

export async function recordPlatformAnalyticsEvent({
  supabaseAdmin,
  event,
  environment = resolveAnalyticsEnvironment(event),
} = {}) {
  const { authUser, profile } = await authenticateEvent(supabaseAdmin, event)
  const input = normalizeAnalyticsEventInput(parseJsonBody(event))
  const context = await resolveAuthoritativeEventContext({
    supabaseAdmin,
    authUser,
    profile,
    input,
  })
  const row = buildEventRow({
    input,
    profile,
    environment,
    context,
    requestId: safeRequestId(event),
  })
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
    activityType: queryValue(event, 'activityType'),
    environment: queryValue(event, 'environment'),
    pageFamily: queryValue(event, 'pageFamily'),
    includeInternal: queryValue(event, 'includeInternal'),
    includeFpTest: queryValue(event, 'includeFpTest'),
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
    canonicalReportResult,
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
    supabaseAdmin.rpc('get_platform_analytics_canonical_v4', {
      start_date_value: filters.startDate,
      end_date_value: filters.endDate,
      club_id_value: filters.clubId === 'all' ? null : filters.clubId,
      plan_key_value: filters.plan === 'all' ? null : filters.plan,
      role_value: filters.role === 'all' ? null : filters.role,
      platform_value: filters.platform === 'all' ? null : filters.platform,
      activity_type_value: filters.activityType === 'all' ? null : filters.activityType,
      environment_value: filters.environment === 'all' ? null : filters.environment,
      page_family_value: filters.pageFamily === 'all' ? null : filters.pageFamily,
      include_internal_value: filters.includeInternal,
      include_fp_test_value: filters.includeFpTest,
    }),
  ])
  if (canonicalReportResult.error) throw canonicalReportResult.error
  const canonicalReport = canonicalReportResult.data || {}

  return buildPlatformAnalyticsReport({
    dailyUsers,
    dailyPageUsers,
    hourlyUsers,
    hourlyPages,
    hourlyPlatform,
    lifetimes,
    clubs,
    identityAdoption: canonicalReport.identityAdoption || {},
    dashboardEvidence: canonicalReport,
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

function isPageViewEvent(eventName) {
  return eventName === 'page.view' || eventName === 'page.viewed'
}

export async function loadPlatformAnalyticsDiagnostics({
  supabaseAdmin,
  event,
  now = new Date(),
} = {}) {
  await requirePlatformAdmin(supabaseAdmin, event)
  const filters = normalizePlatformAnalyticsFilters(reportFilterInput(event), now)
  const startAt = new Date(`${filters.startDate}T00:00:00.000Z`).toISOString()
  const end = new Date(`${filters.endDate}T00:00:00.000Z`)
  end.setUTCDate(end.getUTCDate() + 1)
  const { data, error } = await supabaseAdmin.rpc('get_platform_analytics_diagnostics', {
    start_at_value: startAt,
    end_at_value: end.toISOString(),
  })
  if (error) throw error
  return data || {}
}

async function loadScopeNames(supabaseAdmin, table, ids) {
  const names = new Map()
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  for (let index = 0; index < uniqueIds.length; index += 500) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select('id,name')
      .in('id', uniqueIds.slice(index, index + 500))
    if (error) throw error
    for (const row of data || []) names.set(row.id, text(row.name).toLowerCase())
  }
  return names
}

function auditTeamId(row) {
  const value = row?.metadata?.teamId || row?.metadata?.team_id
  return /^[0-9a-f-]{36}$/i.test(text(value)) ? text(value) : null
}

function canonicalAuditRole(row, profile) {
  const value = text(row?.actor_role_label).toLowerCase()
  if (value.includes('platform') && value.includes('admin')) return 'super_admin'
  if (value.includes('club') && value.includes('admin')) return 'club_admin'
  if (value.includes('team') && value.includes('admin')) return 'head_manager'
  if (value.includes('manager')) return 'manager'
  if (value.includes('coach')) return 'coach'
  if (value.includes('parent')) return 'parent_portal'
  return normalizeProfileRole(profile)
}

export async function ingestAuditAnalyticsEvents({
  supabaseAdmin,
  startAt,
  endAt,
  environment = 'production',
  processorRunId = null,
} = {}) {
  const auditRows = []
  for (let offset = 0; offset < MAX_AUDIT_INGEST_ROWS; offset += REPORT_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from('audit_logs')
      .select('id,actor_id,actor_role_label,club_id,action,entity_type,outcome,metadata,created_at')
      .gte('created_at', startAt)
      .lte('created_at', endAt)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + REPORT_PAGE_SIZE - 1)

    if (error) throw error
    auditRows.push(...(data || []))
    if (!data || data.length < REPORT_PAGE_SIZE) break
  }

  const profiles = await loadProfilesById(supabaseAdmin, (auditRows || []).map((row) => row.actor_id))
  const clubNames = await loadScopeNames(supabaseAdmin, 'clubs', (auditRows || []).map((row) => row.club_id))
  const teamNames = await loadScopeNames(supabaseAdmin, 'teams', (auditRows || []).map(auditTeamId))
  const eventRows = []
  const quarantineRows = []

  for (const auditRow of auditRows || []) {
    const profile = profiles.get(auditRow.actor_id)
    const eventName = mapAuditActionToAnalyticsEvent(auditRow.action)

    if (auditRow.outcome && auditRow.outcome !== 'success') {
      continue
    }

    if (!profile?.id || profile.status !== 'active') {
      quarantineRows.push({
        processor_run_id: processorRunId,
        source_kind: 'audit',
        source_record_id: auditRow.id,
        safe_reason: 'actor_unattributed',
        safe_event_name: eventName || '',
        safe_actor_profile_id: auditRow.actor_id || null,
      })
      continue
    }

    if (!eventName) {
      continue
    }

    const canonicalRoute = isPageViewEvent(eventName) ? auditRoute(auditRow) : ''

    if (isPageViewEvent(eventName) && !canonicalRoute) {
      quarantineRows.push({
        processor_run_id: processorRunId,
        source_kind: 'audit',
        source_record_id: auditRow.id,
        safe_reason: 'route_unclassifiable',
        safe_event_name: eventName,
        safe_actor_profile_id: auditRow.actor_id,
      })
      continue
    }

    const roleAtEvent = canonicalAuditRole(auditRow, profile)
    const requestedTeamId = auditTeamId(auditRow)
    const teamId = requestedTeamId && teamNames.has(requestedTeamId) ? requestedTeamId : null
    if (requestedTeamId && !teamId) {
      quarantineRows.push({
        processor_run_id: processorRunId,
        source_kind: 'audit',
        source_record_id: auditRow.id,
        safe_reason: 'team_unattributed',
        safe_event_name: eventName,
        safe_actor_profile_id: auditRow.actor_id,
      })
    }
    const fpTestState = [clubNames.get(auditRow.club_id), teamNames.get(teamId)]
      .filter(Boolean)
      .some((value) => value.includes('fp test') || value.includes('fp-test'))
    const context = {
      role: roleAtEvent,
      clubId: auditRow.club_id || profile.club_id || null,
      teamId,
      internalState: roleAtEvent === 'super_admin',
      fpTestState,
    }

    eventRows.push(buildEventRow({
      input: auditInput({ row: auditRow, eventName, route: canonicalRoute }),
      profile: { ...profile, club_id: auditRow.club_id || profile.club_id },
      context,
      environment,
      occurredAt: auditRow.created_at,
      receivedAt: endAt,
      sourceKind: 'audit',
      processorRunId,
    }))

    if (isPageViewEvent(eventName)) {
      const meaningfulEvent = getMeaningfulRouteEvent(canonicalRoute)

      if (meaningfulEvent) {
        eventRows.push(buildEventRow({
          input: auditInput({ row: auditRow, eventName: meaningfulEvent, route: canonicalRoute }),
          profile: { ...profile, club_id: auditRow.club_id || profile.club_id },
          context,
          environment,
          occurredAt: auditRow.created_at,
          receivedAt: endAt,
          sourceKind: 'audit',
          processorRunId,
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

  for (let index = 0; index < quarantineRows.length; index += 500) {
    const { error } = await supabaseAdmin
      .from('analytics_event_quarantine')
      .upsert(quarantineRows.slice(index, index + 500), {
        onConflict: 'source_kind,source_record_id,safe_reason',
        ignoreDuplicates: true,
      })
    if (error) throw error
  }

  return {
    auditRowsRead: auditRows?.length || 0,
    analyticsRowsPrepared: eventRows.length,
    rowsRejected: quarantineRows.length,
    lastAuditAt: auditRows?.at(-1)?.created_at || startAt,
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

      if (queryValue(event, 'diagnostic') === 'true') {
        const diagnostic = await loadPlatformAnalyticsDiagnostics({
          supabaseAdmin,
          event,
          now: now(),
        })
        return json(200, { success: true, diagnostic })
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
