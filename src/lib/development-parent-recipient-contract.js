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

function getContactNameByEmail(parentContacts, email) {
  const normalizedEmail = normalizeDevelopmentParentRecipientEmail(email)
  const contact = (Array.isArray(parentContacts) ? parentContacts : []).find(
    (item) =>
      normalizeDevelopmentParentRecipientEmail(item?.email ?? item?.parentEmail) === normalizedEmail,
  )

  return normalizeText(contact?.name ?? contact?.parentName)
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
  const resolvedName = normalizeText(link?.resolved_name ?? link?.resolvedName)
  const contactSource = normalizeText(link?.contact_source ?? link?.contactSource) || 'link'
  const contactSourceEligible =
    (link?.contact_source_eligible ?? link?.contactSourceEligible) !== false
  const clubMatches = linkClubId === normalizeText(clubId)
  const teamMatches = !linkTeamId || linkTeamId === normalizeText(teamId)
  const playerMatches = linkPlayerId === normalizeText(playerId)
  const unavailableReason = getUnavailableReason({
    linkId,
    clubMatches,
    teamMatches,
    playerMatches,
    status,
    communicationsAllowed: communicationPreference.allowed,
    contactSourceEligible,
    email,
  })

  return {
    linkId,
    name:
      resolvedName ||
      getContactNameByEmail(parentContacts, email) ||
      normalizeText(link?.relationship) ||
      'Parent or guardian',
    email,
    contactSource,
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
  return (Array.isArray(links) ? links : [])
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

  if (selectedCandidates.length !== selectedIds.length || unavailableLinkIds.length > 0) {
    return {
      outcome: 'no_recipient',
      code: 'DEVELOPMENT_PARENT_EMAIL_SELECTED_LINK_UNAVAILABLE',
      recipients: [],
      unavailableLinkIds,
    }
  }

  return {
    outcome: 'ready',
    code: 'DEVELOPMENT_PARENT_EMAIL_RECIPIENTS_RESOLVED',
    recipients: selectedCandidates,
    unavailableLinkIds: [],
  }
}
