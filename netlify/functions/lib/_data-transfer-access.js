import { CAPABILITIES, getFeatureAccess } from '../../../src/lib/paywall-access.js'
import { isDemoEmail } from '../../../src/lib/demo.js'

export const DATA_TRANSFER_FEATURE = CAPABILITIES.bulkInvitesImports
export const DATA_TRANSFER_ALLOWED_ROLES = Object.freeze([
  'super_admin',
  'admin',
  'head_manager',
  'manager',
  'coach',
])
export const DATA_TRANSFER_TEAM_SCOPED_ROLES = Object.freeze([
  'head_manager',
  'manager',
  'coach',
])

const ALLOWED_ROLE_SET = new Set(DATA_TRANSFER_ALLOWED_ROLES)
const TEAM_SCOPED_ROLE_SET = new Set(DATA_TRANSFER_TEAM_SCOPED_ROLES)
const MINIMUM_ROLE_RANK = Object.freeze({
  admin: 50,
  coach: 20,
  head_manager: 50,
  manager: 50,
})
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,99}$/i

const GUARDIAN_CONTACT_FIELDS = new Set([
  'email',
  'guardian_email',
  'guardian_phone',
  'parent_email',
  'parent_phone',
  'phone',
])
const GUARDIAN_POSTAL_FIELDS = new Set([
  'address_line_1',
  'address_line_2',
  'country',
  'county',
  'guardian_address_line_1',
  'guardian_address_line_2',
  'guardian_country',
  'guardian_county',
  'guardian_postcode',
  'guardian_town_city',
  'parent_address_line_1',
  'parent_address_line_2',
  'parent_country',
  'parent_county',
  'parent_postcode',
  'parent_town_city',
  'postcode',
  'town_city',
])

const TEAM_EXPORT_FIELDS = Object.freeze([
  'id',
  'club_id',
  'name',
  'transfer_reference',
  'age_group',
  'category',
  'season',
  'league',
  'division',
  'home_ground',
  'training_day',
  'training_time',
  'status',
  'updated_at',
])
const PLAYER_EXPORT_FIELDS = Object.freeze([
  'id',
  'club_id',
  'team_id',
  'team',
  'player_name',
  'first_name',
  'last_name',
  'preferred_name',
  'transfer_reference',
  'date_of_birth',
  'gender',
  'section',
  'shirt_number',
  'positions',
  'status',
  'updated_at',
])
const GUARDIAN_IDENTITY_FIELDS = Object.freeze([
  'id',
  'club_id',
  'transfer_reference',
  'first_name',
  'last_name',
  'status',
  'updated_at',
])
const GUARDIAN_CONTACT_EXPORT_FIELDS = Object.freeze(['email', 'phone'])
const GUARDIAN_POSTAL_EXPORT_FIELDS = Object.freeze([
  'address_line_1',
  'address_line_2',
  'town_city',
  'county',
  'postcode',
  'country',
])
const LINK_EXPORT_FIELDS = Object.freeze([
  'id',
  'club_id',
  'team_id',
  'player_id',
  'guardian_id',
  'relationship',
  'primary_contact',
  'receives_communications',
  'emergency_contact',
  'status',
])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeRole(value) {
  return normalizeText(value).toLowerCase()
}

function isPastDate(value, now = Date.now()) {
  const parsed = Date.parse(normalizeText(value))
  return Number.isFinite(parsed) && parsed <= now
}

function entitlementDenied(code, message, accessReason = '') {
  return {
    accessReason,
    allowed: false,
    code,
    feature: DATA_TRANSFER_FEATURE,
    message,
  }
}

export function getDataTransferEntitlementDecision({ actor = {}, club = null, now = Date.now() } = {}) {
  const role = normalizeRole(actor.role)
  if (!ALLOWED_ROLE_SET.has(role)) {
    return entitlementDenied('ROLE_NOT_ALLOWED', 'Data Transfer is not available for this role.', 'role_not_allowed')
  }

  const minimumRoleRank = MINIMUM_ROLE_RANK[role]
  if (minimumRoleRank && Number(actor.roleRank ?? actor.role_rank ?? 0) < minimumRoleRank) {
    return entitlementDenied('ROLE_NOT_ALLOWED', 'Data Transfer is not available for this role.', 'role_rank_not_allowed')
  }

  if (isDemoEmail(actor.email)) {
    return entitlementDenied('FEATURE_NOT_AVAILABLE', 'Data Transfer is not available in demo accounts.', 'demo_not_allowed')
  }

  if (role === 'super_admin') {
    return {
      accessReason: 'platform_admin_override',
      allowed: true,
      code: '',
      feature: DATA_TRANSFER_FEATURE,
      message: '',
      planKey: 'platform',
    }
  }

  const clubId = normalizeText(club?.id || actor.clubId || actor.club_id)
  if (!clubId || !club) {
    return entitlementDenied('FEATURE_NOT_AVAILABLE', 'Data Transfer entitlement could not be resolved.', 'missing_club_context')
  }

  if (normalizeText(club.status || 'active').toLowerCase() !== 'active') {
    return entitlementDenied('PLAN_INACTIVE', 'This club workspace is not active.', 'club_inactive')
  }

  if (isPastDate(club.tester_access_expires_at, now)) {
    return entitlementDenied('PLAN_EXPIRED', 'The temporary Data Transfer entitlement has expired.', 'tester_access_expired')
  }

  const access = getFeatureAccess({
    clubId,
    isPlanComped: Boolean(club.is_plan_comped),
    planKey: club.plan_key,
    planStatus: club.plan_status,
    role,
    roleRank: Number(actor.roleRank ?? actor.role_rank ?? 0),
  }, DATA_TRANSFER_FEATURE)

  if (access.allowed) {
    return {
      accessReason: access.reason,
      allowed: true,
      code: '',
      feature: DATA_TRANSFER_FEATURE,
      message: '',
      planKey: access.planKey,
    }
  }

  const reason = normalizeText(access.reason).toLowerCase()
  if (reason === 'role_not_allowed') {
    return entitlementDenied('ROLE_NOT_ALLOWED', 'Data Transfer is not available for this role.', reason)
  }
  if (reason === 'invalid_payment_state:expired' || reason === 'invalid_payment_state:incomplete_expired') {
    return entitlementDenied('PLAN_EXPIRED', 'The Data Transfer plan entitlement has expired.', reason)
  }
  if (reason === 'no_subscription' || reason.startsWith('invalid_payment_state:') || reason.startsWith('unsupported_payment_state:')) {
    return entitlementDenied('PLAN_INACTIVE', 'An active plan is required to use Data Transfer.', reason)
  }
  return entitlementDenied('FEATURE_NOT_AVAILABLE', 'Data Transfer is not included in the current plan.', reason)
}

function accessError(message, code, statusCode = 403) {
  return Object.assign(new Error(message), { code, expose: true, statusCode })
}

function hasUntrustedTeamSelectors(body = {}) {
  return [
    body.teamName,
    body.teamReference,
    body.teamTransferReference,
  ].some((value) => normalizeText(value))
    || ['teamNames', 'teamReferences', 'teamTransferReferences'].some(
      (key) => Array.isArray(body[key]) && body[key].some((value) => normalizeText(value)),
    )
}

export function resolveDataTransferTeamSelection({
  actor = {},
  allTeams = [],
  assignedTeamIds = [],
  body = {},
  requireSelection = false,
} = {}) {
  const role = normalizeRole(actor.role)
  const canManageAllTeams = role === 'super_admin' || role === 'admin'
  const teamScoped = TEAM_SCOPED_ROLE_SET.has(role)
  const requestedTeamIds = Array.isArray(body.teamIds)
    ? [...new Set(body.teamIds.map(normalizeText).filter(Boolean))]
    : []
  const requestedClubWideScope = body.clubWideScope === true
  const assignedIds = new Set(assignedTeamIds.map(normalizeText).filter(Boolean))
  const authorizedTeamPool = canManageAllTeams
    ? [...allTeams]
    : allTeams.filter((team) => assignedIds.has(normalizeText(team.id)))

  if (!canManageAllTeams && !authorizedTeamPool.length) {
    throw accessError('No authorized team assignment is available for Data Transfer.', 'TEAM_SCOPE_DENIED')
  }
  if (hasUntrustedTeamSelectors(body)) {
    throw accessError('Team authority must use one server-verified selected team.', 'TEAM_SCOPE_DENIED')
  }
  if (requestedClubWideScope && !canManageAllTeams) {
    throw accessError('Club-wide scope is not available for this role.', 'TEAM_SCOPE_DENIED')
  }
  if (requestedClubWideScope && requestedTeamIds.length) {
    throw accessError('Choose either club-wide scope or selected teams.', 'SCOPE_SELECTION_CONFLICT', 400)
  }
  if (teamScoped && requestedTeamIds.length > 1) {
    throw accessError('Select one authorized team at a time.', 'TEAM_SCOPE_DENIED')
  }
  if (requireSelection && !requestedClubWideScope && !requestedTeamIds.length) {
    throw accessError('Select one or more authorized teams.', 'TEAM_SCOPE_REQUIRED', 400)
  }

  let authorizedTeams = authorizedTeamPool
  if (requestedTeamIds.length) {
    const allowedIds = new Set(authorizedTeamPool.map((team) => normalizeText(team.id)))
    if (requestedTeamIds.some((id) => !allowedIds.has(id))) {
      throw accessError('One or more selected teams are outside your authorized scope.', 'TEAM_SCOPE_DENIED')
    }
    authorizedTeams = authorizedTeamPool.filter((team) => requestedTeamIds.includes(normalizeText(team.id)))
  }
  if (!canManageAllTeams && requireSelection && authorizedTeams.length !== 1) {
    throw accessError('Select one authorized team.', 'TEAM_SCOPE_REQUIRED', 400)
  }

  return {
    authorizedTeams,
    canManageAllTeams,
    isClubWideScope: canManageAllTeams && (requestedClubWideScope || (!requireSelection && !requestedTeamIds.length)),
    requiresSingleTeamSelection: teamScoped,
  }
}

export function getDataTransferFieldPolicy(actor = {}) {
  const role = normalizeRole(actor.role)
  const fullClubPolicy = role === 'super_admin' || role === 'admin'
  const guardianContactFields = fullClubPolicy || role === 'head_manager' || role === 'manager'
  return Object.freeze({
    guardianContactFields,
    guardianIdentityFields: ALLOWED_ROLE_SET.has(role),
    guardianPostalFields: fullClubPolicy,
    key: fullClubPolicy
      ? 'club_full'
      : guardianContactFields
        ? 'team_operational_contacts'
        : 'team_player_membership',
    role,
  })
}

function pickFields(row, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(row || {}, field)).map((field) => [field, row[field]]))
}

export function applyDataTransferExportFieldPolicy(existing = {}, fieldPolicy = {}) {
  const guardianFields = [
    ...GUARDIAN_IDENTITY_FIELDS,
    ...(fieldPolicy.guardianContactFields ? GUARDIAN_CONTACT_EXPORT_FIELDS : []),
    ...(fieldPolicy.guardianPostalFields ? GUARDIAN_POSTAL_EXPORT_FIELDS : []),
  ]
  return {
    club: existing.club ? { ...existing.club } : null,
    guardians: (existing.guardians || []).map((guardian) => pickFields(guardian, guardianFields)),
    legacyGuardianEmails: fieldPolicy.guardianContactFields ? [...(existing.legacyGuardianEmails || [])] : [],
    links: (existing.links || []).map((link) => ({
      ...pickFields(link, LINK_EXPORT_FIELDS),
      ...(fieldPolicy.guardianContactFields && Object.hasOwn(link, 'email') ? { email: link.email } : {}),
    })),
    players: (existing.players || []).map((player) => pickFields(player, PLAYER_EXPORT_FIELDS)),
    restrictedGuardianEmails: [],
    restrictedGuardianReferences: [...(existing.restrictedGuardianReferences || [])],
    restrictedPlayerReferences: [...(existing.restrictedPlayerReferences || [])],
    teams: (existing.teams || []).map((team) => pickFields(team, TEAM_EXPORT_FIELDS)),
  }
}

function requestedFieldKeys(body = {}) {
  const keys = [
    ...(Array.isArray(body.fields) ? body.fields : []),
    ...(Array.isArray(body.requestedFields) ? body.requestedFields : []),
  ]
  return new Set(keys.map((value) => normalizeText(value).toLowerCase()).filter(Boolean))
}

export function assertDataTransferExportRequestAllowed({ body = {}, fieldPolicy = {}, ordinaryDataset = '' } = {}) {
  const fields = requestedFieldKeys(body)
  const requestsGuardianContacts = body.includeGuardianContacts === true
    || [...fields].some((field) => GUARDIAN_CONTACT_FIELDS.has(field))
  const requestsGuardianPostal = body.includeGuardianPostal === true
    || [...fields].some((field) => GUARDIAN_POSTAL_FIELDS.has(field))

  if (ordinaryDataset === 'players_and_guardians' && !fieldPolicy.guardianContactFields) {
    throw accessError('Your role cannot export parent or guardian contact fields.', 'FIELD_DENIED')
  }
  if (requestsGuardianContacts && !fieldPolicy.guardianContactFields) {
    throw accessError('Guardian contact fields are not available for this role.', 'FIELD_DENIED')
  }
  if (requestsGuardianPostal && !fieldPolicy.guardianPostalFields) {
    throw accessError('Guardian postal fields are not available for this role.', 'FIELD_DENIED')
  }
}

function safeUuid(value) {
  const normalized = normalizeText(value)
  return UUID_PATTERN.test(normalized) ? normalized.toLowerCase() : null
}

export function safeDataTransferRequestId(value, fallback = '') {
  const normalized = normalizeText(value)
  if (SAFE_REQUEST_ID_PATTERN.test(normalized)) return normalized
  return normalizeText(fallback)
}

export function buildDataTransferDenialAuditMetadata({
  actor = {},
  body = {},
  denialCode = 'DATA_TRANSFER_DENIED',
  operation = 'unknown',
  requestId = '',
  resolvedAuthorizedClubId = null,
  resolvedAuthorizedTeamIds = [],
  timestamp = new Date().toISOString(),
} = {}) {
  return {
    actorId: safeUuid(actor.id),
    actorRole: normalizeRole(actor.role) || 'unknown',
    denialCode: normalizeText(denialCode).slice(0, 80) || 'DATA_TRANSFER_DENIED',
    operation: normalizeText(operation).slice(0, 80) || 'unknown',
    outcome: 'denied',
    requestId: safeDataTransferRequestId(requestId),
    requestedClubId: safeUuid(body.clubId),
    requestedTeamIds: (Array.isArray(body.teamIds) ? body.teamIds : []).map(safeUuid).filter(Boolean).slice(0, 20),
    resolvedAuthorizedClubId: safeUuid(resolvedAuthorizedClubId),
    resolvedAuthorizedTeamIds: resolvedAuthorizedTeamIds.map(safeUuid).filter(Boolean).slice(0, 250),
    timestamp,
  }
}
