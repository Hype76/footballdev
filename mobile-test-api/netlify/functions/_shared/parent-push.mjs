const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EXPO_PUSH_TOKEN_PATTERN = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/

export const PARENT_PUSH_INTENTS = Object.freeze({
  matchday_update: {
    detailed: 'Your team has a new Matchday update.',
    minimal: 'Matchday information has been updated.',
    route: 'matchday',
  },
  parent_message: {
    detailed: 'Your club has shared a new Parent message.',
    minimal: 'You have a new update in Football Player Parents.',
    route: 'messages',
  },
  parent_poll: {
    detailed: 'A Parent poll is ready to view.',
    minimal: 'A new poll is available.',
    route: 'polls',
  },
})

function normalize(value) {
  return String(value ?? '').trim()
}

export function isInstallationId(value) {
  return INSTALLATION_ID_PATTERN.test(normalize(value))
}

export function isExpoPushToken(value) {
  const token = normalize(value)
  return token.length <= 512 && EXPO_PUSH_TOKEN_PATTERN.test(token)
}

export function normalizeDetailLevel(value) {
  return normalize(value).toLowerCase() === 'detailed' ? 'detailed' : 'minimal'
}

export function requireParentFixture(result) {
  if (normalize(result?.profile?.role) !== 'parent_portal') {
    throw Object.assign(new Error('parent_authority_required'), { status: 403 })
  }
  return result
}

export async function callAuthenticatedRpc(result, name, body) {
  const response = await fetch(`${result.environment.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      ...result.headers,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(normalize(payload?.message) || 'parent_push_request_failed')
    error.status = response.status === 401 ? 401 : response.status === 403 ? 403 : 400
    throw error
  }

  return payload
}

export function buildParentPushMessage(intentType, detailLevel) {
  const intent = PARENT_PUSH_INTENTS[normalize(intentType)]
  if (!intent) {
    throw Object.assign(new Error('unsupported_parent_notification_intent'), { status: 400 })
  }
  const normalizedDetail = normalizeDetailLevel(detailLevel)

  return {
    body: intent[normalizedDetail],
    data: {
      app: 'parent',
      intentType: normalize(intentType),
      route: intent.route,
    },
    sound: 'default',
    title: 'Football Player Parents',
  }
}

export async function sendAllowedParentPush({ detailLevel, expoPushToken, intentType }) {
  if (!isExpoPushToken(expoPushToken)) {
    throw Object.assign(new Error('allowed_push_token_unavailable'), { status: 409 })
  }

  const message = buildParentPushMessage(intentType, detailLevel)
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'accept-encoding': 'gzip, deflate',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...message,
      to: expoPushToken,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  const ticket = Array.isArray(payload?.data) ? payload.data[0] : payload?.data
  const sent = response.ok && ticket?.status === 'ok'

  return {
    receiptId: sent ? normalize(ticket?.id) : '',
    resultCategory: sent ? 'sent' : 'failed',
    sent,
  }
}
