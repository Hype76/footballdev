const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INSTALLATION_STORAGE_PREFIX = 'football-player.parent.push-installation-id.v2'
const DETAIL_STORAGE_PREFIX = 'football-player:parent:push-detail:v2'
const SECURE_STORE_KEY_PATTERN = /^[A-Za-z0-9._-]+$/

export const parentNotificationDetailLevels = Object.freeze(['minimal', 'detailed'])
export const parentNotificationIntentTypes = Object.freeze([
  'parent_message',
  'parent_poll',
  'parent_chat',
  'matchday_update',
  'calendar_update',
])

const parentPushFailureStages = new Set(['api', 'device', 'expo', 'local', 'permission'])
const DEFAULT_PARENT_PUSH_STEP_TIMEOUT_MS = 12000

function normalize(value) {
  return String(value ?? '').trim()
}

export function isParentInstallationId(value) {
  return INSTALLATION_ID_PATTERN.test(normalize(value))
}

export function getParentNotificationStorageKeys(environment = 'test') {
  const scope = normalize(environment).toLowerCase() === 'production' ? 'production' : 'test'
  const installationId = `${INSTALLATION_STORAGE_PREFIX}.${scope}`
  if (!SECURE_STORE_KEY_PATTERN.test(installationId)) {
    throw new Error('parent_notification_secure_key_invalid')
  }
  return {
    detailLevel: `${DETAIL_STORAGE_PREFIX}:${scope}`,
    installationId,
  }
}

export function normalizeParentNotificationDetail(value) {
  return normalize(value).toLowerCase() === 'detailed' ? 'detailed' : 'minimal'
}

export function getParentPushSetupFailureCode(error, stage = 'expo') {
  const requestedStage = normalize(stage).toLowerCase()
  const normalizedStage = parentPushFailureStages.has(requestedStage) ? requestedStage : 'expo'
  const code = normalize(error?.code).toLowerCase()
  const message = normalize(error?.message || error).toLowerCase()
  const signal = `${code} ${message}`
  let category = 'token_unavailable'

  if (
    signal.includes('fis_auth_error')
    || signal.includes('firebase configuration')
    || signal.includes('firebaseapp')
    || signal.includes('permission_denied')
    || signal.includes('requests from this android client application are blocked')
  ) {
    category = 'firebase_configuration'
  } else if (
    signal.includes('network')
    || signal.includes('timed out')
    || signal.includes('timeout')
    || signal.includes('service_not_available')
    || signal.includes('failed to fetch')
  ) {
    category = 'network'
  } else if (
    signal.includes('no_experience_id')
    || signal.includes('no_application_id')
    || signal.includes('projectid')
    || signal.includes('applicationid')
  ) {
    category = 'app_configuration'
  } else if (normalizedStage === 'device' && signal.includes('unavailable')) {
    category = 'device_unavailable'
  } else if (normalizedStage === 'expo' && signal.includes('server_error')) {
    category = 'service'
  } else if (normalizedStage === 'permission') {
    category = 'permission_unavailable'
  } else if (normalizedStage === 'local') {
    category = 'storage_unavailable'
  } else if (normalizedStage === 'api') {
    const status = Number(error?.status || error?.statusCode || 0)
    if (status === 401 || signal.includes('sign_in_required') || signal.includes('sign in again')) {
      category = 'signed_out'
    } else if (status === 403 && (signal.includes('link_required') || signal.includes('family portal link'))) {
      category = 'parent_authority'
    } else if (status === 403) {
      category = 'forbidden'
    } else if (status >= 500) {
      category = 'service'
    } else if (signal.includes('network') || signal.includes('timed out') || signal.includes('failed to fetch')) {
      category = 'network'
    } else if (status >= 400) {
      category = 'preference_save'
    } else {
      category = 'request_unavailable'
    }
  }

  return `PARENT_PUSH_${normalizedStage.toUpperCase()}_${category.toUpperCase()}`
}

export async function withParentPushStepTimeout(operation, options = {}) {
  const requestedStage = normalize(options.stage).toLowerCase()
  const stage = parentPushFailureStages.has(requestedStage) ? requestedStage : 'expo'
  const requestedTimeout = Number(options.timeoutMs)
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? requestedTimeout
    : DEFAULT_PARENT_PUSH_STEP_TIMEOUT_MS
  let timeoutHandle

  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          const error = new Error(`parent push ${stage} timed out`)
          error.code = getParentPushSetupFailureCode(error, stage)
          reject(error)
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeoutHandle)
  }
}

export function normalizeParentNotificationState(value = {}) {
  const detailLevel = normalizeParentNotificationDetail(value.detailLevel)
  const permissionStatus = normalize(value.permissionStatus).toLowerCase() || 'undetermined'
  const registered = Boolean(value.registered)

  return {
    canAskAgain: value.canAskAgain !== false,
    detailLevel,
    enabled: Boolean(value.enabled && registered),
    message: normalize(value.message),
    permissionGranted: Boolean(value.permissionGranted),
    permissionStatus,
    registered,
  }
}

export function mergeParentNotificationPermission(serverState = {}, permission = {}, fallbackDetail = 'minimal') {
  return normalizeParentNotificationState({
    ...serverState,
    ...permission,
    detailLevel: serverState.detailLevel || fallbackDetail,
    enabled: Boolean(serverState.enabled),
  })
}

export function getParentAppBadgeUpdate({ authenticated = false, resourcesLoaded = false, count = 0 } = {}) {
  if (!authenticated || !resourcesLoaded) return null
  const normalizedCount = Number.isFinite(Number(count)) ? Math.floor(Number(count)) : 0
  return Math.max(0, Math.min(99, normalizedCount))
}

export function getParentNotificationStatusLabel(value = {}) {
  const state = normalizeParentNotificationState(value)
  if (!state.permissionGranted && state.permissionStatus === 'denied') return 'Blocked in device settings'
  if (!state.enabled) return 'Off'
  return state.detailLevel === 'detailed' ? 'On, Detailed' : 'On, Minimal'
}

export function resolveParentNotificationOpen(data, available = {}) {
  if (normalize(data?.app).toLowerCase() !== 'parent') return null

  const route = normalize(data?.type) === 'scorer_request' ? 'invites' : normalize(data?.route).toLowerCase()
  const routeMap = {
    calendar: 'calendar',
    chat: 'chat',
    development: 'development',
    invites: 'invites',
    matchday: 'matchday',
    messages: 'messages',
    polls: 'polls',
    resources: 'resources',
    results: 'results',
    settings: 'settings',
  }
  const tab = routeMap[route]
  if (!tab) return null

  const routeTargetIds = {
    calendar: data?.calendarEventId,
    chat: data?.roomId,
    development: data?.reportId,
    invites: data?.invitationId,
    matchday: data?.matchDayId,
    messages: data?.messageId,
    polls: data?.pollId,
    resources: data?.resourceId,
    results: data?.matchDayId,
  }
  let targetId = normalize(data?.targetId || routeTargetIds[route])
  const availabilityProvided = Object.prototype.hasOwnProperty.call(available, route)
  const availableIds = new Set((available[route] || []).map(normalize).filter(Boolean))
  if (route === 'invites' && availabilityProvided && !availableIds.has(targetId)) {
    const canonicalId = targetId.replace(/^match:/, 'match_attendance:')
    const eventInvitation = (available.invitationRecords || []).find((item) => (
      normalize(item.eventId) === normalize(data?.matchDayId || data?.calendarEventId)
      && normalize(item.eventId)
    ))
    targetId = availableIds.has(canonicalId) ? canonicalId : normalize(eventInvitation?.invitationId)
  }

  return {
    targetId: targetId && (!availabilityProvided || availableIds.has(targetId)) ? targetId : '',
    tab,
  }
}

export async function loadCurrentParentNotificationData(loadParentData, maxAttempts = 3) {
  if (typeof loadParentData !== 'function') {
    throw new TypeError('A Parent data loader is required.')
  }

  const attemptLimit = Math.max(1, Math.min(5, Number(maxAttempts) || 3))
  let result = null

  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    result = await loadParentData()
    if (!result?.stale) return result
  }

  return result
}

export function resolveParentNotificationLinkId(data, parentLinks = []) {
  const requestedLinkId = normalize(data?.parentLinkId)
  if (!requestedLinkId) return ''

  const authorisedLinkIds = new Set(parentLinks.map((link) => normalize(link?.id)).filter(Boolean))
  return authorisedLinkIds.has(requestedLinkId) ? requestedLinkId : null
}

export function containsForbiddenParentNotificationContent(text, playerNames = []) {
  const normalizedText = normalize(text).toLowerCase()
  const forbiddenSignals = ['@', 'assessment', 'Coach note', 'phone number']
  if (forbiddenSignals.some((signal) => normalizedText.includes(signal))) return true

  return playerNames.some((name) => {
    const normalizedName = normalize(name).toLowerCase()
    return normalizedName.includes(' ') && normalizedText.includes(normalizedName)
  })
}
