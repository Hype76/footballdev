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

export const PARENT_EMAIL_TEMPLATES = [
  { key: 'decline', label: 'No Place Offered' },
  { key: 'progress', label: 'Invite Back' },
  { key: 'offer', label: 'Offer Place' },
]

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
  return PARENT_EMAIL_TEMPLATES.some((template) => template.key === normalizedTemplateKey)
    ? normalizedTemplateKey
    : getEmailTemplateKey(decision)
}

export function buildParentEmailTemplate({
  parentName = '',
  playerName = '',
  coachName = '',
  clubName = '',
  teamName = '',
  session = '',
  decision = 'Progress',
  templateKey = '',
} = {}) {
  const resolvedParentName = normalizeText(parentName, 'Parent/Guardian')
  const resolvedPlayerName = normalizeText(playerName, 'the player')
  const resolvedCoachName = normalizeText(coachName, 'Coaching Team')
  const resolvedClubName = normalizeText(clubName || teamName, 'Club Team')
  const resolvedTeamName = normalizeText(teamName || clubName, resolvedClubName)
  const nextSessionLabel = formatSessionLabel(session)
  const resolvedTemplateKey = getValidEmailTemplateKey(templateKey, decision)
  const greeting = `Dear ${resolvedParentName},`
  let subject = 'Player Trial Feedback'
  let bodyLines = []

  if (resolvedTemplateKey === 'decline') {
    subject = `Player Trial Feedback for ${resolvedPlayerName}`
    bodyLines = [
      greeting,
      '',
      `Thank you so much for bringing ${resolvedPlayerName} along to our recent JPL trial sessions. We really enjoyed having them involved.`,
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
      'Thank you for attending our recent JPL trial sessions.',
      `We were really impressed with ${resolvedPlayerName} and are delighted to offer them a place in our JPL squad for the upcoming season.`,
      '',
      `We would also like to invite ${resolvedPlayerName} to join us for a friendly match on ${nextSessionLabel}. This will be a great opportunity for them to meet the team and get involved.`,
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
      `Thank you for attending our recent JPL trial with ${resolvedPlayerName}. It was great to see them in action.`,
      '',
      'We saw some really positive things and would love to invite them back for another session so we can take a further look. We feel there is definitely potential there and would like to see a bit more.',
      '',
      `We would also like to invite ${resolvedPlayerName} to take part in a friendly match with us on ${nextSessionLabel}. This will give us a chance to see them in a match environment.`,
      '',
      'Please let us know if they are available to attend both the session and the match. We would be delighted to see them again.',
      '',
      'Kind regards,',
      resolvedCoachName,
      resolvedTeamName,
    ]
  }

  const template = PARENT_EMAIL_TEMPLATES.find((item) => item.key === resolvedTemplateKey)

  return {
    key: resolvedTemplateKey,
    label: template?.label || getEmailTemplateLabel(decision),
    subject,
    body: bodyLines.join('\n'),
  }
}

export function buildParentEmailMailtoUrl(template, recipientEmail) {
  const normalizedEmail = normalizeText(recipientEmail)

  if (!normalizedEmail || !template?.subject || !template?.body) {
    return ''
  }

  return `mailto:${encodeURIComponent(normalizedEmail)}?subject=${encodeURIComponent(template.subject)}&body=${encodeURIComponent(template.body)}`
}
