import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { supabaseAdmin } from './lib/_supabase.js'
import { sendEmail } from './lib/_email-provider.js'
import {
  authorizeNativeScheduledRequest,
  authorizeProcessorRequest,
} from './lib/_processor-auth.js'
import { ensureResendWebhookConfigured } from './configure-resend-webhook.js'
import {
  getFailedEmailLogs,
  getStoredResendPayload,
  lockEmailLogForRetry,
  markEmailLogFailed,
  markEmailLogSent,
  unlockEmailLogForRetry,
} from './lib/_email-log-store.js'
import {
  assertPlanFeature,
  getClubPlanProfile,
} from './lib/_plan-gate.js'
import { reauthorizePreparedDevelopmentParentEmail } from './lib/_development-parent-email-output.js'

void supabaseAdmin

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function getMissingEnvVars() {
  return ['RESEND_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL'].filter(
    (envName) => !process.env[envName],
  )
}

export async function processFailedEmails() {
  const missingEnvVars = getMissingEnvVars()

  if (missingEnvVars.length > 0) {
    return {
      statusCode: 503,
      payload: { success: false, message: 'Retry processor is not configured.' },
    }
  }

  try {
    await ensureResendWebhookConfigured()
  } catch (error) {
    console.error('resend_webhook_configuration_failed', {
      code: String(error?.code || error?.name || 'resend_webhook_configuration_failed'),
    })
    return {
      statusCode: 503,
      payload: {
        success: false,
        message: 'Email delivery verification is not configured.',
      },
    }
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
    const lockedEmailLog = await lockEmailLogForRetry(emailLog)

    if (!lockedEmailLog) {
      summary.skipped += 1
      continue
    }

    summary.retried += 1

    try {
      const requiredFeature = String(lockedEmailLog.payload?.requiredFeature ?? '').trim()
      const clubId = String(lockedEmailLog.payload?.clubId ?? '').trim()
      let planProfile = null

      if (requiredFeature && clubId) {
        planProfile = {
          ...await getClubPlanProfile(clubId),
          role: 'system',
          roleRank: 100,
        }
        assertPlanFeature(planProfile, requiredFeature)
      }

      const storedResendPayload = getStoredResendPayload(lockedEmailLog)
      const authorizedPreparedEmail = await reauthorizePreparedDevelopmentParentEmail(
        supabaseAdmin,
        {
          emailPayload: storedResendPayload,
          planProfile,
          recipients: storedResendPayload.to,
          storedPayload: lockedEmailLog.payload,
        },
      )
      const resendPayload = authorizedPreparedEmail.emailPayload
      const response = await sendEmail(resendPayload, {
        idempotencyKey: `fp-retry-${lockedEmailLog.idempotency_key || lockedEmailLog.id}`,
        context: {
          emailType: String(lockedEmailLog.payload?.requiredFeature || 'retry_failed_email'),
          actorId: String(lockedEmailLog.payload?.actorId || ''),
          actorEmail: String(lockedEmailLog.payload?.actorEmail || ''),
          clubId,
          teamId: String(lockedEmailLog.payload?.teamId || ''),
          targetEntityType: 'email_log',
          targetEntityId: lockedEmailLog.id,
          emailLogId: lockedEmailLog.id,
          deliveryTelemetry: {
            ...(lockedEmailLog.payload?.deliveryTelemetry || {}),
            logicalKey: `email_log:${lockedEmailLog.id}`,
            sourceType: 'email_log',
            sourceId: lockedEmailLog.id,
            emailLogId: lockedEmailLog.id,
            originActionAt: lockedEmailLog.payload?.deliveryTelemetry?.originActionAt
              || lockedEmailLog.created_at,
            eligibleAt: lockedEmailLog.next_retry_at || new Date().toISOString(),
            claimedAt: new Date().toISOString(),
            processingStartedAt: new Date().toISOString(),
            workerInvocationId: lockedEmailLog.workerInvocationId || randomUUID(),
          },
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

  return {
    statusCode: 200,
    payload: { success: true, ...summary },
  }
}

export async function handler(event) {
  const authorization = authorizeProcessorRequest(event)

  if (!authorization.ok) {
    return authorization.response
  }

  const result = await processFailedEmails()
  return jsonResponse(result.statusCode, result.payload)
}

export const config = {
  schedule: '* * * * *',
}

export default async function scheduledHandler(request) {
  const authorization = await authorizeNativeScheduledRequest(request)

  if (!authorization.ok) {
    return authorization.response
  }

  const result = await processFailedEmails()
  return Response.json(result.payload, { status: result.statusCode })
}
