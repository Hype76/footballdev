import { randomUUID } from 'node:crypto'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeTimestamp(value, fallback = '') {
  const normalizedValue = normalizeText(value)

  if (!normalizedValue) {
    return fallback
  }

  const parsed = new Date(normalizedValue)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString()
}

function safeArray(value) {
  return Array.isArray(value)
    ? value.filter(Boolean)
    : normalizeText(value)
      ? [normalizeText(value)]
      : []
}

function hasPdfAttachment(payload) {
  return safeArray(payload?.attachments).some((attachment) => (
    normalizeText(attachment?.contentType).toLowerCase() === 'application/pdf'
    || normalizeText(attachment?.filename).toLowerCase().endsWith('.pdf')
  ))
}

function getTelemetryContext(context = {}) {
  return context.deliveryTelemetry && typeof context.deliveryTelemetry === 'object'
    ? context.deliveryTelemetry
    : {}
}

function getLogicalKey(context, telemetry) {
  const explicitKey = normalizeText(telemetry.logicalKey)

  if (explicitKey) {
    return explicitKey
  }

  const emailLogId = normalizeText(telemetry.emailLogId || context.emailLogId)

  if (emailLogId) {
    return `email_log:${emailLogId}`
  }

  const sourceType = normalizeText(telemetry.sourceType)
  const sourceId = normalizeText(telemetry.sourceId)

  if (sourceType && sourceId) {
    return `${sourceType}:${sourceId}`
  }

  const targetType = normalizeText(context.targetEntityType)
  const targetId = normalizeText(context.targetEntityId)

  return targetType && targetId
    ? `${normalizeText(context.emailType || 'email')}:${targetType}:${targetId}`
    : ''
}

export function createEmailTelemetryDescriptor({
  context = {},
  payload = {},
  now = new Date(),
} = {}) {
  const telemetry = getTelemetryContext(context)
  const providerRequested = telemetry.providerRequested !== false
  const providerRequestedAt = providerRequested ? now.toISOString() : null
  const currentStageAt = providerRequestedAt || now.toISOString()
  const originActionAt = normalizeTimestamp(
    telemetry.originActionAt,
    currentStageAt,
  )
  const eligibleAt = normalizeTimestamp(
    telemetry.eligibleAt,
    originActionAt,
  )
  const processingStartedAt = normalizeTimestamp(
    telemetry.processingStartedAt,
    currentStageAt,
  )

  return {
    logicalKey: getLogicalKey(context, telemetry) || null,
    sourceType: normalizeText(telemetry.sourceType) || 'direct',
    sourceId: normalizeText(telemetry.sourceId) || null,
    emailLogId: normalizeText(telemetry.emailLogId || context.emailLogId) || null,
    deliveryType: normalizeText(context.emailType || telemetry.deliveryType) || 'unknown',
    clubId: normalizeText(context.clubId || telemetry.clubId) || null,
    teamId: normalizeText(context.teamId || telemetry.teamId) || null,
    recipientCount: safeArray(payload.to).length,
    hasPdf: hasPdfAttachment(payload),
    originActionAt,
    eligibleAt,
    enqueuedAt: normalizeTimestamp(telemetry.enqueuedAt) || null,
    scheduledAt: normalizeTimestamp(telemetry.scheduledAt) || null,
    claimedAt: normalizeTimestamp(telemetry.claimedAt, processingStartedAt),
    processingStartedAt,
    pdfStartedAt: normalizeTimestamp(telemetry.pdfStartedAt) || null,
    pdfFinishedAt: normalizeTimestamp(telemetry.pdfFinishedAt) || null,
    providerRequested,
    providerRequestedAt,
    workerInvocationId: normalizeText(telemetry.workerInvocationId) || randomUUID(),
  }
}

async function getSupabaseClient(supabaseClient) {
  if (supabaseClient) {
    return supabaseClient
  }

  const { supabaseAdmin } = await import('./_supabase.js')
  return supabaseAdmin
}

export async function beginEmailDeliveryAttempt({
  context = {},
  payload = {},
  supabaseClient = null,
} = {}) {
  const descriptor = createEmailTelemetryDescriptor({ context, payload })
  const supabase = await getSupabaseClient(supabaseClient)
  const { data, error } = await supabase.rpc('begin_email_delivery_attempt_v1', {
    telemetry_input: descriptor,
  })

  if (error) {
    throw error
  }

  const attempt = Array.isArray(data) ? data[0] : data

  if (!attempt?.job_id || !attempt?.attempt_id) {
    throw new Error('Email delivery telemetry did not return an attempt.')
  }

  return {
    descriptor,
    jobId: attempt.job_id,
    attemptId: attempt.attempt_id,
    attemptNumber: Number(attempt.attempt_number || 0),
    workerInvocationId: attempt.worker_invocation_id || descriptor.workerInvocationId,
  }
}

function getProviderMessageId(response) {
  return normalizeText(response?.data?.id || response?.id)
}

function getProviderStatus(error) {
  const status = Number(
    error?.providerStatus
    ?? error?.status
    ?? error?.statusCode
    ?? error?.response?.status
    ?? 0,
  )
  return Number.isFinite(status) && status > 0 ? status : null
}

function getFailureCategory(error) {
  const providerStatus = getProviderStatus(error)
  const code = normalizeText(error?.code || error?.name).toLowerCase()

  if (code.includes('pdf')) {
    return 'pdf_failure'
  }

  if (providerStatus === 429 || (providerStatus && providerStatus >= 500)) {
    return 'retryable_provider'
  }

  if (
    code.includes('timeout')
    || code.includes('network')
    || code.includes('fetch')
    || code.includes('connection')
  ) {
    return 'retryable_network'
  }

  if (providerStatus && providerStatus >= 400 && providerStatus < 500) {
    return 'non_retryable_provider'
  }

  return 'provider_failure'
}

function getSafeErrorCode(error) {
  const code = normalizeText(error?.code || error?.name || 'email_provider_failed')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .slice(0, 100)
  return code || 'email_provider_failed'
}

export async function completeEmailDeliveryAttempt({
  attempt,
  error = null,
  response = null,
  supabaseClient = null,
} = {}) {
  if (!attempt?.jobId || !attempt?.attemptId) {
    return
  }

  const supabase = await getSupabaseClient(supabaseClient)
  const providerStatus = error
    ? getProviderStatus(error)
    : 'accepted'
  const providerWasRequested = attempt.descriptor?.providerRequested !== false
  const outcome = error
    ? providerWasRequested
      ? 'failed'
      : 'preparation_failed'
    : 'accepted'
  const { error: updateError } = await supabase.rpc(
    'complete_email_delivery_attempt_v1',
    {
      target_job_id: attempt.jobId,
      target_attempt_id: attempt.attemptId,
      outcome,
      provider_message_id_value: error ? null : getProviderMessageId(response),
      provider_status_value: normalizeText(providerStatus),
      failure_category_value: error ? getFailureCategory(error) : null,
      safe_error_code_value: error ? getSafeErrorCode(error) : null,
      finished_at_value: new Date().toISOString(),
    },
  )

  if (updateError) {
    throw updateError
  }
}

export async function recordEmailPreparationFailure({
  context = {},
  error,
  payload = {},
  supabaseClient = null,
} = {}) {
  const attempt = await beginEmailDeliveryAttempt({
    context: {
      ...context,
      deliveryTelemetry: {
        ...(context.deliveryTelemetry || {}),
        providerRequested: false,
      },
    },
    payload,
    supabaseClient,
  })

  await completeEmailDeliveryAttempt({
    attempt,
    error,
    supabaseClient,
  })

  return attempt
}

function safeMetricNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

export function normalizeOperationalMetrics(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    deliveryType: normalizeText(row.delivery_type) || 'all',
    pendingCount: safeMetricNumber(row.pending_count),
    eligibleCount: safeMetricNumber(row.eligible_count),
    processingCount: safeMetricNumber(row.processing_count),
    retryCount: safeMetricNumber(row.retry_count),
    failedCount: safeMetricNumber(row.failed_count),
    oldestEligibleAgeSeconds: safeMetricNumber(row.oldest_eligible_age_seconds),
    eligibilityToClaimP50Ms: safeMetricNumber(row.eligibility_to_claim_p50_ms),
    eligibilityToClaimP95Ms: safeMetricNumber(row.eligibility_to_claim_p95_ms),
    providerAcceptanceP50Ms: safeMetricNumber(row.provider_acceptance_p50_ms),
    providerAcceptanceP95Ms: safeMetricNumber(row.provider_acceptance_p95_ms),
    pdfDurationP50Ms: safeMetricNumber(row.pdf_duration_p50_ms),
    pdfDurationP95Ms: safeMetricNumber(row.pdf_duration_p95_ms),
  }))
}

export async function getEmailOperationalMetrics({
  supabaseClient = null,
} = {}) {
  const supabase = await getSupabaseClient(supabaseClient)
  const { data, error } = await supabase
    .from('email_delivery_operational_metrics_v1')
    .select('*')
    .order('delivery_type', { ascending: true })

  if (error) {
    throw error
  }

  return normalizeOperationalMetrics(data)
}
