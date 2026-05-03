import process from 'node:process'
import { Resend } from 'resend'
import {
  getFailedEmailLogs,
  markEmailLogFailed,
  markEmailLogSent,
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
    retried: 0,
    success: 0,
    failed: 0,
  }

  for (const emailLog of failedEmailLogs) {
    if (Number(emailLog.attempts ?? 0) >= 3) {
      continue
    }

    summary.retried += 1

    try {
      const response = await resend.emails.send(emailLog.payload)
      await markEmailLogSent(emailLog, response)
      summary.success += 1
    } catch (error) {
      console.error('Email retry failed', error)
      await markEmailLogFailed(emailLog, error)
      summary.failed += 1
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(summary),
  }
}
