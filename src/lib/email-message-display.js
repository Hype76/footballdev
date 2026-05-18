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
