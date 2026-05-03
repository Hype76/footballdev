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

export async function createPendingEmailLog({ recipients, subject, payload, dedupeKey }) {
  const client = getEmailLogClient()

  if (!client) {
    return { record: null, skipped: false }
  }

  const { data: existingRecord, error: selectError } = await client
    .from('email_logs')
    .select('id, status, attempts')
    .eq('dedupe_key', dedupeKey)
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
      })
      .eq('id', existingRecord.id)
      .select('id, status, attempts')
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
      to_email: recipients.join(', '),
      subject,
      status: 'pending',
      attempts: 0,
      payload,
    })
    .select('id, status, attempts')
    .single()

  if (error) {
    if (error.code === '23505') {
      const { data: duplicateRecord, error: duplicateSelectError } = await client
        .from('email_logs')
        .select('id, status, attempts')
        .eq('dedupe_key', dedupeKey)
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

  const { data, error } = await client
    .from('email_logs')
    .select('id, attempts, payload')
    .eq('status', 'failed')
    .lt('attempts', 3)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('Failed email log fetch failed', error)
    return []
  }

  return data ?? []
}
