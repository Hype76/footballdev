function normalizeText(value, fallback = '') {
  const normalizedValue = String(value ?? '').trim()
  return normalizedValue || fallback
}

function formatSessionLabel(session) {
  const normalizedValue = normalizeText(session)

  if (!normalizedValue) {
    return 'our next trial date'
  }

  const parsedDate = new Date(normalizedValue)

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedValue
  }

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsedDate)
}

function formatCurrentSessionPhrase(session) {
  const normalizedSession = normalizeText(session)

  if (!normalizedSession) {
    return 'our recent JPL trial'
  }

  return `our recent JPL trial session on ${formatSessionLabel(normalizedSession)}`
}

export const PARENT_EMAIL_TEMPLATES = [
  { key: 'decline', label: 'No Place Offered' },
  { key: 'progress', label: 'Invite Back' },
  { key: 'offer', label: 'Offer Place' },
]

export const ASSESSMENT_EMAIL_TEMPLATE = { key: 'assessment', label: 'Send Assessment' }

export const EMAIL_TEMPLATE_FIELDS = [
  { key: 'parentName', label: 'Parent name' },
  { key: 'playerName', label: 'Player name' },
  { key: 'coachName', label: 'Coach name' },
  { key: 'clubName', label: 'Club name' },
  { key: 'teamName', label: 'Team name' },
  { key: 'session', label: 'Session' },
  { key: 'inviteDate', label: 'Invite date' },
  { key: 'summary', label: 'Summary' },
]

const EMAIL_TEMPLATE_FIELD_KEYS = new Set(EMAIL_TEMPLATE_FIELDS.map((field) => field.key))

export const DEFAULT_PARENT_EMAIL_TEMPLATES = [
  {
    key: 'decline',
    label: 'No Place Offered',
    subject: 'Player Trial Feedback for {playerName}',
    body: [
      'Dear {parentName},',
      '',
      'Thank you so much for bringing {playerName} along to {session}. We really enjoyed having them involved.',
      '',
      'Unfortunately, on this occasion we will not be offering {playerName} a place in the squad. We had a very strong group trialling, which made it a tough decision.',
      '',
      'We want to say how much we appreciated {playerName} and their effort throughout, and we wish them all the very best for the upcoming season and their continued football journey.',
      '',
      'Thanks again for your time and support.',
      'Kind regards,',
      '{coachName}',
      '{teamName}',
    ].join('\n'),
  },
  {
    key: 'progress',
    label: 'Invite Back',
    subject: 'Follow-up Trial Invitation for {playerName}',
    body: [
      'Dear {parentName},',
      '',
      'Thank you for attending {session} with {playerName}. It was great to see them in action.',
      '',
      'We saw some really positive things and would love to invite them back for another session so we can take a further look.',
      '',
      'We would also like to invite {playerName} to take part in a friendly match with us on {inviteDate}. This will give us a chance to see them in a match environment.',
      '',
      'Please let us know if they are available to attend both the session and the match.',
      '',
      'Kind regards,',
      '{coachName}',
      '{teamName}',
    ].join('\n'),
  },
  {
    key: 'offer',
    label: 'Offer Place',
    subject: 'Squad Offer for {playerName}',
    body: [
      'Dear {parentName},',
      '',
      'Thank you for attending {session}.',
      'We were really impressed with {playerName} and are delighted to offer them a place in our squad for the upcoming season.',
      '',
      'We would also like to invite {playerName} to join us for a friendly match on {inviteDate}. This will be a great opportunity for them to meet the team and get involved.',
      '',
      'Please let us know if you would like to accept the place, and we will send over full details for next steps, training, and the season ahead.',
      '',
      'Kind regards,',
      '{coachName}',
      '{teamName}',
    ].join('\n'),
  },
  {
    key: 'assessment',
    label: 'Send Assessment',
    subject: 'Player Feedback for {playerName}',
    body: [
      'Dear {parentName},',
      '',
      'Please find the latest feedback report for {playerName}.',
      '',
      '{summary}',
      '',
      'The assessment details are included below and attached as a PDF for your records.',
      '',
      'If you have any questions, please reply to this email.',
      '',
      'Kind regards,',
      '{coachName}',
      '{teamName}',
    ].join('\n'),
  },
]

export function getDefaultParentEmailTemplates() {
  return DEFAULT_PARENT_EMAIL_TEMPLATES.map((template, index) => ({
    ...template,
    orderIndex: index + 1,
    isEnabled: true,
  }))
}

export function isInviteEmailTemplate(templateKey) {
  return templateKey === 'progress' || templateKey === 'offer'
}

export function getEmailTemplateKey(decision) {
  const normalizedDecision = normalizeText(decision, 'Progress').toLowerCase()

  if (normalizedDecision === 'yes') {
    return 'offer'
  }

  if (normalizedDecision === 'no') {
    return 'decline'
  }

  return 'progress'
}

export function getEmailTemplateLabel(decision) {
  const templateKey = getEmailTemplateKey(decision)

  if (templateKey === 'offer') {
    return 'Offer Place'
  }

  if (templateKey === 'decline') {
    return 'Decline'
  }

  return 'Invite Back'
}

function getValidEmailTemplateKey(templateKey, decision) {
  const normalizedTemplateKey = normalizeText(templateKey).toLowerCase()
  return [...PARENT_EMAIL_TEMPLATES, ASSESSMENT_EMAIL_TEMPLATE].some((template) => template.key === normalizedTemplateKey)
    ? normalizedTemplateKey
    : getEmailTemplateKey(decision)
}

function getTemplateTokens(value) {
  return [...String(value ?? '').matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map((match) => match[1])
}

export function validateParentEmailTemplateContent({ subject = '', body = '' } = {}) {
  const invalidTokens = [...new Set([...getTemplateTokens(subject), ...getTemplateTokens(body)].filter((token) => !EMAIL_TEMPLATE_FIELD_KEYS.has(token)))]

  if (invalidTokens.length > 0) {
    throw new Error(`Unknown template field${invalidTokens.length === 1 ? '' : 's'}: ${invalidTokens.join(', ')}`)
  }
}

export function getParentEmailTemplateLabel(templateKey) {
  return [...PARENT_EMAIL_TEMPLATES, ASSESSMENT_EMAIL_TEMPLATE].find((template) => template.key === templateKey)?.label || 'Parent Email'
}

function renderTemplateText(value, fields) {
  return String(value ?? '').replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, key) => {
    if (!EMAIL_TEMPLATE_FIELD_KEYS.has(key)) {
      return match
    }

    return normalizeText(fields[key])
  })
}

export function renderParentEmailTemplate(template, fields = {}) {
  if (!template?.subject || !template?.body) {
    return {
      key: template?.key || '',
      label: template?.label || 'Parent Email',
      subject: '',
      body: '',
    }
  }

  return {
    key: template.key,
    label: template.label || getParentEmailTemplateLabel(template.key),
    subject: renderTemplateText(template.subject, fields),
    body: renderTemplateText(template.body, fields),
  }
}

export function buildParentEmailTemplate({
  parentName = '',
  playerName = '',
  coachName = '',
  clubName = '',
  teamName = '',
  session = '',
  inviteDate = '',
  decision = 'Progress',
  templateKey = '',
} = {}) {
  const resolvedParentName = normalizeText(parentName, 'Parent/Guardian')
  const resolvedPlayerName = normalizeText(playerName, 'the player')
  const resolvedCoachName = normalizeText(coachName, 'Coaching Team')
  const resolvedClubName = normalizeText(clubName || teamName, 'Club Team')
  const resolvedTeamName = normalizeText(teamName || clubName, resolvedClubName)
  const currentSessionPhrase = formatCurrentSessionPhrase(session)
  const inviteSessionLabel = formatSessionLabel(inviteDate)
  const resolvedTemplateKey = getValidEmailTemplateKey(templateKey, decision)
  const greeting = `Dear ${resolvedParentName},`
  let subject = 'Player Trial Feedback'
  let bodyLines = []

  if (resolvedTemplateKey === 'assessment') {
    subject = `Player Feedback for ${resolvedPlayerName}`
    bodyLines = [
      greeting,
      '',
      `Please find the latest feedback report for ${resolvedPlayerName}.`,
      '',
      'The assessment details are included below and attached as a PDF for your records.',
      '',
      'If you have any questions, please reply to this email.',
      '',
      'Kind regards,',
      resolvedCoachName,
      resolvedTeamName,
    ]
  } else if (resolvedTemplateKey === 'decline') {
    subject = `Player Trial Feedback for ${resolvedPlayerName}`
    bodyLines = [
      greeting,
      '',
      `Thank you so much for bringing ${resolvedPlayerName} along to ${currentSessionPhrase}. We really enjoyed having them involved.`,
      '',
      `Unfortunately, on this occasion we will not be offering ${resolvedPlayerName} a place in the squad. We had a very strong group trialling, which made it a tough decision.`,
      '',
      `We want to say how much we appreciated ${resolvedPlayerName}'s effort and attitude throughout, and we wish them all the very best for the upcoming season and their continued football journey.`,
      '',
      'Thanks again for your time and support.',
      'Kind regards,',
      resolvedCoachName,
      resolvedTeamName,
    ]
  } else if (resolvedTemplateKey === 'offer') {
    subject = `Squad Offer for ${resolvedPlayerName}`
    bodyLines = [
      greeting,
      '',
      `Thank you for attending ${currentSessionPhrase}.`,
      `We were really impressed with ${resolvedPlayerName} and are delighted to offer them a place in our JPL squad for the upcoming season.`,
      '',
      `We would also like to invite ${resolvedPlayerName} to join us for a friendly match on ${inviteSessionLabel}. This will be a great opportunity for them to meet the team and get involved.`,
      '',
      `We feel they will be a great addition to the squad and are excited to support their development.`,
      '',
      "Please let us know if you would like to accept the place, and we will send over full details for next steps, training, and the season ahead.",
      '',
      `We are really looking forward to hopefully welcoming ${resolvedPlayerName} to the team.`,
      '',
      'Kind regards,',
      resolvedCoachName,
      resolvedTeamName,
    ]
  } else {
    subject = `Follow-up Trial Invitation for ${resolvedPlayerName}`
    bodyLines = [
      greeting,
      '',
      `Thank you for attending ${currentSessionPhrase} with ${resolvedPlayerName}. It was great to see them in action.`,
      '',
      'We saw some really positive things and would love to invite them back for another session so we can take a further look. We feel there is definitely potential there and would like to see a bit more.',
      '',
      `We would also like to invite ${resolvedPlayerName} to take part in a friendly match with us on ${inviteSessionLabel}. This will give us a chance to see them in a match environment.`,
      '',
      'Please let us know if they are available to attend both the session and the match. We would be delighted to see them again.',
      '',
      'Kind regards,',
      resolvedCoachName,
      resolvedTeamName,
    ]
  }

  const template = [...PARENT_EMAIL_TEMPLATES, ASSESSMENT_EMAIL_TEMPLATE].find((item) => item.key === resolvedTemplateKey)

  return {
    key: resolvedTemplateKey,
    label: template?.label || getEmailTemplateLabel(decision),
    subject,
    body: bodyLines.join('\n'),
  }
}

export function buildParentEmailMailtoUrl(template, recipientEmail) {
  const normalizedEmail = String(recipientEmail ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
    .join(',')

  if (!normalizedEmail || !template?.subject || !template?.body) {
    return ''
  }

  return `mailto:${normalizedEmail
    .split(',')
    .map((email) => encodeURIComponent(email))
    .join(',')}?subject=${encodeURIComponent(template.subject)}&body=${encodeURIComponent(template.body)}`
}
