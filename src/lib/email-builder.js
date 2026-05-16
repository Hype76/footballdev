import { formatUkDate } from './date-format.js'

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatLines(value) {
  return escapeHtml(value)
    .split('\n')
    .map((line) => (line.trim() ? line : '&nbsp;'))
    .join('<br />')
}

function normaliseResponses(responses) {
  if (Array.isArray(responses)) {
    return responses
  }

  if (responses && typeof responses === 'object') {
    return Object.entries(responses).map(([label, value]) => ({ label, value }))
  }

  return []
}

function isNumericResponseValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (typeof value !== 'string') {
    return false
  }

  const trimmedValue = value.trim()
  return trimmedValue !== '' && Number.isFinite(Number(trimmedValue))
}

function sortResponseItemsByValueType(responseItems) {
  return [...responseItems].sort((firstItem, secondItem) => {
    const firstIsNumeric = isNumericResponseValue(firstItem.value)
    const secondIsNumeric = isNumericResponseValue(secondItem.value)

    if (firstIsNumeric === secondIsNumeric) {
      return 0
    }

    return firstIsNumeric ? -1 : 1
  })
}

function chunkResponseRows(responseItems) {
  const rows = []

  for (let index = 0; index < responseItems.length; index += 2) {
    rows.push(responseItems.slice(index, index + 2))
  }

  return rows
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
    return '<p style="margin: 0; color: #64705f; font-size: 14px;">No selected assessment details were included.</p>'
  }

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
      <tbody>
        ${chunkResponseRows(sortResponseItemsByValueType(responseItems))
          .map(
            (row) => `
              <tr>
                ${row
                  .map(
                    (item) => `
                      <td width="50%" style="padding: 0 6px 10px 0; vertical-align: top;">
                        <div style="border: 1px solid #e7ece3; border-radius: 10px; background: #ffffff; padding: 10px 12px; min-height: 54px;">
                          <p style="margin: 0 0 5px; color: #4f6552; font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;">${escapeHtml(item.label)}</p>
                          <p style="margin: 0; color: #142018; font-size: 13px; line-height: 1.45;">${formatLines(item.value || 'No data entered')}</p>
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

function getSafeLogoUrl(logoUrl) {
  const normalizedLogoUrl = String(logoUrl ?? '').trim()

  if (!normalizedLogoUrl) {
    return ''
  }

  try {
    const parsedUrl = new URL(normalizedLogoUrl)
    return parsedUrl.protocol === 'https:' ? parsedUrl.href : ''
  } catch {
    return ''
  }
}

export function shouldShowWebsiteAdvert(planKey) {
  return ['single_team', 'small_club'].includes(String(planKey ?? '').trim())
}

function buildWebsiteAdvertMarkup(planKey) {
  if (!shouldShowWebsiteAdvert(planKey)) {
    return ''
  }

  return `
      <div style="border-top: 1px solid #e7ece3; margin-top: 20px; padding-top: 14px;">
        <p style="margin: 0; color: #7a8578; font-size: 11px; line-height: 1.45;">Powered by Player Feedback | playerfeedback.online</p>
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
  emailBody,
  logoUrl,
  planKey,
}) {
  const responseItems = normaliseResponses(responses)
  const templateBody = String(emailBody ?? '').trim()
  const hasTemplateBody = Boolean(String(emailBody ?? '').trim())
  const resolvedTeam = teamName || team
  const resolvedClub = clubName || club
  const resolvedPlayer = playerName || 'Player'
  const resolvedParent = parentName || 'Parent/Guardian'
  const resolvedSession = formatSessionForDisplay(session)
  const safeLogoUrl = getSafeLogoUrl(logoUrl)

  return `
    <div style="font-family: Arial, sans-serif; color: #142018; background: #ffffff; padding: 28px; line-height: 1.55; max-width: 760px; margin: 0 auto;">
      <p style="margin: 0 0 10px; color: #4f6552; font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">Assessment report</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; margin: 0 0 22px;">
        <tbody>
          <tr>
            <td width="48%" style="vertical-align: top; padding: 0 18px 0 0;">
              ${
                safeLogoUrl
                  ? `<img src="${escapeHtml(safeLogoUrl)}" alt="Club Logo" style="width: 58px; max-width: 58px; height: auto; display: block; margin: 0 0 10px;" />`
                  : ''
              }
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
        <p style="margin: 0 0 10px; color: #4f6552; font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">Assessment responses</p>
        ${buildResponseMarkup(responseItems)}
      </div>

      <p style="margin: 0 0 18px; font-size: 14px;">If you have any questions, just reply to this email.</p>
      <p style="margin: 0; color: #5a6b5b; font-size: 13px;">${escapeHtml(resolvedClub || 'Club')} | ${escapeHtml(resolvedTeam || 'Team')}</p>
      ${buildWebsiteAdvertMarkup(planKey)}
    </div>
  `
}

export function buildPlayerFeedbackSubject({ playerName, teamName, team }) {
  const resolvedPlayer = String(playerName ?? '').trim()
  const resolvedTeam = String(teamName || team || '').trim()

  if (resolvedPlayer && resolvedTeam) {
    return `Player Feedback: ${resolvedPlayer} (${resolvedTeam})`
  }

  return 'Player Feedback Report'
}

export async function sendParentEmail(data) {
  const html = buildEmailHtml(data)
  const teamName = data.teamName || data.team
  const clubName = data.clubName || data.club
  const subject = data.subject || buildPlayerFeedbackSubject({
    playerName: data.playerName,
    teamName,
  })

  const response = await fetch('/.netlify/functions/send-parent-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parentEmail: data.parentEmail,
      displayName: data.displayName,
      teamName,
      clubName,
      replyToEmail: data.replyToEmail || data.clubContactEmail || data.clubEmail,
      clubContactEmail: data.clubContactEmail,
      subject,
      html,
      logoUrl: data.logoUrl,
      playerName: data.playerName,
      parentName: data.parentName,
      senderEmail: data.senderEmail,
      planKey: data.planKey,
      attachPdf: data.attachPdf,
      idempotencyKey: data.idempotencyKey,
      evaluationId: data.evaluationId,
    }),
  })

  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.message || 'Email failed - will retry automatically')
  }

  return result
}
