const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const normalize = (value) => String(value ?? '').trim()
const normalizeLower = (value) => normalize(value).toLowerCase()

export const COACH_NOTIFICATION_LEVELS = Object.freeze(['off', 'minimal', 'detailed'])

export const COACH_NOTIFICATION_INTENTS = Object.freeze({
  matchday_assignment: Object.freeze({ route: 'matchday', sensitivity: 'operational' }),
  matchday_update: Object.freeze({ route: 'matchday', sensitivity: 'operational' }),
  availability_response: Object.freeze({ route: 'invites', sensitivity: 'child-data' }),
  scorer_assignment: Object.freeze({ route: 'matchday', sensitivity: 'operational' }),
  training_update: Object.freeze({ route: 'calendar', sensitivity: 'operational' }),
  calendar_update: Object.freeze({ route: 'calendar', sensitivity: 'operational' }),
  session_update: Object.freeze({ route: 'sessions', sensitivity: 'operational' }),
  staff_chat: Object.freeze({ route: 'chat', sensitivity: 'private-communication' }),
  parent_chat: Object.freeze({ route: 'chat', sensitivity: 'private-communication' }),
  communication_history: Object.freeze({ route: 'messages', sensitivity: 'private-communication' }),
  poll_activity: Object.freeze({ route: 'polls', sensitivity: 'operational' }),
  development_update: Object.freeze({ route: 'development', sensitivity: 'private-development' }),
  resource_shared: Object.freeze({ route: 'resources', sensitivity: 'authorised-resource-metadata' }),
  team_operational_update: Object.freeze({ route: 'home', sensitivity: 'operational' }),
})

const ROUTES = new Set(['home', 'calendar', 'players', 'sessions', 'matchday', 'development', 'resources', 'chat', 'messages', 'polls', 'invites', 'settings'])
const FAILURE_STAGES = new Set(['api', 'device', 'expo', 'local', 'permission'])

export function isCoachInstallationId(value) {
  return INSTALLATION_ID_PATTERN.test(normalize(value))
}

export function getCoachNotificationStorageKeys(environment = 'test') {
  const scope = normalizeLower(environment) === 'production' ? 'production' : 'test'
  return Object.freeze({
    detailLevel: `football-player.coach.push-detail.v3.${scope}`,
    installationId: `football-player.coach.push-installation-id.v3.${scope}`,
  })
}

export function normalizeCoachNotificationLevel(value) {
  const level = normalizeLower(value)
  return COACH_NOTIFICATION_LEVELS.includes(level) ? level : 'minimal'
}

export function normalizeCoachNotificationState(value = {}) {
  value = value || {}
  const detailLevel = normalizeCoachNotificationLevel(value.detailLevel)
  const permissionStatus = normalizeLower(value.permissionStatus) || 'undetermined'
  const preferenceEnabled = value.preferenceEnabled === undefined
    ? Boolean(value.enabled)
    : Boolean(value.preferenceEnabled)
  const registered = Boolean(value.registered)
  return Object.freeze({
    canAskAgain: value.canAskAgain !== false,
    detailLevel,
    enabled: Boolean(detailLevel !== 'off' && preferenceEnabled && registered && value.permissionGranted),
    message: normalize(value.message),
    permissionGranted: Boolean(value.permissionGranted),
    permissionStatus,
    preferenceEnabled,
    registered,
    requiresContextRefresh: Boolean(value.requiresContextRefresh),
    requiresRegistrationRefresh: Boolean(value.requiresRegistrationRefresh),
  })
}

export function preserveCoachNotificationRegistration(currentValue, nextValue) {
  const current = normalizeCoachNotificationState(currentValue)
  const next = normalizeCoachNotificationState(nextValue)
  if (!current.registered || next.registered || next.permissionGranted) return next
  return Object.freeze({
    ...current,
    canAskAgain: next.canAskAgain,
    enabled: false,
    message: next.message,
    permissionGranted: false,
    permissionStatus: next.permissionStatus,
  })
}

export function getCoachNotificationStatusLabel(value = {}) {
  const state = normalizeCoachNotificationState(value)
  if (!state.permissionGranted && state.permissionStatus === 'denied') return 'Blocked in device settings'
  if (!state.enabled || state.detailLevel === 'off') return 'Off'
  return state.detailLevel === 'detailed' ? 'On, Detailed' : 'On, Minimal'
}

export function shouldRestoreCoachNotificationRegistration(value = {}) {
  const state = normalizeCoachNotificationState(value)
  return Boolean(
    state.permissionGranted
    && state.detailLevel !== 'off'
    && (state.requiresRegistrationRefresh || state.requiresContextRefresh)
  )
}

export function isCoachInstallationOwnershipConflict(error) {
  return normalize(error?.code).toUpperCase() === 'COACH_MOBILE_INSTALLATION_OWNED'
}

export function getCoachPushSetupFailureCode(error, stage = 'expo') {
  const normalizedStage = FAILURE_STAGES.has(normalizeLower(stage)) ? normalizeLower(stage) : 'expo'
  const status = Number(error?.status || error?.statusCode || 0)
  const signal = `${normalizeLower(error?.code)} ${normalizeLower(error?.message || error)}`
  let category = 'token_unavailable'
  if (status === 401 || signal.includes('sign_in') || signal.includes('login')) category = 'signed_out'
  else if (status === 403 || signal.includes('forbidden') || signal.includes('authority')) category = 'forbidden'
  else if (status >= 500 || signal.includes('server_error')) category = 'service'
  else if (signal.includes('network') || signal.includes('timeout') || signal.includes('failed to fetch')) category = 'network'
  else if (signal.includes('firebase') || signal.includes('fis_auth')) category = 'firebase_configuration'
  else if (signal.includes('projectid') || signal.includes('applicationid')) category = 'app_configuration'
  else if (normalizedStage === 'permission') category = 'permission_unavailable'
  else if (normalizedStage === 'local') category = 'storage_unavailable'
  else if (normalizedStage === 'device') category = 'device_unavailable'
  return `COACH_PUSH_${normalizedStage.toUpperCase()}_${category.toUpperCase()}`
}

export function getCoachPushSetupFailureMessage(error) {
  const code = normalize(error?.code || error?.message || error).toUpperCase()
  if (code.includes('SIGNED_OUT')) return 'Your account could not be verified just now. Your saved notification setting has not been changed.'
  if (code.includes('PERMISSION')) return 'Notifications are turned off in device settings. The Coach app remains fully usable.'
  if (code.includes('NETWORK') || code.includes('SERVICE')) return 'Notifications could not be refreshed while the service is unavailable. The Coach app remains fully usable.'
  if (code.includes('FORBIDDEN')) return 'Notifications are not available for this Coach context. The Coach app remains fully usable.'
  return 'Notifications are temporarily unavailable on this device. The Coach app remains fully usable.'
}

export function canStartCoachNotificationRegistration(state = {}, request = {}) {
  if (state.inFlight) return false
  if (request.silent !== true) return true
  const sameContext = normalize(state.contextId) === normalize(request.contextId)
  const now = Number.isFinite(Number(request.now)) ? Number(request.now) : Date.now()
  const lastRegistrationAt = Number.isFinite(Number(state.lastRegistrationAt)) ? Number(state.lastRegistrationAt) : 0
  return !sameContext || now - lastRegistrationAt >= 30000
}

export function buildCoachNotificationPayload(intentType, detailLevel = 'minimal') {
  const intent = COACH_NOTIFICATION_INTENTS[normalizeLower(intentType)]
  if (!intent) throw new Error('unsupported_coach_notification_intent')
  const level = normalizeCoachNotificationLevel(detailLevel)
  const copy = {
    calendar: ['Calendar updated', 'A Coach Calendar item has changed.'],
    chat: ['New Coach update', 'Open Football Player Coach to view it.'],
    development: ['Development updated', 'A Development item needs your attention.'],
    home: ['Team update', 'New operational information is available.'],
    invites: ['Availability updated', 'A response summary has changed.'],
    matchday: ['Match Day updated', 'Match Day information has changed.'],
    messages: ['Communication updated', 'New communication history is available.'],
    polls: ['Poll updated', 'A Team Poll has changed.'],
    resources: ['Resource updated', 'A Team Resource is available.'],
    sessions: ['Session updated', 'A Team Session has changed.'],
  }[intent.route]
  return Object.freeze({
    body: level === 'detailed' && intent.sensitivity === 'operational' ? copy[1] : 'Open Football Player Coach for an update.',
    data: Object.freeze({ app: 'coach', intentType: normalizeLower(intentType), route: intent.route }),
    title: copy[0],
  })
}

export function containsForbiddenCoachNotificationContent(text, playerNames = []) {
  const content = normalizeLower(text)
  const forbidden = ['@', 'phone', 'assessment', 'development note', 'Coach note', 'message body', 'parent contact']
  if (forbidden.some((signal) => content.includes(signal))) return true
  return playerNames.some((name) => {
    const candidate = normalizeLower(name)
    return candidate.includes(' ') && content.includes(candidate)
  })
}

export function resolveCoachNotificationOpen(data, authority = {}) {
  if (normalizeLower(data?.app) !== 'coach') return Object.freeze({ allowed: false, code: 'notification_app_mismatch' })
  const route = normalizeLower(data?.route)
  if (!ROUTES.has(route)) return Object.freeze({ allowed: false, code: 'notification_route_invalid' })
  const contexts = Array.isArray(authority.contexts) ? authority.contexts : []
  const requestedContextId = normalize(data?.contextId)
  const requestedTeamId = normalize(data?.teamId)
  const context = requestedContextId
    ? contexts.find((entry) => normalize(entry?.id) === requestedContextId)
    : requestedTeamId
      ? contexts.find((entry) => normalize(entry?.teamId) === requestedTeamId)
      : contexts.find((entry) => normalize(entry?.id) === normalize(authority.activeContextId))
  if (!context) return Object.freeze({ allowed: false, code: 'notification_context_denied' })
  if (requestedTeamId && normalize(context.teamId) !== requestedTeamId) {
    return Object.freeze({ allowed: false, code: 'notification_context_denied' })
  }
  if (normalize(context.archivedAt) || normalizeLower(context.clubStatus) !== 'active' || normalizeLower(context.teamStatus) !== 'active') {
    return Object.freeze({ allowed: false, code: 'notification_context_inactive' })
  }
  const chatTargetId = route === 'chat' ? normalize(data?.roomId || data?.conversationId) : ''
  const targetId = normalize(data?.targetId || chatTargetId)
  if (targetId && route !== 'chat') {
    const availabilityProvided = Object.prototype.hasOwnProperty.call(authority.availableTargets || {}, route)
    const availableIds = new Set((authority.availableTargets?.[route] || []).map(normalize).filter(Boolean))
    if (availabilityProvided && !availableIds.has(targetId)) return Object.freeze({ allowed: false, code: 'notification_target_stale' })
  }
  const notificationType = normalizeLower(data?.type || data?.intentType)
  const chatKind = route === 'chat' && targetId
    ? notificationType === 'parent_chat' || normalize(data?.roomId) ? 'parent' : 'staff'
    : ''
  return Object.freeze(chatKind
    ? { allowed: true, chatKind, code: 'notification_route_ready', contextId: context.id, route, targetId }
    : { allowed: true, code: 'notification_route_ready', contextId: context.id, route, targetId })
}

export function getCoachInstallationOwnerKey({ appRole = 'coach', environment = 'test', installationId, userId }) {
  if (normalizeLower(appRole) !== 'coach') throw new Error('coach_installation_app_mismatch')
  const scope = normalizeLower(environment)
  if (!['test', 'production'].includes(scope)) throw new Error('coach_installation_environment_mismatch')
  if (!isCoachInstallationId(installationId) || !normalize(userId)) throw new Error('coach_installation_owner_invalid')
  return `coach:${scope}:${normalize(userId)}:${normalizeLower(installationId)}`
}
