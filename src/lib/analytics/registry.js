const RAW_RETENTION_CLASS = 'raw_90_days'
const PAGE_VIEW_DEDUPLICATION_KEY = 'fp-analytics-page-view-deduplication'
const PAGE_VIEW_DEDUPLICATION_WINDOW_MS = 2_000

export const ANALYTICS_PLATFORMS = Object.freeze(['web', 'parent_app', 'coach_app'])

export const ANALYTICS_EVENT_REGISTRY = Object.freeze({
  'auth.login_success': Object.freeze({
    description: 'A user completed authentication successfully.',
    activityClass: 'authentication',
    meaningful: false,
    parentActivation: false,
    clubActivation: false,
    featureKey: 'authentication',
    roles: ['all'],
    approvedMetadata: ['operationResult', 'deviceCategory', 'pwaState'],
    retention: RAW_RETENTION_CLASS,
  }),
  'auth.login_succeeded': Object.freeze({
    description: 'A user completed authentication successfully.',
    activityClass: 'authentication',
    meaningful: false,
    parentActivation: false,
    clubActivation: false,
    featureKey: 'authentication',
    roles: ['all'],
    approvedMetadata: [],
    retention: RAW_RETENTION_CLASS,
  }),
  'auth.login_failed': Object.freeze({
    description: 'A privacy-safe aggregate authentication failure signal.',
    activityClass: 'authentication',
    meaningful: false,
    parentActivation: false,
    clubActivation: false,
    featureKey: 'authentication',
    roles: ['all'],
    approvedMetadata: [],
    retention: 'aggregate_only',
  }),
  'page.viewed': Object.freeze({
    description: 'An authenticated user viewed a canonical application route.',
    activityClass: 'navigation',
    meaningful: false,
    parentActivation: false,
    clubActivation: false,
    featureKey: 'navigation',
    roles: ['all'],
    approvedMetadata: [],
    retention: RAW_RETENTION_CLASS,
  }),
  'page.view': eventDefinition('A canonical application route was viewed.', 'navigation', {
    metadata: ['deviceCategory', 'pwaState', 'uiSurface'],
  }),
  'auth.logout': authenticationEvent('A user ended an authenticated session.'),
  'auth.session_refresh': authenticationEvent('An authenticated session was refreshed.'),
  'workspace.switch': eventDefinition('An authorized workspace was selected.', 'workspace', {
    metadata: ['uiSurface'],
  }),
  'child.switch': eventDefinition('An authorized child context was selected.', 'workspace', {
    metadata: ['uiSurface'],
  }),
  'team.switch': eventDefinition('An authorized team context was selected.', 'workspace', {
    metadata: ['uiSurface'],
  }),
  'calendar.response_submitted': meaningfulEvent('A calendar response was submitted.', 'calendar'),
  'development.record_submitted': meaningfulEvent('A Development record was submitted.', 'development'),
  'development.report_viewed': meaningfulEvent('A Development report was viewed.', 'development'),
  'chat.message_sent': meaningfulEvent('A chat message was sent.', 'chat'),
  'invitation.sent': meaningfulEvent('An invitation was sent.', 'invitations'),
  'invitation.responded': meaningfulEvent('An invitation response was submitted.', 'invitations'),
  'player.created': meaningfulEvent('A player record was created.', 'players'),
  'role.assignment_changed': meaningfulEvent('A role assignment was changed.', 'roles'),
  'match.selection_changed': meaningfulEvent('A match selection was changed.', 'matchday'),
  'resource.viewed': meaningfulEvent('A resource was viewed.', 'resources'),
  'poll.responded': meaningfulEvent('A poll response was submitted.', 'polls', { parentActivation: true }),
  'platform.action_completed': Object.freeze({
    description: 'An existing auditable domain action completed successfully.',
    activityClass: 'meaningful',
    meaningful: true,
    parentActivation: true,
    clubActivation: true,
    featureKey: 'platform',
    roles: ['all'],
    approvedMetadata: [],
    retention: RAW_RETENTION_CLASS,
  }),
  'player.viewed': eventDefinition('Player profile viewed.', 'players', { meaningful: true }),
  'assessment.started': eventDefinition('Player assessment started.', 'assessments', { meaningful: true }),
  'assessment.submitted': eventDefinition('Player assessment submitted.', 'assessments', { meaningful: true }),
  'feedback.created': eventDefinition('Platform feedback created.', 'feedback', { meaningful: true }),
  'feedback.viewed': eventDefinition('Feedback area viewed.', 'feedback', { meaningful: true }),
  'calendar.viewed': eventDefinition('Football calendar viewed.', 'calendar', { meaningful: true }),
  'calendar.event_created': eventDefinition('Calendar event created.', 'calendar', { meaningful: true }),
  'matchday.viewed': eventDefinition('Match Day workspace viewed.', 'matchday', { meaningful: true }),
  'matchday.created': eventDefinition('Match Day record created.', 'matchday', { meaningful: true }),
  'matchday.started': eventDefinition('Match Day started.', 'matchday', { meaningful: true }),
  'parent_portal.viewed': eventDefinition('Family portal viewed.', 'parent_portal', {
    meaningful: true,
    parentActivation: true,
  }),
  'parent_feedback.viewed': eventDefinition('Parent-visible feedback viewed.', 'parent_feedback', {
    meaningful: true,
    parentActivation: true,
  }),
  'parent_availability_submitted': eventDefinition('Parent availability submitted.', 'parent_availability', {
    meaningful: true,
    parentActivation: true,
  }),
  'poll.voted': eventDefinition('Poll vote submitted.', 'polls', {
    meaningful: true,
    parentActivation: true,
  }),
  'message.viewed': eventDefinition('Permitted message workspace viewed.', 'messages', {
    meaningful: true,
    parentActivation: true,
  }),
  'data_transfer.started': eventDefinition('Data transfer started.', 'data_transfer', { meaningful: true }),
  'data_transfer.completed': eventDefinition('Data transfer completed.', 'data_transfer', { meaningful: true }),
  'form.completed': eventDefinition('A named form was completed.', 'forms', { meaningful: true }),
})

const ROUTE_DEFINITIONS = Object.freeze([
  route('/player/:playerId', /^\/player\/[^/]+$/i, 'player.viewed'),
  route('/players', /^\/players(?:\/current)?$/i),
  route('/archived-players', /^\/archived-players$/i),
  route('/add-player', /^\/add-player$/i),
  route('/calendar', /^\/calendar$/i, 'calendar.viewed'),
  route('/sessions', /^\/sessions$/i),
  route('/sessions/start', /^\/sessions\/start$/i, 'assessment.started'),
  route('/sessions/previous', /^\/sessions\/previous$/i),
  route('/match-day', /^\/match-day$/i, 'matchday.viewed'),
  route('/feedback/new', /^\/feedback\/new$/i),
  route('/feedback-forms', /^\/feedback-forms$/i),
  route('/form-builder', /^\/form-builder$/i),
  route('/parent-portal', /^\/parent-portal$/i, 'parent_portal.viewed'),
  route('/parent-chat', /^\/parent-(?:chat|messages)$/i, 'message.viewed'),
  route('/parent-polls', /^\/parent-polls$/i),
  route('/friends-family', /^\/friends-family$/i),
  route('/parent-linking', /^\/parent-linking$/i),
  route('/teams', /^\/teams$/i),
  route('/coach', /^\/coach$/i),
  route('/assess-player', /^\/assess-player(?:\/new|\/completed)?$/i),
  route('/create-evaluation', /^\/create-evaluation$/i, 'assessment.started'),
  route('/create', /^\/create$/i),
  route('/platform-admin', /^\/platform-admin$/i),
  route('/platform-admin/clubs', /^\/platform-clubs$/i),
  route('/platform-admin/analytics', /^\/platform-analytics$/i),
  route('/platform-admin/banners', /^\/platform-banners$/i),
  route('/platform-admin/staff', /^\/platform-staff$/i),
  route('/platform-admin/data-hygiene', /^\/platform-data-hygiene$/i),
  route('/platform-admin/billing', /^\/platform-billing-options$/i),
  route('/platform-admin/feedback', /^\/platform-feedback$/i),
  route('/activity-log', /^\/activity-log$/i),
  route('/data-transfer', /^\/data-transfer$/i),
  route('/information', /^\/information$/i),
  route('/user-settings', /^\/user-settings$/i),
  route('/resources', /^\/resources$/i),
  route('/polls', /^\/polls$/i),
  route('/staff-chat', /^\/staff-chat$/i, 'message.viewed'),
  route('/parent-chat-staff', /^\/parent-chat-staff$/i, 'message.viewed'),
  route('/email-queue', /^\/email-queue$/i),
  route('/parent-email-templates', /^\/parent-email-templates$/i),
  route('/end-season-stats', /^\/end-season-stats$/i),
  route('/user-access', /^\/user-access$/i),
  route('/club-settings', /^\/club-settings$/i),
  route('/billing', /^\/billing$/i),
])

const STATIC_ASSET_PATTERN = /\.(?:avif|css|gif|ico|jpe?g|js|json|map|mjs|png|svg|txt|webmanifest|webp|woff2?)$/i
const SAFE_EVENT_ID_PATTERN = /^[a-zA-Z0-9:_-]{1,96}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NON_MEANINGFUL_AUDIT_ACTION_PATTERN = /(?:^|_)(?:denied|error|failed|invalid|noop|preview|retried|attempted)(?:_|$)/
const MEANINGFUL_AUDIT_ACTION_PATTERN = /(?:^|_)(?:accepted|added|approved|archived|assigned|cancelled|cleared|completed|created|deleted|deselected|downloaded|duplicated|edited|hidden|moved|paused|promoted|rejected|removed|restored|resumed|saved|selected|sent|set|shown|started|submitted|transferred|updated|uploaded|voted)(?:_|$)/
const MEANINGFUL_AUDIT_ACTIONS = new Set(['create', 'delete', 'replace-staff', 'update'])

function eventDefinition(description, featureKey, options = {}) {
  return Object.freeze({
    description,
    activityClass: options.meaningful ? 'meaningful' : 'navigation',
    meaningful: Boolean(options.meaningful),
    parentActivation: Boolean(options.parentActivation),
    clubActivation: options.clubActivation ?? Boolean(options.meaningful),
    featureKey,
    roles: ['all'],
    approvedMetadata: options.metadata || [],
    retention: RAW_RETENTION_CLASS,
  })
}

function meaningfulEvent(description, featureKey, options = {}) {
  return eventDefinition(description, featureKey, { ...options, meaningful: true })
}

function authenticationEvent(description) {
  return Object.freeze({
    description,
    activityClass: 'authentication',
    meaningful: false,
    parentActivation: false,
    clubActivation: false,
    featureKey: 'authentication',
    roles: ['all'],
    approvedMetadata: ['operationResult', 'deviceCategory', 'pwaState'],
    retention: RAW_RETENTION_CLASS,
  })
}

function route(key, pattern, meaningfulEvent = '') {
  return Object.freeze({ key, pattern, meaningfulEvent })
}

function pathnameFromValue(value) {
  const text = String(value ?? '').trim()

  if (!text) {
    return ''
  }

  try {
    return new URL(text, 'https://footballplayer.online').pathname
  } catch {
    return text.split(/[?#]/, 1)[0] || ''
  }
}

export function canonicalizeAnalyticsRoute(value) {
  const pathname = pathnameFromValue(value)
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '') || '/'

  if (
    pathname === '/favicon.ico'
    || pathname === '/robots.txt'
    || pathname === '/manifest.webmanifest'
    || pathname.startsWith('/.netlify/')
    || pathname.startsWith('/assets/')
    || pathname.startsWith('/api/')
    || STATIC_ASSET_PATTERN.test(pathname)
  ) {
    return ''
  }

  const definition = ROUTE_DEFINITIONS.find((candidate) => candidate.pattern.test(pathname))
  return definition?.key || '/other'
}

export function getMeaningfulRouteEvent(value) {
  const canonicalRoute = canonicalizeAnalyticsRoute(value)
  return ROUTE_DEFINITIONS.find((candidate) => candidate.key === canonicalRoute)?.meaningfulEvent || ''
}

export function getAnalyticsEventDefinition(eventName) {
  return ANALYTICS_EVENT_REGISTRY[String(eventName ?? '').trim()] || null
}

export function normalizeAnalyticsPlatform(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  return ANALYTICS_PLATFORMS.includes(normalized) ? normalized : 'web'
}

export function normalizeAnalyticsEventInput(input = {}) {
  const eventName = String(input.eventName ?? input.event_name ?? '').trim()
  const definition = getAnalyticsEventDefinition(eventName)

  if (!definition || definition.retention === 'aggregate_only') {
    throw Object.assign(new Error('This analytics event is not accepted by the raw event collector.'), {
      code: 'analytics_event_not_allowed',
      statusCode: 400,
    })
  }

  const clientEventId = String(input.clientEventId ?? input.client_event_id ?? '').trim()
  const sessionId = String(input.sessionId ?? input.session_id ?? '').trim()

  if (!SAFE_EVENT_ID_PATTERN.test(clientEventId)) {
    throw Object.assign(new Error('A valid analytics event identifier is required.'), {
      code: 'analytics_event_id_invalid',
      statusCode: 400,
    })
  }

  return {
    eventName,
    clientEventId,
    sessionId: SAFE_EVENT_ID_PATTERN.test(sessionId) ? sessionId : '',
    platform: normalizeAnalyticsPlatform(input.platform),
    canonicalRoute: canonicalizeAnalyticsRoute(input.route ?? input.canonicalRoute ?? input.canonical_route),
    featureKey: definition.featureKey,
    metadata: sanitizeAnalyticsMetadata(eventName, input.metadata),
    reportedTeamId: UUID_PATTERN.test(String(input.reportedTeamId ?? input.teamId ?? input.team_id ?? '').trim())
      ? String(input.reportedTeamId ?? input.teamId ?? input.team_id).trim()
      : '',
    reportedRole: String(input.reportedRole ?? input.workspaceRole ?? input.workspace_role ?? '').trim().toLowerCase(),
    definition,
  }
}

export function sanitizeAnalyticsMetadata(eventName, metadata) {
  const definition = getAnalyticsEventDefinition(eventName)

  if (!definition || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {}
  }

  return Object.fromEntries(
    definition.approvedMetadata
      .filter((key) => Object.hasOwn(metadata, key))
      .map((key) => [key, String(metadata[key] ?? '').slice(0, 80)]),
  )
}

export function analyticsRoleFamily(role) {
  const normalized = String(role ?? '').trim().toLowerCase()
  if (normalized === 'super_admin') return 'platform_admin'
  if (['admin', 'club_admin'].includes(normalized)) return 'club_admin'
  if (['parent', 'parent_portal'].includes(normalized)) return 'parent'
  if (normalized === 'adult_player') return 'player'
  if (['head_manager', 'manager', 'coach', 'assistant_coach'].includes(normalized)) return 'staff'
  return 'unknown'
}

export function shouldRecordAnalyticsPageView({
  key,
  now = Date.now(),
  storage = globalThis.window?.sessionStorage,
} = {}) {
  if (!key || !storage) return true
  try {
    const previous = JSON.parse(storage.getItem(PAGE_VIEW_DEDUPLICATION_KEY) || '{}')
    if (
      previous.key === key
      && now - Number(previous.timestamp || 0) < PAGE_VIEW_DEDUPLICATION_WINDOW_MS
    ) {
      return false
    }
    storage.setItem(PAGE_VIEW_DEDUPLICATION_KEY, JSON.stringify({ key, timestamp: now }))
  } catch {
    return true
  }
  return true
}

export function mapAuditActionToAnalyticsEvent(action) {
  const normalized = String(action ?? '').trim().toLowerCase()

  if (!normalized || normalized === 'ui_clicked') {
    return ''
  }

  if (normalized === 'page_viewed') return 'page.view'
  if (NON_MEANINGFUL_AUDIT_ACTION_PATTERN.test(normalized)) return ''
  if (normalized === 'evaluation_submitted') return 'development.record_submitted'
  if (normalized === 'assessment_session_created') return 'assessment.started'
  if (normalized === 'calendar_event_created') return 'calendar.event_created'
  if (normalized.includes('availability') && ['submitted', 'selected', 'updated'].some((value) => normalized.includes(value))) {
    return 'calendar.response_submitted'
  }
  if (normalized.includes('poll') && ['responded', 'submitted', 'voted'].some((value) => normalized.includes(value))) {
    return 'poll.responded'
  }
  if (normalized === 'player_created') return 'player.created'
  if (normalized.includes('invite') && normalized.endsWith('_sent')) return 'invitation.sent'
  if (normalized.includes('invitation') && ['accepted', 'declined', 'responded'].some((value) => normalized.includes(value))) {
    return 'invitation.responded'
  }
  if (normalized.includes('chat') && normalized.includes('message') && normalized.endsWith('_sent')) {
    return 'chat.message_sent'
  }
  if (normalized.includes('selection') && ['changed', 'selected', 'deselected'].some((value) => normalized.includes(value))) {
    return 'match.selection_changed'
  }
  if (normalized.includes('role') && ['assigned', 'changed', 'removed', 'updated'].some((value) => normalized.includes(value))) {
    return 'role.assignment_changed'
  }
  if (normalized.includes('resource') && normalized.includes('viewed')) return 'resource.viewed'
  if (normalized.includes('development') && normalized.includes('report') && normalized.includes('viewed')) {
    return 'development.report_viewed'
  }
  if (normalized === 'match_day_created') return 'matchday.created'
  if (normalized === 'platform_feedback_created') return 'feedback.created'
  if (normalized.includes('data_transfer') && normalized.includes('completed')) return 'data_transfer.completed'
  if (normalized.includes('data_transfer')) return 'data_transfer.started'
  if (normalized === 'feedback_form_created' || normalized === 'feedback_form_edited') return 'form.completed'

  return MEANINGFUL_AUDIT_ACTIONS.has(normalized) || MEANINGFUL_AUDIT_ACTION_PATTERN.test(normalized)
    ? 'platform.action_completed'
    : ''
}

export function isClearlyExcludedAnalyticsProfile(profile = {}, environment = 'production') {
  if (String(environment ?? '').trim().toLowerCase() !== 'production') {
    return true
  }

  if (String(profile.role ?? '').trim().toLowerCase() === 'super_admin') {
    return true
  }

  const identity = [
    profile.email,
    profile.name,
    profile.username,
    profile.display_name,
  ]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ')

  return (
    identity.includes('fp test')
    || identity.includes('fp-test')
    || identity.includes('+test@')
    || identity.includes('+demo@')
    || identity.startsWith('demo ')
    || identity.includes('@example.test')
  )
}

export function getAnalyticsRegistrySummary() {
  return Object.entries(ANALYTICS_EVENT_REGISTRY).map(([eventName, definition]) => ({
    eventName,
    description: definition.description,
    activityClass: definition.activityClass,
    meaningful: definition.meaningful,
    parentActivation: definition.parentActivation,
    clubActivation: definition.clubActivation,
    featureKey: definition.featureKey,
    retention: definition.retention,
  }))
}
