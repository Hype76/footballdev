import { formatUkDate } from './date-format.js'

function normalizeText(value, fallback = '') {
  const normalizedValue = String(value ?? '').trim()
  return normalizedValue || fallback
}

export function splitPlayerName(playerName = '') {
  const normalizedName = normalizeText(playerName)

  if (!normalizedName) {
    return {
      playerName: '',
      playerFirstName: '',
      playerLastName: '',
    }
  }

  const nameParts = normalizedName.split(/\s+/).filter(Boolean)
  const playerFirstName = nameParts[0] || normalizedName
  const playerLastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : playerFirstName

  return {
    playerName: normalizedName,
    playerFirstName,
    playerLastName,
  }
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

  return formatUkDate(parsedDate.toISOString().slice(0, 10), normalizedValue)
}

function formatTemplateDateValue(value) {
  const normalizedValue = normalizeText(value)

  if (!normalizedValue) {
    return ''
  }

  const parsedDate = new Date(normalizedValue)

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedValue
  }

  return formatUkDate(parsedDate.toISOString().slice(0, 10), normalizedValue)
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

export const EMAIL_TEMPLATE_AUDIENCES = {
  parent: 'parent',
  player: 'player',
}

export const DIRECT_EMAIL_TEMPLATE_SECTION = 'Direct Email'
export const EMAIL_TEMPLATE_SECTIONS = ['Trial', 'Squad', DIRECT_EMAIL_TEMPLATE_SECTION]

export const EMAIL_TEMPLATE_FIELDS = [
  { key: 'recipientName', label: 'Recipient name' },
  { key: 'parentName', label: 'Parent name' },
  { key: 'playerName', label: 'Player full name' },
  { key: 'playerFirstName', label: 'Player first name' },
  { key: 'playerLastName', label: 'Player last name' },
  { key: 'coachName', label: 'Coach name' },
  { key: 'clubName', label: 'Club name' },
  { key: 'teamName', label: 'Team name' },
  { key: 'session', label: 'Session' },
  { key: 'inviteDate', label: 'Invite date' },
  { key: 'summary', label: 'Summary' },
]

const EMAIL_TEMPLATE_FIELD_KEYS = new Set(EMAIL_TEMPLATE_FIELDS.map((field) => field.key))

export function normalizePlayerNameTemplateField(value) {
  return String(value ?? '').replace(/\{playerName\}/g, '{playerFirstName}')
}

export const DEFAULT_PARENT_EMAIL_TEMPLATES = [
  {
    key: 'decline',
    label: 'No Place Offered',
    sectionAvailability: ['Trial', DIRECT_EMAIL_TEMPLATE_SECTION],
    subject: 'Player Trial Feedback for {playerFirstName}',
    body: [
      'Dear {parentName},',
      '',
      'Thank you so much for bringing {playerFirstName} along to {session}. We really enjoyed having them involved.',
      '',
      'Unfortunately, on this occasion we will not be offering {playerFirstName} a place in the squad. We had a very strong group trialling, which made it a tough decision.',
      '',
      'We want to say how much we appreciated {playerFirstName} and their effort throughout, and we wish them all the very best for the upcoming season and their continued football journey.',
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
    sectionAvailability: ['Trial', DIRECT_EMAIL_TEMPLATE_SECTION],
    subject: 'Follow-up Trial Invitation for {playerFirstName}',
    body: [
      'Dear {parentName},',
      '',
      'Thank you for attending {session} with {playerFirstName}. It was great to see them in action.',
      '',
      'We saw some really positive things and would love to invite them back for another session so we can take a further look.',
      '',
      'We would also like to invite {playerFirstName} to take part in a friendly match with us on {inviteDate}. This will give us a chance to see them in a match environment.',
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
    sectionAvailability: ['Trial', DIRECT_EMAIL_TEMPLATE_SECTION],
    subject: 'Squad Offer for {playerFirstName}',
    body: [
      'Dear {parentName},',
      '',
      'Thank you for attending {session}.',
      'We were really impressed with {playerFirstName} and are delighted to offer them a place in our squad for the upcoming season.',
      '',
      'We would also like to invite {playerFirstName} to join us for a friendly match on {inviteDate}. This will be a great opportunity for them to meet the team and get involved.',
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
    sectionAvailability: ['Squad', DIRECT_EMAIL_TEMPLATE_SECTION],
    subject: 'Football Player for {playerFirstName}',
    body: [
      'Dear {parentName},',
      '',
      'Please find the latest feedback report for {playerFirstName}.',
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

export const DEFAULT_PLAYER_EMAIL_TEMPLATES = [
  {
    key: 'decline',
    label: 'No Place Offered',
    sectionAvailability: ['Trial', DIRECT_EMAIL_TEMPLATE_SECTION],
    subject: 'Player Trial Feedback for {playerFirstName}',
    body: [
      'Dear {playerFirstName},',
      '',
      'Thank you so much for coming along to {session}. We really enjoyed having you involved.',
      '',
      'Unfortunately, on this occasion we will not be offering you a place in the squad. We had a very strong group trialling, which made it a tough decision.',
      '',
      'We want to say how much we appreciated your effort throughout, and we wish you all the very best for the upcoming season and your continued football journey.',
      '',
      'Thanks again for your time.',
      'Kind regards,',
      '{coachName}',
      '{teamName}',
    ].join('\n'),
  },
  {
    key: 'progress',
    label: 'Invite Back',
    sectionAvailability: ['Trial', DIRECT_EMAIL_TEMPLATE_SECTION],
    subject: 'Follow-up Trial Invitation for {playerFirstName}',
    body: [
      'Dear {playerFirstName},',
      '',
      'Thank you for attending {session}. It was great to see you in action.',
      '',
      'We saw some really positive things and would love to invite you back for another session so we can take a further look.',
      '',
      'We would also like to invite you to take part in a friendly match with us on {inviteDate}. This will give us a chance to see you in a match environment.',
      '',
      'Please let us know if you are available to attend both the session and the match.',
      '',
      'Kind regards,',
      '{coachName}',
      '{teamName}',
    ].join('\n'),
  },
  {
    key: 'offer',
    label: 'Offer Place',
    sectionAvailability: ['Trial', DIRECT_EMAIL_TEMPLATE_SECTION],
    subject: 'Squad Offer for {playerFirstName}',
    body: [
      'Dear {playerFirstName},',
      '',
      'Thank you for attending {session}.',
      'We were really impressed with you and are delighted to offer you a place in our squad for the upcoming season.',
      '',
      'We would also like to invite you to join us for a friendly match on {inviteDate}. This will be a great opportunity to meet the team and get involved.',
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
    sectionAvailability: ['Squad', DIRECT_EMAIL_TEMPLATE_SECTION],
    subject: 'Football Player for {playerFirstName}',
    body: [
      'Dear {playerFirstName},',
      '',
      'Please find your latest feedback report.',
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

export function normalizeEmailTemplateAudience(value) {
  return String(value ?? '').trim().toLowerCase() === EMAIL_TEMPLATE_AUDIENCES.player
    ? EMAIL_TEMPLATE_AUDIENCES.player
    : EMAIL_TEMPLATE_AUDIENCES.parent
}

export function getDefaultParentEmailTemplates() {
  return DEFAULT_PARENT_EMAIL_TEMPLATES.map((template, index) => ({
    ...template,
    audience: EMAIL_TEMPLATE_AUDIENCES.parent,
    orderIndex: index + 1,
    isEnabled: true,
    isDefaultTemplate: true,
  }))
}

export function getDefaultPlayerEmailTemplates() {
  return DEFAULT_PLAYER_EMAIL_TEMPLATES.map((template, index) => ({
    ...template,
    audience: EMAIL_TEMPLATE_AUDIENCES.player,
    orderIndex: index + 1,
    isEnabled: true,
    isDefaultTemplate: true,
  }))
}

export function getDefaultEmailTemplates(audience = EMAIL_TEMPLATE_AUDIENCES.parent) {
  return normalizeEmailTemplateAudience(audience) === EMAIL_TEMPLATE_AUDIENCES.player
    ? getDefaultPlayerEmailTemplates()
    : getDefaultParentEmailTemplates()
}

export function mergeEmailTemplatesWithDefaults(savedTemplates = [], audience = 'all') {
  const audiences = String(audience ?? '').trim().toLowerCase() === 'all'
    ? [EMAIL_TEMPLATE_AUDIENCES.parent, EMAIL_TEMPLATE_AUDIENCES.player]
    : [normalizeEmailTemplateAudience(audience)]
  const savedTemplatesList = Array.isArray(savedTemplates) ? savedTemplates : []

  return audiences.flatMap((templateAudience) => {
    const defaultTemplates = getDefaultEmailTemplates(templateAudience)
    const defaultKeys = new Set(defaultTemplates.map((template) => template.key))
    const savedByKey = new Map(
      savedTemplatesList
        .filter((template) => normalizeEmailTemplateAudience(template.audience) === templateAudience)
        .map((template) => [template.key, template]),
    )
    const mergedDefaults = defaultTemplates.map((defaultTemplate) => {
      const savedTemplate = savedByKey.get(defaultTemplate.key)

      return {
        ...defaultTemplate,
        ...(savedTemplate ?? {}),
        isCustom: false,
        isDefaultTemplate: true,
      }
    })
    const customTemplates = savedTemplatesList
      .filter(
        (template) =>
          normalizeEmailTemplateAudience(template.audience) === templateAudience &&
          !defaultKeys.has(template.key),
      )
      .map((template) => ({
        ...template,
        isCustom: true,
        isDefaultTemplate: false,
      }))

    return [...mergedDefaults, ...customTemplates]
  })
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

  const playerNameFields = splitPlayerName(fields.playerName)
  const templateFields = {
    ...playerNameFields,
    ...fields,
    playerName: normalizeText(fields.playerName || playerNameFields.playerName),
    playerFirstName: normalizeText(fields.playerFirstName || playerNameFields.playerFirstName),
    playerLastName: normalizeText(fields.playerLastName || playerNameFields.playerLastName),
    session: formatTemplateDateValue(fields.session),
    inviteDate: formatTemplateDateValue(fields.inviteDate),
  }

  return {
    key: template.key,
    audience: normalizeEmailTemplateAudience(template.audience),
    label: template.label || getParentEmailTemplateLabel(template.key),
    subject: renderTemplateText(template.subject, templateFields),
    body: renderTemplateText(template.body, templateFields),
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
  const resolvedPlayerFirstName = normalizeText(splitPlayerName(resolvedPlayerName).playerFirstName, resolvedPlayerName)
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
    subject = `Football Player for ${resolvedPlayerFirstName}`
    bodyLines = [
      greeting,
      '',
      `Please find the latest feedback report for ${resolvedPlayerFirstName}.`,
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
    subject = `Player Trial Feedback for ${resolvedPlayerFirstName}`
    bodyLines = [
      greeting,
      '',
      `Thank you so much for bringing ${resolvedPlayerFirstName} along to ${currentSessionPhrase}. We really enjoyed having them involved.`,
      '',
      `Unfortunately, on this occasion we will not be offering ${resolvedPlayerFirstName} a place in the squad. We had a very strong group trialling, which made it a tough decision.`,
      '',
      `We want to say how much we appreciated ${resolvedPlayerFirstName}'s effort and attitude throughout, and we wish them all the very best for the upcoming season and their continued football journey.`,
      '',
      'Thanks again for your time and support.',
      'Kind regards,',
      resolvedCoachName,
      resolvedTeamName,
    ]
  } else if (resolvedTemplateKey === 'offer') {
    subject = `Squad Offer for ${resolvedPlayerFirstName}`
    bodyLines = [
      greeting,
      '',
      `Thank you for attending ${currentSessionPhrase}.`,
      `We were really impressed with ${resolvedPlayerFirstName} and are delighted to offer them a place in our JPL squad for the upcoming season.`,
      '',
      `We would also like to invite ${resolvedPlayerFirstName} to join us for a friendly match on ${inviteSessionLabel}. This will be a great opportunity for them to meet the team and get involved.`,
      '',
      `We feel they will be a great addition to the squad and are excited to support their development.`,
      '',
      "Please let us know if you would like to accept the place, and we will send over full details for next steps, training, and the season ahead.",
      '',
      `We are really looking forward to hopefully welcoming ${resolvedPlayerFirstName} to the team.`,
      '',
      'Kind regards,',
      resolvedCoachName,
      resolvedTeamName,
    ]
  } else {
    subject = `Follow-up Trial Invitation for ${resolvedPlayerFirstName}`
    bodyLines = [
      greeting,
      '',
      `Thank you for attending ${currentSessionPhrase} with ${resolvedPlayerFirstName}. It was great to see them in action.`,
      '',
      'We saw some really positive things and would love to invite them back for another session so we can take a further look. We feel there is definitely potential there and would like to see a bit more.',
      '',
      `We would also like to invite ${resolvedPlayerFirstName} to take part in a friendly match with us on ${inviteSessionLabel}. This will give us a chance to see them in a match environment.`,
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
