import process from 'node:process'
import { Resend } from 'resend'
import { supabaseAdmin } from './_supabase.js'
import {
  getFailedEmailLogs,
  getStoredResendPayload,
  lockEmailLogForRetry,
  markEmailLogFailed,
  markEmailLogSent,
  unlockEmailLogForRetry,
} from './_email-log-store.js'

void supabaseAdmin

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function failureResponse(statusCode, message) {
  return jsonResponse(statusCode, { success: false, message })
}

function getMissingEnvVars() {
  return ['RESEND_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL'].filter(
    (envName) => !process.env[envName],
  )
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  const missingEnvVars = getMissingEnvVars()

  if (missingEnvVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`)
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const failedEmailLogs = await getFailedEmailLogs()
  const summary = {
    scanned: failedEmailLogs.length,
    retried: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  }

  for (const emailLog of failedEmailLogs) {
    if (Number(emailLog.attempts ?? 0) >= 3) {
      continue
    }

    const lockedEmailLog = await lockEmailLogForRetry(emailLog)

    if (!lockedEmailLog) {
      summary.skipped += 1
      continue
    }

    summary.retried += 1

    try {
      const resendPayload = getStoredResendPayload(lockedEmailLog)
      const response = await resend.emails.send(resendPayload)
      await markEmailLogSent(lockedEmailLog, response)
      summary.success += 1
    } catch (error) {
      console.error('Email retry failed', error)
      await markEmailLogFailed(lockedEmailLog, error)
      summary.failed += 1
    } finally {
      await unlockEmailLogForRetry(lockedEmailLog)
    }
  }

  return jsonResponse(200, { success: true, ...summary })
}
