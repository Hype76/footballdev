import { createHash, randomUUID } from 'node:crypto'
import { supabaseAdmin } from './_supabase.js'
import {
  EMAIL_RETRY_POLICY_VERSION,
  MAX_EMAIL_DELIVERY_ATTEMPTS,
  classifyEmailFailure,
  getNextEmailRetryAt,
  getProviderMessageId,
} from './_email-retry-policy.js'

const DUPLICATE_SEND_LIMIT = 3
const DUPLICATE_SEND_WINDOW_MS = 5 * 60 * 1000

function getPayloadReplyTo(payload) {
  return payload.replyTo ?? payload.reply_to
}

function normalizeResendPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {}
  }

  if (!payload.reply_to || payload.replyTo) {
    return payload
  }

  const { reply_to, ...rest } = payload
  return {
    ...rest,
    replyTo: reply_to,
  }
}

export function createEmailDedupeKey(payload) {
  return createHash('sha256')
    .update(JSON.stringify({
      from: payload.from,
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      replyTo: getPayloadReplyTo(payload),
      subject: payload.subject,
      html: payload.html,
    }))
    .digest('hex')
}

export function createEmailRecipientDedupeKey({ payload, recipient }) {
  return createHash('sha256')
    .update(JSON.stringify({
      recipient: String(recipient ?? '').trim().toLowerCase(),
      from: payload.from,
      cc: payload.cc,
      replyTo: getPayloadReplyTo(payload),
      subject: payload.subject,
      html: payload.html,
    }))
    .digest('hex')
}

export function createEmailRecipientDedupeKeys({ payload, recipients }) {
  return Array.from(
    new Set(
      (Array.isArray(recipients) ? recipients : [])
        .map((recipient) => createEmailRecipientDedupeKey({ payload, recipient }))
        .filter(Boolean),
    ),
  )
}

export function createEmailIdempotencyKey({ payload, idempotencySeed }) {
  return createHash('sha256')
    .update(JSON.stringify({
      seed: idempotencySeed || null,
      from: payload.from,
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      replyTo: getPayloadReplyTo(payload),
      subject: payload.subject,
      html: payload.html,
    }))
    .digest('hex')
}

export function getStoredResendPayload(emailLog) {
  return normalizeResendPayload(emailLog?.payload?.resendPayload || emailLog?.payload || {})
}

export async function createPendingEmailLog({
  recipients,
  subject,
  payload,
  dedupeKey,
  recipientDedupeKeys = [],
  idempotencyKey,
  retryEnabled = true,
  retryPending = false,
}) {
  const normalizedRecipientDedupeKeys = Array.from(
    new Set((Array.isArray(recipientDedupeKeys) ? recipientDedupeKeys : []).map((key) => String(key ?? '').trim()).filter(Boolean)),
  )

  if (normalizedRecipientDedupeKeys.length > 0) {
    const duplicateWindowStart = new Date(Date.now() - DUPLICATE_SEND_WINDOW_MS).toISOString()
    const { data: recentEvents, error: duplicateCountError } = await supabaseAdmin
      .from('email_send_events')
      .select('dedupe_key')
      .in('dedupe_key', normalizedRecipientDedupeKeys)
      .gte('created_at', duplicateWindowStart)

    if (duplicateCountError) {
      console.error('Email duplicate count failed', duplicateCountError)
    } else {
      const sendCounts = new Map()

      ;(recentEvents ?? []).forEach((event) => {
        const key = String(event.dedupe_key ?? '').trim()
        sendCounts.set(key, (sendCounts.get(key) ?? 0) + 1)
      })

      if (normalizedRecipientDedupeKeys.some((key) => (sendCounts.get(key) ?? 0) >= DUPLICATE_SEND_LIMIT)) {
        return {
          record: null,
          blocked: true,
          retryAfterSeconds: Math.ceil(DUPLICATE_SEND_WINDOW_MS / 1000),
        }
      }
    }
  }

  const { data: existingRecord, error: selectError } = await supabaseAdmin
    .from('email_logs')
    .select('id, status, attempts, payload, idempotency_key, retry_enabled, legacy_review_required')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (selectError) {
    console.error('Email log lookup failed', selectError)
    return { record: null, skipped: false }
  }

  if (existingRecord?.status === 'sent' || (existingRecord?.status === 'pending' && !retryPending)) {
    return { record: existingRecord, skipped: true }
  }

  if (existingRecord?.legacy_review_required) {
    return { record: existingRecord, blocked: true, legacyReviewRequired: true }
  }

  if (existingRecord) {
    const { data, error } = await supabaseAdmin
      .from('email_logs')
      .update({
        status: 'pending',
        last_error: null,
        payload,
        subject,
        to_email: recipients.join(', '),
        is_processing: false,
        next_retry_at: null,
        delivery_state: 'queued',
        retry_enabled: retryEnabled,
        legacy_review_required: false,
        retry_policy_version: EMAIL_RETRY_POLICY_VERSION,
        failure_category: null,
        safe_error_code: null,
        terminal_at: null,
      })
      .eq('id', existingRecord.id)
      .select('id, status, attempts, payload, idempotency_key, retry_enabled, legacy_review_required')
      .single()

    if (error) {
      console.error('Email log update failed', error)
      return { record: existingRecord, skipped: false }
    }

    return { record: data, skipped: false }
  }

  const { data, error } = await supabaseAdmin
    .from('email_logs')
    .insert({
      dedupe_key: dedupeKey,
      idempotency_key: idempotencyKey,
      to_email: recipients.join(', '),
      subject,
      status: 'pending',
      attempts: 0,
      payload,
      is_processing: false,
      next_retry_at: null,
      delivery_state: 'queued',
      retry_enabled: retryEnabled,
      legacy_review_required: false,
      retry_policy_version: EMAIL_RETRY_POLICY_VERSION,
    })
    .select('id, status, attempts, payload, idempotency_key, retry_enabled, legacy_review_required')
    .single()

  if (error) {
    if (error.code === '23505') {
      const { data: duplicateRecord, error: duplicateSelectError } = await supabaseAdmin
        .from('email_logs')
        .select('id, status, attempts, payload, idempotency_key, retry_enabled, legacy_review_required')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()

      if (!duplicateSelectError && duplicateRecord) {
        return { record: duplicateRecord, skipped: duplicateRecord.status !== 'failed' }
      }
    }

    console.error('Email log insert failed', error)
    return { record: null, skipped: false }
  }

  return { record: data, skipped: false }
}

export async function markEmailLogSent(record, response, { recipientDedupeKeys = [] } = {}) {
  if (!record?.id) {
    return
  }

  const attempts = Number(record.attempts ?? 0) + 1
  const { error } = await supabaseAdmin
    .from('email_logs')
    .update({
      status: 'sent',
      attempts,
      last_error: null,
      is_processing: false,
      next_retry_at: null,
      delivery_state: 'provider_accepted',
      provider_message_id: getProviderMessageId(response),
      provider_accepted_at: new Date().toISOString(),
      failure_category: null,
      safe_error_code: null,
      lease_owner: null,
      leased_at: null,
      lease_expires_at: null,
    })
    .eq('id', record.id)

  if (error) {
    console.error('Email log sent update failed', error)
    return
  }

  const { error: telemetryError } = await supabaseAdmin
    .from('email_delivery_jobs')
    .update({ next_retry_at: null })
    .eq('email_log_id', record.id)

  if (telemetryError) {
    console.warn('Email delivery retry telemetry clear failed', {
      code: String(telemetryError.code || 'EMAIL_TELEMETRY_FAILED'),
    })
  }

  const eventRows = Array.from(
    new Set((Array.isArray(recipientDedupeKeys) ? recipientDedupeKeys : []).map((key) => String(key ?? '').trim()).filter(Boolean)),
  ).map((dedupeKey) => ({
    email_log_id: record.id,
    dedupe_key: dedupeKey,
  }))

  if (eventRows.length > 0) {
    const { error: eventError } = await supabaseAdmin
      .from('email_send_events')
      .insert(eventRows)

    if (eventError) {
      console.error('Email send event logging failed', eventError)
    }
  }

  void response
}

export async function markEmailLogFailed(record, error) {
  if (!record?.id) {
    return
  }

  const attempts = Number(record.attempts ?? 0) + 1
  const failure = classifyEmailFailure(error)
  const retryAllowed = failure.retryable
    && record.retry_enabled !== false
    && record.legacy_review_required !== true
    && attempts < MAX_EMAIL_DELIVERY_ATTEMPTS
  const nextRetryAt = retryAllowed ? getNextEmailRetryAt(attempts) : null
  const { error: updateError } = await supabaseAdmin
    .from('email_logs')
    .update({
      status: 'failed',
      attempts,
      last_error: 'Email delivery failed.',
      is_processing: false,
      next_retry_at: nextRetryAt,
      delivery_state: retryAllowed ? 'retrying' : 'failed',
      failure_category: failure.category,
      safe_error_code: failure.safeCode,
      terminal_at: retryAllowed ? null : new Date().toISOString(),
      lease_owner: null,
      leased_at: null,
      lease_expires_at: null,
    })
    .eq('id', record.id)

  if (updateError) {
    console.error('Email log failed update failed', updateError)
    return
  }

  const { error: telemetryError } = await supabaseAdmin
    .from('email_delivery_jobs')
    .update({ next_retry_at: nextRetryAt })
    .eq('email_log_id', record.id)

  if (telemetryError) {
    console.warn('Email delivery retry telemetry update failed', {
      code: String(telemetryError.code || 'EMAIL_TELEMETRY_FAILED'),
    })
  }
}

export async function getFailedEmailLogs({ limit = 25 } = {}) {
  const workerInvocationId = randomUUID()
  const { data, error } = await supabaseAdmin.rpc('claim_email_retry_jobs_v1', {
    target_worker_invocation_id: workerInvocationId,
    lease_seconds: 120,
    batch_limit: limit,
  })

  if (error) {
    console.error('Failed email log fetch failed', error)
    return []
  }

  return (data ?? []).map((row) => ({ ...row, workerInvocationId }))
}

export async function lockEmailLogForRetry(emailLog) {
  if (!emailLog?.id) {
    return null
  }

  return emailLog
}

export async function unlockEmailLogForRetry(emailLog) {
  if (!emailLog?.id) {
    return
  }

  const { error } = await supabaseAdmin
    .from('email_logs')
    .update({
      is_processing: false,
      lease_owner: null,
      leased_at: null,
      lease_expires_at: null,
    })
    .eq('id', emailLog.id)
    .eq('lease_owner', emailLog.workerInvocationId || emailLog.lease_owner)

  if (error) {
    console.error('Email retry unlock failed', error)
  }
}

export async function createServerAuditLog({ action, entityType, entityId, metadata = {} }) {
  if (!action || !entityType) {
    return
  }

  const { error } = await supabaseAdmin.from('audit_logs').insert({
    club_id: null,
    actor_id: null,
    actor_name: '',
    actor_email: '',
    actor_role_label: '',
    actor_role_rank: 0,
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    metadata,
  })

  if (error) {
    console.error('Email audit logging failed', error)
  }
}
