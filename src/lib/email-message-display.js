export function getMessageMetadata(message) {
  return message?.metadata && typeof message.metadata === 'object' ? message.metadata : {}
}

export function getMessageSubject(message) {
  const metadata = getMessageMetadata(message)
  return String(message?.subject ?? metadata.subject ?? '').trim() || 'Email from the club'
}

export function getMessageBody(message) {
  const metadata = getMessageMetadata(message)
  return String(message?.body ?? metadata.body ?? '').trim()
}

export function getMessageTemplateName(message) {
  const metadata = getMessageMetadata(message)
  return String(message?.templateName ?? metadata.templateName ?? '').trim()
}

export function getMessageAssessmentFields(message) {
  const metadata = getMessageMetadata(message)
  const fields = message?.assessmentFields ?? metadata.assessmentFields
  return Array.isArray(fields) ? fields : []
}

export function messageHasAttachment(message) {
  const metadata = getMessageMetadata(message)
  return message?.hasAttachment === true || metadata.hasAttachment === true
}

export function getMessagePdfHtml(message) {
  const metadata = getMessageMetadata(message)
  const storedPdfHtml = String(message?.pdfHtml ?? metadata.pdfHtml ?? '').trim()

  if (storedPdfHtml) {
    return storedPdfHtml
  }

  if (!messageHasAttachment(message)) {
    return ''
  }

  const assessmentFields = getMessageAssessmentFields(message)

  if (assessmentFields.length === 0) {
    return ''
  }

  return buildFallbackMessagePdfHtml(message, assessmentFields)
}

export function canDownloadMessagePdf(message) {
  return messageHasAttachment(message) && Boolean(getMessagePdfHtml(message))
}

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

function buildFallbackMessagePdfHtml(message, assessmentFields) {
  const subject = getMessageSubject(message)
  const body = getMessageBody(message)
  const playerName = getMessagePlayerLabel(message) || 'Player'
  const team = getMessageTeamLabel(message)
  const club = getMessageClubLabel(message)

  return `
    <div style="font-family: Arial, sans-serif; color: #142018; background: #ffffff; padding: 28px; line-height: 1.55;">
      <p style="margin: 0 0 8px; color: #4f6552; font-size: 11px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase;">Parent Message</p>
      <h1 style="margin: 0 0 8px; font-size: 26px; line-height: 1.25;">${escapeHtml(subject)}</h1>
      <p style="margin: 0 0 22px; color: #5a6b5b; font-size: 13px;">${escapeHtml([playerName, team, club].filter(Boolean).join(' | '))}</p>
      ${body ? `<div style="border: 1px solid #e7ece3; border-radius: 12px; background: #fbfcf9; padding: 16px; margin: 0 0 22px; font-size: 14px;">${formatLines(body)}</div>` : ''}
      <h2 style="margin: 0 0 12px; font-size: 18px;">Assessment details</h2>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        ${assessmentFields.map((field) => `
          <div style="border: 1px solid #e7ece3; border-radius: 10px; background: #fbfcf9; padding: 10px 12px;">
            <p style="margin: 0 0 4px; color: #4f6552; font-size: 9px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;">${escapeHtml(field.label)}</p>
            <p style="margin: 0; color: #142018; font-size: 13px; line-height: 1.35; font-weight: 700;">${formatLines(field.value)}</p>
          </div>
        `).join('')}
      </div>
      <div style="border-top: 1px solid #e7ece3; margin-top: 20px; padding-top: 14px;">
        <p style="margin: 0; color: #7a8578; font-size: 11px; line-height: 1.45;">Powered by Player Feedback | playerfeedback.online</p>
      </div>
    </div>
  `
}

export function getMessageTeamLabel(message) {
  const metadata = getMessageMetadata(message)
  return String(message?.team ?? metadata.team ?? '').trim()
}

export function getMessageClubLabel(message) {
  const metadata = getMessageMetadata(message)
  return String(message?.club ?? metadata.club ?? '').trim()
}

export function getMessagePlayerLabel(message) {
  const metadata = getMessageMetadata(message)
  return String(message?.playerName ?? metadata.playerName ?? '').trim()
}
