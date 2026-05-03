import { createHash } from 'node:crypto'
import { supabaseAdmin } from './_supabase.js'

export function createEmailDedupeKey(payload) {
  return createHash('sha256')
    .update(JSON.stringify({
      from: payload.from,
      to: payload.to,
      reply_to: payload.reply_to,
      subject: payload.subject,
      html: payload.html,
    }))
    .digest('hex')
}

export function createEmailIdempotencyKey({ payload, idempotencySeed }) {
  return createHash('sha256')
    .update(JSON.stringify({
      seed: idempotencySeed || null,
      from: payload.from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    }))
    .digest('hex')
}

function getNextRetryDate(attempts) {
  const delayByAttempt = {
    1: 60 * 1000,
    2: 5 * 60 * 1000,
    3: 15 * 60 * 1000,
  }
  const delayMs = delayByAttempt[attempts] ?? delayByAttempt[3]

  return new Date(Date.now() + delayMs).toISOString()
}

export function getStoredResendPayload(emailLog) {
  return emailLog?.payload?.resendPayload || emailLog?.payload || {}
}

export async function createPendingEmailLog({
  recipients,
  subject,
  payload,
  dedupeKey,
  idempotencyKey,
}) {
  const { data: existingRecord, error: selectError } = await supabaseAdmin
    .from('email_logs')
    .select('id, status, attempts, payload')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (selectError) {
    console.error('Email log lookup failed', selectError)
    return { record: null, skipped: false }
  }

  if (existingRecord?.status === 'sent' || existingRecord?.status === 'pending') {
    return { record: existingRecord, skipped: true }
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
      })
      .eq('id', existingRecord.id)
      .select('id, status, attempts, payload')
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
    })
    .select('id, status, attempts, payload')
    .single()

  if (error) {
    if (error.code === '23505') {
      const { data: duplicateRecord, error: duplicateSelectError } = await supabaseAdmin
        .from('email_logs')
        .select('id, status, attempts, payload')
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

export async function markEmailLogSent(record, response) {
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
    })
    .eq('id', record.id)

  if (error) {
    console.error('Email log sent update failed', error)
    return
  }

  if (response) {
    console.log('Email sent', response)
  }
}

export async function markEmailLogFailed(record, error) {
  if (!record?.id) {
    return
  }

  const attempts = Number(record.attempts ?? 0) + 1
  const { error: updateError } = await supabaseAdmin
    .from('email_logs')
    .update({
      status: 'failed',
      attempts,
      last_error: error?.message || String(error),
      is_processing: false,
      next_retry_at: getNextRetryDate(attempts),
    })
    .eq('id', record.id)

  if (updateError) {
    console.error('Email log failed update failed', updateError)
  }
}

export async function getFailedEmailLogs({ limit = 25 } = {}) {
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('email_logs')
    .select('id, attempts, payload, is_processing, next_retry_at')
    .eq('status', 'failed')
    .eq('is_processing', false)
    .lt('attempts', 3)
    .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('Failed email log fetch failed', error)
    return []
  }

  return data ?? []
}

export async function lockEmailLogForRetry(emailLog) {
  if (!emailLog?.id) {
    return null
  }

  const { data, error } = await supabaseAdmin
    .from('email_logs')
    .update({ is_processing: true })
    .eq('id', emailLog.id)
    .eq('status', 'failed')
    .eq('is_processing', false)
    .lt('attempts', 3)
    .select('id, attempts, payload')
    .maybeSingle()

  if (error) {
    console.error('Email retry lock failed', error)
    return null
  }

  return data
}

export async function unlockEmailLogForRetry(emailLog) {
  if (!emailLog?.id) {
    return
  }

  const { error } = await supabaseAdmin
    .from('email_logs')
    .update({ is_processing: false })
    .eq('id', emailLog.id)

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
