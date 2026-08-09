export const COACH_CONTEXT_SCHEMA_VERSION = 1

export const COACH_STAFF_ROLES = Object.freeze({
  admin: Object.freeze({ label: 'Club Admin', rank: 90 }),
  assistant_coach: Object.freeze({ label: 'Assistant Coach', rank: 20 }),
  coach: Object.freeze({ label: 'Coach', rank: 30 }),
  head_manager: Object.freeze({ label: 'Team Admin', rank: 70 }),
  manager: Object.freeze({ label: 'Manager', rank: 50 }),
})

const PORTAL_ONLY_ROLES = new Set(['adult_player', 'parent_portal'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeRole(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeStatus(value, fallback = 'active') {
  return normalizeText(value || fallback).toLowerCase() || fallback
}

function isActiveStatus(value) {
  return normalizeStatus(value) === 'active'
}

function isArchived(value) {
  return Boolean(normalizeText(value))
}

export function getCoachContextMarkerKey(userId) {
  const normalizedUserId = normalizeText(userId)
  if (!normalizedUserId) throw new Error('coach_context_user_required')
  return `fp.coach.context.v${COACH_CONTEXT_SCHEMA_VERSION}.${normalizedUserId}`
}

export function createCoachContextMarker(context) {
  if (!context?.id || !context?.clubId) throw new Error('coach_context_invalid')
  return Object.freeze({
    clubId: normalizeText(context.clubId),
    contextId: normalizeText(context.id),
    schemaVersion: COACH_CONTEXT_SCHEMA_VERSION,
    teamId: normalizeText(context.teamId),
  })
}

export function parseCoachContextMarker(value) {
  try {
    const marker = JSON.parse(String(value || ''))
    if (
      marker?.schemaVersion !== COACH_CONTEXT_SCHEMA_VERSION
      || !normalizeText(marker?.contextId)
      || !normalizeText(marker?.clubId)
    ) {
      return null
    }
    return createCoachContextMarker({
      clubId: marker.clubId,
      id: marker.contextId,
      teamId: marker.teamId,
    })
  } catch {
    return null
  }
}

export function getCoachPaymentAccess(context) {
  if (!context) {
    return Object.freeze({ canMutate: false, canRead: false, payerAuthority: 'none', state: 'access_denied' })
  }

  const hasActivePlanAccess = Boolean(context.hasActivePlanAccess)
  const role = normalizeRole(context.role)
  const roleRank = Number(context.roleRank || 0)
  const workspaceScope = normalizeText(context.workspaceScope).toLowerCase()
  let payerAuthority = 'none'

  if (role === 'admin' && roleRank >= 90 && workspaceScope === 'club') payerAuthority = 'club'
  else if (role === 'head_manager' && roleRank >= 70 && workspaceScope === 'team') payerAuthority = 'team'

  return Object.freeze({
    canMutate: hasActivePlanAccess,
    canRead: true,
    payerAuthority,
    state: hasActivePlanAccess ? 'active' : 'payment_required',
  })
}

export function normalizeCoachContext(rawContext) {
  const role = normalizeRole(rawContext?.role)
  const registeredRole = COACH_STAFF_ROLES[role]
  const roleRank = Number(rawContext?.roleRank || registeredRole?.rank || 0)
  const clubId = normalizeText(rawContext?.clubId)
  const teamId = normalizeText(rawContext?.teamId)
  const type = teamId ? 'team' : 'club'
  const id = normalizeText(rawContext?.id || `${type}:${teamId || clubId}`)
  const normalized = {
    archivedAt: normalizeText(rawContext?.archivedAt),
    authorityId: normalizeText(rawContext?.authorityId),
    authoritySource: normalizeText(rawContext?.authoritySource),
    clubAccent: normalizeText(rawContext?.clubAccent),
    clubButtonStyle: normalizeText(rawContext?.clubButtonStyle),
    clubId,
    clubLogoUrl: normalizeText(rawContext?.clubLogoUrl),
    clubName: normalizeText(rawContext?.clubName || 'Club workspace'),
    clubStatus: normalizeStatus(rawContext?.clubStatus),
    hasActivePlanAccess: Boolean(rawContext?.hasActivePlanAccess),
    id,
    planKey: normalizeText(rawContext?.planKey),
    planStatus: normalizeStatus(rawContext?.planStatus),
    role,
    roleLabel: normalizeText(rawContext?.roleLabel || registeredRole?.label || role),
    roleRank,
    teamAccent: normalizeText(rawContext?.teamAccent),
    teamButtonStyle: normalizeText(rawContext?.teamButtonStyle),
    teamId,
    teamName: normalizeText(rawContext?.teamName),
    teamStatus: normalizeStatus(rawContext?.teamStatus),
    type,
    workspaceScope: normalizeText(rawContext?.workspaceScope || type).toLowerCase(),
  }

  return Object.freeze({
    ...normalized,
    paymentAccess: getCoachPaymentAccess(normalized),
  })
}

export function isCoachContextOperational(context) {
  if (!context?.id || !context?.clubId || !COACH_STAFF_ROLES[normalizeRole(context.role)]) return false
  if (!isActiveStatus(context.clubStatus) || !isActiveStatus(context.teamStatus)) return false
  if (isArchived(context.archivedAt)) return false
  if (context.type === 'team' && !context.teamId) return false
  if (context.type === 'club' && normalizeRole(context.role) !== 'admin') return false
  return true
}

export function resolveCoachStaffContext({ profile, requestedContextId = '' } = {}) {
  const accountStatus = normalizeStatus(profile?.accountStatus)
  if (!profile?.id) return Object.freeze({ allowed: false, code: 'staff_profile_required', contexts: [] })
  if (!isActiveStatus(accountStatus)) return Object.freeze({ allowed: false, code: 'staff_account_inactive', contexts: [] })

  const role = normalizeRole(profile?.role)
  const contexts = (Array.isArray(profile?.coachContexts) ? profile.coachContexts : [])
    .map(normalizeCoachContext)
    .filter(isCoachContextOperational)

  if (contexts.length === 0) {
    if (PORTAL_ONLY_ROLES.has(role)) {
      return Object.freeze({ allowed: false, code: `${role}_operational_staff_required`, contexts: [] })
    }
    if (role === 'super_admin') {
      return Object.freeze({ allowed: false, code: 'platform_admin_operational_membership_required', contexts: [] })
    }
    return Object.freeze({ allowed: false, code: 'active_staff_membership_required', contexts: [] })
  }

  const requested = normalizeText(requestedContextId)
  const selected = contexts.find((context) => context.id === requested)
    || contexts.find((context) => context.id === normalizeText(profile?.activeCoachContextId))
    || contexts[0]

  return Object.freeze({
    allowed: true,
    code: 'staff_context_ready',
    context: selected,
    contexts: Object.freeze(contexts),
  })
}

export function applyCoachContext(profile, context) {
  if (!profile?.id || !isCoachContextOperational(context)) throw new Error('coach_context_not_authorised')
  return Object.freeze({
    ...profile,
    activeCoachContextId: context.id,
    activeTeamId: context.teamId,
    activeTeamName: context.teamName,
    clubId: context.clubId,
    clubLogoUrl: context.clubLogoUrl,
    clubName: context.clubName,
    hasActivePlanAccess: context.hasActivePlanAccess,
    planKey: context.planKey,
    planStatus: context.planStatus,
    role: context.role,
    roleLabel: context.roleLabel,
    roleRank: context.roleRank,
    workspaceScope: context.workspaceScope,
  })
}

export function createCoachContextTransition(previousContext, nextContext) {
  if (!isCoachContextOperational(nextContext)) throw new Error('coach_context_not_authorised')
  const previousId = normalizeText(previousContext?.id)
  return Object.freeze({
    clearDomainState: previousId !== nextContext.id,
    nextContextId: nextContext.id,
    previousContextId: previousId,
    resetMutationScope: previousId !== nextContext.id,
  })
}
