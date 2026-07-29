import { formatUkDate } from './date-format.js'
import { buildMainAppUrl } from './app-origins.js'
import { buildEmailLogoMarkup } from './email-branding.js'
import {
  buildParentPortalInviteHtml as buildTrustedParentPortalInviteHtml,
} from './parent-invite-email.js'
import { supabase } from './supabase-client.js'
import { sanitizeAssessmentEmailSections, sanitizeAssessmentOutputText } from './assessment-output-sanitizer.js'
import { buildProgressionChartMarkup } from './progression-chart-markup.js'
import {
  DEFAULT_ASSESSMENT_SCORE_GUIDE,
  formatDefaultAssessmentScoreForParent,
  isDefaultAssessmentScoreLabel,
  isDefaultAssessmentScoreValue,
} from './assessment-scoring.js'
import { buildDevelopmentParentReportContent } from './development-parent-report-content.js'

function escapeHtml(value) {
  return sanitizeAssessmentOutputText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatLines(value) {
  return escapeHtml(sanitizeAssessmentOutputText(value))
    .split('\n')
    .map((line) => (line.trim() ? line : '&nbsp;'))
    .join('<br />')
}

function normaliseResponses(responses) {
  if (Array.isArray(responses)) {
    return responses.filter((item) => isExportableResponseValue(item?.value))
  }

  if (responses && typeof responses === 'object') {
    return Object.entries(responses)
      .filter(([, value]) => isExportableResponseValue(value))
      .map(([label, value]) => ({ label, value }))
  }

  return []
}

function isScoredResponseItem(item) {
  return (
    Number.isFinite(Number(item?.numericScore)) &&
    isDefaultAssessmentScoreValue(item.numericScore)
  ) || (
    isDefaultAssessmentScoreLabel(item?.label) &&
    isDefaultAssessmentScoreValue(item?.value)
  )
}

function formatParentResponseValue(item) {
  if (item?.value && Number.isFinite(Number(item?.numericScore))) {
    return item.value
  }

  return isScoredResponseItem(item) ? formatDefaultAssessmentScoreForParent(item.value) : item?.value
}

function hasScoredResponses(responseItems) {
  return responseItems.some((item) => isScoredResponseItem(item))
}

function isExportableResponseValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value !== 0
  }

  const trimmedValue = String(value ?? '').trim()
  return trimmedValue !== '' && trimmedValue !== '0'
}

function chunkResponseRows(responseItems) {
  const rows = []

  for (let index = 0; index < responseItems.length; index += 2) {
    rows.push(responseItems.slice(index, index + 2))
  }

  return rows
}

function buildScoringKeyMarkup(responseItems) {
  if (!hasScoredResponses(responseItems)) {
    return ''
  }

  return `
    <div style="border: 1px solid #e7ece3; border-radius: 12px; background: #fbfcf9; padding: 14px 16px; margin: 0 0 20px;">
      <p style="margin: 0 0 8px; color: #4f6552; font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">How scoring works</p>
      <p style="margin: 0 0 10px; color: #142018; font-size: 13px; line-height: 1.55;">Player feedback is scored out of 10. A 5 means the player is broadly at the expected level, 6 gives coaches a clear way to show slightly above expected performance, and 10 means exceptional for this context rather than flawless.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
        <tbody>
          ${DEFAULT_ASSESSMENT_SCORE_GUIDE.map((item) => `
            <tr>
              <td style="padding: 3px 8px 3px 0; color: #142018; font-size: 12px; font-weight: 700; white-space: nowrap;">${item.score} - ${escapeHtml(item.label)}</td>
              <td style="padding: 3px 0; color: #4f6552; font-size: 12px; line-height: 1.4;">${escapeHtml(item.description)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `
}

function buildInfoCard(label, value) {
  return `
    <div style="border: 1px solid #e7ece3; border-radius: 10px; background: #fbfcf9; padding: 10px 12px;">
      <p style="margin: 0 0 4px; color: #4f6552; font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;">${escapeHtml(label)}</p>
      <p style="margin: 0; color: #142018; font-size: 13px; line-height: 1.35; font-weight: 700;">${escapeHtml(value || 'Not recorded')}</p>
    </div>
  `
}

function formatSessionForDisplay(session) {
  if (!session) {
    return ''
  }

  if (typeof session === 'string') {
    return formatUkDate(session, session)
  }

  if (session instanceof Date && !Number.isNaN(session.getTime())) {
    return formatUkDate(session.toISOString().slice(0, 10), '')
  }

  return String(session)
}

function buildResponseMarkup(responseItems) {
  if (responseItems.length === 0) {
    return '<p style="margin: 0; color: #64705f; font-size: 14px;">No selected development details were included.</p>'
  }

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
      <tbody>
        ${chunkResponseRows(responseItems)
          .map(
            (row) => `
              <tr>
                ${row
                  .map(
                    (item) => `
                      <td width="50%" style="padding: 0 6px 10px 0; vertical-align: top;">
                        <div style="border: 1px solid #e7ece3; border-radius: 10px; background: #ffffff; padding: 10px 12px; min-height: 54px;">
                          <p style="margin: 0 0 5px; color: #4f6552; font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;">${escapeHtml(item.label)}</p>
                          <p style="margin: 0; color: #142018; font-size: 13px; line-height: 1.45;">${formatLines(formatParentResponseValue(item) || 'No data entered')}</p>
                        </div>
                      </td>
                    `,
                  )
                  .join('')}
                ${row.length === 1 ? '<td width="50%" style="padding: 0 0 10px 6px; vertical-align: top;">&nbsp;</td>' : ''}
              </tr>
            `,
          )
          .join('')}
      </tbody>
    </table>
  `
}

function buildEmailSectionMarkup(emailSections, { useChartContentIds = false } = {}) {
  const sections = sanitizeAssessmentEmailSections(emailSections)

  if (sections.length === 0) {
    return ''
  }

  return `
    <div style="border: 1px solid #e7ece3; border-radius: 12px; background: #fbfcf9; padding: 12px; margin: 0 0 20px;">
      <p style="margin: 0 0 10px; color: #4f6552; font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">Coach update</p>
      ${sections.map((section, index) => `
        <div style="border: 1px solid #e7ece3; border-radius: 10px; background: #ffffff; padding: 12px 14px; margin: 0 0 10px;">
          <p style="margin: 0 0 6px; color: #142018; font-size: 14px; font-weight: 700;">${escapeHtml(section.title)}</p>
          <p style="margin: 0; color: #4f6552; font-size: 13px; line-height: 1.5;">${formatLines(section.body)}</p>
          ${section.chartPoints ? buildProgressionChartMarkup(section.chartPoints, {
            imageSrc: useChartContentIds ? `cid:${section.chartContentId || `progression-chart-${index}@footballplayer.online`}` : '',
          }) : ''}
        </div>
      `).join('')}
    </div>
  `
}

export function getProgressionChartImages(emailSections = []) {
  const contentSeed = `progression-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  return sanitizeAssessmentEmailSections(emailSections)
    .filter((section) => Array.isArray(section.chartPoints) && section.chartPoints.length >= 2)
    .map((section, index) => ({
      contentId: `${contentSeed}-${index}@footballplayer.online`,
      filename: `player-progression-chart-${index + 1}.png`,
      points: section.chartPoints,
    }))
}

export function shouldShowWebsiteAdvert(planKey) {
  return ['single_team', 'small_club'].includes(String(planKey ?? '').trim())
}

function buildPoweredByFooterMarkup() {
  return `
      <div style="border-top: 1px solid #e7ece3; margin-top: 20px; padding-top: 14px;">
        <p style="margin: 0; color: #7a8578; font-size: 11px; line-height: 1.45;">Powered by Football Player | footballplayer.online</p>
      </div>
  `
}

function buildDevelopmentReportFacts(content) {
  const facts = [
    ['Overall assessment', content.overallAssessment?.value || 'Not recorded'],
    ['Report date', formatSessionForDisplay(content.context?.reportDate) || 'Not recorded'],
    ['Team', content.context?.teamName || 'Team'],
    ['Development form', content.context?.formName || 'Development report'],
  ]

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; margin: 0 0 20px;">
      <tbody>
        <tr>
          <td width="50%" style="padding: 0 6px 8px 0; vertical-align: top;">${buildInfoCard(facts[0][0], facts[0][1])}</td>
          <td width="50%" style="padding: 0 0 8px 6px; vertical-align: top;">${buildInfoCard(facts[1][0], facts[1][1])}</td>
        </tr>
        <tr>
          <td width="50%" style="padding: 0 6px 0 0; vertical-align: top;">${buildInfoCard(facts[2][0], facts[2][1])}</td>
          <td width="50%" style="padding: 0 0 0 6px; vertical-align: top;">${buildInfoCard(facts[3][0], facts[3][1])}</td>
        </tr>
      </tbody>
    </table>
  `
}

function buildDevelopmentSectionsMarkup(sections = []) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return ''
  }

  return `
    <div style="margin: 0 0 20px;">
      ${sections.map((section) => `
        <div style="border: 1px solid #e7ece3; border-radius: 12px; background: #fbfcf9; padding: 14px 16px; margin: 0 0 10px;">
          <p style="margin: 0 0 6px; color: #142018; font-size: 14px; font-weight: 700;">${escapeHtml(section.title)}</p>
          <p style="margin: 0; color: #4f6552; font-size: 13px; line-height: 1.5;">${formatLines(section.body)}</p>
          ${Array.isArray(section.chartPoints) && section.chartPoints.length >= 2
            ? '<p style="margin: 8px 0 0; color: #4f6552; font-size: 12px; line-height: 1.45;">The final progression point represents the current Development review.</p>'
            : ''}
        </div>
      `).join('')}
    </div>
  `
}

export function buildDevelopmentParentEmailHtml({
  developmentReport,
  content: suppliedContent,
  parentName = '',
  clubLogoUrl = '',
  logoUrl = '',
  origin = '',
  pdfAttached = false,
} = {}) {
  const content = suppliedContent || buildDevelopmentParentReportContent(developmentReport)
  const resolvedParent = parentName || content.context.recipientLabel || 'Parent or guardian'
  const authorName = content.context.authorName
  const reviewIntroduction = authorName
    ? `${content.context.playerName}'s latest Development review has been completed by ${authorName}.`
    : `${content.context.playerName}'s latest Development review is complete.`
  const logoMarkup = buildEmailLogoMarkup({
    altText: content.context.clubName || content.context.teamName || 'Football Player',
    clubLogoUrl: clubLogoUrl || logoUrl,
    origin,
  })
  const responseMarkup = content.emptySelection
    ? `
      <div style="border: 1px solid #e7ece3; border-radius: 12px; background: #fbfcf9; padding: 14px 16px; margin: 0 0 20px;">
        <p style="margin: 0; color: #4f6552; font-size: 13px; line-height: 1.5;">This update contains only the summary information deliberately selected by the coaching team. No completed Development response fields were selected for sharing.</p>
      </div>
    `
    : `
      <div style="border: 1px solid #e7ece3; border-radius: 12px; background: #fbfcf9; padding: 12px; margin: 0 0 20px;">
        <p style="margin: 0 0 10px; color: #4f6552; font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">Current Development summary</p>
        ${buildResponseMarkup(content.responseItems)}
      </div>
    `

  return `
    <div style="font-family: Arial, sans-serif; color: #142018; background: #ffffff; padding: 28px; line-height: 1.55; max-width: 760px; margin: 0 auto;">
      ${logoMarkup}
      <p style="margin: 0 0 10px; color: #4f6552; font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">Development report</p>
      <h1 style="margin: 0 0 6px; font-size: 26px; line-height: 1.2;">${escapeHtml(content.context.playerName)}</h1>
      <p style="margin: 0 0 22px; color: #4f6552; font-size: 13px;">${escapeHtml(content.context.clubName)} | ${escapeHtml(content.context.teamName)}</p>

      <p style="margin: 0 0 14px; font-size: 15px;">Hi ${escapeHtml(resolvedParent)},</p>
      <p style="margin: 0 0 20px; font-size: 15px;">${escapeHtml(reviewIntroduction)}</p>

      ${buildDevelopmentReportFacts(content)}
      ${responseMarkup}
      ${buildDevelopmentSectionsMarkup(content.sections)}

      ${pdfAttached
        ? '<p style="margin: 0 0 18px; font-size: 14px; font-weight: 700;">The full club-branded Development report is attached.</p>'
        : ''}
      <p style="margin: 0 0 18px; font-size: 14px;">If you have any questions about this review, please reply to this email.</p>
      <p style="margin: 0; color: #142018; font-size: 13px;">Kind regards,</p>
      <p style="margin: 3px 0 0; color: #142018; font-size: 13px; font-weight: 700;">${escapeHtml(authorName || `${content.context.teamName} Development team`)}</p>
      <p style="margin: 3px 0 0; color: #5a6b5b; font-size: 13px;">${escapeHtml(content.context.clubName)} | ${escapeHtml(content.context.teamName)}</p>
      ${buildScoringKeyMarkup(content.responseItems)}
      ${buildPoweredByFooterMarkup()}
    </div>
  `
}

export function buildEmailHtml({
  parentName,
  playerName,
  team,
  teamName,
  club,
  clubName,
  section,
  session,
  responses,
  emailSections,
  emailBody,
  clubLogoUrl,
  logoUrl,
  origin,
  teamLogoUrl,
  useChartContentIds = false,
}) {
  const responseItems = normaliseResponses(responses)
  const templateBody = sanitizeAssessmentOutputText(emailBody).trim()
  const hasTemplateBody = Boolean(templateBody)
  const resolvedTeam = teamName || team
  const resolvedClub = clubName || club
  const resolvedPlayer = playerName || 'Player'
  const resolvedParent = parentName || 'Parent or guardian'
  const resolvedSession = formatSessionForDisplay(session)
  const logoMarkup = buildEmailLogoMarkup({
    altText: resolvedClub || resolvedTeam || 'Football Player',
    clubLogoUrl: clubLogoUrl || logoUrl,
    origin,
    teamLogoUrl,
  })

  return `
    <div style="font-family: Arial, sans-serif; color: #142018; background: #ffffff; padding: 28px; line-height: 1.55; max-width: 760px; margin: 0 auto;">
      <p style="margin: 0 0 10px; color: #4f6552; font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">Development report</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; margin: 0 0 22px;">
        <tbody>
          <tr>
            <td width="48%" style="vertical-align: top; padding: 0 18px 0 0;">
              ${logoMarkup}
              <h2 style="margin: 0 0 18px; font-size: 24px; line-height: 1.2;">${escapeHtml(resolvedClub || 'Club')}</h2>
              <p style="margin: 0 0 4px; color: #4f6552; font-size: 11px; font-weight: 700;">Player</p>
              <h1 style="margin: 0; font-size: 24px; line-height: 1.2;">${escapeHtml(resolvedPlayer)}</h1>
            </td>
            <td width="52%" style="vertical-align: bottom; padding: 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <tbody>
                  <tr>
                    <td width="50%" style="padding: 0 6px 8px 0; vertical-align: top;">${buildInfoCard('Team', resolvedTeam || 'Team')}</td>
                    <td width="50%" style="padding: 0 0 8px 6px; vertical-align: top;">${buildInfoCard('Session', resolvedSession || 'Not recorded')}</td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding: 0 0 8px;">${buildInfoCard('Section', section || 'Not recorded')}</td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding: 0;">${buildInfoCard('Recipients', resolvedParent)}</td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      ${
        hasTemplateBody
          ? `<div style="border: 1px solid #e7ece3; border-radius: 12px; background: #fbfcf9; padding: 14px 16px; margin: 0 0 22px; font-size: 14px;">${formatLines(templateBody)}</div>`
          : `
              <p style="margin: 0 0 14px; font-size: 15px;">Hi ${escapeHtml(resolvedParent)},</p>
              <p style="margin: 0 0 20px; font-size: 15px;">Here is the latest player feedback report for ${escapeHtml(resolvedPlayer)}.</p>
            `
      }

      <div style="border: 1px solid #e7ece3; border-radius: 12px; background: #fbfcf9; padding: 12px; margin: 0 0 20px;">
        <p style="margin: 0 0 10px; color: #4f6552; font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">Development responses</p>
        ${buildResponseMarkup(responseItems)}
      </div>

      ${buildEmailSectionMarkup(emailSections, { useChartContentIds })}

      <p style="margin: 0 0 18px; font-size: 14px;">If you have any questions, just reply to this email.</p>
      <p style="margin: 0; color: #5a6b5b; font-size: 13px;">${escapeHtml(resolvedClub || 'Club')} | ${escapeHtml(resolvedTeam || 'Team')}</p>
      ${buildScoringKeyMarkup(responseItems)}
      ${buildPoweredByFooterMarkup()}
    </div>
  `
}

export function buildPlayerFeedbackSubject({ playerName, teamName, team }) {
  const resolvedPlayer = String(playerName ?? '').trim()
  const resolvedTeam = String(teamName || team || '').trim()

  if (resolvedPlayer && resolvedTeam) {
    return `Football Player: ${resolvedPlayer} (${resolvedTeam})`
  }

  return 'Football Player Report'
}

export async function finalizeDevelopmentParentReport(data = {}) {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || ''
  const response = await fetch('/.netlify/functions/send-parent-email', {
    method: 'POST',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'finalize_development_parent_report',
      clubId: data.clubId,
      teamId: data.teamId,
      playerId: data.playerId,
      evaluationId: data.evaluationId,
      selectedParentLinkIds: data.selectedParentLinkIds,
      responses: data.responses,
      includeAttendance: data.includeAttendance === true,
      includeProgression: data.includeProgression !== false,
    }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result.success !== true) {
    throw new Error(result.message || 'The Development report snapshot could not be finalized.')
  }

  return result
}

export async function confirmDevelopmentSubmission(data = {}) {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || ''
  const response = await fetch('/.netlify/functions/send-parent-email', {
    method: 'POST',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'confirm_development_submission',
      operationId: data.operationId,
      evaluationId: data.evaluationId,
      clubId: data.clubId,
      teamId: data.teamId,
      playerId: data.playerId,
      outputContext: data.outputContext,
      sendMode: data.sendMode,
      scheduledAt: data.scheduledAt,
      attachPdf: data.attachPdf === true,
      includeAttendance: data.includeAttendance === true,
      selectedParentLinkIds: data.selectedParentLinkIds,
      selectedResponseCount: data.selectedResponseCount,
      reminderDate: data.reminderDate,
    }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result.success !== true) {
    throw Object.assign(
      new Error(result.message || 'The final Development submission confirmation could not be recorded.'),
      {
        code: result.code || 'DEVELOPMENT_SUBMISSION_CONFIRMATION_FAILED',
        statusCode: response.status,
      },
    )
  }

  return result
}

export async function sendParentEmail(data) {
  const progressionChartImages = getProgressionChartImages(data.emailSections)
  let chartIndex = 0
  const emailSections = sanitizeAssessmentEmailSections(data.emailSections).map((section) => {
    if (!Array.isArray(section.chartPoints) || section.chartPoints.length < 2) {
      return section
    }

    const enrichedSection = {
      ...section,
      chartContentId: progressionChartImages[chartIndex]?.contentId || '',
    }
    chartIndex += 1
    return enrichedSection
  })
  const html = buildEmailHtml({
    ...data,
    emailSections,
    useChartContentIds: progressionChartImages.length > 0,
  })
  const teamName = data.teamName || data.team
  const clubName = data.clubName || data.club
  const subject = sanitizeAssessmentOutputText(data.subject || buildPlayerFeedbackSubject({
    playerName: data.playerName,
    teamName,
  }))
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || ''

  const response = await fetch('/.netlify/functions/send-parent-email', {
    method: 'POST',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clubId: data.clubId,
      userId: data.userId,
      parentEmail: data.parentEmail,
      displayName: data.displayName,
      teamName,
      clubName,
      replyToEmail: data.replyToEmail || data.clubContactEmail || data.clubEmail,
      clubContactEmail: data.clubContactEmail,
      subject,
      html,
      clubLogoUrl: data.clubLogoUrl || data.logoUrl,
      logoUrl: data.logoUrl,
      pdfDocument: data.pdfDocument,
      playerName: data.playerName,
      parentName: data.parentName,
      senderEmail: data.senderEmail,
      planKey: data.planKey,
      attachPdf: data.attachPdf,
      idempotencyKey: data.idempotencyKey,
      evaluationId: data.evaluationId,
      playerId: data.playerId,
      teamId: data.teamId,
      outputContext: data.outputContext,
      selectedParentLinkIds: data.selectedParentLinkIds,
      responses: data.responses,
      emailSections,
      emailBody: data.emailBody,
      section: data.section,
      session: data.session,
      scheduledAt: data.scheduledAt,
      submissionOperationId: data.submissionOperationId,
      includeAttendance: data.includeAttendance === true,
      communicationLog: data.communicationLog,
      progressionChartImages,
    }),
  })

  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw Object.assign(
      new Error(result.message || 'Email failed - will retry automatically'),
      {
        code: result.code || 'DEVELOPMENT_PARENT_EMAIL_SEND_FAILED',
        statusCode: response.status,
      },
    )
  }

  if (result.scheduled) {
    window.dispatchEvent(new Event('scheduled-email-queue-changed'))
  }

  return result
}

export function buildParentPortalInviteHtml({
  clubLogoUrl,
  clubName,
  existingParentPortalUser = false,
  inviteUrl,
  logoUrl,
  origin,
  playerName,
  teamName,
  teamLogoUrl,
}) {
  return buildTrustedParentPortalInviteHtml({
    clubLogoUrl,
    clubName,
    existingParentPortalUser,
    inviteUrl,
    logoUrl,
    origin,
    playerName,
    teamName,
    teamLogoUrl,
  })
}

export async function sendParentPortalInvite(data) {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || ''

  const response = await fetch('/.netlify/functions/send-parent-portal-invite', {
    method: 'POST',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      copySender: data.copySender === true,
      inviteLinkId: data.inviteLinkId,
      senderEmail: data.senderEmail,
    }),
  })

  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.message || 'Family portal invite could not be sent.')
  }

  return result
}

export function buildStaffInviteUrl(token) {
  return buildMainAppUrl(`/staff-invite/${token}`)
}

export function buildStaffInviteHtml({
  clubLogoUrl,
  clubName,
  inviteUrl,
  logoUrl,
  origin,
  roleLabel,
  teamName,
  teamLogoUrl,
}) {
  const resolvedClub = String(clubName ?? '').trim() || 'Your club'
  const resolvedRole = String(roleLabel ?? '').trim() || 'Staff'
  const resolvedTeam = String(teamName ?? '').trim() || 'your team'
  const logoMarkup = buildEmailLogoMarkup({
    altText: resolvedClub,
    clubLogoUrl: clubLogoUrl || logoUrl,
    origin,
    teamLogoUrl,
  })

  return `
    <div style="font-family: Arial, sans-serif; color: #142018; background: #ffffff; padding: 28px; line-height: 1.55; max-width: 680px; margin: 0 auto;">
      ${logoMarkup}
      <p style="margin: 0 0 10px; color: #4f6552; font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">Staff invite</p>
      <h1 style="margin: 0 0 14px; font-size: 24px; line-height: 1.25;">${escapeHtml(resolvedClub)} has invited you</h1>
      <p style="margin: 0 0 16px; font-size: 15px;">You have been invited to join ${escapeHtml(resolvedTeam)} as ${escapeHtml(resolvedRole)}.</p>
      <p style="margin: 0 0 22px; font-size: 15px;">Open the link below and create your password. The role and team access have already been set by the club.</p>
      <p style="margin: 0 0 22px;">
        <a href="${escapeHtml(inviteUrl)}" style="display: inline-block; background: #d8ff2f; color: #142018; text-decoration: none; font-weight: 800; padding: 12px 18px; border-radius: 10px;">Create Staff Access</a>
      </p>
      <p style="margin: 0 0 8px; color: #5a6b5b; font-size: 13px;">This link expires after 7 days. If the button does not work, copy and paste this link into your browser:</p>
      <p style="margin: 0; word-break: break-all; color: #142018; font-size: 13px;">${escapeHtml(inviteUrl)}</p>
      ${buildPoweredByFooterMarkup()}
    </div>
  `
}

export async function sendStaffInvite(data) {
  const inviteUrl = data.inviteUrl || buildStaffInviteUrl(data.inviteToken)
  const html = buildStaffInviteHtml({
    ...data,
    inviteUrl,
  })
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || ''

  const response = await fetch('/.netlify/functions/send-staff-invite', {
    method: 'POST',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clubId: data.clubId,
      displayName: data.displayName,
      inviteId: data.inviteId,
      inviteUrl,
      senderEmail: data.senderEmail,
      subject: data.subject,
      html,
    }),
  })

  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.message || 'Staff invite could not be sent.')
  }

  return result
}
