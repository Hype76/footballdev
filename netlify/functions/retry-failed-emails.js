import process from 'node:process'
import { Resend } from 'resend'
import {
  getFailedEmailLogs,
  getStoredResendPayload,
  lockEmailLogForRetry,
  markEmailLogFailed,
  markEmailLogSent,
  unlockEmailLogForRetry,
} from './_email-log-store.js'

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  if (!process.env.RESEND_API_KEY) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Email service is not configured' }),
    }
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

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(summary),
  }
}
