const ACTIVE_STATUS = 'active'
const RECOGNISED_STAFF_ROLES = new Set([
  'admin',
  'head_manager',
  'manager',
  'coach',
  'assistant_coach',
])
const STAFF_ROLE_RANKS = Object.freeze({
  admin: 90,
  head_manager: 70,
  manager: 50,
  coach: 30,
  assistant_coach: 20,
})

function normalizeStatus(value) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeRole(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function isExpired(value, now = Date.now()) {
  if (!value) {
    return false
  }

  const expiresAt = new Date(value).getTime()
  return !Number.isNaN(expiresAt) && expiresAt <= now
}

function hasInactiveOptionalStatus(value) {
  const status = normalizeStatus(value)
  return Boolean(status) && status !== ACTIVE_STATUS
}

export function isActiveStaffAccount(profile) {
  return Boolean(profile?.id)
    && normalizeStatus(profile?.status ?? profile?.accountStatus) === ACTIVE_STATUS
    && !profile?.suspended_at
    && !profile?.accountSuspendedAt
    && !profile?.removed_at
    && !profile?.removedAt
    && !isExpired(profile?.expires_at ?? profile?.expiresAt)
}

export function isActiveStaffMembership(membership) {
  const role = normalizeRole(membership?.role ?? membership?.roleKey)
  const roleRank = Number(membership?.roleRank ?? membership?.role_rank ?? STAFF_ROLE_RANKS[role] ?? 0)
  const clubStatus = normalizeStatus(membership?.clubStatus ?? membership?.club_status)
  const teamId = membership?.teamId ?? membership?.team_id

  return Boolean(membership?.clubId ?? membership?.club_id)
    && RECOGNISED_STAFF_ROLES.has(role)
    && roleRank >= 20
    && clubStatus === ACTIVE_STATUS
    && !membership?.club_suspended_at
    && !membership?.clubSuspendedAt
    && !hasInactiveOptionalStatus(membership?.membershipStatus ?? membership?.membership_status ?? membership?.status)
    && !membership?.suspended_at
    && !membership?.suspendedAt
    && !membership?.removed_at
    && !membership?.removedAt
    && !isExpired(membership?.expires_at ?? membership?.expiresAt)
    && (!teamId || !hasInactiveOptionalStatus(membership?.teamStatus ?? membership?.team_status))
}

export function getActiveStaffMemberships(memberships = []) {
  return Array.isArray(memberships) ? memberships.filter(isActiveStaffMembership) : []
}

export function canSwitchParentToStaff({ memberships = [], profile } = {}) {
  return isActiveStaffAccount(profile) && getActiveStaffMemberships(memberships).length > 0
}

export function buildLegacyStaffMembershipFromProfile({ club, profile } = {}) {
  const clubId = profile?.club_id ?? profile?.clubId
  const role = normalizeRole(profile?.role)
  const roleRank = Number(profile?.role_rank ?? profile?.roleRank ?? STAFF_ROLE_RANKS[role] ?? 0)

  if (!clubId || !RECOGNISED_STAFF_ROLES.has(role)) {
    return null
  }

  return {
    clubId,
    clubStatus: club?.status ?? profile?.club_status ?? profile?.clubStatus,
    clubSuspendedAt: club?.suspended_at ?? profile?.club_suspended_at ?? profile?.clubSuspendedAt,
    role,
    roleRank,
  }
}
