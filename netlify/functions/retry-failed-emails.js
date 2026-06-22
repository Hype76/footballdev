import process from 'node:process'
import { supabaseAdmin } from './_supabase.js'
import { sendEmail } from './_email-provider.js'
import {
  getFailedEmailLogs,
  getStoredResendPayload,
  lockEmailLogForRetry,
  markEmailLogFailed,
  markEmailLogSent,
  unlockEmailLogForRetry,
} from './_email-log-store.js'
import {
  assertPlanFeature,
  getClubPlanProfile,
} from './_plan-gate.js'

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
      const requiredFeature = String(lockedEmailLog.payload?.requiredFeature ?? '').trim()
      const clubId = String(lockedEmailLog.payload?.clubId ?? '').trim()

      if (requiredFeature && clubId) {
        const planProfile = {
          ...await getClubPlanProfile(clubId),
          role: 'system',
          roleRank: 100,
        }
        assertPlanFeature(planProfile, requiredFeature)
      }

      const resendPayload = getStoredResendPayload(lockedEmailLog)
      const response = await sendEmail(resendPayload, {
        context: {
          emailType: String(lockedEmailLog.payload?.requiredFeature || 'retry_failed_email'),
          actorId: String(lockedEmailLog.payload?.actorId || ''),
          actorEmail: String(lockedEmailLog.payload?.actorEmail || ''),
          clubId,
          teamId: String(lockedEmailLog.payload?.teamId || ''),
          targetEntityType: 'email_log',
          targetEntityId: lockedEmailLog.id,
        },
        publicMessage: 'Email retry could not be sent. Please try again in a moment.',
      })
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
