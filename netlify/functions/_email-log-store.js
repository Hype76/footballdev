import process from 'node:process'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

let emailLogClient

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY

  return { url, key }
}

function getEmailLogClient() {
  if (emailLogClient) {
    return emailLogClient
  }

  const { url, key } = getSupabaseConfig()

  if (!url || !key) {
    return null
  }

  emailLogClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return emailLogClient
}

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
  const client = getEmailLogClient()

  if (!client) {
    return { record: null, skipped: false }
  }

  const { data: existingRecord, error: selectError } = await client
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
    const { data, error } = await client
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

  const { data, error } = await client
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
      const { data: duplicateRecord, error: duplicateSelectError } = await client
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
  const client = getEmailLogClient()

  if (!client || !record?.id) {
    return
  }

  const attempts = Number(record.attempts ?? 0) + 1
  const { error } = await client
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
  const client = getEmailLogClient()

  if (!client || !record?.id) {
    return
  }

  const attempts = Number(record.attempts ?? 0) + 1
  const { error: updateError } = await client
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
  const client = getEmailLogClient()

  if (!client) {
    return []
  }

  const now = new Date().toISOString()
  const { data, error } = await client
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
  const client = getEmailLogClient()

  if (!client || !emailLog?.id) {
    return null
  }

  const { data, error } = await client
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
  const client = getEmailLogClient()

  if (!client || !emailLog?.id) {
    return
  }

  const { error } = await client
    .from('email_logs')
    .update({ is_processing: false })
    .eq('id', emailLog.id)

  if (error) {
    console.error('Email retry unlock failed', error)
  }
}
