import process from 'node:process'
import { createFromAddress, sendEmail } from './_email-provider.js'

export const PRODUCTION_SUPPORT_EMAIL = 'support@jelumalabs.com'
export const SUPPORT_NOTIFICATION_REFERENCE = 'FPO-V1-SUPPORT-EMAIL-AUDIT-013'

const MAX_FIELD_LENGTH = 4000
const MAX_SUBJECT_FIELD_LENGTH = 140

export class SupportNotificationConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SupportNotificationConfigError'
    this.code = 'support_notification_config_invalid'
  }
}

function normalizeText(value, { maxLength = MAX_FIELD_LENGTH } = {}) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function normalizeEmail(value) {
  return normalizeText(value, { maxLength: 320 }).toLowerCase()
}

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalizeText(value))
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function cleanHeaderText(value, fallback) {
  const cleanedValue = normalizeText(value, { maxLength: MAX_SUBJECT_FIELD_LENGTH })
    .replace(/[\r\n][\s\S]*$/g, '')
    .replace(/[<>{}[\]"'`;\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleanedValue || fallback
}

function getEnvName(env) {
  const context = normalizeText(env.CONTEXT).toLowerCase()
  const branch = normalizeText(env.BRANCH).toLowerCase()

  if (context) {
    return context
  }

  if (branch) {
    return branch
  }

  return normalizeText(env.NODE_ENV).toLowerCase() || 'unknown'
}

function getHostname(value) {
  try {
    return new URL(normalizeText(value)).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function isTrustedProductionSupportEnvironment(env = process.env) {
  if (normalizeText(env.SUPPORT_EMAIL_FORCE_SEND).toLowerCase() === 'true') {
    return true
  }

  const context = normalizeText(env.CONTEXT).toLowerCase()
  const branch = normalizeText(env.BRANCH).toLowerCase()
  const host = getHostname(env.URL || env.DEPLOY_URL || env.VITE_APP_URL)

  return context === 'production'
    || (branch === 'main' && (host === 'footballplayer.online' || host === 'www.footballplayer.online'))
}

export function resolveSupportRecipient(env = process.env) {
  const configuredRecipient = normalizeEmail(env.SUPPORT_EMAIL_TO || PRODUCTION_SUPPORT_EMAIL)

  if (configuredRecipient && configuredRecipient !== PRODUCTION_SUPPORT_EMAIL) {
    throw new SupportNotificationConfigError('Production support notifications must be addressed to support@jelumalabs.com.')
  }

  return PRODUCTION_SUPPORT_EMAIL
}

function buildRows(report) {
  return [
    ['Report ID', report.reportId],
    ['Type', report.type],
    ['Severity', report.severity],
    ['Title', report.title],
    ['Summary', report.summary],
    ['Route', report.route],
    ['Page title', report.pageTitle],
    ['Module', report.module],
    ['Phase/environment', report.phase],
    ['Reporter name', report.reporterName],
    ['Reporter email', report.reporterEmail],
    ['Club', report.clubName || report.clubId],
    ['Team', report.teamName || report.teamId],
    ['Submitted at', report.submittedAt],
    ['Browser/device', report.browserDevice],
    ['Screenshot URL', report.screenshotUrl],
    ['Log reference', report.logReference],
    ['Admin review URL', report.adminReviewUrl],
  ]
}

export function buildSupportNotificationPayload(reportInput = {}, {
  env = process.env,
  recipient = resolveSupportRecipient(env),
} = {}) {
  const report = {
    reportId: normalizeText(reportInput.reportId || reportInput.id || 'Unknown', { maxLength: 160 }),
    type: normalizeText(reportInput.type || reportInput.feedbackType || 'support', { maxLength: 80 }),
    severity: normalizeText(reportInput.severity || 'medium', { maxLength: 80 }),
    title: normalizeText(reportInput.title || 'Untitled support report', { maxLength: 240 }),
    summary: normalizeText(reportInput.summary || reportInput.message || 'No summary provided.'),
    route: normalizeText(reportInput.route || '', { maxLength: 500 }),
    pageTitle: normalizeText(reportInput.pageTitle || '', { maxLength: 240 }),
    module: normalizeText(reportInput.module || '', { maxLength: 160 }),
    phase: normalizeText(reportInput.phase || getEnvName(env), { maxLength: 120 }),
    reporterName: normalizeText(reportInput.reporterName || reportInput.submittedByName || '', { maxLength: 240 }),
    reporterEmail: normalizeEmail(reportInput.reporterEmail || reportInput.submittedByEmail || ''),
    clubId: normalizeText(reportInput.clubId || '', { maxLength: 120 }),
    clubName: normalizeText(reportInput.clubName || '', { maxLength: 240 }),
    teamId: normalizeText(reportInput.teamId || '', { maxLength: 120 }),
    teamName: normalizeText(reportInput.teamName || '', { maxLength: 240 }),
    submittedAt: normalizeText(reportInput.submittedAt || reportInput.createdAt || new Date().toISOString(), { maxLength: 120 }),
    browserDevice: normalizeText(reportInput.browserDevice || '', { maxLength: 1000 }),
    screenshotUrl: normalizeText(reportInput.screenshotUrl || '', { maxLength: 1000 }),
    logReference: normalizeText(reportInput.logReference || '', { maxLength: 1000 }),
    adminReviewUrl: normalizeText(reportInput.adminReviewUrl || 'https://footballplayer.online/platform-feedback', { maxLength: 500 }),
  }
  const safeType = cleanHeaderText(report.type, 'support')
  const safeSeverity = cleanHeaderText(report.severity, 'medium')
  const safeTitle = cleanHeaderText(report.title, 'Untitled support report')
  const rows = buildRows(report)

  const htmlRows = rows
    .map(([label, value]) => `
      <tr>
        <td style="width: 180px; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; color: #4b5563; font-weight: 700;">${escapeHtml(label)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; white-space: pre-line;">${escapeHtml(value || 'Unknown')}</td>
      </tr>
    `)
    .join('')

  return {
    from: createFromAddress('Footballplayer.online Support', env),
    to: [recipient],
    replyTo: isValidEmail(report.reporterEmail) ? report.reporterEmail : undefined,
    subject: `Footballplayer.online support report: ${safeType} ${safeSeverity} - ${safeTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5; padding: 24px;">
        <div style="max-width: 760px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
          <div style="background: #101510; color: #ffffff; padding: 24px;">
            <p style="margin: 0 0 8px; color: #d8ff2f; font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">Footballplayer.online</p>
            <h1 style="margin: 0; font-size: 24px;">Support report notification</h1>
          </div>
          <div style="padding: 24px; background: #ffffff;">
            <table style="width: 100%; border-collapse: collapse;">
              <tbody>${htmlRows}</tbody>
            </table>
            <p style="margin: 18px 0 0; color: #6b7280; font-size: 12px;">Reference: ${SUPPORT_NOTIFICATION_REFERENCE}</p>
          </div>
        </div>
      </div>
    `,
    report,
  }
}

export async function sendSupportNotification(reportInput, {
  env = process.env,
  sendEmailImpl = sendEmail,
} = {}) {
  const environmentName = getEnvName(env)

  if (!isTrustedProductionSupportEnvironment(env)) {
    console.info('support_notification_skipped', JSON.stringify({
      reference: SUPPORT_NOTIFICATION_REFERENCE,
      environment: environmentName,
      reason: 'non_production_environment',
    }))

    return {
      sent: false,
      skipped: true,
      recipient: '',
      reason: 'non_production_environment',
    }
  }

  const recipient = resolveSupportRecipient(env)
  const payload = buildSupportNotificationPayload(reportInput, { env, recipient })
  const { report, ...emailPayload } = payload
  const response = await sendEmailImpl(emailPayload, {
    env,
    context: {
      emailType: 'support_notification',
      actorEmail: report.reporterEmail,
      actorId: normalizeText(reportInput.reporterId || reportInput.submittedByUserId || ''),
      clubId: report.clubId,
      teamId: report.teamId,
      targetEntityType: normalizeText(reportInput.source || 'support_report'),
      targetEntityId: report.reportId,
    },
    publicMessage: 'Support notification could not be sent.',
  })

  return {
    sent: true,
    skipped: false,
    recipient,
    id: response?.data?.id || response?.id || '',
  }
}
