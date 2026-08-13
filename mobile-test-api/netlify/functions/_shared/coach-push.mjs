const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN_PATTERN = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/
const STAFF_ROLES = new Set(['assistant_coach', 'coach', 'manager', 'head_manager', 'admin'])

const normalize = (value) => String(value ?? '').trim()

export function isCoachInstallationId(value) {
  return UUID_PATTERN.test(normalize(value))
}
export function isCoachExpoPushToken(value) {
  const token = normalize(value)
  return token.length <= 512 && TOKEN_PATTERN.test(token)
}

export function normalizeCoachDetailLevel(value) {
  const level = normalize(value).toLowerCase()
  return ['off', 'minimal', 'detailed'].includes(level) ? level : 'minimal'
}

export function requireCoachFixture(result) {
  if (!STAFF_ROLES.has(normalize(result?.profile?.role).toLowerCase())) {
    throw Object.assign(new Error('coach_authority_required'), { status: 403 })
  }
  return result
}

export async function callCoachRpc(result, name, body) {
  const response = await fetch(`${result.environment.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...result.headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(normalize(payload?.message) || 'coach_push_request_failed')
    error.status = response.status === 401 ? 401 : response.status === 403 ? 403 : response.status >= 500 ? 503 : 400
    throw error
  }
  return payload
}
