function normalizeText(value) {
  return String(value ?? '').trim()
}

export function normalizeDevelopmentParentRecipientEmail(value) {
  return normalizeText(value).toLowerCase()
}

export function isValidDevelopmentParentRecipientEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(
    normalizeDevelopmentParentRecipientEmail(value),
  )
}

function getConfiguredContact(parentContacts, emails = []) {
  const normalizedEmails = new Set(
    emails
      .map(normalizeDevelopmentParentRecipientEmail)
      .filter(Boolean),
  )

  return (Array.isArray(parentContacts) ? parentContacts : []).find(
    (item) =>
      normalizedEmails.has(
        normalizeDevelopmentParentRecipientEmail(item?.email ?? item?.parentEmail),
      ),
  ) ?? null
}

function getLinkCommunicationPreference(link) {
  const rawPreference = link?.receives_communications ?? link?.receivesCommunications
  const guardianId = normalizeText(link?.guardian_id ?? link?.guardianId)
  const preferenceIsExplicit =
    (link?.communications_preference_explicit ?? link?.communicationsPreferenceExplicit) === true ||
    (Boolean(guardianId) && (rawPreference === true || rawPreference === false))

  return {
    allowed: !(preferenceIsExplicit && rawPreference === false),
    explicit: preferenceIsExplicit,
  }
}

function hasAuthoritativeLinkedRecipientIdentity(link) {
  return Boolean(
    normalizeText(link?.auth_user_id ?? link?.authUserId) ||
    normalizeText(link?.guardian_id ?? link?.guardianId),
  )
}

function getUnavailableReason({
  linkId,
  clubMatches,
  teamMatches,
  playerMatches,
  status,
  communicationsAllowed,
  contactSourceEligible,
  email,
}) {
  if (!linkId) {
    return 'missing_link_id'
  }

  if (!clubMatches || !teamMatches || !playerMatches) {
    return 'outside_record_scope'
  }

  if (status !== 'active') {
    return 'inactive_link'
  }

  if (!communicationsAllowed) {
    return 'communications_disabled'
  }

  if (!contactSourceEligible) {
    return 'contact_source_unavailable'
  }

  if (!isValidDevelopmentParentRecipientEmail(email)) {
    return 'invalid_email'
  }

  return ''
}

export function normalizeDevelopmentParentRecipientCandidate(
  link,
  {
    clubId,
    teamId,
    playerId,
    parentContacts = [],
  } = {},
) {
  const linkId = normalizeText(link?.id ?? link?.linkId)
  const linkClubId = normalizeText(link?.club_id ?? link?.clubId)
  const linkTeamId = normalizeText(link?.team_id ?? link?.teamId)
  const linkPlayerId = normalizeText(link?.player_id ?? link?.playerId)
  const status = normalizeText(link?.status)
  const communicationPreference = getLinkCommunicationPreference(link)
  const email = normalizeDevelopmentParentRecipientEmail(
    link?.resolved_email ?? link?.resolvedEmail ?? link?.email,
  )
  const configuredContact = getConfiguredContact(parentContacts, [
    email,
    link?.email,
  ])
  const resolvedName = normalizeText(link?.resolved_name ?? link?.resolvedName)
  const contactSource = normalizeText(link?.contact_source ?? link?.contactSource) || 'link'
  const contactSourceEligible =
    (link?.contact_source_eligible ?? link?.contactSourceEligible) !== false
  const clubMatches = linkClubId === normalizeText(clubId)
  const teamMatches = !linkTeamId || linkTeamId === normalizeText(teamId)
  const playerMatches = linkPlayerId === normalizeText(playerId)
  const developmentRecipientConfigured = communicationPreference.explicit
    ? communicationPreference.allowed
    : hasAuthoritativeLinkedRecipientIdentity(link) || Boolean(configuredContact)
  const unavailableReason = getUnavailableReason({
    linkId,
    clubMatches,
    teamMatches,
    playerMatches,
    status,
    communicationsAllowed:
      communicationPreference.allowed && developmentRecipientConfigured,
    contactSourceEligible,
    email,
  })

  return {
    linkId,
    name:
      resolvedName ||
      normalizeText(configuredContact?.name ?? configuredContact?.parentName) ||
      normalizeText(link?.relationship) ||
      'Parent or guardian',
    email,
    contactSource,
    recipientIdentitySource: hasAuthoritativeLinkedRecipientIdentity(link)
      ? 'linked_identity'
      : configuredContact
        ? 'configured_contact'
        : 'unavailable',
    communicationsPreferenceExplicit: communicationPreference.explicit,
    type: 'parent',
    primary: (link?.primary_contact ?? link?.primaryContact) === true,
    eligible: !unavailableReason,
    unavailableReason,
  }
}

export function getDevelopmentParentRecipientCandidates({
  links = [],
  clubId,
  teamId,
  playerId,
  parentContacts = [],
} = {}) {
  const candidates = (Array.isArray(links) ? links : [])
    .map((link) =>
      normalizeDevelopmentParentRecipientCandidate(link, {
        clubId,
        teamId,
        playerId,
        parentContacts,
      }),
    )
    .filter((candidate) => candidate.linkId)
    .sort(
      (left, right) =>
        Number(right.primary) - Number(left.primary) ||
        left.name.localeCompare(right.name) ||
        left.email.localeCompare(right.email) ||
        left.linkId.localeCompare(right.linkId),
    )

  const firstEligibleLinkByEmail = new Map()

  return candidates.map((candidate) => {
    if (!candidate.eligible || !candidate.email) {
      return candidate
    }

    const duplicateOfLinkId = firstEligibleLinkByEmail.get(candidate.email) || ''
    if (!duplicateOfLinkId) {
      firstEligibleLinkByEmail.set(candidate.email, candidate.linkId)
    }

    return {
      ...candidate,
      deliveryLinkId: duplicateOfLinkId || candidate.linkId,
      duplicateOfLinkId,
    }
  })
}

export function resolveSelectedDevelopmentParentRecipients({
  links = [],
  clubId,
  teamId,
  playerId,
  parentContacts = [],
  selectedParentLinkIds = [],
} = {}) {
  if (!normalizeText(clubId) || !normalizeText(teamId) || !normalizeText(playerId)) {
    return {
      outcome: 'no_recipient',
      code: 'DEVELOPMENT_PARENT_EMAIL_PLAYER_SCOPE_MISSING',
      recipients: [],
      unavailableLinkIds: [],
    }
  }

  const selectedIds = [
    ...new Set(
      (Array.isArray(selectedParentLinkIds) ? selectedParentLinkIds : [])
        .map(normalizeText)
        .filter(Boolean),
    ),
  ]

  if (selectedIds.length === 0) {
    return {
      outcome: 'no_recipient',
      code: 'DEVELOPMENT_PARENT_EMAIL_SELECTED_LINK_REQUIRED',
      recipients: [],
      unavailableLinkIds: [],
    }
  }

  const candidates = getDevelopmentParentRecipientCandidates({
    links,
    clubId,
    teamId,
    playerId,
    parentContacts,
  })
  const candidatesById = new Map(candidates.map((candidate) => [candidate.linkId, candidate]))
  const selectedCandidates = selectedIds.map((linkId) => candidatesById.get(linkId)).filter(Boolean)
  const unavailableLinkIds = selectedIds.filter(
    (linkId) => candidatesById.get(linkId)?.eligible !== true,
  )
  const eligibleRecipients = selectedCandidates.filter((candidate) => candidate.eligible)
  const ineligibleRecipients = selectedIds
    .filter((linkId) => candidatesById.get(linkId)?.eligible !== true)
    .map((linkId) => {
      const candidate = candidatesById.get(linkId)
      return {
        linkId,
        name: candidate?.name || 'Parent or guardian',
        unavailableReason: candidate?.unavailableReason || 'recipient_not_found',
      }
    })
  const deliveryRecipients = eligibleRecipients.filter(
    (candidate, index, recipients) =>
      recipients.findIndex((item) => item.email === candidate.email) === index,
  )

  if (selectedCandidates.length !== selectedIds.length || unavailableLinkIds.length > 0) {
    return {
      outcome: 'no_recipient',
      code: 'DEVELOPMENT_PARENT_EMAIL_SELECTED_LINK_UNAVAILABLE',
      recipients: [],
      eligibleRecipients,
      ineligibleRecipients,
      deliveryRecipients: [],
      unavailableLinkIds,
    }
  }

  return {
    outcome: 'ready',
    code: 'DEVELOPMENT_PARENT_EMAIL_RECIPIENTS_RESOLVED',
    recipients: selectedCandidates,
    eligibleRecipients: selectedCandidates,
    ineligibleRecipients: [],
    deliveryRecipients,
    unavailableLinkIds: [],
  }
}
