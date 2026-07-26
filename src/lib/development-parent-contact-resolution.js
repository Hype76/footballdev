import {
  isValidDevelopmentParentRecipientEmail,
  normalizeDevelopmentParentRecipientEmail,
} from './development-parent-recipient-contract.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeStatus(value) {
  return normalizeText(value).toLowerCase()
}

function getDisplayName(source) {
  return normalizeText(
    source?.display_name ??
    source?.displayName ??
    source?.name ??
    [source?.first_name ?? source?.firstName, source?.last_name ?? source?.lastName]
      .map(normalizeText)
      .filter(Boolean)
      .join(' '),
  )
}

function matchesId(source, expectedId) {
  return Boolean(source && normalizeText(source.id) === normalizeText(expectedId))
}

function validContact(email) {
  const normalizedEmail = normalizeDevelopmentParentRecipientEmail(email)
  return isValidDevelopmentParentRecipientEmail(normalizedEmail)
    ? normalizedEmail
    : ''
}

export function resolveDevelopmentParentContact({
  link,
  guardian,
  parentProfile,
  authUser,
} = {}) {
  const linkClubId = normalizeText(link?.club_id ?? link?.clubId)
  const guardianId = normalizeText(link?.guardian_id ?? link?.guardianId)
  const authUserId = normalizeText(link?.auth_user_id ?? link?.authUserId)

  if (guardianId) {
    const guardianMatches =
      matchesId(guardian, guardianId) &&
      normalizeText(guardian?.club_id ?? guardian?.clubId) === linkClubId &&
      normalizeStatus(guardian?.status) === 'active'
    const email = guardianMatches ? validContact(guardian?.email) : ''

    return {
      email,
      name: guardianMatches ? getDisplayName(guardian) : '',
      source: 'guardian',
      eligible: Boolean(email),
      communicationsPreferenceExplicit:
        (link?.receives_communications ?? link?.receivesCommunications) === true ||
        (link?.receives_communications ?? link?.receivesCommunications) === false,
    }
  }

  if (authUserId) {
    const authUserMatches = matchesId(authUser, authUserId)
    const authEmail = authUserMatches ? validContact(authUser?.email) : ''

    if (authEmail) {
      return {
        email: authEmail,
        name: getDisplayName(authUser?.user_metadata ?? authUser),
        source: 'auth_user',
        eligible: true,
        communicationsPreferenceExplicit: false,
      }
    }

    const profileMatches = matchesId(parentProfile, authUserId)
    const profileEmail = profileMatches ? validContact(parentProfile?.email) : ''

    return {
      email: profileEmail,
      name: profileMatches ? getDisplayName(parentProfile) : '',
      source: 'parent_profile',
      eligible: Boolean(profileEmail),
      communicationsPreferenceExplicit: false,
    }
  }

  const linkEmail = validContact(link?.email)

  return {
    email: linkEmail,
    name: '',
    source: 'legacy_link_contact',
    eligible: Boolean(linkEmail),
    communicationsPreferenceExplicit: false,
  }
}

export function applyDevelopmentParentContactResolution({
  link,
  guardian,
  parentProfile,
  authUser,
} = {}) {
  const contact = resolveDevelopmentParentContact({
    link,
    guardian,
    parentProfile,
    authUser,
  })

  return {
    ...link,
    resolved_email: contact.email,
    resolved_name: contact.name,
    contact_source: contact.source,
    contact_source_eligible: contact.eligible,
    communications_preference_explicit: contact.communicationsPreferenceExplicit,
  }
}
