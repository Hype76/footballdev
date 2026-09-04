import process from 'node:process'
import { createHash, randomUUID } from 'node:crypto'
import {
  buildDevelopmentParentEmailHtml,
  buildEmailHtml as buildParentEmailHtml,
} from '../../src/lib/email-builder.js'
import { buildPdfBuffer, buildProgressionChartPngBuffer } from '../../src/lib/pdf-builder.js'
import { buildAssessmentPdfDocument } from '../../src/lib/pdf-document.js'
import { buildDevelopmentParentReportContent } from '../../src/lib/development-parent-report-content.js'
import { buildDevelopmentPdfFilename } from '../../src/lib/development-pdf-filename.js'
import {
  normalizeDevelopmentEmailBody,
  resolveDevelopmentEmailOutputPolicy,
} from '../../src/lib/development-email-output-policy.js'
import { isDevelopmentPdfServerEnabled } from '../../src/lib/development-pdf-feature.js'
import { createFromAddress, getPublicEmailErrorMessage, sendEmail } from './lib/_email-provider.js'
import { recordEmailPreparationFailure } from './lib/_email-delivery-telemetry.js'
import {
  createEmailDedupeKey,
  createEmailIdempotencyKey,
  createEmailRecipientDedupeKeys,
  createPendingEmailLog,
  createServerAuditLog,
  markEmailLogFailed,
  markEmailLogSent,
} from './lib/_email-log-store.js'
import { supabaseAdmin } from './lib/_supabase.js'
import {
  assertPlanFeature,
  canUsePlanFeature,
  getAuthenticatedPlanProfile,
} from './lib/_plan-gate.js'
import {
  finalizeDevelopmentParentReportSnapshot,
  createDevelopmentOutputKey,
  createDevelopmentOutputQueueId,
  enrichDevelopmentParentReportWithScores,
  getDevelopmentParentReport,
  getParentVisibleDevelopmentEmailSections,
  getParentVisibleDevelopmentResponses,
  loadDevelopmentParentEmailContext,
  loadDevelopmentParentRecipientCandidates,
  reauthorizePreparedDevelopmentParentEmail,
} from './lib/_development-parent-email-output.js'
import { authorizeAssessmentPdfReport } from './lib/_pdf-report.js'
import {
  assertDevelopmentSubmissionOperation,
  confirmDevelopmentSubmissionOperation,
} from './lib/_development-submission-operation.js'

void supabaseAdmin

const DEMO_EMAIL = 'demo@playerfeedback.online'
const PDF_ATTACHMENT_TIMEOUT_MS = 9_250

function safeReference(value) {
  const normalizedValue = String(value ?? '').trim()

  return normalizedValue
    ? createHash('sha256').update(normalizedValue).digest('hex').slice(0, 12)
    : 'none'
}

function logSafeError(label, error, context = {}) {
  const numericStatusCode = Number(error?.statusCode)

  console.error(label, {
    caller: 'send-parent-email',
    code: String(error?.code || context.code || 'DEVELOPMENT_PARENT_EMAIL_FAILED'),
    errorName: String(error?.name || 'Error'),
    ...(Number.isFinite(numericStatusCode) ? { statusCode: numericStatusCode } : {}),
    ...context,
  })
}

function createDeterministicQueueId(value) {
  const hash = createHash('sha256').update(String(value ?? '')).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function cleanHeaderPart(value, fallback) {
  const cleanedValue = String(value ?? '')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127 && !'<>{}[]"\'`;\\'.includes(character)
    })
    .join('')
    .trim()

  return cleanedValue || fallback
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function successResponse(payload = {}) {
  return jsonResponse(200, { success: true, ...payload })
}

function failureResponse(statusCode, message, code = '') {
  return jsonResponse(statusCode, {
    success: false,
    message,
    ...(code ? { code } : {}),
  })
}

function getMissingEnvVars() {
  return ['RESEND_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL'].filter(
    (envName) => !process.env[envName],
  )
}

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(value ?? '').trim())
}

function normaliseEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function normaliseRecipients(value) {
  if (Array.isArray(value)) {
    return value.map((email) => String(email ?? '').trim()).filter(Boolean)
  }

  return String(value ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
}

function getSenderCopyEmails(senderEmail, recipients) {
  const normalisedRecipients = new Set(recipients.map(normaliseEmail))
  const senderCopyEmail = normaliseEmail(senderEmail)

  if (!senderCopyEmail || !isValidEmail(senderCopyEmail) || normalisedRecipients.has(senderCopyEmail)) {
    return []
  }

  return [senderCopyEmail]
}

function normalizeEmailHtml(html) {
  return String(html ?? '').trim() || '<p>No content</p>'
}

function buildEmailPayload({
  fromName,
  recipients,
  safeReplyTo,
  senderCopyEmails,
  subject,
  emailHtml,
  attachments,
}) {
  const emailPayload = {
    from: createFromAddress(fromName),
    to: recipients,
    replyTo: safeReplyTo || undefined,
    subject: String(subject ?? '').trim() || 'Football Player',
    html: emailHtml,
  }

  if (senderCopyEmails.length > 0) {
    emailPayload.cc = senderCopyEmails
  }

  if (attachments.length > 0) {
    emailPayload.attachments = attachments
  }

  return emailPayload
}

function withTimeout(promise, timeoutMs, errorMessage) {
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId)
  })
}

async function buildPdfAttachment(pdfReport, context = {}) {
  const startedAt = Date.now()
  const diagnostics = context.diagnostics || {}
  Object.assign(diagnostics, {
    caller: 'send-parent-email',
    cleanupState: 'not_started',
    networkRequestCount: 0,
    rendererStage: 'queued',
    workflow: 'email_attachment',
  })
  let pdfBuffer

  try {
    pdfBuffer = await withTimeout(
      buildPdfBuffer(pdfReport.document, {
        branding: pdfReport.branding,
        diagnostics,
      }),
      PDF_ATTACHMENT_TIMEOUT_MS,
      'PDF generation timed out',
    )
  } catch (error) {
    console.error('PDF attachment generation failed', {
      actorRef: safeReference(context.actorId),
      caller: diagnostics.caller,
      cleanupState: diagnostics.cleanupState,
      clubRef: safeReference(context.clubId),
      code: String(error?.code || 'PDF_ATTACHMENT_GENERATION_FAILED'),
      durationMs: Date.now() - startedAt,
      errorName: String(error?.name || 'Error'),
      resourceRef: safeReference(context.resourceId),
      step: diagnostics.rendererStage,
      teamRef: safeReference(context.teamId),
      workflow: diagnostics.workflow,
    })
    throw Object.assign(
      new Error('Email not sent because the requested PDF could not be generated. Retry the PDF attachment.'),
      {
        cause: error,
        code: 'PDF_ATTACHMENT_GENERATION_FAILED',
        publicMessage: 'Email not sent because the requested PDF could not be generated. Retry the PDF attachment.',
        statusCode: 503,
      },
    )
  }

  if (!pdfBuffer?.length) {
    throw Object.assign(new Error('Email not sent because the requested PDF could not be generated. Retry the PDF attachment.'), {
      code: 'PDF_ATTACHMENT_GENERATION_FAILED',
      publicMessage: 'Email not sent because the requested PDF could not be generated. Retry the PDF attachment.',
      statusCode: 503,
    })
  }

  console.info('PDF attachment generation completed', {
    actorRef: safeReference(context.actorId),
    browserLaunchResult: diagnostics.browserLaunchResult,
    browserLaunchDurationMs: Number(diagnostics.browserLaunchDurationMs ?? 0),
    brandingDurationMs: Number(diagnostics.brandingDurationMs ?? 0),
    brandingFallbackReason: diagnostics.brandingFallbackReason || 'none',
    brandingSource: diagnostics.brandingSource || 'fallback',
    caller: diagnostics.caller,
    cleanupState: diagnostics.cleanupState,
    clubRef: safeReference(context.clubId),
    durationMs: Date.now() - startedAt,
    embeddedResourceCount: Number(diagnostics.embeddedResourceCount ?? 0),
    logoConversionDurationMs: Number(diagnostics.logoConversionDurationMs ?? 0),
    logoFetchDurationMs: Number(diagnostics.logoFetchDurationMs ?? 0),
    logoInputBytes: Number(diagnostics.logoInputBytes ?? 0),
    logoOutputBytes: Number(diagnostics.logoOutputBytes ?? 0),
    logoValidationDurationMs: Number(diagnostics.logoValidationDurationMs ?? 0),
    memoryRssBytes: Number(diagnostics.memoryRssBytes ?? 0),
    networkRequestCount: diagnostics.networkRequestCount,
    outputBucket: pdfBuffer.length < 1_000_000 ? 'under-1mb' : '1mb-or-more',
    pageCount: diagnostics.pageCount,
    renderDurationMs: Number(diagnostics.renderDurationMs ?? 0),
    resourceRef: safeReference(context.resourceId),
    step: diagnostics.rendererStage,
    teamRef: safeReference(context.teamId),
    totalRenderDurationMs: Number(diagnostics.totalRenderDurationMs ?? 0),
    workflow: diagnostics.workflow,
  })

  return [
    {
      filename: String(context.filename || 'player-feedback.pdf').trim(),
      content: pdfBuffer.toString('base64'),
      contentType: 'application/pdf',
    },
  ]
}

async function createEmailAuditLog(payload) {
  try {
    await createServerAuditLog(payload)
  } catch (error) {
    logSafeError('Email audit logging failed', error, {
      step: 'audit_log',
      workflow: 'email',
    })
  }
}

async function buildProgressionChartAttachments(chartImages = []) {
  if (!Array.isArray(chartImages) || chartImages.length === 0) {
    return []
  }

  const attachments = []

  for (const chartImage of chartImages.slice(0, 5)) {
    const points = Array.isArray(chartImage?.points) ? chartImage.points : []

    if (points.length < 2) {
      continue
    }

    try {
      const pngBuffer = await withTimeout(
        buildProgressionChartPngBuffer(points),
        10000,
        'Progression chart image generation timed out',
      )

      if (!pngBuffer?.length) {
        continue
      }

      attachments.push({
        filename: String(chartImage.filename || `progression-chart-${attachments.length + 1}.png`).trim(),
        content: pngBuffer.toString('base64'),
        contentType: 'image/png',
        contentId: String(chartImage.contentId || `progression-chart-${attachments.length}`).trim(),
      })
    } catch (error) {
      logSafeError('Progression chart image generation failed', error, {
        step: 'chart_render',
        workflow: 'email_attachment',
      })
    }
  }

  return attachments
}

function buildDevelopmentChartImages(emailSections = [], outputKey = '') {
  const contentSeed = String(outputKey ?? '').trim().slice(0, 24) || 'development-record'

  return emailSections
    .filter((section) => Array.isArray(section?.chartPoints) && section.chartPoints.length >= 2)
    .map((section, index) => ({
      contentId: `${contentSeed}-${index}@footballplayer.online`,
      filename: `player-progression-chart-${index + 1}.png`,
      points: section.chartPoints,
    }))
}

function addDevelopmentChartContentIds(emailSections = [], chartImages = []) {
  let chartIndex = 0

  return emailSections.map((section) => {
    if (!Array.isArray(section?.chartPoints) || section.chartPoints.length < 2) {
      return section
    }

    const nextSection = {
      ...section,
      chartContentId: chartImages[chartIndex]?.contentId || '',
    }
    chartIndex += 1
    return nextSection
  })
}

function parseScheduledAt(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return null
  }

  const parsedDate = new Date(normalizedValue)

  if (Number.isNaN(parsedDate.getTime())) {
    throw Object.assign(new Error('Choose a valid scheduled send date and time.'), { statusCode: 400 })
  }

  return parsedDate
}

function isFutureScheduledDate(dateValue) {
  return dateValue instanceof Date && dateValue.getTime() > Date.now() + 30000
}

export async function prepareParentEmail({ body, requestUser }) {
  const originActionAt = new Date().toISOString()
  const planProfile = requestUser
  assertPlanFeature(planProfile, 'parentEmails')

  const {
    parentEmail,
    displayName,
    teamName,
    clubName,
    replyToEmail,
    clubContactEmail,
    clubEmail,
    subject,
    html: clientHtml,
    pdfDocument,
    logoUrl,
    playerName,
    parentName,
    senderEmail,
  } = body
  const requestedIdempotencyKey = String(body.idempotencyKey ?? '').trim()

  if (requestedIdempotencyKey.length > 200) {
    throw Object.assign(new Error('The email request is not valid.'), { statusCode: 400 })
  }

  const outputPolicy = resolveDevelopmentEmailOutputPolicy(body, {
    developmentPdfEnabled: isDevelopmentPdfServerEnabled(process.env),
  })

  const submissionOperation = await assertDevelopmentSubmissionOperation(
    supabaseAdmin,
    {
      body,
      profile: planProfile,
      outputContext: body.outputContext,
    },
  )

  if (outputPolicy.shouldRejectUnavailableDevelopmentPdf) {
    throw Object.assign(
      new Error('Email not sent because the requested PDF is not available. Retry the PDF attachment.'),
      {
        code: 'DEVELOPMENT_PDF_UNAVAILABLE',
        publicMessage: 'Email not sent because the requested PDF is not available. Retry the PDF attachment.',
        statusCode: 503,
      },
    )
  }

  const normalizedSenderEmail = normaliseEmail(senderEmail)
  const bodyUserId = String(body.userId ?? '').trim()

  if (bodyUserId && bodyUserId !== String(requestUser.id ?? '').trim()) {
    throw Object.assign(new Error('Email can only be sent from your logged-in account.'), { statusCode: 403 })
  }

  if (normalizedSenderEmail && normalizedSenderEmail !== requestUser.email) {
    throw Object.assign(new Error('Email can only be sent from your logged-in account.'), { statusCode: 403 })
  }

  if (requestUser.email === DEMO_EMAIL) {
    throw Object.assign(new Error('Email sending is disabled for the demo account'), { statusCode: 403 })
  }

  const developmentContext = outputPolicy.requiresDevelopmentParentResolution
    ? await loadDevelopmentParentEmailContext(supabaseAdmin, {
        evaluationId: body.evaluationId,
        profile: planProfile,
        selectedParentLinkIds: body.selectedParentLinkIds,
      })
    : null

  if (developmentContext?.outcome === 'no_recipient') {
    return {
      noRecipient: true,
      code: developmentContext.code,
      evaluationId: developmentContext.evaluation?.id || String(body.evaluationId ?? '').trim(),
    }
  }

  const recipients = developmentContext
    ? [developmentContext.recipient.email]
    : normaliseRecipients(parentEmail)

  if (recipients.length === 0) {
    throw Object.assign(new Error('Parent email is required'), { statusCode: 400 })
  }

  if (!recipients.every(isValidEmail)) {
    throw Object.assign(new Error('Parent email must be a valid email address'), { statusCode: 400 })
  }

  if (recipients.length > 5) {
    throw Object.assign(new Error('Too many emails in one request'), { statusCode: 400 })
  }

  if (replyToEmail && !isValidEmail(replyToEmail)) {
    throw Object.assign(new Error('Reply-to email must be a valid email address'), { statusCode: 400 })
  }

  const authoritativeClubName = developmentContext?.club?.name
  const authoritativeTeamName = developmentContext?.team?.name
  const authoritativeReplyTo = developmentContext?.club?.contact_email
  const authoritativeLogoUrl = developmentContext?.club?.logo_url
  const authoritativePlayerName = developmentContext?.evaluation?.player_name || developmentContext?.player?.player_name
  const authoritativeParentName = developmentContext?.recipient?.name
  const senderReplyTo = isValidEmail(normalizedSenderEmail) ? normalizedSenderEmail : ''
  const safeDisplayName = cleanHeaderPart(displayName, 'Coach')
  const safeTeamName = cleanHeaderPart(authoritativeTeamName || teamName, 'Team')
  const safeClubName = cleanHeaderPart(authoritativeClubName || clubName, 'Club')
  const fromName = `${safeDisplayName} (${safeTeamName} - ${safeClubName})`
  const safeReplyTo = cleanHeaderPart(senderReplyTo || authoritativeReplyTo || replyToEmail || clubContactEmail || clubEmail, '')
  const senderCopyEmails = getSenderCopyEmails(senderEmail, recipients)
  const developmentReport = developmentContext
    ? getDevelopmentParentReport({
        context: developmentContext,
        requestedResponses: body.responses,
        requestedSections: body.emailSections,
      })
    : null
  const developmentPdfReport = developmentReport && outputPolicy.shouldAttachPdf
    ? enrichDevelopmentParentReportWithScores(
        developmentReport,
        developmentContext.evaluation,
      )
    : developmentReport
  const developmentContent = developmentReport
    ? buildDevelopmentParentReportContent(developmentReport)
    : null
  const developmentPdfContent = developmentPdfReport
    ? buildDevelopmentParentReportContent(developmentPdfReport)
    : null
  const developmentPdfFilename = developmentPdfReport
    ? buildDevelopmentPdfFilename(developmentPdfReport)
    : 'player-feedback.pdf'
  const authoritativeResponses = developmentReport
    ? developmentReport.responseItems.map((item) => ({
        fieldId: item.fieldId,
        fieldType: item.type,
        label: item.label,
        value: item.displayValue,
      }))
    : developmentContext
      ? getParentVisibleDevelopmentResponses(developmentContext.evaluation, body.responses)
      : body.responses
  const authoritativeEmailSections = developmentReport
    ? developmentReport.emailSections
    : developmentContext
      ? getParentVisibleDevelopmentEmailSections({
          evaluation: developmentContext.evaluation,
          evaluations: developmentContext.evaluations,
          requestedSections: body.emailSections,
        })
      : body.emailSections
  const developmentChartImages = outputPolicy.shouldBuildChartAttachments && developmentContext &&
    !developmentContent
    ? buildDevelopmentChartImages(authoritativeEmailSections, developmentContext.outputKey)
    : []
  const emailSectionsWithChartContent = developmentChartImages.length > 0
    ? addDevelopmentChartContentIds(authoritativeEmailSections, developmentChartImages)
    : authoritativeEmailSections
  const emailHtml = outputPolicy.isDevelopmentEmailOnly
    ? developmentContent
      ? buildDevelopmentParentEmailHtml({
          content: developmentContent,
          parentName: authoritativeParentName || parentName,
          clubLogoUrl: authoritativeLogoUrl || logoUrl,
          origin: 'https://footballplayer.online',
          pdfAttached: outputPolicy.shouldAttachPdf,
        })
      : buildParentEmailHtml({
          parentName: authoritativeParentName || parentName,
          playerName: authoritativePlayerName || playerName,
          teamName: safeTeamName,
          clubName: safeClubName,
          section: developmentContext?.evaluation?.section || body.section,
          session: developmentContext?.evaluation?.session || body.session,
          responses: authoritativeResponses,
          emailSections: developmentContext ? emailSectionsWithChartContent : authoritativeEmailSections,
          emailBody: normalizeDevelopmentEmailBody(body.emailBody),
          clubLogoUrl: authoritativeLogoUrl || logoUrl,
          origin: 'https://footballplayer.online',
          useChartContentIds: developmentChartImages.length > 0,
        })
    : normalizeEmailHtml(clientHtml)

  if (emailHtml.length > 200000) {
    throw Object.assign(new Error('Email content is too large'), { statusCode: 400 })
  }

  const shouldAttachPdf = outputPolicy.shouldAttachPdf
  if (shouldAttachPdf) {
    assertPlanFeature(planProfile, 'pdfReports')
  }

  const chartAttachments = outputPolicy.shouldBuildChartAttachments
    ? developmentContent
      ? []
      : await buildProgressionChartAttachments(
        developmentContext ? developmentChartImages : body.progressionChartImages,
      )
    : []
  const authoritativePdfDocument = shouldAttachPdf
    ? developmentContext
      ? buildAssessmentPdfDocument({
          content: developmentPdfContent,
        })
      : pdfDocument
    : null
  const pdfDiagnostics = shouldAttachPdf ? {} : null
  const authorizedPdfReport = shouldAttachPdf
    ? await authorizeAssessmentPdfReport({
        supabaseAdmin,
        profile: planProfile,
        clubId: planProfile.clubId,
        teamId: developmentContext?.team?.id || body.teamId,
        evaluationId: developmentContext?.evaluation?.id || body.evaluationId,
        playerId: developmentContext?.player?.id || body.playerId,
        document: authoritativePdfDocument,
        diagnostics: pdfDiagnostics,
      })
    : null
  const pdfStartedAt = shouldAttachPdf ? new Date().toISOString() : null
  let pdfFinishedAt = null
  const pdfAttachments = shouldAttachPdf ? await buildPdfAttachment(
        authorizedPdfReport,
        {
          actorId: requestUser.id,
          clubId: planProfile.clubId,
          diagnostics: pdfDiagnostics,
          filename: developmentPdfFilename,
          resourceId: developmentContext?.evaluation?.id || body.evaluationId || body.playerId,
          teamId: developmentContext?.team?.id || body.teamId,
        },
      )
    .catch(async (pdfError) => {
      pdfFinishedAt = new Date().toISOString()

      try {
        const telemetrySourceId = String(
          developmentContext?.evaluation?.id
          || body.evaluationId
          || body.playerId
          || '',
        ).trim()
        await recordEmailPreparationFailure({
          context: {
            clubId: planProfile.clubId,
            emailType: 'development_parent_pdf',
            targetEntityId: telemetrySourceId || null,
            targetEntityType: developmentContext?.evaluation?.id || body.evaluationId
              ? 'evaluation'
              : 'player',
            teamId: developmentContext?.team?.id || body.teamId || null,
            deliveryTelemetry: {
              eligibleAt: originActionAt,
              logicalKey: telemetrySourceId
                ? `development_pdf_preparation:${telemetrySourceId}:${safeReference(requestedIdempotencyKey)}`
                : `development_pdf_preparation:${randomUUID()}`,
              originActionAt,
              pdfFinishedAt,
              pdfStartedAt,
              processingStartedAt: pdfStartedAt,
              sourceId: telemetrySourceId || null,
              sourceType: 'development_pdf_preparation',
            },
          },
          error: pdfError,
          payload: {
            attachments: [{
              contentType: 'application/pdf',
              filename: developmentPdfFilename,
            }],
            to: [],
          },
        })
      } catch (telemetryError) {
        console.warn('Email delivery preparation telemetry failed', {
          code: String(telemetryError?.code || telemetryError?.name || 'EMAIL_TELEMETRY_FAILED'),
        })
      }

      throw pdfError
    })
    .finally(() => {
      pdfFinishedAt ||= new Date().toISOString()
    }) : []

  const attachments = [...pdfAttachments, ...chartAttachments]
  const emailSubject = String(subject ?? '').trim() || 'Football Player'
  const emailPayload = buildEmailPayload({
    fromName,
    recipients,
    safeReplyTo,
    senderCopyEmails,
    subject: emailSubject,
    emailHtml,
    attachments,
  })
  const storedPayload = {
    resendPayload: emailPayload,
    displayName: safeDisplayName,
    teamName: safeTeamName,
    clubName: safeClubName,
    logoUrl: String(authoritativeLogoUrl || logoUrl || '').trim(),
    playerName: String(authoritativePlayerName || playerName || '').trim(),
    playerId: String(developmentContext?.player?.id || body.playerId || '').trim() || null,
    evaluationId: String(developmentContext?.evaluation?.id || body.evaluationId || '').trim() || null,
    parentName: String(authoritativeParentName || parentName || '').trim(),
    clubId: planProfile.clubId,
    teamId: String(developmentContext?.team?.id || body.teamId || '').trim() || null,
    actorId: String(requestUser.id ?? '').trim(),
    actorEmail: requestUser.email,
    actorRole: planProfile.role,
    idempotencyKey: requestedIdempotencyKey,
    requiredFeature: 'parentEmails',
    outputKey: developmentContext?.outputKey || '',
    outputQueueId: developmentContext?.outputQueueId || '',
    recipientLinkId: developmentContext?.recipient?.linkId || '',
    deliveryTelemetry: {
      originActionAt,
      eligibleAt: originActionAt,
      pdfStartedAt,
      pdfFinishedAt,
    },
    communicationLog: body.communicationLog && typeof body.communicationLog === 'object'
      ? {
          ...body.communicationLog,
          metadata: {
            ...(body.communicationLog.metadata && typeof body.communicationLog.metadata === 'object'
              ? body.communicationLog.metadata
              : {}),
            developmentOutputKey: developmentContext?.outputKey || '',
            recipientLinkId: developmentContext?.recipient?.linkId || '',
            submissionOperationId: submissionOperation?.operation_id || '',
          },
        }
      : null,
    submissionOperationId: submissionOperation?.operation_id || '',
  }

  return {
    attachments,
    emailHtml,
    emailPayload,
    emailSubject,
    planProfile,
    recipients,
    senderCopyEmails,
    storedPayload,
  }
}

async function createScheduledEmail({ preparedEmail, scheduledAt }) {
  const authorizedPreparedEmail = await reauthorizePreparedDevelopmentParentEmail(
    supabaseAdmin,
    preparedEmail,
  )
  const outputKey = String(authorizedPreparedEmail.storedPayload.outputKey ?? '').trim()
  const requestIdempotencyKey = String(authorizedPreparedEmail.storedPayload.idempotencyKey ?? '').trim()
  const deterministicQueueId = outputKey
    ? String(authorizedPreparedEmail.storedPayload.outputQueueId ?? '').trim()
    : requestIdempotencyKey
      ? createDeterministicQueueId(`${authorizedPreparedEmail.planProfile.clubId}:${requestIdempotencyKey}`)
      : ''

  if (deterministicQueueId) {
    const { data: existingRow, error: existingError } = await supabaseAdmin
      .from('scheduled_email_queue')
      .select('id, scheduled_at')
      .eq('id', deterministicQueueId)
      .maybeSingle()

    if (existingError) {
      throw new Error('Email queue availability could not be checked.')
    }

    if (existingRow?.id) {
      return {
        ...existingRow,
        duplicate: true,
      }
    }
  }

  const enqueuedAt = new Date().toISOString()
  const queuedPayload = {
    ...authorizedPreparedEmail.storedPayload,
    deliveryTelemetry: {
      ...(authorizedPreparedEmail.storedPayload.deliveryTelemetry || {}),
      eligibleAt: scheduledAt.toISOString(),
      enqueuedAt,
      scheduledAt: scheduledAt.toISOString(),
    },
  }
  const { data, error } = await supabaseAdmin
    .from('scheduled_email_queue')
    .insert({
      ...(deterministicQueueId ? { id: deterministicQueueId } : {}),
      club_id: authorizedPreparedEmail.planProfile.clubId,
      team_id: authorizedPreparedEmail.storedPayload.teamId,
      created_by: authorizedPreparedEmail.storedPayload.actorId || null,
      created_by_email: authorizedPreparedEmail.storedPayload.actorEmail,
      to_email: authorizedPreparedEmail.recipients.join(', '),
      subject: authorizedPreparedEmail.emailSubject,
      status: 'scheduled',
      scheduled_at: scheduledAt.toISOString(),
      payload: queuedPayload,
    })
    .select('id, scheduled_at')
    .single()

  if (error?.code === '23505' && deterministicQueueId) {
    const { data: duplicateRow, error: duplicateError } = await supabaseAdmin
      .from('scheduled_email_queue')
      .select('id, scheduled_at')
      .eq('id', deterministicQueueId)
      .maybeSingle()

    if (!duplicateError && duplicateRow?.id) {
      return {
        ...duplicateRow,
        duplicate: true,
      }
    }
  }

  if (error) {
    logSafeError('Scheduled email queue write failed', error, {
      step: 'queue_write',
      workflow: 'scheduled_email',
    })
    throw new Error('Email could not be added to the queue.')
  }

  await createEmailAuditLog({
    user: null,
    action: 'email_scheduled',
    entityType: 'email',
    entityId: data.id,
    metadata: {
      to: authorizedPreparedEmail.recipients,
      subject: authorizedPreparedEmail.emailSubject,
      clubId: authorizedPreparedEmail.planProfile.clubId,
      teamId: authorizedPreparedEmail.storedPayload.teamId,
      actorId: authorizedPreparedEmail.storedPayload.actorId,
      actorEmail: authorizedPreparedEmail.storedPayload.actorEmail,
      scheduledAt: data.scheduled_at,
      hasAttachment: Boolean(authorizedPreparedEmail.emailPayload.attachments?.length),
    },
  })

  return data
}

async function ensureDevelopmentCommunicationLog(preparedEmail, action) {
  const outputKey = String(preparedEmail?.storedPayload?.outputKey ?? '').trim()
  const log = preparedEmail?.storedPayload?.communicationLog

  if (!outputKey || !log || typeof log !== 'object' || !log.clubId || !log.userId) {
    return null
  }

  const findExistingLog = async () => {
    const { data, error } = await supabaseAdmin
      .from('communication_logs')
      .select('id, club_id')
      .eq('action', action)
      .eq('metadata->>developmentOutputKey', outputKey)
      .maybeSingle()

    if (error) {
      throw error
    }

    return data
  }
  const existingLog = await findExistingLog()
  if (existingLog?.id) {
    return {
      ...existingLog,
      duplicate: true,
    }
  }

  const { data, error } = await supabaseAdmin
    .from('communication_logs')
    .insert({
      club_id: log.clubId,
      player_id: log.playerId || null,
      evaluation_id: log.evaluationId || null,
      user_id: log.userId,
      user_name: String(log.userName ?? '').trim(),
      user_email: String(log.userEmail ?? '').trim().toLowerCase(),
      channel: 'email',
      action,
      recipient_email: preparedEmail.recipients.join(', '),
      metadata: {
        ...(log.metadata && typeof log.metadata === 'object' ? log.metadata : {}),
        developmentOutputKey: outputKey,
        recipientLinkId: preparedEmail.storedPayload.recipientLinkId || '',
        submissionOperationId: preparedEmail.storedPayload.submissionOperationId || '',
      },
    })
    .select('id, club_id')
    .single()

  if (error?.code === '23505') {
    const duplicateLog = await findExistingLog()
    if (duplicateLog?.id) {
      return {
        ...duplicateLog,
        duplicate: true,
      }
    }
  }

  if (error) {
    throw error
  }

  return {
    ...data,
    duplicate: false,
  }
}

async function findExistingDevelopmentOutput({
  body,
  profile,
  scheduledAt,
} = {}) {
  if (String(body.outputContext ?? '').trim() !== 'development_record') {
    return null
  }

  const selectedParentLinkIds = Array.isArray(body.selectedParentLinkIds)
    ? [...new Set(body.selectedParentLinkIds.map((value) => String(value ?? '').trim()).filter(Boolean))]
    : []
  const evaluationId = String(body.evaluationId ?? '').trim()

  if (!evaluationId || selectedParentLinkIds.length !== 1) {
    return null
  }

  await assertDevelopmentSubmissionOperation(
    supabaseAdmin,
    {
      body,
      profile,
      outputContext: body.outputContext,
    },
  )

  const outputKey = createDevelopmentOutputKey(evaluationId, selectedParentLinkIds[0])
  const action = scheduledAt ? 'parent_email_scheduled' : 'parent_email_sent'
  const logQuery = supabaseAdmin
    .from('communication_logs')
    .select('id')
    .eq('action', action)
    .eq('metadata->>developmentOutputKey', outputKey)
    .maybeSingle()

  if (scheduledAt) {
    const queueId = createDevelopmentOutputQueueId(outputKey)
    const [{ data: queueRow, error: queueError }, { data: communicationLog, error: logError }] = await Promise.all([
      supabaseAdmin
        .from('scheduled_email_queue')
        .select('id, scheduled_at')
        .eq('id', queueId)
        .maybeSingle(),
      logQuery,
    ])

    if (queueError || logError) {
      throw queueError || logError
    }

    return queueRow?.id
      ? {
          scheduled: true,
          duplicate: true,
          communicationLogId: communicationLog?.id || '',
          communicationLogDuplicate: Boolean(communicationLog?.id),
          queueId: queueRow.id,
          scheduledAt: queueRow.scheduled_at,
          recipientLinkId: selectedParentLinkIds[0],
        }
      : null
  }

  const [{ data: emailLog, error: emailLogError }, { data: communicationLog, error: logError }] = await Promise.all([
    supabaseAdmin
      .from('email_logs')
      .select('id, status')
      .eq('idempotency_key', outputKey)
      .eq('status', 'sent')
      .maybeSingle(),
    logQuery,
  ])

  if (emailLogError || logError) {
    throw emailLogError || logError
  }

  return emailLog?.id
    ? {
        duplicate: true,
        communicationLogId: communicationLog?.id || '',
        communicationLogDuplicate: Boolean(communicationLog?.id),
        recipientLinkId: selectedParentLinkIds[0],
      }
    : null
}

export async function sendPreparedParentEmail(
  preparedEmail,
  {
    deliveryTelemetry = {},
    idempotencySeed = '',
    retryOwner = 'email_log',
    retryPending = false,
  } = {},
) {
  preparedEmail = await reauthorizePreparedDevelopmentParentEmail(supabaseAdmin, preparedEmail)
  let emailLogRecord = null
  const dedupeKey = createEmailDedupeKey(preparedEmail.emailPayload)
  const recipientDedupeKeys = createEmailRecipientDedupeKeys({
    payload: preparedEmail.emailPayload,
    recipients: preparedEmail.recipients,
  })
  const finalIdempotencyKey = preparedEmail.storedPayload.outputKey || createEmailIdempotencyKey({
    payload: preparedEmail.emailPayload,
    idempotencySeed: idempotencySeed || `parent-email:${randomUUID()}`,
  })
  const pendingLogResult = await createPendingEmailLog({
    recipients: preparedEmail.recipients,
    subject: preparedEmail.emailSubject,
    payload: preparedEmail.storedPayload,
    dedupeKey,
    recipientDedupeKeys,
    idempotencyKey: finalIdempotencyKey,
    retryEnabled: retryOwner === 'email_log',
    retryPending,
  })

  emailLogRecord = pendingLogResult.record

  if (pendingLogResult.legacyReviewRequired) {
    throw Object.assign(
      new Error('This legacy email requires separate review before retry.'),
      { statusCode: 409, emailLogRecord },
    )
  }

  if (pendingLogResult.blocked) {
    throw Object.assign(new Error('This email has already been sent 3 times in 5 minutes. Wait before sending again.'), { statusCode: 429, emailLogRecord })
  }

  if (pendingLogResult.skipped) {
    return { duplicate: true, emailLogRecord }
  }

  let response
  const sentPayload = preparedEmail.emailPayload
  const isResourceNotification = preparedEmail.storedPayload?.resourceNotification?.type === 'resource_shared'
  const isTrainingInvitation = preparedEmail.storedPayload?.trainingInvitation?.invitationType === 'training_rsvp'
  const context = {
    emailType: isTrainingInvitation
      ? 'training_availability'
      : isResourceNotification
        ? 'resource_shared'
        : 'parent_feedback',
    userRole: preparedEmail.storedPayload.actorRole || (isTrainingInvitation ? 'system' : ''),
    actorId: preparedEmail.storedPayload.actorId,
    actorEmail: preparedEmail.storedPayload.actorEmail,
    clubId: preparedEmail.planProfile.clubId,
    teamId: preparedEmail.storedPayload.teamId,
    targetEntityType: isTrainingInvitation ? 'training_availability_request_player' : 'player',
    targetEntityId: isTrainingInvitation
      ? preparedEmail.storedPayload.trainingInvitation.requestPlayerId || ''
      : preparedEmail.storedPayload.playerId || '',
    emailLogId: emailLogRecord?.id || '',
    deliveryTelemetry: {
      ...(preparedEmail.storedPayload.deliveryTelemetry || {}),
      sourceType: 'email_log',
      sourceId: emailLogRecord?.id || '',
      emailLogId: emailLogRecord?.id || '',
      logicalKey: emailLogRecord?.id ? `email_log:${emailLogRecord.id}` : '',
      ...deliveryTelemetry,
    },
  }

  try {
    response = await sendEmail(preparedEmail.emailPayload, {
      context,
      idempotencyKey: `fp-email-${finalIdempotencyKey}`,
      publicMessage: 'Email could not be sent. Please try again in a moment.',
    })
  } catch (sendWithPdfError) {
    if (!preparedEmail.emailPayload.attachments?.length) {
      throw Object.assign(sendWithPdfError, { emailLogRecord })
    }

    console.error('Email send with requested PDF attachment failed', {
      actorRef: safeReference(context.actorId),
      caller: 'send-parent-email',
      clubRef: safeReference(context.clubId),
      code: String(sendWithPdfError?.code || 'PDF_ATTACHMENT_DELIVERY_FAILED'),
      errorName: String(sendWithPdfError?.name || 'Error'),
      resourceRef: safeReference(context.targetEntityId),
      step: 'provider_send',
      teamRef: safeReference(context.teamId),
      workflow: 'email_attachment',
    })
    throw Object.assign(
      new Error('Email not sent because the requested PDF attachment could not be delivered. Retry the email with PDF.'),
      {
        cause: sendWithPdfError,
        code: 'PDF_ATTACHMENT_DELIVERY_FAILED',
        emailLogRecord,
        publicMessage: 'Email not sent because the requested PDF attachment could not be delivered. Retry the email with PDF.',
        statusCode: Number(sendWithPdfError?.statusCode || 502),
      },
    )
  }

  await markEmailLogSent(emailLogRecord, response, { recipientDedupeKeys })
  await createEmailAuditLog({
    user: null,
    action: 'email_sent',
    entityType: 'email',
    metadata: {
      to: preparedEmail.recipients,
      cc: preparedEmail.senderCopyEmails,
      subject: preparedEmail.emailSubject,
      clubId: preparedEmail.planProfile.clubId,
      teamId: preparedEmail.storedPayload.teamId,
      actorId: preparedEmail.storedPayload.actorId,
      actorEmail: preparedEmail.storedPayload.actorEmail,
      hasAttachment: Boolean(sentPayload.attachments?.length),
      playerName: preparedEmail.storedPayload.playerName,
      teamName: preparedEmail.storedPayload.teamName,
      clubName: preparedEmail.storedPayload.clubName,
    },
  })

  return {
    id: response?.data?.id || response?.id || '',
    hasAttachment: Boolean(sentPayload.attachments?.length),
    htmlSize: preparedEmail.emailHtml.length,
    emailLogRecord,
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  let recipients = []
  let emailSubject = 'Football Player'
  let emailLogRecord = null

  try {
    const body = JSON.parse(event.body || '{}')
    const requestUser = await getAuthenticatedPlanProfile(event, {
      clubId: body.clubId,
      teamId: body.teamId,
      playerId: body.playerId || body.evaluationId,
    })

    if (String(body.action ?? '').trim() === 'resolve_development_recipients') {
      const resolvedRecipients = await loadDevelopmentParentRecipientCandidates(
        supabaseAdmin,
        {
          profile: requestUser,
          playerId: body.playerId,
          teamId: body.teamId,
        },
      )

      return successResponse({
        recipients: resolvedRecipients,
        pdfAttachmentAvailable:
          isDevelopmentPdfServerEnabled(process.env) &&
          canUsePlanFeature(requestUser, 'pdfReports'),
      })
    }

    if (String(body.action ?? '').trim() === 'finalize_development_parent_report') {
      const report = await finalizeDevelopmentParentReportSnapshot(
        supabaseAdmin,
        {
          evaluationId: body.evaluationId,
          includeAttendance: body.includeAttendance === true,
          includeProgression: body.includeProgression !== false,
          profile: requestUser,
          requestedResponses: body.responses,
          selectedParentLinkIds: body.selectedParentLinkIds,
        },
      )

      return successResponse({
        evaluationId: report.evaluationId,
        reportVersion: report.version,
        responseCount: report.responseItems.length,
        recipientReviewRequired: report.recipientReviewRequired === true,
        eligibleRecipients: report.eligibleRecipients ?? report.recipients ?? [],
        ineligibleRecipients: report.ineligibleRecipients ?? [],
      })
    }

    if (String(body.action ?? '').trim() === 'confirm_development_submission') {
      const operation = await confirmDevelopmentSubmissionOperation(
        supabaseAdmin,
        {
          body,
          profile: requestUser,
        },
      )

      return successResponse({
        operationId: operation.operation_id,
        evaluationId: operation.evaluation_id,
        confirmationHash: operation.confirmation_hash,
        confirmedAt: operation.confirmed_at,
      })
    }

    const missingEnvVars = getMissingEnvVars()

    if (missingEnvVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`)
    }

    const scheduledAt = parseScheduledAt(body.scheduledAt)

    if (scheduledAt && !isFutureScheduledDate(scheduledAt)) {
      throw Object.assign(new Error('Scheduled send time must be at least 30 seconds from now.'), { statusCode: 400 })
    }

    const existingDevelopmentOutput = await findExistingDevelopmentOutput({
      body,
      profile: requestUser,
      scheduledAt,
    })

    if (existingDevelopmentOutput) {
      return successResponse(existingDevelopmentOutput)
    }

    const preparedEmail = await prepareParentEmail({ body, requestUser })

    if (preparedEmail.noRecipient) {
      return successResponse({
        outcome: 'no_recipient',
        code: preparedEmail.code,
        evaluationId: preparedEmail.evaluationId,
      })
    }

    recipients = preparedEmail.recipients
    emailSubject = preparedEmail.emailSubject

    if (isFutureScheduledDate(scheduledAt)) {
      const scheduledRecord = await createScheduledEmail({ preparedEmail, scheduledAt })
      const communicationLog = await ensureDevelopmentCommunicationLog(
        preparedEmail,
        'parent_email_scheduled',
      )
      return successResponse({
        scheduled: true,
        duplicate: Boolean(scheduledRecord.duplicate),
        communicationLogId: communicationLog?.id || '',
        communicationLogDuplicate: communicationLog?.duplicate === true,
        queueId: scheduledRecord.id,
        scheduledAt: scheduledRecord.scheduled_at,
        recipientLinkId: preparedEmail.storedPayload.recipientLinkId,
      })
    }

    const sendResult = await sendPreparedParentEmail(preparedEmail, {
      idempotencySeed: preparedEmail.storedPayload.outputKey ||
        preparedEmail.storedPayload.idempotencyKey ||
        `${body.evaluationId || 'parent-email'}:${randomUUID()}`,
    })
    emailLogRecord = sendResult.emailLogRecord
    const communicationLog = await ensureDevelopmentCommunicationLog(
      preparedEmail,
      'parent_email_sent',
    )

    if (sendResult.duplicate) {
      return successResponse({
        duplicate: true,
        communicationLogId: communicationLog?.id || '',
        communicationLogDuplicate: communicationLog?.duplicate === true,
        recipientLinkId: preparedEmail.storedPayload.recipientLinkId,
      })
    }

    return successResponse({
      ...sendResult,
      communicationLogId: communicationLog?.id || '',
      communicationLogDuplicate: communicationLog?.duplicate === true,
      recipientEmail: preparedEmail.recipients.join(', '),
      recipientLinkId: preparedEmail.storedPayload.recipientLinkId,
    })
  } catch (error) {
    logSafeError('Parent email request failed', error, {
      step: 'handler',
      workflow: 'parent_email',
    })
    emailLogRecord = error.emailLogRecord || emailLogRecord
    await markEmailLogFailed(emailLogRecord, error)
    await createEmailAuditLog({
      user: null,
      action: 'email_failed',
      entityType: 'email',
      metadata: {
        to: recipients,
        subject: emailSubject,
        error: error.publicMessage
          ? getPublicEmailErrorMessage(error)
          : 'Parent email request failed.',
        errorCode: error.code || 'DEVELOPMENT_PARENT_EMAIL_SEND_FAILED',
      },
    })

    const publicMessage = error.publicMessage
      ? getPublicEmailErrorMessage(error)
      : error.statusCode ? error.message : 'Email failed. Please try again in a moment.'
    return failureResponse(
      error.statusCode || 500,
      publicMessage,
      error.code || 'DEVELOPMENT_PARENT_EMAIL_SEND_FAILED',
    )
  }
}
