import { normalizeAnalyticsEventInput } from '../analytics/registry.js'

function analyticsRequestHeaders(accessToken) {
  return {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }
}

async function parseAnalyticsResponse(response) {
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result?.success === false) {
    const error = new Error(result?.message || 'Platform analytics could not be loaded.')
    error.code = result?.code || `http_${response.status}`
    error.status = response.status
    throw error
  }

  return result
}

function randomEventId(prefix) {
  const randomValue = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}:${randomValue}`
}

function getAnalyticsSessionId() {
  const key = 'fp-analytics-session-id'

  try {
    const existing = window.sessionStorage.getItem(key)
    if (existing) return existing
    const created = randomEventId('session')
    window.sessionStorage.setItem(key, created)
    return created
  } catch {
    return randomEventId('session')
  }
}

export async function recordAnalyticsEvent({
  accessToken = '',
  eventName,
  route = '',
  platform = 'web',
  clientEventId = '',
  sessionId = '',
  metadata = {},
} = {}) {
  if (!accessToken) {
    return { accepted: false, reason: 'no_authenticated_session' }
  }

  const normalized = normalizeAnalyticsEventInput({
    eventName,
    route,
    platform,
    clientEventId: clientEventId || randomEventId('event'),
    sessionId: sessionId || getAnalyticsSessionId(),
    metadata,
  })
  const response = await fetch('/.netlify/functions/platform-analytics', {
    method: 'POST',
    headers: analyticsRequestHeaders(accessToken),
    body: JSON.stringify(normalized),
    keepalive: true,
  })

  return parseAnalyticsResponse(response)
}

export function recordSuccessfulLoginAnalytics(data) {
  const accessToken = data?.session?.access_token || ''

  if (!accessToken) {
    return Promise.resolve({ accepted: false, reason: 'no_authenticated_session' })
  }

  return recordAnalyticsEvent({
    accessToken,
    eventName: 'auth.login_succeeded',
    route: '/login',
    platform: 'web',
  }).catch((error) => {
    console.error({ code: error?.code || 'analytics_login_signal_failed' })
    return { accepted: false, reason: 'analytics_request_failed' }
  })
}

export async function getPlatformAnalytics({
  accessToken = '',
  filters = {},
  refresh = false,
} = {}) {
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && String(value) !== '') {
      query.set(key, String(value))
    }
  }

  if (refresh) {
    query.set('refresh', 'true')
  }

  const response = await fetch(`/.netlify/functions/platform-analytics?${query.toString()}`, {
    headers: analyticsRequestHeaders(accessToken),
  })
  const result = await parseAnalyticsResponse(response)
  return result.report
}
