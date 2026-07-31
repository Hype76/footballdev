const RETRY_DELAYS_MS = Object.freeze([
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
])

export const EMAIL_RETRY_POLICY_VERSION = 1
export const MAX_EMAIL_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length + 1

function normalizeCode(error) {
  return String(error?.code || error?.name || 'email_delivery_failed')
    .trim()
    .toLowerCase()
    .slice(0, 100)
}

function getStatus(error) {
  const status = Number(
    error?.providerStatus
    ?? error?.status
    ?? error?.statusCode
    ?? error?.response?.status,
  )

  return Number.isFinite(status) && status > 0 ? status : null
}

export function getEmailRetryDelayMs(attemptNumber) {
  const normalizedAttempt = Number(attemptNumber)

  if (!Number.isInteger(normalizedAttempt) || normalizedAttempt < 1) {
    return null
  }

  return RETRY_DELAYS_MS[normalizedAttempt - 1] ?? null
}

export function getNextEmailRetryAt(attemptNumber, now = Date.now()) {
  const delayMs = getEmailRetryDelayMs(attemptNumber)
  return delayMs === null ? null : new Date(Number(now) + delayMs).toISOString()
}

export function classifyEmailFailure(error) {
  const code = normalizeCode(error)
  const status = getStatus(error)
  const message = String(error?.message || '').toLowerCase()

  if (
    status === 401
    || status === 403
    || /auth|permission|forbidden|plan_feature/.test(code)
    || /not authorised|not authorized/.test(message)
  ) {
    return { category: 'non_retryable_authorization', retryable: false, safeCode: code }
  }

  if (
    /cancel|revok|event_closed|event_started/.test(code)
    || /cancelled|canceled|revoked|event has started/.test(message)
  ) {
    return { category: 'non_retryable_cancelled', retryable: false, safeCode: code }
  }

  if (
    /recipient|invalid_email|email_invalid|email_to_invalid|not_found/.test(code)
    || /recipient.*invalid|invalid.*recipient|email address.*invalid/.test(message)
  ) {
    return { category: 'non_retryable_recipient', retryable: false, safeCode: code }
  }

  if (
    status === 400
    || status === 404
    || status === 422
    || /malformed|invalid_payload|validation|missing_required|invalid_parameter|email_from_invalid/.test(code)
  ) {
    return { category: 'non_retryable_malformed_payload', retryable: false, safeCode: code }
  }

  if (
    ['40001', '40p01', '53300', '57p01', '57p02', '57p03'].includes(code)
    || /database.*tempor|connection.*database/.test(message)
  ) {
    return { category: 'retryable_database', retryable: true, safeCode: code }
  }

  if (
    ['econnreset', 'econnrefused', 'etimedout', 'enotfound', 'eai_again', 'aborterror'].includes(code)
    || /network|socket|timed out|timeout/.test(message)
  ) {
    return { category: 'retryable_network', retryable: true, safeCode: code }
  }

  if (
    status === 429
    || (status !== null && status >= 500)
    || /rate_limit|application_error|internal_server_error|concurrent_idempotent/.test(code)
  ) {
    return { category: 'retryable_provider', retryable: true, safeCode: code }
  }

  if (status !== null && status >= 400 && status < 500) {
    return { category: 'non_retryable_provider', retryable: false, safeCode: code }
  }

  return { category: 'retryable_transient', retryable: true, safeCode: code }
}

export function getProviderMessageId(response) {
  return String(response?.data?.id || response?.id || '').trim() || null
}
